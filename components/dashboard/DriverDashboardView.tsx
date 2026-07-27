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
    const activeTrip = assignment?.active_trip;
    if (!bus || !activeTrip) return;

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
          trip_id: activeTrip.trip_id,
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

  // Initialize Geolocation Tracking Watcher globally when trip is active
  useEffect(() => {
    const activeTrip = assignment?.active_trip;
    const bus = assignment?.bus;
    if (!activeTrip || !bus) return;

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

    if (activeTrip && bus) {
      // Start the native service
      (async () => {
        try {
          const { data: { session } } = await supabaseClient.auth.getSession();
          const token = session?.access_token;
          if (token) {
            await LocationService.startTracking({
              token,
              busId: bus.id,
              tripId: activeTrip.trip_id || '',
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
      // If we fetched the assignment and there is no active trip, make sure native tracking is stopped
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
