'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  Loader2,
  User,
  Users,
  Radio,
  Phone,
  Play,
  Square,
  AlertCircle,
  Battery,
  MapPin,
  Mail
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { Capacitor } from '@capacitor/core';
import { LocationService } from '@/lib/capacitor-plugins';

// Load map dynamically to prevent build failures during SSR
const AdminMap = dynamic(() => import('@/components/AdminMap').then((m) => m.AdminMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mr-3" />
      Loading Map Module...
    </div>
  ),
});

export default function SupervisorDashboardView({ tab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();

  // Shift telemetry state
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerIdRef = useRef<any>(null);
  const lastSentRef = useRef<number>(0);

  // Fetch Supervisor Dashboard Data (Profile, Direct Workers, Live Locations, Plant Manager)
  const { data: dashboardData, isLoading, refetch } = useQuery({
    queryKey: ['supervisor-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/supervisor/dashboard');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const supervisorProfile = dashboardData?.profile;
  const plantManager = dashboardData?.plantManager;

  const plantsArray = useMemo(() => {
    return supervisorProfile?.plant ? [supervisorProfile.plant] : [];
  }, [supervisorProfile?.plant?.id, supervisorProfile?.plant?.name]);

  const [isPausedByAdmin, setIsPausedByAdmin] = useState(false);

  const startAutoTrackingRef = useRef<any>(null);

  // Real-time listener for direct worker coordinates (persistent WebSocket connection)
  useEffect(() => {
    if (!supervisorProfile?.id) return;

    const channel = supabase
      .channel(`supervisor-dashboard-realtime-${supervisorProfile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_locations' },
        () => {
          refetchRef.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supervisorProfile?.id, supabase]);

  const startAutoTracking = useCallback(async () => {
    if (!supervisorProfile?.id) return;
    const sessionRes = await supabase.auth.getSession();
    const sessionToken = sessionRes.data.session?.access_token;
    if (!sessionToken) return;

    setIsShiftActive(true);
    setIsPausedByAdmin(false);
    setTrackingError(null);

    if (Capacitor.isNativePlatform()) {
      try {
        await LocationService.startTracking({
          token: sessionToken,
          busId: supervisorProfile.id,
          tripId: '',
          serverUrl: `${window.location.origin}/api/worker/location`,
          isTripActive: true,
        });
      } catch (err) {
        console.error('Failed to start native tracking:', err);
      }
      return;
    }

    let latestCoords: { lat: number; lng: number; speed: number; heading: number; accuracy: number } | null = null;

    const sendLocationPacket = async (coords: { lat: number; lng: number; speed: number; heading: number; accuracy: number }) => {
      const now = Date.now();
      const intervalSeconds = supervisorProfile.location_interval || 10;
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
            battery_level: 100,
            is_tracking: true,
          }),
        });
        const data = await res.json();
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
          setIsShiftActive(false);
          setIsPausedByAdmin(true);
          setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
        } else {
          setIsPausedByAdmin(false);
          setIsShiftActive(true);
        }
      } catch (err) {
        console.error('Failed to post coordinates:', err);
      }
    };

    if ('geolocation' in navigator) {
      // Initial location fetch probe
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latestCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
            heading: pos.coords.heading || 0,
            accuracy: pos.coords.accuracy,
          };
          sendLocationPacket(latestCoords);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      // Movement watcher
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          latestCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
            heading: pos.coords.heading || 0,
            accuracy: pos.coords.accuracy,
          };
        },
        (err) => {
          setTrackingError(err.message || 'GPS access denied.');
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );

      // Dynamic time interval loop (streams continuously at exact Admin location_interval)
      if (timerIdRef.current !== null) {
        clearInterval(timerIdRef.current);
      }
      const intervalMs = Math.max(1000, (supervisorProfile.location_interval || 10) * 1000);
      timerIdRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
              heading: pos.coords.heading || 0,
              accuracy: pos.coords.accuracy,
            };
            latestCoords = coords;
            sendLocationPacket(coords);
          },
          () => {
            if (latestCoords) {
              sendLocationPacket(latestCoords);
            }
          },
          { enableHighAccuracy: true, maximumAge: 0 }
        );
      }, intervalMs);
    }
  }, [supervisorProfile?.id, supervisorProfile?.location_interval, supabase]);

  // Supabase Realtime listener on user_profiles for instant pause/resume signals
  useEffect(() => {
    if (!supervisorProfile?.id) return;

    const channel = supabase
      .channel(`supervisor-pause-listener-${supervisorProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${supervisorProfile.id}`,
        },
        async (payload: any) => {
          const updated = payload.new;
          if (updated && updated.is_active === false) {
            // Admin paused telemetry: clear all future timers & watchers
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
            setIsShiftActive(false);
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
  }, [supervisorProfile?.id, supabase, refetch, startAutoTracking]);

  // Automatically start background packet streaming upon login if enabled by Admin
  useEffect(() => {
    if (supervisorProfile?.id) {
      if (supervisorProfile.is_active === false) {
        setIsPausedByAdmin(true);
        setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
      } else if (!isPausedByAdmin) {
        startAutoTracking();
      }
    }
  }, [supervisorProfile?.id, supervisorProfile?.is_active, isPausedByAdmin, startAutoTracking]);

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

  // Handle Shift Toggle (GPS Telemetry Broadcaster)
  const toggleShift = async () => {
    if (isShiftActive) {
      // STOP SHIFT
      setIsShiftActive(false);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.stopTracking();
        } catch (err) {
          console.error(err);
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

      setIsShiftActive(true);

      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.startTracking({
            token: sessionToken,
            busId: supervisorProfile.id,
            tripId: '',
            serverUrl: `${window.location.origin}/api/worker/location`,
            isTripActive: true
          });
        } catch (err: any) {
          setTrackingError(err.message || 'Failed to trigger background service.');
          setIsShiftActive(false);
        }
      } else {
        if ('geolocation' in navigator) {
          watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
              try {
                await fetch('/api/worker/location', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                  body: JSON.stringify({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
                    heading: pos.coords.heading || 0,
                    accuracy: pos.coords.accuracy,
                    battery_level: 100,
                    is_tracking: true
                  })
                });
              } catch (err) {
                console.error('Failed to post coordinates:', err);
              }
            },
            (err) => {
              setTrackingError(err.message || 'GPS access denied.');
              setIsShiftActive(false);
            },
            { enableHighAccuracy: true, maximumAge: 0 }
          );
        } else {
          setTrackingError('Browser does not support GPS Geolocation.');
          setIsShiftActive(false);
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

  if (!supervisorProfile || isLoading) {
    return (
      <div className="p-4 sm:p-8 space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-24 bg-slate-200 rounded-2xl" />
        <div className="h-32 bg-slate-200 rounded-2xl" />
        <div className="h-80 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  const { workers = [], locations = [] } = dashboardData || {};
  const activeWorkersCount = locations.filter((loc: any) => loc.is_tracking).length;

  return (
    <div className="p-4 lg:p-8 pb-32 sm:pb-20 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">

      {/* Plant Manager Contact Card */}
      {plantManager && (
        <div className="bg-white border border-slate-150 p-4 sm:p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl flex items-center justify-center font-extrabold text-base flex-shrink-0">
              🏢
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Site Plant Manager</span>
              <h4 className="font-extrabold text-slate-900 text-sm sm:text-base truncate">{plantManager.full_name}</h4>
              <span className="text-[11px] text-slate-500 block leading-tight truncate">{plantManager.email}</span>
            </div>
          </div>

          {plantManager.phone && (
            <a
              href={`tel:${plantManager.phone}`}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-xl transition shadow-sm flex-shrink-0"
            >
              <Phone className="w-4 h-4 text-emerald-400" />
              Call Manager
            </a>
          )}
        </div>
      )}

      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 border border-slate-150 rounded-2xl shadow-sm">
        <div>
          <span className="text-[9px] font-bold text-amber-700 uppercase tracking-widest bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg">
            Team supervision
          </span>
          <h2 className="text-xl font-black text-slate-900 mt-2 tracking-tight">
            Supervisor Command Roster
          </h2>
          <p className="text-slate-500 text-xs font-semibold mt-1">
            Site: {supervisorProfile.plant?.name} ({supervisorProfile.plant?.code})
          </p>
        </div>

        {/* Telemetry Status Indicator (100% Admin Controlled) */}
        <div className="flex items-center gap-3">
          {isPausedByAdmin ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold shadow-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
              <span>Telemetry paused by Command Center (0 Network Traffic)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-extrabold shadow-xs">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span>LIVE TELEMETRY STREAMING</span>
            </div>
          )}
        </div>
      </div>

      {/* Team Live Map */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Team Live Map</h3>
        <AdminMap plants={plantsArray} locations={locations} selectedPlantId={supervisorProfile.plant_id} />
      </div>

      {/* Team Roster List */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800 tracking-tight">Direct Team Roster</h3>
          <span className="text-xs font-bold text-slate-450 uppercase flex items-center gap-1">
            <Users className="w-4 h-4" />
            {activeWorkersCount} / {workers.length} active
          </span>
        </div>

        <div className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-100">
          {workers.length === 0 ? (
            <div className="p-8 text-center text-slate-400 font-medium">
              No workers assigned under you yet.
            </div>
          ) : (
            workers.map((worker: any) => {
              const workerLocation = locations.find((l: any) => l.user?.id === worker.id);
              const isTracking = workerLocation?.is_tracking;

              return (
                <div key={worker.id} className="p-4 sm:px-6 flex items-center justify-between gap-3 bg-white hover:bg-slate-50/50 transition">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-2.5 w-2.5 relative flex-shrink-0">
                      {isTracking && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isTracking ? 'bg-green-500' : 'bg-slate-350'}`}></span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">{worker.full_name}</h4>
                      <p className="text-slate-400 text-[10px] font-semibold truncate">{worker.email}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] font-bold text-slate-500">
                        {isTracking && workerLocation ? (
                          <>
                            <span className="font-mono text-emerald-600 font-extrabold">{workerLocation.speed.toFixed(1)} km/h</span>
                            <span className="flex items-center gap-1">
                              <Battery className="w-3.5 h-3.5 text-slate-450" />
                              {workerLocation.battery_level !== null ? `${workerLocation.battery_level}%` : '—'}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400 font-bold uppercase">Offline</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {worker.phone && (
                    <a
                      href={`tel:${worker.phone}`}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl transition shadow-xs text-xs font-bold"
                      title={`Call ${worker.full_name}`}
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="hidden sm:inline">Call</span>
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
