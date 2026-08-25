'use client';

import { useEffect, useState, useRef } from 'react';
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
  const [supervisorProfile, setSupervisorProfile] = useState<any>(null);
  const [plantManager, setPlantManager] = useState<any>(null);
  
  // Shift telemetry state
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // 1. Fetch Supervisor Profile
  useEffect(() => {
    async function getProfile() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;
        const profile = await res.json();
        setSupervisorProfile(profile);
      } catch (err) {
        console.error('Failed to fetch supervisor profile', err);
      }
    }
    getProfile();
  }, []);

  // 2. Fetch Direct Workers and their live locations
  const { data: dashboardData, isLoading, refetch } = useQuery({
    queryKey: ['supervisor-dashboard', supervisorProfile?.id],
    queryFn: async () => {
      if (!supervisorProfile?.id) return { workers: [], locations: [] };

      // Fetch workers assigned under this supervisor
      const { data: workers, error: workersErr } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, phone, role, is_active')
        .eq('supervisor_id', supervisorProfile.id)
        .eq('role', 'worker');

      if (workersErr) throw workersErr;

      const workerIds = (workers || []).map((w: any) => w.id);

      // Fetch live locations of those direct workers
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
        .in('user_id', workerIds);

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

      return { workers: workers || [], locations: formattedLocations };
    },
    enabled: !!supervisorProfile?.id,
    refetchInterval: 8000,
  });

  // Real-time listener for direct worker coordinates
  useEffect(() => {
    if (!supervisorProfile?.id) return;

    const channel = supabase
      .channel('supervisor-dashboard-realtime')
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
  }, [supervisorProfile?.id, supabase, refetch]);

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Loading Supervisor Panel...</p>
      </div>
    );
  }

  const { workers = [], locations = [] } = dashboardData || {};
  const activeWorkersCount = locations.filter((loc: any) => loc.is_tracking).length;

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
      
      {/* Plant Manager Contact Card */}
      {plantManager && (
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 text-[#5c3b99] border border-purple-100 rounded-xl flex items-center justify-center font-extrabold text-sm">
              🏢
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Plant Manager</span>
              <h4 className="font-extrabold text-slate-900 text-sm mt-0.5">{plantManager.full_name}</h4>
              <span className="text-[10px] text-slate-500 block leading-tight">{plantManager.email}</span>
            </div>
          </div>
          
          {plantManager.phone && (
            <a
              href={`tel:${plantManager.phone}`}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              <Phone className="w-3.5 h-3.5" />
              Call Manager
            </a>
          )}
        </div>
      )}

      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 border border-slate-150 rounded-2xl shadow-sm">
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

      {/* Team Live Map */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Team Live Map</h3>
        <AdminMap plants={[supervisorProfile.plant]} locations={locations} selectedPlantId={supervisorProfile.plant_id} />
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
                <div key={worker.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-slate-50/50 transition">
                  <div className="flex items-center gap-3">
                    <span className="flex h-2.5 w-2.5 relative flex-shrink-0">
                      {isTracking && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isTracking ? 'bg-green-500' : 'bg-slate-350'}`}></span>
                    </span>
                    <div>
                      <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm">{worker.full_name}</h4>
                      <p className="text-slate-400 text-[10px] font-semibold mt-0.5">{worker.email}</p>
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
                        <span className="text-slate-450 text-[10px] font-semibold">
                          GPS Accuracy: {workerLocation.accuracy.toFixed(1)}m
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400 text-[10px] font-bold uppercase">Offline</span>
                    )}

                    {worker.phone && (
                      <a
                        href={`tel:${worker.phone}`}
                        className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-650 border border-slate-200 rounded-xl transition shadow-sm"
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
      </div>
    </div>
  );
}
