'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Radio, CheckCircle, Navigation, ShieldAlert, Users, XCircle, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';
import { MapTrackSkeleton } from '@/components/ui/Skeleton';
import { LocationService, BackgroundGeolocation } from '@/lib/capacitor-plugins';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
});

const supabaseClient = createBrowserSupabaseClient();


interface DriverTripPageProps {
  gpsStatus: 'searching' | 'active' | 'error';
  gpsErrorMsg: string | null;
  lastTelemetryTime: Date | null;
  currentLocation?: { latitude: number; longitude: number } | null;
  passedStops: string[];
  setPassedStops: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function DriverTripPage({
  gpsStatus,
  gpsErrorMsg,
  lastTelemetryTime,
  currentLocation,
  passedStops,
  setPassedStops,
}: DriverTripPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const watchIdRef = useRef<number | string | null>(null);


  // Fetch driver assignment & check if there's an active trip
  const { data: assignment, isLoading, error } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/driver/assignment');
      if (!res.ok) throw new Error('Failed to fetch assignment details');
      return res.json();
    },
  });

  // End Trip Mutation
  const endTripMutation = useMutation({
    mutationFn: async (tripId: string) => {
      const res = await fetch('/api/driver/trip/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to end trip');
      return data;
    },
    onSuccess: () => {
      // Clean up native background service tracking on trip end
      if (Capacitor.isNativePlatform()) {
        LocationService.stopTracking().catch((err: any) => {
          console.error('Failed to stop native location service on trip end:', err);
        });
      }

      // Clean up watch position
      if (watchIdRef.current !== null) {
        if (typeof watchIdRef.current === 'string') {
          BackgroundGeolocation.removeWatcher({ id: watchIdRef.current });
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = null;
      }
      queryClient.invalidateQueries({ queryKey: ['driver-assignment'] });
      router.push('/driver/dashboard');
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const activeTrip = assignment?.active_trip;
  const bus = assignment?.bus;
  const route = assignment?.route;



  const handleEndTrip = async () => {
    if (!activeTrip) return;
    if (confirm('End this route trip? Location tracking will stop immediately.')) {
      const allCompleted = passedStops.length >= stopsList.length;
      if (!allCompleted) {
        // Send notification to Admin that trip was ended early!
        try {
          await fetch('/api/driver/notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'trip_ended_early',
              message: `Ended the trip early. Only completed ${passedStops.length} out of ${stopsList.length} stops.`
            })
          });
        } catch (nErr) {
          console.error('Failed to dispatch notification:', nErr);
        }
      }
      endTripMutation.mutate(activeTrip.trip_id);
    }
  };

  const toggleStopPassed = async (stopId: string) => {
    const isPassing = !passedStops.includes(stopId);
    
    // Optimistic UI update
    if (isPassing) {
      setPassedStops([...passedStops, stopId]);
    } else {
      setPassedStops(passedStops.filter((id) => id !== stopId));
    }

    try {
      const res = await fetch('/api/driver/trip/stop-passed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: activeTrip.trip_id,
          stop_id: stopId,
          passed: isPassing,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to record stop arrival status on server');
      }
    } catch (err: any) {
      console.error(err);
      // Rollback on failure
      if (isPassing) {
        setPassedStops(passedStops.filter((id) => id !== stopId));
      } else {
        setPassedStops([...passedStops, stopId]);
      }
      alert(err.message || 'Failed to update stop status.');
    }
  };

  if (isLoading) {
    return <MapTrackSkeleton />;
  }

  if (error || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-3">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Connection Refused</h3>
        <p className="text-slate-500 text-xs">Verify your active shift connection.</p>
      </div>
    );
  }

  if (!activeTrip) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4 max-w-sm mx-auto">
        <XCircle className="w-14 h-14 text-slate-400" />
        <h3 className="font-bold text-slate-800 text-sm">No Active Trip Running</h3>
        <p className="text-slate-500 text-xs leading-relaxed">
          You must start a trip from your dashboard home screen first before opening the tracking console.
        </p>
        <button
          onClick={() => router.push('/driver/dashboard')}
          className="w-full py-3.5 bg-primary text-white text-xs font-bold rounded-xl shadow"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  const stopsList = (route?.stops || []).filter((s: any) => s.stop_order !== 0);
  // Find next stop (the first stop that has not been checked off)
  const nextStop = stopsList.find((s: any) => !passedStops.includes(s.id));



  // Distance to next stop calculation
  let distanceStr = '';
  if (currentLocation && nextStop) {
    const nextLat = Number(nextStop.latitude);
    const nextLng = Number(nextStop.longitude);
    if (!isNaN(nextLat) && !isNaN(nextLng)) {
      const dist = calculateDistanceKm(
        currentLocation.latitude,
        currentLocation.longitude,
        nextLat,
        nextLng
      );
      if (dist < 1) {
        distanceStr = `${Math.round(dist * 1000)}m`;
      } else {
        distanceStr = `${dist.toFixed(1)} km`;
      }
    }
  }

  const totalStops = stopsList.length;
  const completedStops = passedStops.length;
  const progressPercent = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;

  return (
    <div className="max-w-md mx-auto lg:max-w-5xl lg:mx-auto pt-2 pb-8 px-4 lg:px-0">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Active Telemetry and Next Stop Action */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Trip Header */}
          <div className="bg-white/90 backdrop-blur border border-slate-200/80 rounded-2xl p-5 shadow-sm flex items-center justify-between transition-all duration-300 hover:shadow-md">
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm leading-none tracking-wide">TRIP ACTIVE</h3>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1">Bus: {bus?.name}</span>
              </div>
            </div>

            {/* GPS Signal Status Badge */}
            <div className="text-right">
              {gpsStatus === 'active' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold bg-green-50 text-green-700 border border-green-150 shadow-sm">
                  <Navigation className="w-3.5 h-3.5 fill-current" /> GPS ACTIVE
                </span>
              )}
              {gpsStatus === 'searching' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold bg-yellow-50 text-yellow-700 border border-yellow-150 animate-pulse shadow-sm">
                  <Radio className="w-3.5 h-3.5 animate-spin" /> LOCATING
                </span>
              )}
              {gpsStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold bg-red-50 text-red-700 border border-red-150 shadow-sm">
                  <ShieldAlert className="w-3.5 h-3.5" /> GPS DISCONNECTED
                </span>
              )}
              <span className="text-[8px] text-slate-400 font-bold block mt-1.5">
                {lastTelemetryTime 
                  ? `Last synced: ${Math.round((Date.now() - lastTelemetryTime.getTime()) / 1000)}s ago`
                  : 'Awaiting telemetry link...'}
              </span>
            </div>
          </div>

          {gpsErrorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold">
              <AlertTriangle className="w-4.5 h-4.5 text-red-650 flex-shrink-0" />
              <span>{gpsErrorMsg}</span>
            </div>
          )}

          {/* Next Stop Details Panel */}
          {nextStop ? (
            <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 text-white rounded-2xl p-6 shadow-xl border border-indigo-500/25 relative overflow-hidden">
              {/* Glowing Background Art */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 space-y-5">
                <div>
                  <span className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/20">NEXT DESTINATION</span>
                  <h4 className="font-extrabold text-xl leading-tight mt-3 tracking-tight">{nextStop.name}</h4>
                  <span className="text-[10px] text-indigo-200/75 block mt-1.5 font-semibold">Order Index: Stop {nextStop.stop_order}</span>
                  {distanceStr && (
                    <span className="inline-flex items-center gap-1 mt-3 px-3 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 shadow-sm">
                      <Navigation className="w-3.5 h-3.5 fill-current rotate-45" /> {distanceStr} away
                    </span>
                  )}
                </div>

                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/5 space-y-2.5">
                  <span className="text-[10px] font-bold text-indigo-200/80 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-400" /> Passengers waiting ({nextStop.students?.length || 0})
                  </span>
                  {nextStop.students && nextStop.students.length > 0 ? (
                    <div className="flex flex-col gap-2.5 mt-2 text-xs divide-y divide-white/5">
                      {nextStop.students.map((student: any) => (
                        <div key={student.id} className="flex justify-between font-medium pt-1.5 first:pt-0">
                          <span className="text-slate-200">{student.full_name}</span>
                          <span className="text-indigo-300/80 text-[10px] font-bold">Grade {student.grade}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-indigo-200/50 italic mt-1.5">No students assigned to this pickup point.</p>
                  )}
                </div>

                <div className="flex gap-4 pt-1">
                  <a
                    href={
                      currentLocation
                        ? `https://www.google.com/maps/dir/?api=1&origin=${currentLocation.latitude},${currentLocation.longitude}&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`
                        : `https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-white/10 hover:bg-white/15 active:scale-98 text-white font-extrabold text-xs rounded-xl border border-white/15 shadow transition-all duration-200 text-center cursor-pointer no-underline"
                  >
                    <Navigation className="w-3.5 h-3.5 text-amber-300 fill-amber-300 animate-pulse" />
                    Navigate
                  </a>
                  <button
                    onClick={() => toggleStopPassed(nextStop.id)}
                    className="flex-1 flex items-center justify-center py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-450 hover:to-teal-450 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-500/10 active:scale-98 transition-all duration-200 cursor-pointer border-none"
                  >
                    Arrived & Pick Up
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-2xl p-6 shadow-lg space-y-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shadow-inner">
                  <Navigation className="w-5 h-5 text-white animate-pulse" />
                </div>
                <div>
                  <span className="text-[9px] font-bold text-white/70 uppercase tracking-widest block">RETURN ROUTE ACTIVE</span>
                  <h4 className="font-extrabold text-base leading-tight mt-0.5">Proceed back to School Campus</h4>
                </div>
              </div>
              <p className="text-xs text-white/80 leading-relaxed bg-white/10 p-4 rounded-xl border border-white/10">
                All kids have safely de-boarded. Tap the red button below to end this operational route log.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Route Steps Checklist and Action End */}
        <div className="lg:col-span-5 space-y-6">
          {/* Complete Route Steps List */}
          <div className="space-y-4 bg-white border border-slate-200/80 rounded-2xl p-5.5 shadow-sm transition-all duration-300 hover:shadow-md">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Route Stops Checklist</h4>
              <span className="bg-slate-100 text-slate-600 text-[10px] px-2.5 py-0.5 font-bold rounded-full border border-slate-200">
                {completedStops}/{totalStops} Done
              </span>
            </div>

            {/* Trip Progress Bar */}
            <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-150/50">
              <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                <span>Trip Progress</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-primary rounded-full transition-all duration-500" 
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            
            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {stopsList.map((stop: any) => {
                const isPassed = passedStops.includes(stop.id);
                const isCurrent = nextStop?.id === stop.id;
                return (
                  <div
                    key={stop.id}
                    onClick={() => toggleStopPassed(stop.id)}
                    className={`flex items-center justify-between p-3.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all duration-200 ${
                      isPassed 
                        ? 'bg-slate-50/50 border-slate-200 text-slate-400 line-through opacity-60' 
                        : isCurrent 
                          ? 'bg-gradient-to-r from-blue-50/70 to-indigo-50/40 border-blue-300 text-primary shadow-sm shadow-blue-500/5' 
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50/40 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`flex items-center justify-center w-5.5 h-5.5 rounded-full font-extrabold text-[10px] shadow-sm ${
                        isPassed 
                          ? 'bg-slate-200 text-slate-400' 
                          : isCurrent 
                            ? 'bg-primary text-white' 
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {stop.stop_order}
                      </span>
                      <span className={isCurrent ? 'font-bold' : 'font-medium'}>{stop.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-150">
                        {stop.students?.length || 0} kids
                      </span>
                      {isPassed && <span className="text-emerald-500 text-xs">✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-200/80 rounded-2xl p-4 text-center">
            <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest block">
              Trip Status Control Managed by Admin
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

// Helper functions for Haversine distance calculation
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}
