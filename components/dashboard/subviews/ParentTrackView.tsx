'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, ArrowLeft, Clock, Navigation, RefreshCw, AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
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

export default function ParentTrackPage({ busId: propBusId }: { busId?: string }) {
  const router = useRouter();
  const params = useParams();
  const busId = propBusId || (params?.busId as string);

  // Fetch live track details
  const { data: trackData, isLoading, error, refetch } = useQuery({
    queryKey: ['parent-track', busId],
    queryFn: async () => {
      const res = await fetch(`/api/parent/track/${busId}`);
      if (!res.ok) throw new Error('Failed to fetch tracking details');
      return res.json();
    },
    refetchInterval: 10000, // Poll coordinates every 10s to sync backup telemetry
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Opening live maps...</p>
      </div>
    );
  }

  if (error || !trackData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4 max-w-sm mx-auto">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Trip Tracking Disabled</h3>
        <p className="text-slate-500 text-xs leading-relaxed">
          The bus unit is not active, or you do not have permission to track this vehicle.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full py-3.5 bg-primary text-white text-xs font-bold rounded-xl shadow"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const { active_trip_id, latest_location, child_stop, eta_minutes, route_stops = [] } = trackData;
  const isTripActive = !!active_trip_id;

  // Determine closest stop order index to mark stops timeline check states
  let closestStopOrder = 0;
  if (latest_location && route_stops.length > 0) {
    let minDistance = Infinity;
    for (const stop of route_stops) {
      const d = getDistanceKm(latest_location.latitude, latest_location.longitude, stop.latitude, stop.longitude);
      if (d < minDistance) {
        minDistance = d;
        closestStopOrder = stop.stop_order;
      }
    }
  }

  return (
    <div className="space-y-6 w-full pt-2 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="bg-white border border-slate-150 p-5 rounded-3xl shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl transition cursor-pointer flex items-center justify-center"
            title="Go Back to Dashboard"
          >
            <ArrowLeft className="w-4.5 h-4.5 text-slate-650" />
          </button>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none">Track Bus Location</h2>
            <p className="text-slate-450 text-[10px] font-bold uppercase tracking-widest mt-1.5">Live Telemetry Map Screen</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-150/60 px-3 py-1.5 rounded-lg font-mono">
          <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping"></span>
          <span>Feed Live</span>
        </div>
      </div>

      {/* Grid Layout for Full Stretch Interactive Map & Control Center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2/3 width) - Map View & Telemetry Stats */}
        <div className="lg:col-span-2 space-y-6">
          {/* Geolocation Map */}
          <div className="h-[460px] bg-white border border-slate-150 rounded-3xl overflow-hidden shadow-xs relative">
            {route_stops.length > 0 ? (
              <LiveMap
                busId={busId}
                stops={route_stops}
                highlightStopId={child_stop?.name}
                initialLocation={latest_location}
                showBus={isTripActive}
              />
            ) : (
              <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <AlertTriangle className="w-10 h-10 text-slate-300 mb-2" />
                <p className="text-xs font-semibold">Route alignment has no stops configured.</p>
              </div>
            )}
          </div>

          {/* Telemetry Stats Card */}
          <div className="bg-white border border-slate-150 rounded-3xl p-5 shadow-xs space-y-5">
            {isTripActive && latest_location ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-4 bg-slate-50 border border-slate-150/80 p-4 rounded-2xl">
                  <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-xl text-primary flex-shrink-0">
                    <Clock className="w-5.5 h-5.5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Estimated Arrival</span>
                    <span className="text-base font-black text-slate-800 block mt-1">
                      {eta_minutes !== null ? `~${eta_minutes} min` : 'Calculating...'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-slate-50 border border-slate-150/80 p-4 rounded-2xl">
                  <div className="flex items-center justify-center w-10 h-10 bg-emerald-50 rounded-xl text-emerald-600 flex-shrink-0">
                    <Navigation className="w-5.5 h-5.5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Current Speed</span>
                    <span className="text-base font-black text-slate-800 block mt-1">
                      {latest_location.speed ? `${latest_location.speed.toFixed(1)} km/h` : '0 km/h'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center text-amber-800 font-bold text-xs py-6">
                Bus is currently inactive. Waiting for driver to start the trip.
              </div>
            )}

            {/* Telemetry metadata */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold font-mono border-t border-slate-100 pt-3.5 pl-1">
              <span>GPS Connection Status: Active</span>
              <span>
                {latest_location 
                  ? `Sync Time: ${new Date(latest_location.recorded_at).toLocaleTimeString()}`
                  : 'Sync Time: Waiting for coordinates'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column (1/3 width) - Stops Segment timeline */}
        <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-xs space-y-6 h-fit">
          <div>
            <h4 className="font-extrabold text-slate-800 text-sm tracking-tight">Route Segment Progress</h4>
            <p className="text-[10px] text-slate-455 font-bold uppercase tracking-widest mt-1">transit stations sequence</p>
          </div>
          
          <div className="relative border-l-2 border-slate-100 ml-4.5 space-y-6 py-1">
            {route_stops.map((stop: any) => {
              const isChildStop = stop.name === child_stop?.name;
              const isPassed = stop.stop_order < closestStopOrder;
              const isCurrent = stop.stop_order === closestStopOrder;

              // Visual node icons
              let nodeIcon = (
                <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[9px] text-slate-400 font-black shadow-sm">
                  {stop.stop_order}
                </span>
              );

              if (isPassed) {
                nodeIcon = (
                  <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 border border-emerald-500 text-white text-[9px] font-black shadow">
                    ✓
                  </span>
                );
              } else if (isCurrent) {
                nodeIcon = (
                  <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-primary border border-primary text-white text-[9px] font-black shadow animate-pulse">
                    ⏳
                  </span>
                );
              }

              return (
                <div key={stop.id} className="relative pl-7">
                  {nodeIcon}
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h5 className={`text-xs font-bold leading-tight ${isPassed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {stop.name}
                      </h5>
                      {isChildStop && (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-50 border border-red-100 text-red-700 text-[8px] font-black uppercase tracking-wider mt-1.5">
                          Your Pickup Stop
                        </span>
                      )}
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-wider ${isPassed ? 'text-emerald-500' : isCurrent ? 'text-primary' : 'text-slate-400'}`}>
                      {isPassed ? 'passed' : isCurrent ? 'arrived' : 'upcoming'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
