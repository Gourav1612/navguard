'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  Loader2,
  Building,
  Users,
  ChevronDown,
  ChevronUp,
  Battery,
  Phone,
  AlertCircle,
  Activity
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

const getApiEndpoint = (path: string): string => {
  if (
    typeof window !== 'undefined' &&
    window.location.origin &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('capacitor://')
  ) {
    return `${window.location.origin}${path}`;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://navguard-eight.vercel.app';
  return `${base.replace(/\/$/, '')}${path}`;
};

export default function ManagerDashboardView({ tab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();
  const [activeShifts, setActiveShifts] = useState(0);
  const [expandedSupervisorId, setExpandedSupervisorId] = useState<string | null>(null);

  // Shift telemetry state
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastKnownCoordsRef = useRef<{ lat: number; lng: number; speed: number; heading: number; accuracy: number } | null>(null);

  // 1. Unified Manager Profile & Dashboard Data Query via secure Server API
  const { data: dashboardData, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-dashboard-unified'],
    queryFn: async () => {
      const res = await fetch('/api/manager/dashboard');
      if (!res.ok) {
        // Fallback to client-side auth check if needed
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('id, full_name, email, role, plant_id, location_interval, is_active')
          .eq('id', user.id)
          .maybeSingle();

        if (profile) {
          return {
            profile: { ...profile, plant: null },
            plant: null,
            supervisors: [],
            workers: [],
            locations: [],
          };
        }
        return null;
      }
      return res.json();
    },
    refetchInterval: 8000,
    refetchOnWindowFocus: false,
  });

  const managerProfile = dashboardData?.profile;
  const plantId = managerProfile?.plant_id;
  const currentPlant = dashboardData?.plant || managerProfile?.plant;

  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Calculate active shifts
  useEffect(() => {
    if (dashboardData?.locations) {
      const active = dashboardData.locations.filter((loc: any) => loc.is_tracking).length;
      setActiveShifts(active);
    }
  }, [dashboardData]);

  // Real-time locations listener (persistent WebSocket connection)
  useEffect(() => {
    if (!plantId) return;

    const channel = supabase
      .channel(`manager-dashboard-realtime-${plantId}`)
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
  }, [plantId, supabase]);

  // Shift telemetry state
  const [isPausedByAdmin, setIsPausedByAdmin] = useState(false);
  const lastSentRef = useRef<number>(0);
  const timerIdRef = useRef<any>(null);
  const startAutoTrackingRef = useRef<any>(null);

  const startAutoTracking = useCallback(async () => {
    if (!managerProfile?.id) return;
    const sessionRes = await supabase.auth.getSession();
    const sessionToken = sessionRes.data.session?.access_token;
    if (!sessionToken) return;

    setIsShiftActive(true);
    setIsPausedByAdmin(false);
    setTrackingError(null);

    const apiUrl = getApiEndpoint('/api/worker/location');

    if (Capacitor.isNativePlatform()) {
      try {
        await LocationService.startTracking({
          token: sessionToken,
          busId: managerProfile.id,
          tripId: '',
          serverUrl: apiUrl,
          isTripActive: true,
        });
      } catch (err) {
        console.error('Failed to start native tracking:', err);
      }
      return;
    }

    const sendLocationPacket = async (coords: { lat: number; lng: number; speed: number; heading: number; accuracy: number }) => {
      const now = Date.now();
      const intervalSeconds = managerProfile.location_interval || 10;
      if (now - lastSentRef.current < intervalSeconds * 1000 - 500) return;
      lastSentRef.current = now;

      try {
        const res = await fetch(apiUrl, {
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
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
            heading: pos.coords.heading || 0,
            accuracy: pos.coords.accuracy,
          };
          lastKnownCoordsRef.current = coords;
          sendLocationPacket(coords);
        },
        () => { },
        { enableHighAccuracy: true, maximumAge: 3000 }
      );

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
            heading: pos.coords.heading || 0,
            accuracy: pos.coords.accuracy,
          };
          lastKnownCoordsRef.current = coords;
          sendLocationPacket(coords);
        },
        (err) => {
          setTrackingError(err.message || 'GPS access denied.');
        },
        { enableHighAccuracy: true, maximumAge: 3000 }
      );

      if (timerIdRef.current !== null) {
        clearInterval(timerIdRef.current);
      }
      const intervalMs = Math.max(2000, (managerProfile.location_interval || 10) * 1000);
      timerIdRef.current = setInterval(() => {
        if (lastKnownCoordsRef.current) {
          sendLocationPacket(lastKnownCoordsRef.current);
        }
      }, intervalMs);
    }
  }, [managerProfile?.id, managerProfile?.location_interval, supabase]);

  useEffect(() => {
    startAutoTrackingRef.current = startAutoTracking;
  }, [startAutoTracking]);

  // Supabase Realtime listener on user_profiles for instant pause/resume signals
  useEffect(() => {
    if (!managerProfile?.id) return;

    const channel = supabase
      .channel(`manager-pause-listener-${managerProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `id=eq.${managerProfile.id}`,
        },
        async (payload: any) => {
          const updated = payload.new;
          if (updated && updated.is_active === false) {
            // Admin paused telemetry: clear all future timers & watchers (ZERO packets sent)
            if (watchIdRef.current !== null) {
              navigator.geolocation.clearWatch(watchIdRef.current);
              watchIdRef.current = null;
            }
            if (timerIdRef.current !== null) {
              clearInterval(timerIdRef.current);
              timerIdRef.current = null;
            }
            if (Capacitor.isNativePlatform()) {
              LocationService.stopBackgroundService().catch(() => { });
            }
            setIsShiftActive(false);
            setIsPausedByAdmin(true);
            setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
          } else if (updated && updated.is_active === true) {
            setIsPausedByAdmin(false);
            setTrackingError(null);
            if (startAutoTrackingRef.current) startAutoTrackingRef.current();
            refetchRef.current();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [managerProfile?.id, supabase]);

  // 4-second hybrid polling fallback to guarantee packet streaming auto-starts if Realtime drops
  useEffect(() => {
    if (!managerProfile?.id) return;

    const interval = setInterval(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_active')
          .eq('id', user.id)
          .single();

        const serverIsActive = profile?.is_active !== false;

        if (serverIsActive && isPausedByAdmin) {
          setIsPausedByAdmin(false);
          setTrackingError(null);
          startAutoTracking();
        } else if (!serverIsActive && !isPausedByAdmin) {
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          if (timerIdRef.current !== null) {
            clearInterval(timerIdRef.current);
            timerIdRef.current = null;
          }
          if (Capacitor.isNativePlatform()) {
            LocationService.stopBackgroundService().catch(() => { });
          }
          setIsShiftActive(false);
          setIsPausedByAdmin(true);
          setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
        }
      } catch { }
    }, 4000);

    return () => clearInterval(interval);
  }, [managerProfile?.id, isPausedByAdmin, startAutoTracking]);

  // Automatically start background packet streaming upon login
  useEffect(() => {
    if (managerProfile?.id && !isPausedByAdmin) {
      startAutoTracking();
    }
  }, [managerProfile?.id, isPausedByAdmin, startAutoTracking]);

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Must be declared before any early returns to satisfy React hooks rules
  const plantsArray = useMemo(() => {
    return managerProfile?.plant ? [managerProfile.plant] : [];
  }, [managerProfile?.plant?.id, managerProfile?.plant?.name]);

  const { supervisors = [], workers = [], locations = [] } = dashboardData || {};

  if (isLoading) {
    return (
      <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-28 bg-slate-200/80 rounded-2xl sm:rounded-3xl" />
        <div className="h-80 bg-slate-200/80 rounded-2xl sm:rounded-3xl" />
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="h-20 sm:h-24 bg-slate-200/80 rounded-xl sm:rounded-2xl" />
          <div className="h-20 sm:h-24 bg-slate-200/80 rounded-xl sm:rounded-2xl" />
          <div className="h-20 sm:h-24 bg-slate-200/80 rounded-xl sm:rounded-2xl" />
        </div>
        <div className="h-64 bg-slate-200/80 rounded-2xl sm:rounded-3xl" />
      </div>
    );
  }

  if (!managerProfile || isError) {
    return (
      <div className="p-6 sm:p-8 max-w-md mx-auto text-center space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs sm:text-sm font-semibold">
          Unable to load manager profile data. Please verify your account setup or try again.
        </div>
        <button
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-zinc-900 text-white text-xs font-bold rounded-xl hover:bg-zinc-800 transition cursor-pointer"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-white p-4 sm:p-6 border border-slate-200/80 rounded-2xl sm:rounded-3xl shadow-xs">
        <div>
          <span className="text-[9px] font-black text-[#5c3b99] uppercase tracking-widest bg-purple-50 border border-purple-200/60 px-2.5 py-1 rounded-md inline-block">
            Site command
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 tracking-tight">
            {managerProfile.plant?.name || 'Site'} Command
          </h2>
          <p className="text-slate-500 text-[11px] sm:text-xs font-semibold mt-0.5">
            Plant Manager Panel • Code: <span className="font-mono font-bold text-slate-700">{managerProfile.plant?.code || 'Assigned'}</span>
          </p>
        </div>

        {/* Telemetry Status Indicator (100% Admin Controlled) */}
        <div className="flex items-center">
          {isPausedByAdmin ? (
            <div className="flex items-center justify-center gap-2 w-full sm:w-auto px-3.5 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[11px] sm:text-xs font-bold shadow-2xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-600" />
              <span>Telemetry paused by Command Center</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 w-full sm:w-auto px-3.5 py-2 bg-emerald-50 border border-emerald-200/90 text-emerald-800 rounded-xl text-[11px] sm:text-xs font-extrabold shadow-2xs">
              <span className="flex h-2 w-2 relative flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="tracking-wide">LIVE TELEMETRY STREAMING</span>
            </div>
          )}
        </div>
      </div>

      {/* Site Live Map */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">Site Live Map</h3>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
            {locations.filter((l: any) => l.is_tracking).length} Active Live
          </span>
        </div>
        <div className="rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/80 shadow-xs">
          <AdminMap plants={plantsArray} locations={locations} selectedPlantId={managerProfile.plant_id} />
        </div>
      </div>

      {/* Metrics Row (3 Compact Columns on Mobile) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="bg-white border border-slate-200/80 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
          <div className="p-2 sm:p-2.5 bg-slate-100 text-slate-800 rounded-lg sm:rounded-xl border border-slate-200 flex-shrink-0">
            <Building className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">Supervisors</span>
            <span className="text-lg sm:text-2xl font-black text-slate-900 mt-0.5 block leading-none">{supervisors.length}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
          <div className="p-2 sm:p-2.5 bg-blue-50 text-blue-700 rounded-lg sm:rounded-xl border border-blue-100 flex-shrink-0">
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">Workers</span>
            <span className="text-lg sm:text-2xl font-black text-slate-900 mt-0.5 block leading-none">{workers.length}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-3 sm:p-4 rounded-xl sm:rounded-2xl shadow-xs flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
          <div className="p-2 sm:p-2.5 bg-emerald-50 text-emerald-700 rounded-lg sm:rounded-xl border border-emerald-100 flex-shrink-0">
            <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">Live Stream</span>
            <span className="text-lg sm:text-2xl font-black text-emerald-600 mt-0.5 block leading-none">{locations.filter((l: any) => l.is_tracking).length}</span>
          </div>
        </div>
      </div>

      {/* Roster & Telemetry Subviews */}
      <div className="bg-white border border-slate-200/80 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b pb-3 border-slate-100">
          <h3 className="font-black text-slate-900 text-sm sm:text-base tracking-tight">Supervisors & Workers Roster</h3>
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-md">
            Total: {workers.length + supervisors.length} Personnel
          </span>
        </div>

        <div className="space-y-3">
          {supervisors.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-xs font-semibold bg-slate-50 rounded-xl">
              No supervisors currently assigned to this plant.
            </div>
          ) : (
            supervisors.map((supervisor: any) => {
              const isExpanded = expandedSupervisorId === supervisor.id;
              const assignedWorkers = workers.filter((w: any) => w.supervisor_id === supervisor.id);

              return (
                <div key={supervisor.id} className="border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden transition shadow-2xs">
                  {/* Accordion Header */}
                  <button
                    onClick={() => setExpandedSupervisorId(isExpanded ? null : supervisor.id)}
                    className="w-full p-3 sm:p-4 bg-slate-50/90 hover:bg-slate-100 transition-colors flex items-center justify-between text-left cursor-pointer gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 sm:w-9 sm:h-9 bg-purple-100 border border-purple-200 rounded-lg sm:rounded-xl flex items-center justify-center font-extrabold text-xs text-purple-700 flex-shrink-0">
                        {supervisor.full_name ? supervisor.full_name[0].toUpperCase() : 'S'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">{supervisor.full_name}</h4>
                          <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded text-[8px] sm:text-[9px] font-bold uppercase">
                            Supervisor
                          </span>
                        </div>
                        <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium truncate mt-0.5">
                          {supervisor.email} • {assignedWorkers.length} Reports
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {supervisor.phone && (
                        <a
                          href={`tel:${supervisor.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 sm:p-2 bg-white border border-slate-200 text-slate-700 hover:bg-zinc-900 hover:text-white rounded-lg transition shadow-2xs"
                          title="Call Supervisor"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <div className="p-1 text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </button>

                  {/* Accordion Content (Workers List) */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100 bg-white">
                      {assignedWorkers.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-xs font-semibold">
                          No workers assigned under this supervisor.
                        </div>
                      ) : (
                        assignedWorkers.map((worker: any) => {
                          const workerLocation = locations.find((l: any) => l.user?.id === worker.id);
                          const isTracking = workerLocation?.is_tracking;

                          return (
                            <div key={worker.id} className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/50 transition">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="flex h-2 w-2 relative flex-shrink-0">
                                  {isTracking && (
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  )}
                                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isTracking ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                                </span>
                                <div className="min-w-0">
                                  <span className="font-bold text-slate-900 text-xs sm:text-sm block truncate">{worker.full_name}</span>
                                  <span className="text-slate-400 text-[10px] block truncate font-mono">{worker.email}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-3 text-xs font-semibold text-slate-500 pl-4.5 sm:pl-0">
                                {isTracking && workerLocation ? (
                                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                    <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold">
                                      {workerLocation.speed.toFixed(1)} km/h
                                    </span>
                                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                      <Battery className="w-3.5 h-3.5 text-slate-400" />
                                      {workerLocation.battery_level !== null ? `${workerLocation.battery_level}%` : '—'}
                                    </span>
                                    <span className="text-slate-400 font-medium text-[9px]">
                                      ±{workerLocation.accuracy.toFixed(0)}m
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-slate-400 bg-slate-100 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                                    Offline
                                  </span>
                                )}

                                {worker.phone && (
                                  <a
                                    href={`tel:${worker.phone}`}
                                    className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg transition"
                                    title="Call Worker"
                                  >
                                    <Phone className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
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
