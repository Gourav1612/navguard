'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { 
  Loader2, 
  User, 
  Building, 
  Phone, 
  Play, 
  Square,
  AlertCircle,
  ShieldCheck,
  Compass,
  Battery,
  AlertTriangle,
  Mail
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { LocationService } from '@/lib/capacitor-plugins';

export default function WorkerDashboardView({ tab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();
  const [shiftActive, setShiftActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  
  // Real-time telemetry display states
  const [speed, setSpeed] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number>(100);

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  // 1. Fetch Worker Assignment and Contact Cards
  const { data: assignment, isLoading, refetch } = useQuery({
    queryKey: ['worker-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/worker/assignment');
      if (!res.ok) throw new Error('Failed to load assignment data');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Track battery level dynamically (PWA/web fallback)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    }
  }, []);

  // Automatically start background packet streaming upon login
  useEffect(() => {
    let watchId: number | null = null;

    async function startAutoTracking() {
      const sessionRes = await supabase.auth.getSession();
      const sessionToken = sessionRes.data.session?.access_token;
      if (!sessionToken) return;

      setShiftActive(true);

      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.startTracking({
            token: sessionToken,
            busId: assignment?.worker?.id || '',
            tripId: '',
            serverUrl: `${window.location.origin}/api/worker/location`,
            isTripActive: true,
          });
        } catch (err) {
          console.error('Failed to start native location tracking:', err);
        }
      }

      if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
            const currentAccuracy = pos.coords.accuracy;
            setSpeed(currentSpeed);
            setAccuracy(currentAccuracy);

            const now = Date.now();
            const intervalSeconds = assignment?.worker?.location_interval || 10;
            if (now - lastSentRef.current < intervalSeconds * 1000) return;
            lastSentRef.current = now;

            try {
              const res = await fetch('/api/worker/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
                body: JSON.stringify({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  speed: currentSpeed,
                  heading: pos.coords.heading || 0,
                  accuracy: currentAccuracy,
                  battery_level: batteryLevel,
                  is_tracking: true,
                }),
              });
              const data = await res.json();
              if (data && data.trackingEnabled === false) {
                setShiftActive(false);
              } else {
                setShiftActive(true);
              }
            } catch (err) {
              console.error('Failed to post coordinates:', err);
            }
          },
          (err) => {
            setTrackingError(err.message || 'GPS access denied.');
          },
          { enableHighAccuracy: true, maximumAge: 0 }
        );
      }
    }

    if (assignment) {
      startAutoTracking();
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [assignment, supabase, batteryLevel]);

  // Handle Shift Telemetry Broadcaster
  const handleToggleShift = async () => {
    if (shiftActive) {
      // STOP SHIFT
      setShiftActive(false);
      setSpeed(0);
      setAccuracy(0);
      
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.stopTracking();
        } catch (err) {
          console.error('Failed to stop native location service:', err);
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

      setShiftActive(true);

      // Start local Geolocation watcher strictly for updating UI gauges
      if ('geolocation' in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          async (pos) => {
            const currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
            const currentAccuracy = pos.coords.accuracy;
            
            setSpeed(currentSpeed);
            setAccuracy(currentAccuracy);

            // Web fallback poster (if not native platform)
            if (!Capacitor.isNativePlatform()) {
              const now = Date.now();
              const intervalSeconds = assignment?.worker?.location_interval || 10;
              if (now - lastSentRef.current < intervalSeconds * 1000) return;
              lastSentRef.current = now;

              try {
                await fetch('/api/worker/location', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                  body: JSON.stringify({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: currentSpeed,
                    heading: pos.coords.heading || 0,
                    accuracy: currentAccuracy,
                    battery_level: batteryLevel,
                    is_tracking: true
                  })
                });
              } catch (err) {
                console.error('Failed to post coordinates:', err);
              }
            }
          },
          (err) => {
            setTrackingError(err.message || 'GPS access denied.');
            setShiftActive(false);
          },
          { enableHighAccuracy: true, maximumAge: 0 }
        );
      } else {
        setTrackingError('Browser does not support GPS Geolocation.');
        setShiftActive(false);
        return;
      }

      // Native Background Foreground Service
      if (Capacitor.isNativePlatform()) {
        try {
          await LocationService.startTracking({
            token: sessionToken,
            busId: assignment?.worker?.id || '',
            tripId: '',
            serverUrl: `${window.location.origin}/api/worker/location`,
            isTripActive: true
          });
        } catch (err: any) {
          setTrackingError(err.message || 'Failed to start background tracking service.');
          setShiftActive(false);
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Loading Worker Panel...</p>
      </div>
    );
  }

  if (!assignment || !assignment.worker) {
    return (
      <div className="p-6 text-center max-w-md mx-auto space-y-4">
        <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto" />
        <h3 className="text-lg font-bold text-slate-800">No Plant Link</h3>
        <p className="text-slate-500 text-sm">
          Your profile has not been assigned to any plant site yet. Contact your Super Admin to link your profile.
        </p>
      </div>
    );
  }

  const { plant, supervisor, plantManager } = assignment;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-md mx-auto animate-in fade-in duration-200">
      
      {/* Header Plant Tag */}
      {plant ? (
        <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm space-y-2">
          <span className="text-[9px] font-bold text-blue-650 uppercase tracking-widest bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg">
            Active Site Link
          </span>
          <h2 className="text-xl font-black text-slate-900 tracking-tight mt-2">{plant.name}</h2>
          <p className="text-slate-500 text-[10px] font-bold uppercase">Plant Code: {plant.code}</p>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-amber-800 text-xs font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>No active plant site link configured. Telemetry disabled.</span>
        </div>
      )}

      {/* Main Shift Telemetry Broadcaster Status */}
      {plant && (
        <div className="bg-white border border-slate-150 p-6 rounded-2xl shadow-sm text-center space-y-5">
          <div className="space-y-1">
            <h3 className="font-extrabold text-slate-800 text-sm">Shift Attendance & Tracking</h3>
            <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider mt-2 ${
              shiftActive 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${shiftActive ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'}`}></span>
              {shiftActive ? '🟢 LIVE ON DUTY (AUTO-TRACKING)' : '⏳ CONNECTING GPS SATELLITE...'}
            </span>
          </div>

          <p className="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-100 p-3 rounded-xl">
            ⚡ Telemetry & location packets are automatically streaming to the Command Center while logged in.
          </p>

          {trackingError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[10px] font-bold text-left leading-normal">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-650" />
              <span>{trackingError}</span>
            </div>
          )}

          {/* Real-time Status Gauges */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100 text-center font-sans">
            <div>
              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Speed</span>
              <span className="text-slate-800 font-mono font-extrabold text-sm block mt-1">
                {speed > 0 ? `${speed.toFixed(1)} km/h` : '0.0 km/h'}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">GPS Accuracy</span>
              <span className="text-slate-800 font-extrabold text-sm block mt-1">
                {accuracy > 0 ? `${accuracy.toFixed(1)}m` : 'High'}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Battery</span>
              <span className="text-slate-800 font-extrabold text-sm block mt-1 flex items-center justify-center gap-1">
                <Battery className="w-4 h-4 text-emerald-600" />
                {batteryLevel}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reporting Contacts Card */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-450 uppercase tracking-widest pl-2">Line Reporting Contacts</h3>
        
        {/* Supervisor Card */}
        {supervisor ? (
          <div className="bg-white border border-slate-150 p-4.5 rounded-2xl shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-50 text-amber-700 border border-amber-100 rounded-xl flex items-center justify-center font-extrabold text-xs">
                👤
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Line Supervisor</span>
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm mt-0.5">{supervisor.full_name}</h4>
                <span className="text-[10px] text-slate-500 block leading-tight">{supervisor.email}</span>
              </div>
            </div>
            {supervisor.phone && (
              <a
                href={`tel:${supervisor.phone}`}
                className="p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-100 rounded-xl transition shadow-sm"
                title="Call Supervisor"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-150 p-4 rounded-xl text-center text-slate-400 text-xs font-semibold">
            No line supervisor assigned.
          </div>
        )}

        {/* Plant Manager Card */}
        {plantManager ? (
          <div className="bg-white border border-slate-150 p-4.5 rounded-2xl shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-50 text-[#5c3b99] border border-purple-100 rounded-xl flex items-center justify-center font-extrabold text-xs">
                🏢
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Plant Manager</span>
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm mt-0.5">{plantManager.full_name}</h4>
                <span className="text-[10px] text-slate-500 block leading-tight">{plantManager.email}</span>
              </div>
            </div>
            {plantManager.phone && (
              <a
                href={`tel:${plantManager.phone}`}
                className="p-2.5 bg-purple-50 hover:bg-purple-100 text-[#5c3b99] border border-purple-100 rounded-xl transition shadow-sm"
                title="Call Manager"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-150 p-4 rounded-xl text-center text-slate-400 text-xs font-semibold">
            No plant manager found for this site.
          </div>
        )}
      </div>
    </div>
  );
}
