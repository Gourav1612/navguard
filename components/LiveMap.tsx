'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { MapPin, ExternalLink } from 'lucide-react';

interface Stop {
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
}

interface LiveMapProps {
  busId: string;
  initialLocation?: { latitude: number; longitude: number } | null;
  stops: Stop[];
  highlightStopId?: string; // name of the student's stop to highlight
  showBus?: boolean;
  focusLocation?: { latitude: number; longitude: number } | null;
}

export function LiveMap({
  busId,
  initialLocation,
  stops = [],
  highlightStopId,
  showBus = true,
  focusLocation,
}: LiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerId = `map-${busId}`;
  
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(
    initialLocation || null
  );

  useEffect(() => {
    if (initialLocation) {
      setCurrentLocation(initialLocation);
    }
  }, [initialLocation]);

  useEffect(() => {
    // Determine initial center
    let center: L.LatLngExpression = [26.9124, 75.7873];
    if (initialLocation?.latitude && initialLocation?.longitude) {
      center = [initialLocation.latitude, initialLocation.longitude];
    } else if (stops.length > 0) {
      center = [stops[0].latitude, stops[0].longitude];
    }

    // Initialize Leaflet map
    const map = L.map(mapContainerId, { zoomControl: true }).setView(center, 14);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapRef.current = map;

    // Draw route connecting stops ordered by stop_order using actual road paths (OSRM API)
    const sortedStops = [...stops].sort((a, b) => a.stop_order - b.stop_order);

    // Guard flag: prevents async callbacks from calling .addTo() on an already-removed map
    let destroyed = false;

    function drawStraightLines() {
      if (destroyed) return;
      const polylineCoords = sortedStops.map(
        (stop) => [stop.latitude, stop.longitude] as L.LatLngExpression
      );
      if (polylineCoords.length > 1) {
        L.polyline(polylineCoords, {
          color: '#3b82f6',
          weight: 5,
          opacity: 0.7,
          dashArray: '5, 10',
        }).addTo(map);
      }
    }

    if (sortedStops.length > 1) {
      const osrmCoords = sortedStops.map(s => `${s.longitude},${s.latitude}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`;

      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (destroyed) return; // map already unmounted
          if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
            const roadCoords = data.routes[0].geometry.coordinates.map(
              ([lng, lat]: [number, number]) => [lat, lng] as L.LatLngExpression
            );
            L.polyline(roadCoords, {
              color: '#4f46e5',
              weight: 6,
              opacity: 0.85,
            }).addTo(map);
          } else {
            drawStraightLines();
          }
        })
        .catch((err) => {
          if (!destroyed) {
            console.error('OSRM road routing failed, falling back to straight lines:', err);
            drawStraightLines();
          }
        });
    }

    function escapeHtml(str: string) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Add stop markers
    sortedStops.forEach((stop) => {
      const isHighlighted = stop.name === highlightStopId;
      
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: isHighlighted ? 10 : 6,
        color: isHighlighted ? '#ef4444' : '#1d4ed8', // red highlight / blue standard
        fillColor: isHighlighted ? '#f87171' : '#60a5fa',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);

      // Create a nice popup label
      marker.bindPopup(`
        <div class="font-sans">
          <div class="font-bold text-slate-800">${escapeHtml(stop.name)}</div>
          <div class="text-xs text-slate-500">Stop Order: ${stop.stop_order}</div>
        </div>
      `);
    });

    // Custom bus icon
    const busIcon = L.divIcon({
      className: '',
      html: `
        <div class="relative flex items-center justify-center w-10 h-10 bg-amber-400 border-2 border-amber-600 rounded-full shadow-2xl animate-bounce">
          <span class="text-lg">🚌</span>
          <span class="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-green-500"></span>
          </span>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    // Place initial bus marker
    if (showBus && initialLocation?.latitude && initialLocation?.longitude) {
      markerRef.current = L.marker([initialLocation.latitude, initialLocation.longitude], {
        icon: busIcon,
      }).addTo(map);
    }

    // Supabase Realtime channel setup
    const supabase = createBrowserSupabaseClient();
    
    const channel = supabase
      .channel(`bus-location-${busId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bus_locations',
          filter: `bus_id=eq.${busId}`,
        },
        (payload: any) => {
          if (!showBus) return;
          const { latitude, longitude } = payload.new;
          
          setCurrentLocation({ latitude, longitude });
          
          if (markerRef.current) {
            markerRef.current.setLatLng([latitude, longitude]);
          } else {
            markerRef.current = L.marker([latitude, longitude], { icon: busIcon }).addTo(map);
          }
          
          // Re-center map smoothly
          map.panTo([latitude, longitude]);
        }
      )
      .subscribe();

    // Resize observer to ensure map fits properly in container
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    const container = document.getElementById(mapContainerId);
    if (container) resizeObserver.observe(container);

    return () => {
      destroyed = true; // cancel any pending OSRM/straight-line callbacks
      supabase.removeChannel(channel);
      resizeObserver.disconnect();
      map.remove();
    };
  }, [busId, stops, highlightStopId, showBus]);

  useEffect(() => {
    if (mapRef.current && focusLocation?.latitude && focusLocation?.longitude) {
      mapRef.current.setView([focusLocation.latitude, focusLocation.longitude], 16, {
        animate: true,
      });
    }
  }, [focusLocation]);

  return (
    <div className="relative w-full h-full min-h-[300px] border border-slate-200 rounded-xl overflow-hidden shadow-inner">
      <div id={mapContainerId} className="w-full h-full" />
      
      {showBus && currentLocation && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${currentLocation.latitude},${currentLocation.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-4 right-4 z-[1000] flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-semibold text-xs border border-slate-200 rounded-lg shadow-lg transition duration-200 cursor-pointer"
        >
          <MapPin className="w-3.5 h-3.5 text-red-500" />
          <span>Open in Google Maps</span>
          <ExternalLink className="w-3 h-3 text-slate-400" />
        </a>
      )}
    </div>
  );
}
export default LiveMap;
