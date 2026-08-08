'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { MapPin, ExternalLink, Navigation2, X, Compass } from 'lucide-react';

interface Stop {
  id?: string;
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
  userLocation?: { latitude: number; longitude: number } | null;
}

interface TargetDestinationInfo {
  name: string;
  distanceKm: number;
  durationMin: number;
  lat: number;
  lng: number;
}

export function LiveMap({
  busId,
  initialLocation,
  stops = [],
  highlightStopId,
  showBus = true,
  focusLocation,
  userLocation,
}: LiveMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  
  // Route polylines
  const fullRouteCoordsRef = useRef<[number, number][]>([]);
  const remainingPolylineRef = useRef<L.Polyline | null>(null);
  const traversedPolylineRef = useRef<L.Polyline | null>(null);
  const targetRoutePolylineRef = useRef<L.Polyline | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);

  const mapContainerId = `map-${busId}`;
  
  const [routeMode, setRouteMode] = useState<'road' | 'direct'>('road');
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(
    initialLocation || null
  );

  const [targetDestInfo, setTargetDestInfo] = useState<TargetDestinationInfo | null>(null);

  useEffect(() => {
    if (initialLocation) {
      setCurrentLocation(initialLocation);
    }
  }, [initialLocation]);

  // Helper: Find closest index on route coords array for bus position
  const findClosestRouteIndex = (coords: [number, number][], pos: { latitude: number; longitude: number }) => {
    if (!coords || coords.length === 0) return 0;
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < coords.length; i++) {
      const dLat = coords[i][0] - pos.latitude;
      const dLng = coords[i][1] - pos.longitude;
      const distSq = dLat * dLat + dLng * dLng;
      if (distSq < minDist) {
        minDist = distSq;
        closestIdx = i;
      }
    }
    return closestIdx;
  };

  // Helper: Update dynamic trailing & remaining route polylines
  const updateDynamicRouteTrail = (
    map: L.Map,
    coords: [number, number][],
    pos: { latitude: number; longitude: number } | null
  ) => {
    if (!coords || coords.length < 2) return;

    let closestIdx = 0;
    if (pos) {
      closestIdx = findClosestRouteIndex(coords, pos);
    }

    const traversedCoords = coords.slice(0, closestIdx + 1);
    const remainingCoords = pos
      ? [[pos.latitude, pos.longitude] as [number, number], ...coords.slice(closestIdx)]
      : coords;

    // Clear old polylines
    if (traversedPolylineRef.current) {
      traversedPolylineRef.current.remove();
    }
    if (remainingPolylineRef.current) {
      remainingPolylineRef.current.remove();
    }

    // Traversed Trail (behind bus - faint receding line)
    if (traversedCoords.length > 1) {
      traversedPolylineRef.current = L.polyline(traversedCoords, {
        color: '#94a3b8',
        weight: 3,
        opacity: 0.35,
        dashArray: '4, 8',
      }).addTo(map);
    }

    // Remaining Route (ahead of bus - vibrant indigo/purple line)
    if (remainingCoords.length > 1) {
      remainingPolylineRef.current = L.polyline(remainingCoords, {
        color: '#6366f1',
        weight: 6,
        opacity: 0.9,
      }).addTo(map);
    }
  };

  // Helper: Calculate and draw route from current bus location to clicked point / stop
  const calculateAndDisplayClickRoute = (destLat: number, destLng: number, destName?: string) => {
    if (!mapRef.current || !currentLocation) return;

    const startCoords = `${currentLocation.longitude},${currentLocation.latitude}`;
    const endCoords = `${destLng},${destLat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${startCoords};${endCoords}?overview=full&geometries=geojson`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!mapRef.current) return;
        if (data.code === 'Ok' && data.routes?.[0]) {
          const routeData = data.routes[0];
          const roadCoords = routeData.geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
          );
          const distanceKm = Number((routeData.distance / 1000).toFixed(1));
          const durationMin = Math.max(1, Math.ceil(routeData.duration / 60));

          // Clean previous target layers
          if (targetRoutePolylineRef.current) targetRoutePolylineRef.current.remove();
          if (targetMarkerRef.current) targetMarkerRef.current.remove();

          // Add animated custom target pin icon
          const targetIcon = L.divIcon({
            className: '',
            html: `
              <div class="relative flex items-center justify-center w-9 h-9 bg-emerald-500 border-2 border-white rounded-full shadow-2xl animate-bounce">
                <span class="text-base">🎯</span>
                <span class="absolute -top-1 -right-1 flex h-3 w-3">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-300"></span>
                </span>
              </div>
            `,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          });

          targetMarkerRef.current = L.marker([destLat, destLng], { icon: targetIcon }).addTo(mapRef.current);

          // Vibrant Cyan Target Navigation Line
          targetRoutePolylineRef.current = L.polyline(roadCoords, {
            color: '#06b6d4',
            weight: 7,
            opacity: 0.95,
            dashArray: '6, 10',
          }).addTo(mapRef.current);

          // Fit bounds to display bus to clicked destination
          const bounds = L.latLngBounds([
            [currentLocation.latitude, currentLocation.longitude],
            [destLat, destLng],
          ]);
          mapRef.current.fitBounds(bounds, { padding: [55, 55], maxZoom: 16 });

          setTargetDestInfo({
            name: destName || `Location (${destLat.toFixed(4)}, ${destLng.toFixed(4)})`,
            distanceKm,
            durationMin,
            lat: destLat,
            lng: destLng,
          });
        }
      })
      .catch((err) => console.error('Failed to calculate click route:', err));
  };

  const clearTargetRoute = () => {
    if (targetRoutePolylineRef.current) {
      targetRoutePolylineRef.current.remove();
      targetRoutePolylineRef.current = null;
    }
    if (targetMarkerRef.current) {
      targetMarkerRef.current.remove();
      targetMarkerRef.current = null;
    }
    setTargetDestInfo(null);

    // Re-fit map to general route stops
    if (mapRef.current && stops.length > 0) {
      const bounds = L.latLngBounds(stops.map((s) => [s.latitude, s.longitude]));
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  };

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

    // Automatically adjust zoom/pan to fit all stops in the view
    if (stops.length > 0) {
      try {
        const bounds = L.latLngBounds(stops.map(s => [s.latitude, s.longitude]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      } catch (err) {
        console.error('Failed to fit bounds:', err);
      }
    }

    // Draw route connecting stops ordered by stop_order using actual road paths (OSRM API)
    const sortedStops = [...stops].sort((a, b) => a.stop_order - b.stop_order);
    let destroyed = false;

    function drawStraightLines() {
      if (destroyed) return;
      const polylineCoords = sortedStops.map(
        (stop) => [stop.latitude, stop.longitude] as [number, number]
      );
      fullRouteCoordsRef.current = polylineCoords;
      updateDynamicRouteTrail(map, polylineCoords, currentLocation);
    }

    function fallbackToOsrm() {
      if (destroyed) return;
      const osrmCoords = sortedStops.map(s => `${s.longitude},${s.latitude}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`;

      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (destroyed) return;
          if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
            const roadCoords = data.routes[0].geometry.coordinates.map(
              ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
            );
            fullRouteCoordsRef.current = roadCoords;
            updateDynamicRouteTrail(map, roadCoords, currentLocation);
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

    if (sortedStops.length > 1) {
      if (routeMode === 'direct') {
        drawStraightLines();
      } else {
        fallbackToOsrm();
      }
    }

    function escapeHtml(str: string) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Add stop markers with click listener to calculate route to clicked stop
    sortedStops.forEach((stop, index) => {
      const isHighlighted = stop.name === highlightStopId;
      
      let color = '#1d4ed8'; // Default blue (intermediate)
      let fillColor = '#60a5fa';

      if (index === 0) {
        color = '#ef4444';
        fillColor = '#f87171';
      } else if (index === sortedStops.length - 1) {
        color = '#16a34a';
        fillColor = '#4ade80';
      }

      const radius = isHighlighted ? 12 : 7;
      if (isHighlighted) {
        color = '#ef4444';
        fillColor = '#dc2626';
      }

      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius,
        color,
        fillColor,
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);

      // On click stop marker: calculate turn-by-turn route to clicked stop
      marker.on('click', () => {
        calculateAndDisplayClickRoute(stop.latitude, stop.longitude, stop.name);
      });

      marker.bindPopup(`
        <div class="font-sans">
          <div class="font-bold text-slate-800">${escapeHtml(stop.name)}</div>
          <div class="text-xs text-slate-500">Stop Order: ${stop.stop_order + 1}</div>
          <div class="text-[10px] font-bold mt-1 inline-block px-1.5 py-0.5 rounded text-white ${
            index === 0 ? 'bg-red-500' : index === sortedStops.length - 1 ? 'bg-green-600' : 'bg-blue-500'
          }">
            ${index === 0 ? '🚩 Start Stop' : index === sortedStops.length - 1 ? '🏁 End Destination' : '📍 Transit Stop'}
          </div>
          <div class="text-[10px] text-cyan-600 font-bold mt-1">👉 Click to view route to this stop</div>
        </div>
      `);
    });

    // Map click handler for arbitrary map points
    map.on('click', (e: L.LeafletMouseEvent) => {
      calculateAndDisplayClickRoute(e.latlng.lat, e.latlng.lng);
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

    // Place user location marker if provided
    let userMarker: L.Marker | null = null;
    if (userLocation?.latitude && userLocation?.longitude) {
      const userIcon = L.divIcon({
        className: '',
        html: `
          <div class="relative flex items-center justify-center w-8 h-8 bg-green-500 border-2 border-white rounded-full shadow-lg">
            <span class="text-sm">👤</span>
            <div class="absolute -inset-1 rounded-full border border-green-500 animate-ping opacity-75"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      userMarker = L.marker([userLocation.latitude, userLocation.longitude], { icon: userIcon })
        .addTo(map)
        .bindPopup('<div class="font-bold text-slate-850 text-xs">Your Location</div>');
    }

    // Supabase Realtime channel setup for bus position updates
    const supabase = createBrowserSupabaseClient();
    
    const channel = supabase
      .channel(`bus-location-${busId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bus_locations',
          filter: `bus_id=eq.${busId}`,
        },
        (payload: any) => {
          if (payload.eventType === 'DELETE') return;
          if (!showBus) return;
          const { latitude, longitude } = payload.new;
          const newPos = { latitude, longitude };
          
          setCurrentLocation(newPos);
          
          if (markerRef.current) {
            markerRef.current.setLatLng([latitude, longitude]);
          } else {
            markerRef.current = L.marker([latitude, longitude], { icon: busIcon }).addTo(map);
          }

          // Update dynamic trailing trail as bus moves forward
          if (fullRouteCoordsRef.current.length > 0) {
            updateDynamicRouteTrail(map, fullRouteCoordsRef.current, newPos);
          }
          
          // Re-center map smoothly
          map.panTo([latitude, longitude]);
        }
      )
      .subscribe();

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    const container = document.getElementById(mapContainerId);
    if (container) resizeObserver.observe(container);

    return () => {
      destroyed = true;
      supabase.removeChannel(channel);
      resizeObserver.disconnect();
      if (userMarker) userMarker.remove();
      if (remainingPolylineRef.current) remainingPolylineRef.current.remove();
      if (traversedPolylineRef.current) traversedPolylineRef.current.remove();
      if (targetRoutePolylineRef.current) targetRoutePolylineRef.current.remove();
      if (targetMarkerRef.current) targetMarkerRef.current.remove();
      map.remove();
    };
  }, [busId, stops, highlightStopId, showBus, routeMode, userLocation]);

  useEffect(() => {
    if (mapRef.current && focusLocation?.latitude && focusLocation?.longitude) {
      mapRef.current.setView([focusLocation.latitude, focusLocation.longitude], 16, {
        animate: true,
      });
    }
  }, [focusLocation]);

  // Dynamically update bus marker & dynamic trailing trail when initialLocation changes
  useEffect(() => {
    if (showBus && mapRef.current && initialLocation?.latitude && initialLocation?.longitude) {
      const latLng: L.LatLngExpression = [initialLocation.latitude, initialLocation.longitude];
      if (markerRef.current) {
        markerRef.current.setLatLng(latLng);
      } else {
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
        markerRef.current = L.marker(latLng, { icon: busIcon }).addTo(mapRef.current);
      }

      if (fullRouteCoordsRef.current.length > 0) {
        updateDynamicRouteTrail(mapRef.current, fullRouteCoordsRef.current, initialLocation);
      }
    }
  }, [initialLocation, showBus]);

  return (
    <div className="relative z-0 w-full h-full min-h-[300px] border border-slate-200 rounded-xl overflow-hidden shadow-inner">
      <div id={mapContainerId} className="w-full h-full" />

      {/* Route Mode Toggle Control */}
      {stops.length > 1 && (
        <div className="absolute top-3 left-3 z-[1000] flex bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg p-1 gap-1">
          <button
            type="button"
            onClick={() => setRouteMode('road')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition-all duration-200 cursor-pointer ${
              routeMode === 'road'
                ? 'bg-primary text-white shadow-sm shadow-purple-500/25'
                : 'text-slate-650 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            🚗 Road Route
          </button>
          <button
            type="button"
            onClick={() => setRouteMode('direct')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition-all duration-200 cursor-pointer ${
              routeMode === 'direct'
                ? 'bg-primary text-white shadow-sm shadow-purple-500/25'
                : 'text-slate-650 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            📏 Direct Line
          </button>
        </div>
      )}

      {/* Floating Target Navigation Bar (When a stop or location is clicked) */}
      {targetDestInfo && (
        <div className="absolute bottom-4 left-4 right-4 z-[1000] bg-slate-900/95 text-white backdrop-blur border border-cyan-500/40 rounded-2xl p-3.5 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-xl flex items-center justify-center text-cyan-400">
              <Navigation2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-extrabold text-cyan-400 uppercase tracking-widest block">
                Target Route Destination
              </span>
              <h4 className="text-xs font-black text-white truncate max-w-[180px] sm:max-w-[260px]">
                {targetDestInfo.name}
              </h4>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] font-semibold text-slate-300">
                <span>📏 {targetDestInfo.distanceKm} km</span>
                <span>•</span>
                <span>⏱️ ~{targetDestInfo.durationMin} mins</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={clearTargetRoute}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition cursor-pointer border border-slate-700"
            title="Clear target route"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {showBus && currentLocation && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${currentLocation.latitude},${currentLocation.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-4 right-4 z-[1000] flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-semibold text-xs border border-slate-200 rounded-lg shadow-lg transition duration-200 cursor-pointer"
        >
          <MapPin className="w-3.5 h-3.5 text-red-500" />
          <span className="hidden sm:inline">Open in Google Maps</span>
          <ExternalLink className="w-3 h-3 text-slate-400" />
        </a>
      )}
    </div>
  );
}
export default LiveMap;
