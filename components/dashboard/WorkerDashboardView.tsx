'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { 
  Loader2, 
  User, 
  Building, 
  Phone, 
  Play, 
  Square,
  AlertCircle,
  ShieldCheck,
  Compass,
  Battery,
  AlertTriangle,
  Mail
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { LocationService } from '@/lib/capacitor-plugins';

export default function WorkerDashboardView({ tab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();
  const [shiftActive, setShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  
  // Real-time telemetry display states
  const [speed, setSpeed] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number>(100);

  const [isPausedByAdmin, setIsPausedByAdmin] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const timerIdRef = useRef<any>(null);
  const lastSentRef = useRef<number>(0);

  // 1. Fetch Worker Assignment and Contact Cards
  const { data: assignment, isLoading, refetch } = useQuery({
    queryKey: ['worker-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/worker/assignment');
      if (!res.ok) return { worker: null, plant: null };
      return res.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  // Track battery level dynamically (PWA/web fallback)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    }
  }, []);

  const startAutoTracking = useCallback(async () => {
    const sessionRes = await supabase.auth.getSession();
    const sessionToken = sessionRes.data.session?.access_token;
    if (!sessionToken) return;

    setShiftActive(true);
    setIsPausedByAdmin(false);
    setTrackingError(null);

    if (Capacitor.isNativePlatform()) {
      try {
        await LocationService.startTracking({
          token: sessionToken,
          busId: assignment?.worker?.id || '',
          tripId: '',
          serverUrl: `${window.location.origin}/api/worker/location`,
          isTripActive: true,
        });
      } catch (err) {
        console.error('Failed to start native location tracking:', err);
      }
    }

    let latestCoords: { lat: number; lng: number; speed: number; heading: number; accuracy: number } | null = null;

    const sendLocationPacket = async (coords: { lat: number; lng: number; speed: number; heading: number; accuracy: number }) => {
      const now = Date.now();
      const intervalSeconds = assignment?.worker?.location_interval || 10;
      if (now - lastSentRef.current < intervalSeconds * 1000 - 200) return;
      lastSentRef.current = now;

      try {
        const res = await fetch('/api/worker/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({
            lat: coords.lat,
            lng: coords.lng,
            speed: coords.speed,
            heading: coords.heading,
            accuracy: coords.accuracy,
            battery_level: batteryLevel,
            is_tracking: true,
          }),
        });

        const data = await res.json();

        // Circuit Breaker: If status 403 or is_paused: true, kill watcher and interval immediately!
        if (res.status === 403 || data?.is_paused || data?.trackingEnabled === false) {
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          if (timerIdRef.current !== null) {
            clearInterval(timerIdRef.current);
            timerIdRef.current = null;
          }
          if (Capacitor.isNativePlatform()) {
            LocationService.stopBackgroundService().catch(() => {});
          }
          setShiftActive(false);
          setIsPausedByAdmin(true);
          setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
        } else {
          setIsPausedByAdmin(false);
          setShiftActive(true);
        }
      } catch (err) {
        console.error('Failed to post coordinates:', err);
      }
    };

    if ('geolocation' in navigator) {
      // Initial location fetch probe
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
          const currentAccuracy = pos.coords.accuracy;
          setSpeed(currentSpeed);
          setAccuracy(currentAccuracy);
          latestCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: currentSpeed,
            heading: pos.coords.heading || 0,
            accuracy: currentAccuracy,
          };
          sendLocationPacket(latestCoords);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      // Hardware GPS watcher
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
          const currentAccuracy = pos.coords.accuracy;
          setSpeed(currentSpeed);
          setAccuracy(currentAccuracy);
          latestCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: currentSpeed,
            heading: pos.coords.heading || 0,
            accuracy: currentAccuracy,
          };
        },
        (err) => {
          setTrackingError(err.message || 'GPS access denied.');
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      // Dynamic time interval loop
      if (timerIdRef.current !== null) {
        clearInterval(timerIdRef.current);
      }
      const intervalMs = Math.max(1000, (assignment?.worker?.location_interval || 10) * 1000);
      timerIdRef.current = setInterval(() => {
        if (latestCoords) {
          sendLocationPacket(latestCoords);
        } else {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
              const currentAccuracy = pos.coords.accuracy;
              setSpeed(currentSpeed);
              setAccuracy(currentAccuracy);
              latestCoords = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                speed: currentSpeed,
                heading: pos.coords.heading || 0,
                accuracy: currentAccuracy,
              };
              sendLocationPacket(latestCoords);
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 0 }
          );
        }
      }, intervalMs);
    }
  }, [assignment?.worker?.id, assignment?.worker?.location_interval, batteryLevel, supabase]);

  // Supabase Realtime listener on user_profiles for instant pause/resume signals
  useEffect(() => {
    if (!assignment?.worker?.id) return;

    const channel = supabase
      .channel(`worker-pause-listener-${assignment.worker.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${assignment.worker.id}`,
        },
        async (payload: any) => {
          const updated = payload.new;
          if (updated && updated.is_active === false) {
            // Admin paused telemetry: send 1 final confirmation probe packet
            const sessionRes = await supabase.auth.getSession();
            const sessionToken = sessionRes.data.session?.access_token;
            if (sessionToken && 'geolocation' in navigator) {
              navigator.geolocation.getCurrentPosition(
                async (pos) => {
                  try {
                    await fetch('/api/worker/location', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
                      body: JSON.stringify({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
                        heading: pos.coords.heading || 0,
                        accuracy: pos.coords.accuracy,
                        battery_level: batteryLevel,
                        is_tracking: true,
                      }),
                    });
                  } catch {}
                },
                () => {},
                { enableHighAccuracy: true, maximumAge: 0 }
              );
            }

            // Immediately execute Circuit Breaker to destroy all future timers & watchers
            if (watchIdRef.current !== null) {
              navigator.geolocation.clearWatch(watchIdRef.current);
              watchIdRef.current = null;
            }
            if (timerIdRef.current !== null) {
              clearInterval(timerIdRef.current);
              timerIdRef.current = null;
            }
            if (Capacitor.isNativePlatform()) {
              LocationService.stopBackgroundService().catch(() => {});
            }
            setShiftActive(false);
            setIsPausedByAdmin(true);
            setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
          } else if (updated && updated.is_active === true) {
            setIsPausedByAdmin(false);
            setTrackingError(null);
            startAutoTracking();
            refetch();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [assignment, supabase, refetch, batteryLevel, startAutoTracking]);

  // 4-second hybrid polling fallback to guarantee packet streaming auto-starts if Realtime drops
  useEffect(() => {
    if (!assignment?.worker) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/worker/assignment');
        if (!res.ok) return;
        const data = await res.json();
        const serverIsActive = data?.worker?.is_active !== false;

        if (serverIsActive && isPausedByAdmin) {
          // Admin unpaused! Auto-start telemetry immediately
          setIsPausedByAdmin(false);
          setTrackingError(null);
          startAutoTracking();
        } else if (!serverIsActive && !isPausedByAdmin) {
          // Admin paused! Circuit breaker teardown
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          if (timerIdRef.current !== null) {
            clearInterval(timerIdRef.current);
            timerIdRef.current = null;
          }
          setShiftActive(false);
          setIsPausedByAdmin(true);
          setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
        }
      } catch {}
    }, 4000);

    return () => clearInterval(interval);
  }, [assignment?.worker, isPausedByAdmin, startAutoTracking]);

  // Automatically start background packet streaming upon login
  useEffect(() => {
    if (assignment?.worker?.id && !isPausedByAdmin) {
      startAutoTracking();
    }
  }, [assignment?.worker?.id, isPausedByAdmin, startAutoTracking]);

  // Cleanup on component unmount ONLY
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (timerIdRef.current !== null) {
        clearInterval(timerIdRef.current);
        timerIdRef.current = null;
      }
    };
  }, []);

  // Handle Shift Telemetry Broadcaster
  const handleToggleShift = async () => {
    if (shiftActive) {
      // STOP SHIFT
      setShiftActive(false);
      setSpeed(0);
      setAccuracy(0);
      
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.stopTracking();
        } catch (err) {
          console.error('Failed to stop native location service:', err);
        }
      }
    } else {
      // START SHIFT
      setTrackingError(null);
      
      const sessionRes = await supabase.auth.getSession();
      const sessionToken = sessionRes.data.session?.access_token;
      
      if (!sessionToken) {
        setTrackingError('Authentication session not active.');
        return;
      }

      setShiftActive(true);

      // Start local Geolocation watcher strictly for updating UI gauges
      if ('geolocation' in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          async (pos) => {
            const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
            const currentAccuracy = pos.coords.accuracy;
            
            setSpeed(currentSpeed);
            setAccuracy(currentAccuracy);

            // Web fallback poster (if not native platform)
            if (!Capacitor.isNativePlatform()) {
              const now = Date.now();
              const intervalSeconds = assignment?.worker?.location_interval || 10;
              if (now - lastSentRef.current < intervalSeconds * 1000) return;
              lastSentRef.current = now;

              try {
                await fetch('/api/worker/location', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                  body: JSON.stringify({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: currentSpeed,
                    heading: pos.coords.heading || 0,
                    accuracy: currentAccuracy,
                    battery_level: batteryLevel,
                    is_tracking: true
                  })
                });
              } catch (err) {
                console.error('Failed to post coordinates:', err);
              }
            }
          },
          (err) => {
            setTrackingError(err.message || 'GPS access denied.');
            setShiftActive(false);
          },
          { enableHighAccuracy: true, maximumAge: 0 }
        );
      } else {
        setTrackingError('Browser does not support GPS Geolocation.');
        setShiftActive(false);
        return;
      }

      // Native Background Foreground Service
      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.startTracking({
            token: sessionToken,
            busId: assignment?.worker?.id || '',
            tripId: '',
            serverUrl: `${window.location.origin}/api/worker/location`,
            isTripActive: true
          });
        } catch (err: any) {
          setTrackingError(err.message || 'Failed to start background tracking service.');
          setShiftActive(false);
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);
  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto space-y-6 animate-pulse">
        <div className="h-28 bg-slate-200 rounded-2xl" />
        <div className="h-64 bg-slate-200 rounded-2xl" />
        <div className="h-24 bg-slate-200 rounded-2xl" />
        <div className="h-24 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  if (!assignment || !assignment.worker) {
    return (
      <div className="p-6 text-center max-w-md mx-auto space-y-4">
        <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto" />
        <h3 className="text-lg font-bold text-slate-800">No Plant Link</h3>
        <p className="text-slate-500 text-sm">
          Your profile has not been assigned to any plant site yet. Contact your Super Admin to link your profile.
        </p>
      </div>
    );
  }

  const { plant, supervisor, plantManager } = assignment;

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-8">
      {/* Site Assignment Header Card */}
      <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm text-center relative overflow-hidden">
        <div className="inline-block px-3 py-1 bg-slate-100 border border-slate-200 rounded-full text-[10px] font-black text-slate-800 uppercase tracking-widest mb-3">
          Active Site Link
        </div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">{plant.name}</h2>
        <p className="text-xs font-mono text-slate-500 font-bold mt-1">PLANT CODE: {plant.code}</p>
      </div>

      {/* Auto Shift Tracking Active Card */}
      <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-base font-extrabold text-slate-900">Shift Attendance & Tracking</h3>
          {isPausedByAdmin ? (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-full text-xs font-black">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              PAUSED BY COMMAND CENTER (ZERO NETWORK TRAFFIC)
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-black">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE ON DUTY (AUTO-TRACKING)
            </div>
          )}
        </div>

        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-center">
          <p className="text-xs font-semibold text-slate-600">
            ⚡ Telemetry & location packets are automatically streaming to the Command Center while logged in.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 text-center">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-150">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Speed</span>
            <span className="text-xs font-black text-slate-800 block mt-1">0.0 km/h</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-150">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">GPS Accuracy</span>
            <span className="text-xs font-black text-slate-800 block mt-1">High</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-150">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Battery</span>
            <span className="text-xs font-black text-slate-800 block mt-1 flex items-center justify-center gap-1">
              <Battery className="w-3.5 h-3.5 text-emerald-600" /> 100%
            </span>
          </div>
        </div>
      </div>

      {/* Reporting Contacts */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Line Reporting Contacts</h4>

        {supervisor && (
          <div className="bg-white border border-slate-150 p-4.5 rounded-2xl shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl flex items-center justify-center font-extrabold text-xs">
                👤
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Line Supervisor</span>
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm mt-0.5">{supervisor.full_name}</h4>
                <span className="text-[10px] text-slate-500 block leading-tight">{supervisor.email}</span>
              </div>
            </div>
            {supervisor.phone && (
              <a
                href={`tel:${supervisor.phone}`}
                className="p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl transition shadow-sm"
                title="Call Supervisor"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {plantManager && (
          <div className="bg-white border border-slate-150 p-4.5 rounded-2xl shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl flex items-center justify-center font-extrabold text-xs">
                🏢
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Plant Manager</span>
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm mt-0.5">{plantManager.full_name}</h4>
                <span className="text-[10px] text-slate-500 block leading-tight">{plantManager.email}</span>
              </div>
            </div>
            {plantManager.phone && (
              <a
                href={`tel:${plantManager.phone}`}
                className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl transition shadow-sm"
                title="Call Manager"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
