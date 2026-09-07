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
  ExternalLink,
  Loader2,
  X
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
  const [isMinimized, setIsMinimized] = useState(false);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Fetch currently active alerts (strictly excluding sender themselves)
  const fetchActiveAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/sos/active');
      if (res.ok) {
        const data = await res.json();
        const rawAlerts: EmergencyAlertItem[] = data.alerts || [];
        
        // Client-side safeguard: filter out own alerts
        const incomingAlerts = currentUserId
          ? rawAlerts.filter((a) => a.sender_id !== currentUserId)
          : rawAlerts;

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
  }, [currentUserId]);

  useEffect(() => {
    fetchActiveAlerts();
    const interval = setInterval(fetchActiveAlerts, 8000); // 8-second polling fallback

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
    <div className="fixed top-4 right-4 sm:top-5 sm:right-6 z-[99999] max-w-md w-[calc(100%-2rem)] animate-in slide-in-from-top-4 duration-300 pointer-events-auto">
      <div className="bg-zinc-950/95 backdrop-blur-2xl text-white rounded-3xl border-2 border-red-500 shadow-[0_20px_50px_rgba(220,38,38,0.4)] p-4 sm:p-5 relative overflow-hidden">
        {/* Glowing Red Animated Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 animate-pulse" />

        {/* Top Meta Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-red-400 bg-red-950/80 border border-red-800/80 px-2 py-0.5 rounded-full">
              🚨 Distress Alarm ({activeAlerts.length})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 flex items-center gap-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              {new Date(primaryAlert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              onClick={toggleMute}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-bold border border-zinc-700 transition cursor-pointer"
              title={isMuted ? 'Unmute Chime' : 'Mute Chime'}
            >
              {isMuted ? (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Unmute</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>Mute</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Personnel Distress Details */}
        <div className="bg-zinc-900/80 rounded-2xl p-3 border border-zinc-800/80 mb-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="font-extrabold text-sm sm:text-base text-white tracking-tight truncate">
              {primaryAlert.sender_name}
            </h4>
            <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/30">
              {primaryAlert.sender_role}
            </span>
          </div>
          <p className="text-xs text-zinc-300 font-medium truncate">
            Site: <span className="text-zinc-100 font-bold">{primaryAlert.plant_name || 'Plant Facility'}</span>
          </p>

          {primaryAlert.latitude && primaryAlert.longitude && (
            <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-400">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-red-400" />
                {primaryAlert.latitude.toFixed(4)}, {primaryAlert.longitude.toFixed(4)}
              </span>
              <a
                href={`https://www.google.com/maps?q=${primaryAlert.latitude},${primaryAlert.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-400 hover:text-red-300 flex items-center gap-1 font-sans font-bold text-[10px] uppercase"
              >
                <span>Maps</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Action Controls */}
        {currentUserRole && ['admin', 'manager', 'supervisor'].includes(currentUserRole) && (
          <button
            onClick={() => handleResolveAlert(primaryAlert.id)}
            disabled={resolvingId === primaryAlert.id}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-950/40 border border-emerald-400/40 transition cursor-pointer active:scale-98 disabled:opacity-50"
          >
            {resolvingId === primaryAlert.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>Resolve Distress Incident</span>
          </button>
        )}
      </div>
    </div>
  );
}
export default EmergencyAlertListener;
