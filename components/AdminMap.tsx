'use client';

import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    // Default center to Jaipur or first active bus
    let center: L.LatLngExpression = [26.9124, 75.7873];
    const busesWithLocation = busesLocations.filter((b) => b.latest_location);
    if (busesWithLocation.length > 0 && busesWithLocation[0].latest_location) {
      center = [
        busesWithLocation[0].latest_location.latitude,
        busesWithLocation[0].latest_location.longitude,
      ];
    }

    // Initialize Leaflet map
    const map = L.map('admin-map', { zoomControl: true }).setView(center, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapRef.current = map;

    // Bus Icon Factory
    const createBusIcon = (name: string, isActive: boolean) => {
      const bgClass = isActive 
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

    // Render initial bus markers
    busesLocations.forEach((bus) => {
      if (bus.latest_location) {
        const { latitude, longitude, speed } = bus.latest_location;
        const icon = createBusIcon(bus.bus_name, bus.is_active);
        
        const marker = L.marker([latitude, longitude], { icon }).addTo(map);
        
        marker.bindPopup(`
          <div class="font-sans space-y-1">
            <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
              ${bus.bus_name}
              <span class="inline-block w-2.5 h-2.5 rounded-full ${bus.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
            </div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${bus.is_active ? 'Active Trip' : 'Inactive'}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${bus.route_name}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${bus.driver_name}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${speed.toFixed(1)} km/h</div>
          </div>
        `);
        
        markersRef.current[bus.bus_id] = marker;
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
          
          // Find matching bus metadata
          const matchingBus = busesLocations.find((b) => b.bus_id === bus_id);
          const busName = matchingBus ? matchingBus.bus_name : 'Active Bus';
          const isActive = matchingBus ? matchingBus.is_active : false;
          const routeName = matchingBus ? matchingBus.route_name : 'Assigned Route';
          const driverName = matchingBus ? matchingBus.driver_name : 'Assigned Driver';

          const marker = markersRef.current[bus_id];
          const icon = createBusIcon(busName, isActive);

          if (marker) {
            marker.setLatLng([latitude, longitude]);
            marker.setIcon(icon);
            marker.setPopupContent(`
              <div class="font-sans space-y-1">
                <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                  ${busName}
                  <span class="inline-block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
                </div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${isActive ? 'Active Trip' : 'Inactive'}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${routeName}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${driverName}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${Number(speed || 0).toFixed(1)} km/h</div>
              </div>
            `);
          } else {
            // New active bus locations detected in real-time
            const newMarker = L.marker([latitude, longitude], { icon }).addTo(map);
            newMarker.bindPopup(`
              <div class="font-sans space-y-1">
                <div class="font-bold text-slate-950 text-sm flex items-center gap-1.5">
                  ${busName}
                  <span class="inline-block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
                </div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Status:</span> ${isActive ? 'Active Trip' : 'Inactive'}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${routeName}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${driverName}</div>
                <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${Number(speed || 0).toFixed(1)} km/h</div>
              </div>
            `);
            markersRef.current[bus_id] = newMarker;
          }
        }
      )
      .subscribe();

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    const container = document.getElementById('admin-map');
    if (container) resizeObserver.observe(container);

    return () => {
      supabase.removeChannel(channel);
      resizeObserver.disconnect();
      map.remove();
    };
  }, [activeTrips, busesLocations]);

  return (
    <div className="relative z-0 w-full h-[450px] border border-slate-200 rounded-2xl overflow-hidden shadow-inner">
      <div id="admin-map" className="w-full h-full" />
    </div>
  );
}
export default AdminMap;
