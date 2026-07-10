'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface ActiveTrip {
  trip_id: string;
  bus: {
    id: string;
    name: string;
  };
  driver: {
    full_name: string;
  };
  route: {
    name: string;
  };
  latest_location: {
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    recorded_at: string;
  } | null;
}

interface AdminMapProps {
  activeTrips: ActiveTrip[];
}

export function AdminMap({ activeTrips = [] }: AdminMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  // Track markers by busId
  const markersRef = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    // Default center to Jaipur or first active bus
    let center: L.LatLngExpression = [26.9124, 75.7873];
    const tripsWithLocation = activeTrips.filter((t) => t.latest_location);
    if (tripsWithLocation.length > 0 && tripsWithLocation[0].latest_location) {
      center = [
        tripsWithLocation[0].latest_location.latitude,
        tripsWithLocation[0].latest_location.longitude,
      ];
    }

    // Initialize Leaflet map
    const map = L.map('admin-map', { zoomControl: true }).setView(center, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapRef.current = map;

    // Bus Icon Factory
    const createBusIcon = (name: string) => {
      return L.divIcon({
        className: '',
        html: `
          <div class="relative flex items-center justify-center w-9 h-9 bg-amber-400 border-2 border-amber-600 rounded-full shadow-lg transition-all duration-300">
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

    // Render initial active bus markers
    activeTrips.forEach((trip) => {
      if (trip.latest_location) {
        const { latitude, longitude, speed } = trip.latest_location;
        const icon = createBusIcon(trip.bus.name);
        
        const marker = L.marker([latitude, longitude], { icon }).addTo(map);
        
        marker.bindPopup(`
          <div class="font-sans space-y-1">
            <div class="font-bold text-slate-950 text-sm">${trip.bus.name}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Route:</span> ${trip.route.name}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Driver:</span> ${trip.driver.full_name}</div>
            <div class="text-xs text-slate-500"><span class="font-semibold text-slate-700">Speed:</span> ${speed.toFixed(1)} km/h</div>
          </div>
        `);
        
        markersRef.current[trip.bus.id] = marker;
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
          const { bus_id, latitude, longitude, speed, heading } = payload.new;
          
          // Find matching trip for bus metadata
          const matchingTrip = activeTrips.find((t) => t.bus.id === bus_id);
          const busName = matchingTrip ? matchingTrip.bus.name : 'Active Bus';
          const routeName = matchingTrip ? matchingTrip.route.name : 'Assigned Route';
          const driverName = matchingTrip ? matchingTrip.driver.full_name : 'Assigned Driver';

          const marker = markersRef.current[bus_id];
          const icon = createBusIcon(busName);

          if (marker) {
            marker.setLatLng([latitude, longitude]);
            marker.setPopupContent(`
              <div class="font-sans space-y-1">
                <div class="font-bold text-slate-950 text-sm">${busName}</div>
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
                <div class="font-bold text-slate-950 text-sm">${busName}</div>
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
  }, [activeTrips]);

  return (
    <div className="relative z-0 w-full h-[450px] border border-slate-200 rounded-2xl overflow-hidden shadow-inner">
      <div id="admin-map" className="w-full h-full" />
    </div>
  );
}
export default AdminMap;
