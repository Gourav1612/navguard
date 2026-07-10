'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Clock, Navigation, AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { getDistanceKm } from '@/lib/eta';

// Load map dynamically to prevent SSR failures
const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[350px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mr-3" />
      Initializing Map Screen...
    </div>
  ),
});

export default function StudentTrackPage() {
  const router = useRouter();

  // 1. Fetch student assignment details to get route stops
  const { data: assignment, isLoading: assignmentLoading } = useQuery({
    queryKey: ['student-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/student/assignment');
      if (!res.ok) throw new Error('Failed to load assignment details');
      return res.json();
    },
  });

  // 2. Fetch live tracking telemetry details
  const { data: trackData, isLoading: trackLoading, error, refetch } = useQuery({
    queryKey: ['student-track'],
    queryFn: async () => {
      const res = await fetch('/api/student/track');
      if (!res.ok) throw new Error('Failed to fetch tracking details');
      return res.json();
    },
    refetchInterval: 10000, // Poll coordinates every 10s to sync backup telemetry
  });

  const loading = assignmentLoading || trackLoading;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Opening live maps...</p>
      </div>
    );
  }

  if (error || !trackData || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4 max-w-sm mx-auto">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Trip Tracking Disabled</h3>
        <p className="text-slate-500 text-xs leading-relaxed">
          Your bus unit is not active, or you do not have permission to track this vehicle.
        </p>
        <button
          onClick={() => router.push('/student/dashboard')}
          className="w-full py-3.5 bg-primary text-white text-xs font-bold rounded-xl shadow"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const { active_trip_id, latest_location, eta_minutes } = trackData;
  const { bus, stop, route } = assignment;
  const isTripActive = !!active_trip_id;

  // Retrieve geo stops from student assignment.
  // Wait, student assignment route response has stops, but they only contain {name, stop_order} to be lightweight.
  // To get stops coordinates for student map rendering, we can fetch from parent track API or create a helper stops fetch,
  // or query public stops for route.
  // Let's check: can students read stops from database directly under RLS?
  // Yes! The RLS policy for stops is:
  // `CREATE POLICY stops_school_select ON public.stops FOR SELECT USING (school_id = auth.school_id());`
  // So students can read stops directly from Supabase! This is a beautiful feature of RLS.
  // Let's perform a query in queryFn of stops if needed, or we can just fetch stops using Supabase browser client inside a query!
  // Let's implement that stops query so we have precise stops coordinates for student LiveMap.
  
  // Wait! In student assignment, we can query public stops for route:
  // Let's write a quick react query to pull route stops:
  // We can query Supabase directly for stops of student route.
  return (
    <StudentTrackInner
      bus={bus}
      stop={stop}
      latest_location={latest_location}
      isTripActive={isTripActive}
      eta_minutes={eta_minutes}
      router={router}
    />
  );
}

function StudentTrackInner({ bus, stop, latest_location, isTripActive, eta_minutes, router }: any) {
  // Query stops coordinates using Supabase client directly
  const { data: routeStops = [], isLoading: stopsLoading } = useQuery({
    queryKey: ['student-route-stops', bus?.id],
    queryFn: async () => {
      if (!bus?.id) return [];
      const supabase = createBrowserSupabaseClient();
      
      // Get route linked to bus
      const { data: route } = await supabase
        .from('routes')
        .select('id')
        .eq('bus_id', bus.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!route) return [];

      const { data: stops } = await supabase
        .from('stops')
        .select('*')
        .eq('route_id', route.id)
        .order('stop_order', { ascending: true });

      return (stops || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        stop_order: s.stop_order,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
      }));
    },
    enabled: !!bus?.id,
  });

  if (stopsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Aligning stops coordinates...</p>
      </div>
    );
  }

  // Determine closest stop order index to mark stops timeline check states
  let closestStopOrder = 0;
  if (latest_location && routeStops.length > 0) {
    let minDistance = Infinity;
    for (const s of routeStops) {
      const d = getDistanceKm(latest_location.latitude, latest_location.longitude, s.latitude, s.longitude);
      if (d < minDistance) {
        minDistance = d;
        closestStopOrder = s.stop_order;
      }
    }
  }

  return (
    <div className="space-y-4 max-w-sm mx-auto pt-2 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/student/dashboard')}
          className="p-2 border border-slate-200 hover:bg-slate-100 rounded-xl transition"
        >
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">Track Live Bus</h2>
          <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Live Telemetry Map</p>
        </div>
      </div>

      {/* Geolocation Map */}
      <div className="h-[350px]">
        {routeStops.length > 0 ? (
          <LiveMap
            busId={bus.id}
            stops={routeStops}
            highlightStopId={stop?.name}
            initialLocation={latest_location}
            showBus={isTripActive}
          />
        ) : (
          <div className="w-full h-full bg-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-400 p-6 text-center border">
            <AlertTriangle className="w-10 h-10 text-slate-300 mb-2" />
            <p className="text-xs font-semibold">Route alignment has no stops configured.</p>
          </div>
        )}
      </div>

      {/* Telemetry Stats Card */}
      <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
        {isTripActive && latest_location ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-150 p-3 rounded-xl">
              <Clock className="w-5 h-5 text-primary flex-shrink-0" />
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Remaining ETA</span>
                <span className="text-sm font-extrabold text-slate-800 block mt-0.5">
                  {eta_minutes !== null ? `~${eta_minutes} min` : 'Calculating...'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-slate-50 border border-slate-150 p-3 rounded-xl">
              <Navigation className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Bus Speed</span>
                <span className="text-sm font-extrabold text-slate-800 block mt-0.5">
                  {latest_location.speed ? `${latest_location.speed.toFixed(1)} km/h` : '0 km/h'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 text-center text-slate-500 font-semibold text-xs py-6">
            Bus is currently inactive. Waiting for trip start.
          </div>
        )}

        {/* Telemetry metadata */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold font-mono border-t border-slate-100 pt-3.5">
          <span>Telemetric Link Status: OK</span>
          <span>
            {latest_location 
              ? `Sync: ${new Date(latest_location.recorded_at).toLocaleTimeString()}`
              : 'Sync: No Coords'}
          </span>
        </div>
      </div>

      {/* Timeline Stops list */}
      <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
        <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Route Segments Checklist</h4>
        
        <div className="relative border-l-2 border-slate-100 ml-4.5 space-y-5.5 py-1">
          {routeStops.map((s: any) => {
            const isStudentStop = s.name === stop?.name;
            const isPassed = s.stop_order < closestStopOrder;
            const isCurrent = s.stop_order === closestStopOrder;

            // Visual representations
            let nodeIcon = (
              <span className="absolute -left-[27px] flex h-4.5 w-4.5 items-center justify-center rounded-full border border-slate-200 bg-white text-[9px] text-slate-400 font-extrabold shadow-sm">
                {s.stop_order}
              </span>
            );

            if (isPassed) {
              nodeIcon = (
                <span className="absolute -left-[27px] flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500 border border-emerald-500 text-white text-[9px] font-extrabold shadow">
                  ✓
                </span>
              );
            } else if (isCurrent) {
              nodeIcon = (
                <span className="absolute -left-[27px] flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary border border-primary text-white text-[9px] font-extrabold shadow animate-pulse">
                  ⏳
                </span>
              );
            }

            return (
              <div key={s.id} className="relative pl-6">
                {nodeIcon}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className={`text-xs font-bold leading-none ${isPassed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {s.name}
                    </h5>
                    {isStudentStop && (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 border border-red-200 text-red-700 text-[8px] font-bold mt-1.5">
                        YOUR PICKUP STOP
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold uppercase ${isPassed ? 'text-emerald-500' : isCurrent ? 'text-primary' : 'text-slate-400'}`}>
                    {isPassed ? 'passed' : isCurrent ? 'arrived' : 'upcoming'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Simple browser client creation inside React Query
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
