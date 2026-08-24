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
  AlertCircle
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

      if (profilesErr) throw profilesErr;

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Loading Plant Manager Panel...</p>
      </div>
    );
  }

  const { supervisors = [], workers = [], locations = [] } = dashboardData || {};

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 border border-slate-150 rounded-2xl shadow-sm">
        <div>
          <span className="text-[9px] font-bold text-purple-650 uppercase tracking-widest bg-purple-50 border border-purple-100 px-2.5 py-1 rounded-lg">
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
                : 'bg-[#5c3b99] hover:bg-[#432775] text-white shadow-purple-500/10'
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
          <div className="p-3 bg-purple-50 text-[#5c3b99] rounded-xl border border-purple-100">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supervisors</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{supervisors.length}</span>
          </div>
        </div>
        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Workers On Site</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{workers.length}</span>
          </div>
        </div>
        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-xl border border-green-100 relative">
            <Radio className="w-6 h-6" />
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active On-Duty</span>
            <span className="text-2xl font-black text-slate-900 mt-0.5 block">{activeShifts}</span>
          </div>
        </div>
      </div>

      {/* Interactive Map */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Real-Time Site Map</h3>
        <AdminMap plants={[managerProfile.plant]} locations={locations} selectedPlantId={plantId} />
      </div>

      {/* Team Accordion */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Personnel Roster & Safety</h3>

        <div className="space-y-3">
          {supervisors.length === 0 ? (
            <div className="bg-white border border-slate-150 rounded-2xl p-8 text-center text-slate-400 font-medium">
              No supervisors onboarded at this site yet.
            </div>
          ) : (
            supervisors.map((supervisor: any) => {
              const assignedWorkers = workers.filter((w) => w.supervisor_id === supervisor.id);
              const isExpanded = expandedSupervisorId === supervisor.id;

              return (
                <div key={supervisor.id} className="bg-white border border-slate-150 rounded-2xl overflow-hidden shadow-sm">
                  {/* Accordion Trigger */}
                  <button
                    onClick={() => setExpandedSupervisorId(isExpanded ? null : supervisor.id)}
                    className="w-full flex items-center justify-between p-5 bg-slate-50/50 hover:bg-slate-50 transition border-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-3 text-left">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                        {supervisor.full_name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm">{supervisor.full_name}</h4>
                        <p className="text-slate-400 text-[10px] font-semibold mt-0.5">
                          Supervisor • {assignedWorkers.length} Workers Assigned
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {supervisor.phone && (
                        <a
                          href={`tel:${supervisor.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 bg-white border border-slate-200 text-[#5c3b99] hover:bg-[#5c3b99] hover:text-white rounded-xl transition shadow-sm"
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
