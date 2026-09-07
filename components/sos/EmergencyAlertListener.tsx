'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { sirenPlayer } from '@/lib/siren-audio';
import { 
  AlertTriangle, 
  Volume2, 
  VolumeX, 
  CheckCircle2, 
  MapPin, 
  Clock, 
  ShieldAlert, 
  User, 
  Building,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmergencyAlertItem {
  id: string;
  sender_id: string;
  supervisor_id?: string | null;
  plant_id?: string | null;
  sender_role: 'admin' | 'manager' | 'supervisor' | 'worker';
  sender_name: string;
  plant_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  status: 'active' | 'acknowledged' | 'resolved';
  message?: string | null;
  created_at: string;
}

interface EmergencyAlertListenerProps {
  currentUserRole?: string;
  currentUserId?: string;
}

export function EmergencyAlertListener({ currentUserRole, currentUserId }: EmergencyAlertListenerProps) {
  const supabase = createBrowserSupabaseClient();
  const [activeAlerts, setActiveAlerts] = useState<EmergencyAlertItem[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Fetch currently active alerts
  const fetchActiveAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/sos/active');
      if (res.ok) {
        const data = await res.json();
        const incomingAlerts: EmergencyAlertItem[] = data.alerts || [];
        setActiveAlerts(incomingAlerts);

        if (incomingAlerts.length > 0 && !isMutedRef.current) {
          sirenPlayer.play();
        } else if (incomingAlerts.length === 0) {
          sirenPlayer.stop();
        }
      }
    } catch (err) {
      console.warn('Failed to query active SOS alerts:', err);
    }
  }, []);

  useEffect(() => {
    fetchActiveAlerts();
    const interval = setInterval(fetchActiveAlerts, 10000); // 10-second polling fallback

    // Supabase Realtime channel subscription
    const channel = supabase
      .channel('realtime:emergency_alerts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'emergency_alerts',
        },
        () => {
          // Re-fetch filtered active alerts immediately on any change
          fetchActiveAlerts();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      sirenPlayer.stop();
    };
  }, [fetchActiveAlerts, supabase]);

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (activeAlerts.length > 0) {
        sirenPlayer.play();
      }
    } else {
      setIsMuted(true);
      sirenPlayer.stop();
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    setResolvingId(alertId);
    try {
      const res = await fetch('/api/sos/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });

      if (res.ok) {
        setActiveAlerts((prev) => prev.filter((a) => a.id !== alertId));
        if (activeAlerts.length <= 1) {
          sirenPlayer.stop();
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to resolve emergency alert');
      }
    } catch (err) {
      console.error('Resolve error:', err);
      alert('Network error while resolving emergency alert');
    } finally {
      setResolvingId(null);
    }
  };

  if (activeAlerts.length === 0) {
    return null;
  }

  const primaryAlert = activeAlerts[0];

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] px-3 py-2 sm:p-4 bg-gradient-to-r from-red-650 via-rose-600 to-red-700 text-white shadow-2xl border-b-4 border-red-500 animate-in slide-in-from-top duration-300">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Flashing Beacon & Alert Title */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <div className="relative inline-flex rounded-full h-10 w-10 bg-white text-red-600 items-center justify-center font-black shadow-lg">
              <AlertTriangle className="w-6 h-6 animate-pulse text-red-600" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-white/20 border border-white/30 text-[10px] uppercase font-black px-2 py-0.5 rounded-md tracking-wider">
                🚨 CRITICAL SOS ALERT ({activeAlerts.length})
              </span>
              <span className="text-xs text-red-100 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(primaryAlert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>

            <p className="text-sm sm:text-base font-extrabold tracking-tight truncate mt-0.5">
              <span className="text-yellow-300 underline">{primaryAlert.sender_name}</span>
              <span className="text-xs uppercase bg-red-950/60 px-2 py-0.5 rounded-md ml-2 font-mono font-bold text-red-200">
                {primaryAlert.sender_role}
              </span>
              <span className="text-xs text-red-100 ml-2 font-semibold">
                @ {primaryAlert.plant_name || 'Plant Facility'}
              </span>
            </p>
          </div>
        </div>

        {/* GPS Coordinates & Quick Map View */}
        {primaryAlert.latitude && primaryAlert.longitude && (
          <div className="hidden lg:flex items-center gap-2 bg-black/25 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-mono">
            <MapPin className="w-4 h-4 text-yellow-300 animate-bounce" />
            <span>
              {primaryAlert.latitude.toFixed(5)}, {primaryAlert.longitude.toFixed(5)}
            </span>
            <a
              href={`https://www.google.com/maps?q=${primaryAlert.latitude},${primaryAlert.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white hover:text-yellow-300 ml-1 p-1 bg-white/10 hover:bg-white/20 rounded-md transition"
              title="Open in Google Maps"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* Controls: Mute Siren & Resolve Action */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={toggleMute}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/30 hover:bg-black/50 text-white text-xs font-bold border border-white/20 transition cursor-pointer"
            title={isMuted ? 'Unmute Siren Sound' : 'Mute Siren Sound'}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-red-300" />
                <span>Unmute</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-yellow-300 animate-pulse" />
                <span>Mute Siren</span>
              </>
            )}
          </button>

          {currentUserRole && ['admin', 'manager', 'supervisor'].includes(currentUserRole) && (
            <button
              onClick={() => handleResolveAlert(primaryAlert.id)}
              disabled={resolvingId === primaryAlert.id}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold uppercase tracking-wider shadow-lg border border-emerald-400/40 transition cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {resolvingId === primaryAlert.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>Resolve Incident</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export default EmergencyAlertListener;
