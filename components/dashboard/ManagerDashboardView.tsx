'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { 
  Loader2, 
  Building, 
  Users, 
  Radio, 
  MapPin, 
  ChevronDown, 
  ChevronUp, 
  Battery, 
  Phone, 
  Play, 
  Square,
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

export default function ManagerDashboardView({ tab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();
  const [managerProfile, setManagerProfile] = useState<any>(null);
  const [activeShifts, setActiveShifts] = useState(0);
  const [expandedSupervisorId, setExpandedSupervisorId] = useState<string | null>(null);
  
  // Shift telemetry state
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // 1. Fetch Manager Profile
  useEffect(() => {
    async function getProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, role, plant_id, plant:plants(*)')
        .eq('id', user.id)
        .single();
      
      setManagerProfile(profile);
    }
    getProfile();
  }, [supabase]);

  const plantId = managerProfile?.plant_id;

  // 2. Fetch Personnel (Supervisors and Workers) and Live Locations in same plant
  const { data: dashboardData, isLoading, refetch } = useQuery({
    queryKey: ['manager-dashboard', plantId],
    queryFn: async () => {
      if (!plantId) return { supervisors: [], workers: [], locations: [] };

      // Fetch all user profiles in this plant
      const { data: profiles, error: profilesErr } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, phone, role, supervisor_id')
        .eq('plant_id', plantId);

      if (profilesErr) return { supervisors: [], workers: [], locations: [] };

      const profilesList = (profiles || []) as any[];
      const supervisors = profilesList.filter((p) => p.role === 'supervisor');
      const workers = profilesList.filter((p) => p.role === 'worker');
      const userIds = profilesList.map((p) => p.id);

      // Fetch live locations of those users
      const { data: locations, error: locationsErr } = await supabase
        .from('live_locations')
        .select(`
          id,
          latitude,
          longitude,
          speed,
          heading,
          accuracy,
          battery_level,
          is_tracking,
          recorded_at,
          user:user_profiles(id, full_name, role, plant_id, supervisor_id)
        `)
        .in('user_id', userIds);

      if (locationsErr) throw locationsErr;

      const formattedLocations = (locations || []).map((loc: any) => {
        const userObj = Array.isArray(loc.user) ? loc.user[0] : loc.user;
        const recTime = new Date(loc.recorded_at).getTime();
        const isStale = (Date.now() - recTime) > 30000;

        return {
          ...loc,
          latitude: Number(loc.latitude),
          longitude: Number(loc.longitude),
          speed: isStale ? 0 : Number(loc.speed || 0),
          is_tracking: loc.is_tracking && !isStale,
          is_stale: isStale,
          user: userObj || null
        };
      });

      return { supervisors, workers, locations: formattedLocations };
    },
    enabled: !!plantId,
    refetchInterval: 8000,
    refetchOnWindowFocus: false,
  });

  // Calculate active shifts
  useEffect(() => {
    if (dashboardData?.locations) {
      const active = dashboardData.locations.filter((loc: any) => loc.is_tracking).length;
      setActiveShifts(active);
    }
  }, [dashboardData]);

  // Real-time locations listener
  useEffect(() => {
    if (!plantId) return;

    const channel = supabase
      .channel('manager-dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_locations' },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [plantId, supabase, refetch]);

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
        // Native background service configuration
        try {
          await LocationService.startTracking({
            token: sessionToken,
            busId: managerProfile.id,
            tripId: '',
            serverUrl: `${window.location.origin}/api/worker/location`,
            isTripActive: true
          });
        } catch (err: any) {
          setTrackingError(err.message || 'Failed to trigger background service.');
          setIsShiftActive(false);
        }
      } else {
        // Web Geolocation watch fallback
        if ('geolocation' in navigator) {
          watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
              try {
                const res = await fetch('/api/worker/location', {
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
                const data = await res.json();
                if (res.status === 403 || data?.is_paused || data?.trackingEnabled === false) {
                  if (watchIdRef.current !== null) {
                    navigator.geolocation.clearWatch(watchIdRef.current);
                    watchIdRef.current = null;
                  }
                  if (Capacitor.isNativePlatform()) {
                    LocationService.stopBackgroundService().catch(() => {});
                  }
                  setIsShiftActive(false);
                  setTrackingError('Telemetry paused by Command Center (0 Network Traffic)');
                }
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

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  if (!managerProfile || isLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-8 bg-slate-200 rounded-xl w-1/4" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="h-28 bg-slate-200 rounded-2xl" />
          <div className="h-28 bg-slate-200 rounded-2xl" />
          <div className="h-28 bg-slate-200 rounded-2xl" />
        </div>
        <div className="h-96 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  const { supervisors = [], workers = [], locations = [] } = dashboardData || {};

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 border border-slate-150 rounded-2xl shadow-sm">
        <div>
          <span className="text-[9px] font-bold text-slate-800 uppercase tracking-widest bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
            Site command
          </span>
          <h2 className="text-2xl font-black text-slate-900 mt-2 tracking-tight">
            {managerProfile.plant?.name} Site
          </h2>
          <p className="text-slate-500 text-xs font-semibold mt-1">
            Plant Manager Panel • Code: {managerProfile.plant?.code}
          </p>
        </div>

        {/* Telemetry Shift Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {trackingError && (
            <div className="flex items-center gap-1.5 p-2.5 bg-red-50 text-red-700 rounded-xl text-[10px] font-bold">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{trackingError}</span>
            </div>
          )}

          <button
            onClick={toggleShift}
            className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-black transition cursor-pointer shadow-sm ${
              isShiftActive 
                ? 'bg-red-650 hover:bg-red-750 text-white shadow-red-500/10' 
                : 'bg-zinc-900 hover:bg-zinc-800 text-white'
            }`}
          >
            {isShiftActive ? (
              <>
                <Square className="w-4 h-4 fill-white" />
                Stop Duty Shift
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                Start Duty Shift
              </>
            )}
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-slate-100 text-slate-800 rounded-xl border border-slate-200">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supervisors</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{supervisors.length}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-800 rounded-xl border border-blue-100">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Workers</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{workers.length}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-100">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Live Stream Packets</span>
            <span className="text-2xl font-black text-emerald-650 mt-0.5 block">{locations.filter((l: any) => l.is_tracking).length}</span>
          </div>
        </div>
      </div>

      {/* Roster & Telemetry Subviews */}
      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b pb-4 border-slate-100">
          <h3 className="font-black text-slate-900 text-base">Supervisors & Workers Roster</h3>
          <span className="text-xs text-slate-400 font-bold">Total: {workers.length} Personnel</span>
        </div>

        <div className="space-y-4">
          {supervisors.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-semibold">
              No supervisors currently assigned to this plant.
            </div>
          ) : (
            supervisors.map((supervisor: any) => {
              const isExpanded = expandedSupervisorId === supervisor.id;
              const assignedWorkers = workers.filter((w: any) => w.supervisor_id === supervisor.id);

              return (
                <div key={supervisor.id} className="border border-slate-200 rounded-2xl overflow-hidden transition shadow-2xs">
                  {/* Accordion Header */}
                  <button
                    onClick={() => setExpandedSupervisorId(isExpanded ? null : supervisor.id)}
                    className="w-full p-4 bg-slate-50 hover:bg-slate-100/70 transition flex items-center justify-between text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center font-extrabold text-sm text-slate-700">
                        👤
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-slate-900 text-sm">{supervisor.full_name}</h4>
                          <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-md text-[9px] font-bold uppercase">
                            Supervisor
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                          {supervisor.email} • {assignedWorkers.length} Direct Reports
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {supervisor.phone && (
                        <a
                          href={`tel:${supervisor.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 bg-white border border-slate-200 text-slate-800 hover:bg-zinc-900 hover:text-white rounded-xl transition shadow-sm"
                          title="Call Supervisor"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                      )}
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-450" /> : <ChevronDown className="w-5 h-5 text-slate-450" />}
                    </div>
                  </button>

                  {/* Accordion Content (Workers List) */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 divide-y divide-slate-100">
                      {assignedWorkers.length === 0 ? (
                        <div className="p-5 text-center text-slate-400 text-xs font-semibold">
                          No workers assigned under this supervisor.
                        </div>
                      ) : (
                        assignedWorkers.map((worker: any) => {
                          const workerLocation = locations.find((l: any) => l.user?.id === worker.id);
                          const isTracking = workerLocation?.is_tracking;

                          return (
                            <div key={worker.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
                              <div className="flex items-center gap-3">
                                <span className={`flex h-2.5 w-2.5 relative flex-shrink-0`}>
                                  {isTracking && (
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  )}
                                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isTracking ? 'bg-green-500' : 'bg-slate-350'}`}></span>
                                </span>
                                <div>
                                  <span className="font-extrabold text-slate-900 text-xs sm:text-sm">{worker.full_name}</span>
                                  <span className="text-slate-400 text-[10px] block mt-0.5">{worker.email}</span>
                                </div>
                              </div>

                              <div className="flex items-center flex-wrap gap-4 text-xs font-bold text-slate-500">
                                {isTracking && workerLocation ? (
                                  <>
                                    <span className="font-mono text-slate-700">{workerLocation.speed.toFixed(1)} km/h</span>
                                    <span className="flex items-center gap-1">
                                      <Battery className="w-4 h-4 text-slate-450" />
                                      {workerLocation.battery_level !== null ? `${workerLocation.battery_level}%` : '—'}
                                    </span>
                                    <span className="text-slate-450 font-semibold text-[10px]">
                                      GPS Accuracy: {workerLocation.accuracy.toFixed(1)}m
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-slate-400 text-[10px] font-bold uppercase">Offline</span>
                                )}

                                {worker.phone && (
                                  <a
                                    href={`tel:${worker.phone}`}
                                    className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-650 border border-slate-200 rounded-lg transition"
                                    title="Call Worker"
                                  >
                                    <Phone className="w-3.5 h-3.5" />
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
