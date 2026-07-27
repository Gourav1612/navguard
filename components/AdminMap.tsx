'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface BusLocation {
  bus_id: string;
  bus_name: string;
  registration_plate: string;
  is_active: boolean;
  trip_id: string | null;
  driver_name: string;
  route_name: string;
  latest_location: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    recorded_at: string;
  } | null;
}

interface AdminMapProps {
  activeTrips?: any[];
  busesLocations?: BusLocation[];
}

export function AdminMap({ activeTrips = [], busesLocations = [] }: AdminMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  // Track markers by busId
  const markersRef = useRef<Record<string, L.Marker>>({});
  // Track route layers (lines/stops) for cleanup
  const routeLayersRef = useRef<L.Layer[]>([]);

  const [filterBusId, setFilterBusId] = useState<string>('all');

  // Centering map on select bus changes
  useEffect(() => {
    if (filterBusId !== 'all' && mapRef.current) {
      const selectedBus = busesLocations.find((b) => b.bus_id === filterBusId);
      if (selectedBus?.latest_location) {
        mapRef.current.setView(
          [selectedBus.latest_location.latitude, selectedBus.latest_location.longitude],
          15,
          { animate: true }
        );
      }
    }
  }, [filterBusId, busesLocations]);

  // 1. Initialize Leaflet Map exactly once on mount
  useEffect(() => {
    console.log("AdminMap: First effect mounting...");
    // Default center to Jaipur or first active bus
    let center: L.LatLngExpression = [26.9124, 75.7873];
    const busesWithLocation = busesLocations.filter((b) => b.latest_location);
    if (busesWithLocation.length > 0 && busesWithLocation[0].latest_location) {
      center = [
        busesWithLocation[0].latest_location.latitude,
        busesWithLocation[0].latest_location.longitude,
      ];
    }

    const map = L.map('admin-map', { zoomControl: true }).setView(center, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapRef.current = map;

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    const container = document.getElementById('admin-map');
    if (container) resizeObserver.observe(container);

    return () => {
      console.log("AdminMap: First effect unmounting (map cleanup)...");
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // Run ONLY once on mount

  // 2. Sync markers and listen to Supabase realtime events on the mounted map (preserves zoom level)
  useEffect(() => {
    console.log("AdminMap: Second effect running due to busesLocations change...", busesLocations);
    const map = mapRef.current;
    if (!map) {
      console.log("AdminMap: Second effect skipped, map is not initialized yet");
      return;
    }

    // Clear old route layers
    routeLayersRef.current.forEach((layer) => layer.remove());
    routeLayersRef.current = [];

    // Filter active trips based on selection
    const filteredTrips = filterBusId === 'all'
      ? activeTrips
      : activeTrips.filter((t) => t.bus?.id === filterBusId);

    // Draw route lines and stops for filtered active trips
    filteredTrips.forEach((trip, tripIdx) => {
      const routeStops = trip.route?.stops || [];
      if (routeStops.length > 0) {
        const sortedStops = [...routeStops].sort((a: any, b: any) => a.stop_order - b.stop_order);
        
        // Use different colors for different routes if displaying all
        const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899'];
        const routeColor = colors[tripIdx % colors.length];

        // Draw polyline connecting stops
        const polylineCoords = sortedStops.map((stop: any) => [Number(stop.latitude), Number(stop.longitude)] as L.LatLngExpression);
        if (polylineCoords.length > 1) {
          const routePolyline = L.polyline(polylineCoords, {
            color: routeColor,
            weight: 5,
            opacity: 0.65,
            dashArray: '5, 8'
          }).addTo(map);
          routeLayersRef.current.push(routePolyline);
        }

        // Draw stop circle markers
        sortedStops.forEach((stop: any, idx: number) => {
          let color = '#3b82f6';
          let fillColor = '#93c5fd';
          let radius = 5;

          if (idx === 0) {
            color = '#ef4444'; // Start stop (School Campus)
            fillColor = '#f87171';
            radius = 7;
          } else if (idx === sortedStops.length - 1) {
            color = '#10b981'; // End stop
            fillColor = '#34d399';
            radius = 7;
          }

          const stopMarker = L.circleMarker([Number(stop.latitude), Number(stop.longitude)], {
            radius,
            color,
            fillColor,
            fillOpacity: 0.9,
            weight: 2
          })
            .addTo(map)
            .bindPopup(`
              <div class="font-sans">
                <div class="font-bold text-slate-800 text-xs">${stop.name}</div>
                <div class="text-[10px] text-slate-500">Transit Stop #${idx + 1}</div>
              </div>
            `);
          routeLayersRef.current.push(stopMarker);
        });
      }
    });

    // Bus Icon Factory
    const createBusIcon = (name: string, isActive: boolean, isStale?: boolean) => {
      const bgClass = isStale
        ? 'bg-red-500 border-red-700 text-white'
        : isActive 
          ? 'bg-amber-400 border-amber-600 text-slate-800' 
          : 'bg-slate-200 border-slate-400 text-slate-500';
      return L.divIcon({
        className: '',
        html: `
          <div class="relative flex items-center justify-center w-9 h-9 ${bgClass} border-2 rounded-full shadow-lg transition-all duration-300">
            <span class="text-sm">🚌</span>
            <div class="absolute top-10 bg-slate-900/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
              ${name}
            </div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
    };

    // Render or update active markers
    busesLocations.forEach((bus) => {
      // If we filtered by a specific bus, hide others
      const shouldShow = filterBusId === 'all' || filterBusId === bus.bus_id;
      
      let marker = markersRef.current[bus.bus_id];
      if (!shouldShow) {
        if (marker) {
          marker.remove();
          delete markersRef.current[bus.bus_id];
        }
        return;
      }

      if (bus.latest_location) {
        const { latitude, longitude, speed, is_stale } = bus.latest_location as any;
        const icon = createBusIcon(bus.bus_name, bus.is_active, is_stale);
        const matchingTrip = activeTrips.find((t: any) => t.bus?.id === bus.bus_id);

        let nearestStopInfo = '';
        if (matchingTrip?.route?.stops && matchingTrip.route.stops.length > 0) {
          let nearestStop: any = null;
          let minDistance = Infinity;
          matchingTrip.route.stops.forEach((stop: any) => {
            const d = calculateDistanceKm(latitude, longitude, Number(stop.latitude), Number(stop.longitude));
            if (d < minDistance) {
              minDistance = d;
              nearestStop = stop;
            }
          });
          if (nearestStop) {
            const distLabel = minDistance < 1 ? `${Math.round(minDistance * 1000)}m` : `${minDistance.toFixed(1)} km`;
            nearestStopInfo = `<div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Nearest Stop:</span> ${nearestStop.name} (${distLabel})</div>`;
          }
        }
        
        if (marker) {
          marker.setLatLng([latitude, longitude]);
          marker.setIcon(icon);
          marker.setPopupContent(`
            <div class="font-sans space-y-1.5">
              <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                ${bus.bus_name}
                <span class="inline-block w-2.5 h-2.5 rounded-full ${bus.is_active ? (is_stale ? 'bg-red-500' : 'bg-emerald-500 animate-pulse') : 'bg-slate-400'}"></span>
              </div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${bus.is_active ? (is_stale ? '⚠️ Offline / GPS Lost' : 'Active Trip') : 'Inactive'}</div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${bus.route_name}</div>
              ${nearestStopInfo}
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${bus.driver_name}</div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${is_stale ? '0.0' : speed.toFixed(1)} km/h</div>
              <div class="pt-2 border-t border-slate-100 mt-2">
                <a 
                  href="https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
                >
                  📍 Open Location
                </a>
              </div>
            </div>
          `);
        } else {
          marker = L.marker([latitude, longitude], { icon }).addTo(map);
          marker.bindPopup(`
            <div class="font-sans space-y-1.5">
              <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                ${bus.bus_name}
                <span class="inline-block w-2.5 h-2.5 rounded-full ${bus.is_active ? (is_stale ? 'bg-red-500' : 'bg-emerald-500 animate-pulse') : 'bg-slate-400'}"></span>
              </div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${bus.is_active ? (is_stale ? '⚠️ Offline / GPS Lost' : 'Active Trip') : 'Inactive'}</div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${bus.route_name}</div>
              ${nearestStopInfo}
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${bus.driver_name}</div>
              <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${is_stale ? '0.0' : speed.toFixed(1)} km/h</div>
              <div class="pt-2 border-t border-slate-100 mt-2">
                <a 
                  href="https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
                >
                  📍 Open Location
                </a>
              </div>
            </div>
          `);
          markersRef.current[bus.bus_id] = marker;
        }
      }
    });

    // Supabase Realtime subscription for all bus locations
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel('admin-tracking-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bus_locations' },
        (payload: any) => {
          const { bus_id, latitude, longitude, speed } = payload.new;
          
          // If we filtered by a specific bus, hide updates for others
          const shouldShow = filterBusId === 'all' || filterBusId === bus_id;
          if (!shouldShow) {
            const marker = markersRef.current[bus_id];
            if (marker) {
              marker.remove();
              delete markersRef.current[bus_id];
            }
            return;
          }

          // Find matching bus metadata
          const matchingBus = busesLocations.find((b) => b.bus_id === bus_id);
          const busName = matchingBus ? matchingBus.bus_name : 'Active Bus';
          const isActive = matchingBus ? matchingBus.is_active : false;
          const routeName = matchingBus ? matchingBus.route_name : 'Assigned Route';
          const driverName = matchingBus ? matchingBus.driver_name : 'Assigned Driver';

          // Find nearest stop info
          let nearestStopInfo = '';
          const matchingTrip = activeTrips.find((t: any) => t.bus?.id === bus_id);
          if (latitude && longitude && matchingTrip?.route?.stops && matchingTrip.route.stops.length > 0) {
            let nearestStop: any = null;
            let minDistance = Infinity;
            matchingTrip.route.stops.forEach((stop: any) => {
              const d = calculateDistanceKm(Number(latitude), Number(longitude), Number(stop.latitude), Number(stop.longitude));
              if (d < minDistance) {
                minDistance = d;
                nearestStop = stop;
              }
            });
            if (nearestStop) {
              const distLabel = minDistance < 1 ? `${Math.round(minDistance * 1000)}m` : `${minDistance.toFixed(1)} km`;
              nearestStopInfo = `<div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Nearest Stop:</span> ${nearestStop.name} (${distLabel})</div>`;
            }
          }

          const marker = markersRef.current[bus_id];
          const icon = createBusIcon(busName, isActive);

          if (marker) {
            marker.setLatLng([latitude, longitude]);
            marker.setIcon(icon);
            marker.setPopupContent(`
              <div class="font-sans space-y-1.5">
                <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                  ${busName}
                  <span class="inline-block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
                </div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${isActive ? 'Active Trip' : 'Inactive'}</div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${routeName}</div>
                ${nearestStopInfo}
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${driverName}</div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${Number(speed || 0).toFixed(1)} km/h</div>
                <div class="pt-2 border-t border-slate-100 mt-2">
                  <a 
                    href="https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
                  >
                    📍 Open Location
                  </a>
                </div>
              </div>
            `);
          } else {
            const newMarker = L.marker([latitude, longitude], { icon }).addTo(map);
            newMarker.bindPopup(`
              <div class="font-sans space-y-1.5">
                <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                  ${busName}
                  <span class="inline-block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
                </div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${isActive ? 'Active Trip' : 'Inactive'}</div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${routeName}</div>
                ${nearestStopInfo}
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${driverName}</div>
                <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${Number(speed || 0).toFixed(1)} km/h</div>
                <div class="pt-2 border-t border-slate-100 mt-2">
                  <a 
                    href="https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
                  >
                    📍 Open Location
                  </a>
                </div>
              </div>
            `);
            markersRef.current[bus_id] = newMarker;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [busesLocations, activeTrips, filterBusId]);

// Haversine distance calculator helper
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

  return (
    <div className="relative z-0 w-full h-[450px] border border-slate-200 rounded-2xl overflow-hidden shadow-inner">
      <div id="admin-map" className="w-full h-full" />

      {/* Bus-Wise Filter Dropdown overlay */}
      <div className="absolute top-3 right-3 z-[1000] bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg p-1.5 flex items-center gap-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase pl-1.5">Fleet Filter:</span>
        <select
          value={filterBusId}
          onChange={(e) => setFilterBusId(e.target.value)}
          className="text-[10px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer font-sans"
        >
          <option value="all">All Active Buses</option>
          {busesLocations.map((b) => (
            <option key={b.bus_id} value={b.bus_id}>{b.bus_name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
export default AdminMap;
