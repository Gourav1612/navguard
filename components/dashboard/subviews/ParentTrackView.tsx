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
    <div className="space-y-4 max-w-sm mx-auto pt-2 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-2 border border-slate-200 hover:bg-slate-100 rounded-xl transition"
        >
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">Track Bus Location</h2>
          <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider">Live Telemetry Map</p>
        </div>
      </div>

      {/* Geolocation Map */}
      <div className="h-[350px]">
        {route_stops.length > 0 ? (
          <LiveMap
            busId={busId}
            stops={route_stops}
            highlightStopId={child_stop?.name}
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
          {route_stops.map((stop: any) => {
            const isChildStop = stop.name === child_stop?.name;
            const isPassed = stop.stop_order < closestStopOrder;
            const isCurrent = stop.stop_order === closestStopOrder;

            // Visual representations
            let nodeIcon = (
              <span className="absolute -left-[27px] flex h-4.5 w-4.5 items-center justify-center rounded-full border border-slate-200 bg-white text-[9px] text-slate-400 font-extrabold shadow-sm">
                {stop.stop_order}
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
              <div key={stop.id} className="relative pl-6">
                {nodeIcon}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className={`text-xs font-bold leading-none ${isPassed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {stop.name}
                    </h5>
                    {isChildStop && (
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
