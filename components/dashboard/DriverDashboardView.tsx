'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Bus, Map, Play, ArrowRight, AlertCircle, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createClient } from '@supabase/supabase-js';

// Import subviews
import DriverRouteView from './subviews/DriverRouteView';
import DriverTripView from './subviews/DriverTripView';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
});

const LocationService = registerPlugin<any>('LocationService');
const BackgroundGeolocation = registerPlugin<any>('BackgroundGeolocation');

const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DriverDashboardView({ tab }: { tab?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passedStops, setPassedStops] = useState<string[]>([]);
  const [isPipMode, setIsPipMode] = useState(false);

  useEffect(() => {
    const handlePip = (e: any) => {
      setIsPipMode(!!e.detail?.isPip);
    };
    window.addEventListener('pipModeChanged', handlePip);
    return () => window.removeEventListener('pipModeChanged', handlePip);
  }, []);

  // Fetch driver assignment details
  const { data: assignment, isLoading, error } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/driver/assignment');
      if (!res.ok) throw new Error('Failed to load shift assignments');
      return res.json();
    },
  });

  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [lastTelemetryTime, setLastTelemetryTime] = useState<Date | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const watchIdRef = useRef<number | string | null>(null);
  const lastSentRef = useRef<number>(0);
  const lastPositionRef = useRef<{ latitude: number; longitude: number; speed: number; heading: number } | null>(null);

  const postDriverLocation = async (
    latitude: number,
    longitude: number,
    speedVal?: number,
    headingVal?: number
  ) => {
    const bus = assignment?.bus;
    if (!bus) return;
    const activeTrip = assignment?.active_trip;

    const now = Date.now();
    const GPS_INTERVAL_MS = 5000; // Throttle to post every 5 seconds
    if (now - lastSentRef.current < GPS_INTERVAL_MS) return;
    lastSentRef.current = now;

    try {
      const res = await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bus_id: bus.id,
          trip_id: activeTrip?.trip_id || null,
          latitude,
          longitude,
          speed: Math.max(0, speedVal || 0) * 3.6, // convert m/s to km/h
          heading: headingVal || 0,
        }),
      });

      if (res.ok) {
        setLastTelemetryTime(new Date());
      }
    } catch (err) {
      console.error('Failed to post GPS coords:', err);
    }
  };

  // Load passed stops from audit logs on mount/trip load and listen to changes in real-time
  useEffect(() => {
    const activeTrip = assignment?.active_trip;
    if (!activeTrip) {
      setPassedStops([]);
      return;
    }
    const fetchPassedStops = async () => {
      try {
        const { data } = await supabaseClient
          .from('audit_logs')
          .select('record_id')
          .eq('action', 'STOP_PASSED')
          .filter('new_values->>trip_id', 'eq', activeTrip.trip_id);
        if (data) {
          setPassedStops(data.map((log) => log.record_id));
        }
      } catch (err) {
        console.error('Failed to load passed stops:', err);
      }
    };
    fetchPassedStops();

    // Subscribe to audit log changes dynamically
    const channel = supabaseClient
      .channel('driver-audit-logs-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `action=eq.STOP_PASSED` },
        (payload: any) => {
          const tripId = payload.new?.new_values?.trip_id;
          if (tripId === activeTrip.trip_id) {
            setPassedStops((prev) => {
              const stopId = payload.new.record_id;
              if (stopId && !prev.includes(stopId)) {
                return [...prev, stopId];
              }
              return prev;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [assignment?.active_trip]);

  // Initialize Geolocation Tracking Watcher globally when bus is assigned
  useEffect(() => {
    const bus = assignment?.bus;
    if (!bus) return;

    // Set up interval to post location every 5 seconds regardless of coordinate changes (forces continuous heartbeat)
    const intervalId = setInterval(async () => {
      if (lastPositionRef.current) {
        await postDriverLocation(
          lastPositionRef.current.latitude,
          lastPositionRef.current.longitude,
          lastPositionRef.current.speed,
          lastPositionRef.current.heading
        );
      }
    }, 5000);

    if (Capacitor.isNativePlatform()) {
      setGpsStatus('searching');
      setGpsErrorMsg(null);

      BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: "Tracking bus location in background...",
          backgroundTitle: "NaviGuard Active",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        async (location: any, error: any) => {
          if (error) {
            console.error('Background Geolocation watch error:', error);
            const msg = error.message || 'GPS location error.';
            setGpsStatus('error');
            setGpsErrorMsg(msg);
            
            // Send GPS interruption notification to Admin
            fetch('/api/driver/notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'gps_off', message: msg })
            }).catch(console.error);

            return;
          }
          if (location) {
            setGpsStatus('active');
            setGpsErrorMsg(null);
            
            const coords = {
              latitude: location.latitude,
              longitude: location.longitude,
              speed: location.speed || 0,
              heading: location.bearing || 0
            };
            lastPositionRef.current = coords;
            setCurrentLocation({ latitude: coords.latitude, longitude: coords.longitude });

            await postDriverLocation(
              coords.latitude,
              coords.longitude,
              coords.speed,
              coords.heading
            );
          }
        }
      ).then((id: string) => {
        watchIdRef.current = id;
      });
    } else {
      if (!navigator.geolocation) {
        setGpsStatus('error');
        setGpsErrorMsg('Browser does not support GPS Geolocation.');
        return;
      }

      setGpsStatus('searching');

      const wId = navigator.geolocation.watchPosition(
        async (position) => {
          setGpsStatus('active');
          setGpsErrorMsg(null);

          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed || 0,
            heading: position.coords.heading || 0
          };
          lastPositionRef.current = coords;
          setCurrentLocation({ latitude: coords.latitude, longitude: coords.longitude });

          await postDriverLocation(
            coords.latitude,
            coords.longitude,
            coords.speed,
            coords.heading
          );
        },
        (err) => {
          console.error('GPS watch error:', err);
          setGpsStatus('error');
          let errMsg = 'Unknown GPS error occurred.';
          switch (err.code) {
            case err.PERMISSION_DENIED:
              errMsg = 'GPS Access Denied. Please enable location services.';
              break;
            case err.POSITION_UNAVAILABLE:
              errMsg = 'GPS location info unavailable.';
              break;
            case err.TIMEOUT:
              errMsg = 'GPS connection timeout.';
              break;
          }
          setGpsErrorMsg(errMsg);

          // Send GPS interruption notification to Admin
          fetch('/api/driver/notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'gps_off', message: errMsg })
          }).catch(console.error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
        }
      );

      watchIdRef.current = wId;
    }

    return () => {
      clearInterval(intervalId);
      if (watchIdRef.current !== null) {
        if (typeof watchIdRef.current === 'string') {
          BackgroundGeolocation.removeWatcher({ id: watchIdRef.current });
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = null;
      }
    };
  }, [assignment]);

  // One-off telemetry updates as soon as the driver logs in / mounts dashboard
  useEffect(() => {
    if (!assignment?.bus?.id) return;

    async function sendInitialTelemetry() {
      try {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const payload = {
            bus_id: assignment.bus.id,
            trip_id: null,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed || 0,
            heading: position.coords.heading || 0,
          };
          
          await fetch('/api/driver/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        });
      } catch (err) {
        console.error('Failed to send initial driver telemetry:', err);
      }
    }

    sendInitialTelemetry();
  }, [assignment]);

  // Auto-redirect to active trip console if a trip is already active
  useEffect(() => {
    if (assignment?.active_trip) {
      router.push('/dashboard?tab=trip');
    }
  }, [assignment, router]);

  // Manage native background LocationService globally on the driver portal
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;
    const activeTrip = assignment?.active_trip;
    const bus = assignment?.bus;

    if (bus) {
      // Start the native service
      (async () => {
        try {
          const { data: { session } } = await supabaseClient.auth.getSession();
          const token = session?.access_token;
          if (token) {
            await LocationService.startTracking({
              token,
              busId: bus.id,
              tripId: activeTrip?.trip_id || '',
              serverUrl: `${window.location.origin}/api/driver/location`,
            });

            // Refresh the token every 45 min so the native service stays authenticated
            tokenRefreshInterval = setInterval(async () => {
              try {
                const { data: { session: newSession } } = await supabaseClient.auth.getSession();
                const newToken = newSession?.access_token;
                if (newToken) {
                  await LocationService.updateToken({ token: newToken });
                }
              } catch (e) {
                console.error('Failed to refresh native service token:', e);
              }
            }, 45 * 60 * 1000); // 45 minutes
          }
        } catch (e) {
          console.error('Failed to start native location service globally:', e);
        }
      })();
    } else if (assignment) {
      // If we fetched the assignment and there is no bus assigned, make sure native tracking is stopped
      LocationService.stopTracking().catch((err: any) => {
        console.error('Failed to stop native location service globally:', err);
      });
    }

    return () => {
      if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
      // NOTE: We do NOT stop tracking on unmount here either, to survive app close/process kill.
    };
  }, [assignment]);

  // Start Trip mutation
  const startTripMutation = useMutation({
    mutationFn: async (payload: { bus_id: string; route_id: string }) => {
      const res = await fetch('/api/driver/trip/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start trip log');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['driver-assignment'] });
      // Redirect to the active trip console
      router.push('/dashboard?tab=trip');
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Handle Dynamic Tab Routing
  switch (tab) {
    case 'route':
      return <DriverRouteView />;
    case 'trip':
      return (
        <DriverTripView
          gpsStatus={gpsStatus}
          gpsErrorMsg={gpsErrorMsg}
          lastTelemetryTime={lastTelemetryTime}
          currentLocation={currentLocation}
          passedStops={passedStops}
          setPassedStops={setPassedStops}
        />
      );
  }

  const handleStartTrip = () => {
    if (!assignment?.bus?.id || !assignment?.route?.id) return;
    setErrorMessage(null);
    startTripMutation.mutate({
      bus_id: assignment.bus.id,
      route_id: assignment.route.id,
    });
  };

  // Intercept view and render Picture-in-Picture Map View unconditionally if isPipMode is true
  if (isPipMode && assignment) {
    const route = assignment.route;
    const bus = assignment.bus;
    const active_trip = assignment.active_trip;

    const stops = route?.stops || [];
    const allStopsList = route?.school
      ? [
          {
            id: 'school',
            name: `🏫 ${route.school.name || 'School Campus'}`,
            latitude: Number(route.school.latitude),
            longitude: Number(route.school.longitude),
            stop_order: 0,
            address: 'Source Campus Location',
          },
          ...stops.map((s: any) => ({
            id: s.id,
            name: s.name,
            latitude: Number(s.latitude),
            longitude: Number(s.longitude),
            stop_order: s.stop_order + 1,
          })),
        ]
      : stops.map((s: any) => ({
          id: s.id,
          name: s.name,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          stop_order: s.stop_order,
        }));

    // Find next stop if there is an active trip
    const activeStops = allStopsList.filter((s: any) => s.id !== 'school');
    const nextStop = activeStops.find((s: any) => !passedStops.includes(s.id));
    
    // Distance to next stop calculation
    let distanceStr = '';
    if (currentLocation && nextStop) {
      const nextLat = Number(nextStop.latitude);
      const nextLng = Number(nextStop.longitude);
      if (!isNaN(nextLat) && !isNaN(nextLng)) {
        const dist = calculateDistanceKm(
          currentLocation.latitude,
          currentLocation.longitude,
          nextLat,
          nextLng
        );
        if (dist < 1) {
          distanceStr = `${Math.round(dist * 1000)}m`;
        } else {
          distanceStr = `${dist.toFixed(1)} km`;
        }
      }
    }

    return (
      <div className="fixed inset-0 w-screen h-screen z-[99999] bg-white flex flex-col">
        {/* Navigation HUD at the top (only shown if a trip is active and has a next stop) */}
        {active_trip && nextStop && (
          <div className="absolute top-2 left-2 right-2 z-[10000] bg-slate-900/95 text-white p-2.5 rounded-xl shadow-lg border border-slate-700/50 flex flex-col gap-0.5 pointer-events-none">
            <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest leading-none">Next Stop</span>
            <span className="font-extrabold text-xs tracking-tight truncate leading-tight mt-0.5">{nextStop.name}</span>
            {distanceStr && (
              <span className="text-[9px] font-bold text-slate-300 mt-0.5">{distanceStr} away</span>
            )}
          </div>
        )}
        
        {/* Floating return warning when all stops are done */}
        {active_trip && !nextStop && (
          <div className="absolute top-2 left-2 right-2 z-[10000] bg-emerald-800/95 text-white p-2.5 rounded-xl shadow-lg border border-emerald-600/50 flex flex-col gap-0.5 pointer-events-none">
            <span className="text-[8px] font-bold text-white/80 uppercase tracking-widest leading-none">All Stops Completed</span>
            <span className="font-extrabold text-xs tracking-tight leading-tight mt-0.5">Proceed back to school campus</span>
          </div>
        )}

        <LiveMap
          key="pip-map-global"
          busId={bus?.id || 'unknown'}
          initialLocation={currentLocation || null}
          stops={allStopsList}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Accessing driver assignments...</p>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-3">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Shift Link Missing</h3>
        <p className="text-slate-555 text-xs leading-relaxed font-semibold">
          We failed to retrieve a shift profile. Ensure your driver account profile is active.
        </p>
      </div>
    );
  }



  const { bus, route, active_trip } = assignment;
  const isTripActive = !!active_trip;

  return (
    <div className="space-y-6 max-w-md md:max-w-2xl mx-auto pt-2 animate-in fade-in duration-200">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1e1b4b] tracking-tight">Driver Portal</h2>
          <p className="text-slate-555 text-xs font-semibold uppercase tracking-wider mt-1">Welcome back! Ensure GPS permissions are allowed</p>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Assigned Fleet Bus Card */}
      {bus ? (
        <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-4">
          <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
            <div className="p-3 bg-purple-50 border border-purple-100 rounded-2xl text-[#5c3b99]">
              <Bus className="w-5.5 h-5.5" />
            </div>
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Shift Bus Vehicle</span>
              <h4 className="font-extrabold text-slate-800 text-sm leading-tight mt-0.5">{bus.name}</h4>
              <span className="font-mono text-[10px] font-extrabold text-purple-650 uppercase block mt-1">{bus.registration_plate}</span>
            </div>
          </div>

          {route ? (
            <div className="pt-2 flex items-center gap-3.5">
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600">
                <Map className="w-5.5 h-5.5" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Assigned Transit Route</span>
                <h4 className="font-extrabold text-slate-800 text-sm leading-tight mt-0.5">{route.name}</h4>
                <span className="text-[10px] text-slate-500 font-semibold block mt-1">{route.stops?.length || 0} stops configured</span>
              </div>
            </div>
          ) : (
            <div className="pt-2 flex items-center gap-2.5 text-amber-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-xs font-semibold">No operational route linked to this bus unit.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-150 rounded-3xl p-8 text-center space-y-4 shadow-sm max-w-sm mx-auto">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <div>
            <h4 className="font-extrabold text-slate-855 text-sm">Shift Vehicle Missing</h4>
            <p className="text-slate-555 text-xs leading-relaxed mt-1">
              You do not have a bus unit assigned for this shift. Contact transport control.
            </p>
          </div>
        </div>
      )}

      {/* Operational State Button */}
      {bus && route && (
        <div className="pt-2">
          {isTripActive ? (
            <button
              onClick={() => router.push('/dashboard?tab=trip')}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#10b981] hover:bg-[#059669] text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 transition-all duration-300 cursor-pointer"
            >
              Resume Active Trip
              <ArrowRight className="w-4.5 h-4.5" />
            </button>
          ) : (
            <button
              onClick={handleStartTrip}
              disabled={startTripMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-2xl font-bold shadow-lg shadow-purple-500/20 transition-all duration-300 cursor-pointer disabled:opacity-50"
            >
              {startTripMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-1" />
                  Initiating Trip...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current mr-1" />
                  Start Transit Trip
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Helper functions for Haversine distance calculation
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}
