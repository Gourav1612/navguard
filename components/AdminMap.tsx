'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface Plant {
  id: string;
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  address?: string;
}

interface TelemetryPoint {
  id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  battery_level: number;
  is_tracking: boolean;
  recorded_at: string;
  user: {
    id: string;
    full_name: string;
    role: string;
    plant_id: string;
    supervisor_name?: string | null;
  } | null;
}

interface AdminMapProps {
  plants?: Plant[];
  locations?: TelemetryPoint[];
  selectedPlantId?: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function AdminMap({ plants = [], locations = [], selectedPlantId = 'all' }: AdminMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  // Track markers by userId
  const markersRef = useRef<Record<string, L.Marker>>({});
  // Track plant circles by plantId
  const plantCirclesRef = useRef<Record<string, L.Layer[]>>({});

  // Centering map when selected plant changes
  useEffect(() => {
    if (selectedPlantId !== 'all' && mapRef.current) {
      const selectedPlant = plants.find((p) => p.id === selectedPlantId);
      if (selectedPlant && selectedPlant.latitude && selectedPlant.longitude) {
        mapRef.current.setView(
          [Number(selectedPlant.latitude), Number(selectedPlant.longitude)],
          15,
          { animate: true }
        );
      }
    }
  }, [selectedPlantId, plants]);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    let center: L.LatLngExpression = [26.9124, 75.7873]; // Jaipur default
    if (plants.length > 0 && plants[0].latitude && plants[0].longitude) {
      center = [Number(plants[0].latitude), Number(plants[0].longitude)];
    }

    const map = L.map('admin-map', { zoomControl: true }).setView(center, 12);
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
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Sync Plants and markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Render Plants
    Object.values(plantCirclesRef.current).forEach((layers) => layers.forEach((l) => l.remove()));
    plantCirclesRef.current = {};

    plants.forEach((plant) => {
      if (!plant.latitude || !plant.longitude) return;
      const isFiltered = selectedPlantId === 'all' || selectedPlantId === plant.id;
      if (!isFiltered) return;

      const position: L.LatLngExpression = [Number(plant.latitude), Number(plant.longitude)];

      // 🏢 Plant Center Emoji Marker
      const plantIcon = L.divIcon({
        html: `<div class="flex items-center justify-center w-8 h-8 bg-white border border-slate-350 rounded-lg shadow-md text-lg">🏢</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      const centerMarker = L.marker(position, { icon: plantIcon })
        .addTo(map)
        .bindPopup(`
          <div class="font-sans">
            <div class="font-extrabold text-slate-800 text-xs">${escapeHtml(plant.name)}</div>
            <div class="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Code: ${escapeHtml(plant.code)}</div>
            <div class="text-[10px] text-slate-500 mt-1">${escapeHtml(plant.address || '')}</div>
          </div>
        `);

      // Geofence Circle
      const geofenceCircle = L.circle(position, {
        radius: plant.radius_meters || 100,
        color: '#6366f1', // Indigo
        fillColor: '#818cf8',
        fillOpacity: 0.15,
        weight: 1.5,
      }).addTo(map);

      plantCirclesRef.current[plant.id] = [centerMarker, geofenceCircle];
    });

    // Marker Icon Creators
    const createPinIcon = (name: string, role: string, isTracking: boolean) => {
      const initials = name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
      let colorClass = 'bg-blue-600 border-blue-800 text-white'; // Worker: Blue
      let iconEmoji = '🔵';

      if (role === 'manager') {
        colorClass = 'bg-purple-600 border-purple-800 text-white'; // Manager: Purple
        iconEmoji = '🟣';
      } else if (role === 'supervisor') {
        colorClass = 'bg-amber-500 border-amber-700 text-slate-900'; // Supervisor: Yellow/Amber
        iconEmoji = '🟡';
      }

      if (!isTracking) {
        colorClass = 'bg-slate-400 border-slate-600 text-white';
      }

      return L.divIcon({
        className: '',
        html: `
          <div class="relative flex items-center justify-center w-8 h-8 ${colorClass} border border-white rounded-full shadow-lg font-black text-[10px] tracking-tighter">
            <span>${initials}</span>
            <div class="absolute top-8 bg-slate-900/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
              ${escapeHtml(name)}
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    };

    // Sync Locations
    locations.forEach((loc) => {
      if (!loc.user) return;
      
      const shouldShow = selectedPlantId === 'all' || selectedPlantId === loc.user.plant_id;
      let marker = markersRef.current[loc.user.id];

      if (!shouldShow) {
        if (marker) {
          marker.remove();
          delete markersRef.current[loc.user.id];
        }
        return;
      }

      const position: L.LatLngExpression = [Number(loc.latitude), Number(loc.longitude)];
      const icon = createPinIcon(loc.user.full_name, loc.user.role, loc.is_tracking);
      const roleLabel = loc.user.role === 'manager' ? 'Plant Manager' : loc.user.role === 'supervisor' ? 'Supervisor' : 'Worker';

      const popupHtml = `
        <div class="font-sans space-y-1">
          <div class="font-black text-slate-900 text-sm flex items-center gap-1.5">
            ${escapeHtml(loc.user.full_name)}
            <span class="inline-block w-2 h-2 rounded-full ${loc.is_tracking ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}"></span>
          </div>
          <div class="text-[10px] text-slate-400 font-bold uppercase">${roleLabel}</div>
          ${loc.user.supervisor_name ? `<div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Supervisor:</span> ${escapeHtml(loc.user.supervisor_name)}</div>` : ''}
          <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Speed:</span> ${loc.speed.toFixed(1)} km/h</div>
          <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Battery:</span> ${loc.battery_level !== null ? `${loc.battery_level}%` : '—'}</div>
          <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Accuracy:</span> ${loc.accuracy.toFixed(1)} m</div>
          <div class="pt-1.5 border-t border-slate-100 mt-2">
            <a 
              href="https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}" 
              target="_blank" 
              rel="noopener noreferrer" 
              class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
            >
              📍 Open Location
            </a>
          </div>
        </div>
      `;

      if (marker) {
        marker.setLatLng(position);
        marker.setIcon(icon);
        marker.setPopupContent(popupHtml);
      } else {
        marker = L.marker(position, { icon }).addTo(map).bindPopup(popupHtml);
        markersRef.current[loc.user.id] = marker;
      }
    });

    // Clean up markers for users that are no longer in locations list
    Object.keys(markersRef.current).forEach((userId) => {
      const exists = locations.some((loc) => loc.user?.id === userId);
      if (!exists) {
        markersRef.current[userId].remove();
        delete markersRef.current[userId];
      }
    });

    // Realtime location update WebSocket subscription
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel('live-locations-command-map')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_locations' },
        (payload: any) => {
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old.user_id;
            if (markersRef.current[oldId]) {
              markersRef.current[oldId].remove();
              delete markersRef.current[oldId];
            }
            return;
          }

          const newLoc = payload.new;
          const matchingLoc = locations.find((l) => l.user?.id === newLoc.user_id);
          if (!matchingLoc || !matchingLoc.user) return;

          const shouldShow = selectedPlantId === 'all' || selectedPlantId === matchingLoc.user.plant_id;
          if (!shouldShow) return;

          const pos: L.LatLngExpression = [Number(newLoc.latitude), Number(newLoc.longitude)];
          let marker = markersRef.current[newLoc.user_id];
          const icon = createPinIcon(matchingLoc.user.full_name, matchingLoc.user.role, newLoc.is_tracking);
          const roleLbl = matchingLoc.user.role === 'manager' ? 'Plant Manager' : matchingLoc.user.role === 'supervisor' ? 'Supervisor' : 'Worker';

          const popHtml = `
            <div class="font-sans space-y-1">
              <div class="font-black text-slate-900 text-sm flex items-center gap-1.5">
                ${escapeHtml(matchingLoc.user.full_name)}
                <span class="inline-block w-2 h-2 rounded-full ${newLoc.is_tracking ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}"></span>
              </div>
              <div class="text-[10px] text-slate-400 font-bold uppercase">${roleLbl}</div>
              ${matchingLoc.user.supervisor_name ? `<div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Supervisor:</span> ${escapeHtml(matchingLoc.user.supervisor_name)}</div>` : ''}
              <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Speed:</span> ${Number(newLoc.speed || 0).toFixed(1)} km/h</div>
              <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Battery:</span> ${newLoc.battery_level !== null ? `${newLoc.battery_level}%` : '—'}</div>
              <div class="text-[11px] text-slate-500"><span class="font-bold text-slate-600">Accuracy:</span> ${Number(newLoc.accuracy || 0).toFixed(1)} m</div>
              <div class="pt-1.5 border-t border-slate-100 mt-2">
                <a 
                  href="https://www.google.com/maps/search/?api=1&query=${newLoc.latitude},${newLoc.longitude}" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  class="inline-flex items-center justify-center w-full px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#5c3b99] text-[10px] font-bold rounded-lg transition-all text-center no-underline"
                >
                  📍 Open Location
                </a>
              </div>
            </div>
          `;

          if (marker) {
            marker.setLatLng(pos);
            marker.setIcon(icon);
            marker.setPopupContent(popHtml);
          } else {
            marker = L.marker(pos, { icon }).addTo(map).bindPopup(popHtml);
            markersRef.current[newLoc.user_id] = marker;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [plants, locations, selectedPlantId]);

  return (
    <div className="relative z-0 w-full h-[450px] border border-slate-200 rounded-2xl overflow-hidden shadow-inner">
      <div id="admin-map" className="w-full h-full animate-in fade-in duration-300" />
    </div>
  );
}

export default AdminMap;
