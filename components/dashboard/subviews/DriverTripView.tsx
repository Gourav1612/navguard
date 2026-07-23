'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Radio, CheckCircle, Navigation, ShieldAlert, Users, XCircle, AlertTriangle } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const BackgroundGeolocation = registerPlugin<any>('BackgroundGeolocation');

export default function DriverTripPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [passedStops, setPassedStops] = useState<string[]>([]);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'active' | 'error'>('searching');
  const [lastTelemetryTime, setLastTelemetryTime] = useState<Date | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);
  const watchIdRef = useRef<number | string | null>(null);
  const lastSentRef = useRef<number>(0);

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

  const postDriverLocation = async (
    latitude: number,
    longitude: number,
    speedVal?: number,
    headingVal?: number
  ) => {
    if (!bus || !activeTrip) return;

    const now = Date.now();
    const GPS_INTERVAL_MS = 15000; // Throttle to post every 15 seconds
    if (now - lastSentRef.current < GPS_INTERVAL_MS) return;
    lastSentRef.current = now;

    try {
      const res = await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bus_id: bus.id,
          trip_id: activeTrip.trip_id,
          latitude,
          longitude,
          speed: Math.max(0, speedVal || 0) * 3.6, // convert m/s to km/h
          heading: headingVal || 0,
        }),
      });

      if (res.ok) {
        setLastTelemetryTime(new Date());
      }
    } catch (err) {
      console.error('Failed to post GPS coords:', err);
    }
  };

  // Initialize Geolocation Tracking Watcher when trip is active
  useEffect(() => {
    if (!activeTrip || !bus) return;

    if (Capacitor.isNativePlatform()) {
      setGpsStatus('searching');
      setGpsErrorMsg(null);

      BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: "Tracking bus location in background...",
          backgroundTitle: "NaviGuard Active",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        async (location: any, error: any) => {
          if (error) {
            console.error('Background Geolocation watch error:', error);
            setGpsStatus('error');
            setGpsErrorMsg(error.message || 'GPS location error.');
            return;
          }
          if (location) {
            setGpsStatus('active');
            setGpsErrorMsg(null);
            await postDriverLocation(
              location.latitude,
              location.longitude,
              location.speed,
              location.bearing
            );
          }
        }
      ).then((id: string) => {
        watchIdRef.current = id;
      });
    } else {
      if (!navigator.geolocation) {
        setGpsStatus('error');
        setGpsErrorMsg('Browser does not support GPS Geolocation.');
        return;
      }

      setGpsStatus('searching');

      const wId = navigator.geolocation.watchPosition(
        async (position) => {
          setGpsStatus('active');
          setGpsErrorMsg(null);
          await postDriverLocation(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.speed || 0,
            position.coords.heading || 0
          );
        },
        (err) => {
          console.error('GPS watch error:', err);
          setGpsStatus('error');
          switch (err.code) {
            case err.PERMISSION_DENIED:
              setGpsErrorMsg('GPS Access Denied. Please enable location services.');
              break;
            case err.POSITION_UNAVAILABLE:
              setGpsErrorMsg('GPS location info unavailable.');
              break;
            case err.TIMEOUT:
              setGpsErrorMsg('GPS connection timeout.');
              break;
            default:
              setGpsErrorMsg('Unknown GPS error occurred.');
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
        }
      );

      watchIdRef.current = wId;
    }

    return () => {
      if (watchIdRef.current !== null) {
        if (typeof watchIdRef.current === 'string') {
          BackgroundGeolocation.removeWatcher({ id: watchIdRef.current });
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = null;
      }
    };
  }, [activeTrip, bus]);

  const handleEndTrip = () => {
    if (!activeTrip) return;
    if (confirm('End this route trip? Location tracking will stop immediately.')) {
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
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Opening trip details...</p>
      </div>
    );
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

  const stopsList = route?.stops || [];
  // Find next stop (the first stop that has not been checked off)
  const nextStop = stopsList.find((s: any) => !passedStops.includes(s.id));

  return (
    <div className="space-y-6 max-w-sm mx-auto pt-2">
      {/* Active Trip Header */}
      <div className="bg-white border border-slate-150 rounded-2xl p-4.5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm leading-none">TRIP ACTIVE</h3>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1">Bus: {bus?.name}</span>
          </div>
        </div>

        {/* GPS Signal Status Badge */}
        <div className="text-right">
          {gpsStatus === 'active' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-100">
              <Navigation className="w-3 h-3 fill-current" /> GPS ON
            </span>
          )}
          {gpsStatus === 'searching' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-100 animate-pulse">
              <Radio className="w-3 h-3 animate-spin" /> LOCATING
            </span>
          )}
          {gpsStatus === 'error' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-100">
              <ShieldAlert className="w-3 h-3" /> GPS OFF
            </span>
          )}
          <span className="text-[8px] text-slate-400 block mt-1">
            {lastTelemetryTime 
              ? `Last sent: ${Math.round((Date.now() - lastTelemetryTime.getTime()) / 1000)}s ago`
              : 'Waiting for coordinates...'}
          </span>
        </div>
      </div>

      {gpsErrorMsg && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{gpsErrorMsg}</span>
        </div>
      )}

      {/* Next Stop Details Panel */}
      {nextStop ? (
        <div className="bg-gradient-to-br from-primary-dark to-blue-900 text-white rounded-2xl p-5 shadow-lg space-y-4">
          <div>
            <span className="text-[9px] font-bold text-white/60 uppercase tracking-wider block">NEXT DESTINATION</span>
            <h4 className="font-extrabold text-base leading-tight mt-0.5">{nextStop.name}</h4>
            <span className="text-[10px] text-white/85 block mt-1">Order Index: Stop {nextStop.stop_order}</span>
          </div>

          <div className="bg-white/10 rounded-xl p-3 border border-white/10">
            <span className="text-[9px] font-bold text-white/70 uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Passengers waiting ({nextStop.students?.length || 0}):
            </span>
            {nextStop.students && nextStop.students.length > 0 ? (
              <div className="flex flex-col gap-1.5 mt-2 text-xs">
                {nextStop.students.map((student: any) => (
                  <div key={student.id} className="flex justify-between font-medium">
                    <span>{student.full_name}</span>
                    <span className="text-white/60 text-[10px]">Grade {student.grade}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-white/50 italic mt-1.5">No students assigned to this pickup point.</p>
            )}
          </div>

          <div className="flex gap-3">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/20 shadow-md transition text-center cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5 text-amber-300 fill-amber-300 animate-pulse" />
              Navigate
            </a>
            <button
              onClick={() => toggleStopPassed(nextStop.id)}
              className="flex-1 flex items-center justify-center py-2.5 bg-white text-primary font-bold text-xs rounded-xl shadow-md cursor-pointer hover:bg-slate-50 transition"
            >
              Arrived & Pick Up
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Navigation className="w-4.5 h-4.5 text-white animate-pulse" />
            </div>
            <div>
              <span className="text-[9px] font-bold text-white/70 uppercase tracking-widest block">RETURN ROUTE ACTIVE</span>
              <h4 className="font-extrabold text-sm leading-tight">Proceed back to School Campus</h4>
            </div>
          </div>
          <p className="text-[11px] text-white/80 leading-relaxed bg-white/10 p-3 rounded-xl border border-white/10">
            All kids have safely de-boarded. Tap the red button below to end this operational route log.
          </p>
        </div>
      )}

      {/* Complete Route Steps List */}
      <div className="space-y-3 bg-white border border-slate-150 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Route Stops Checklist</h4>
        
        <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
          {stopsList.map((stop: any) => {
            const isPassed = passedStops.includes(stop.id);
            const isCurrent = nextStop?.id === stop.id;
            return (
              <div
                key={stop.id}
                onClick={() => toggleStopPassed(stop.id)}
                className={`flex items-center justify-between p-3 rounded-xl border text-xs font-semibold cursor-pointer transition ${
                  isPassed 
                    ? 'bg-slate-50/50 border-slate-200 text-slate-400 line-through' 
                    : isCurrent 
                      ? 'bg-blue-50 border-blue-200 text-primary' 
                      : 'bg-white border-slate-150 text-slate-700 hover:bg-slate-50/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full font-bold text-[10px] ${
                    isPassed 
                      ? 'bg-slate-200 text-slate-400' 
                      : isCurrent 
                        ? 'bg-primary text-white' 
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {stop.stop_order}
                  </span>
                  <span>{stop.name}</span>
                </div>
                <span className="text-[10px] text-slate-400 font-bold">
                  {stop.students?.length || 0} kids
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* End Trip Button */}
      <button
        onClick={handleEndTrip}
        disabled={endTripMutation.isPending}
        className="w-full flex items-center justify-center py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold shadow-lg shadow-red-600/20 transition cursor-pointer disabled:opacity-50"
      >
        {endTripMutation.isPending ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin mr-1" />
            Terminating Trip Logs...
          </>
        ) : (
          'End Operational Trip'
        )}
      </button>
    </div>
  );
}
