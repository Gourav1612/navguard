'use client';

import React, { useState, useRef, useEffect } from 'react';
import { AlertOctagon, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SosTriggerButtonProps {
  userRole?: string;
  className?: string;
  onTriggerSuccess?: () => void;
}

export function SosTriggerButton({ userRole, className, onTriggerSuccess }: SosTriggerButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);
  const holdTimerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const HOLD_DURATION_MS = 2000; // 2 seconds hold to trigger

  const startHold = (e: React.TouchEvent | React.MouseEvent) => {
    if (isSubmitting || justTriggered) return;
    setIsHolding(true);
    startTimeRef.current = Date.now();
    setHoldProgress(0);

    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
      setHoldProgress(progress);

      if (elapsed >= HOLD_DURATION_MS) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        triggerSosAlert();
      }
    }, 40);
  };

  const cancelHold = () => {
    if (isSubmitting) return;
    setIsHolding(false);
    setHoldProgress(0);
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const triggerSosAlert = async () => {
    setIsSubmitting(true);
    setIsHolding(false);

    try {
      // 1. Fetch current GPS coordinates
      let lat: number | null = null;
      let lng: number | null = null;
      let accuracy: number | null = null;

      if (typeof window !== 'undefined' && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 4000,
              maximumAge: 10000,
            });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          accuracy = position.coords.accuracy;
        } catch (geoErr) {
          console.warn('Geolocation capture for SOS timed out or was denied:', geoErr);
        }
      }

      // 2. Submit SOS to API
      const res = await fetch('/api/sos/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          accuracy: accuracy || 0,
          message: `Emergency SOS triggered by ${userRole || 'staff'}`,
        }),
      });

      if (res.ok) {
        setJustTriggered(true);
        if (onTriggerSuccess) onTriggerSuccess();
        setTimeout(() => setJustTriggered(false), 5000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to dispatch SOS alert. Please retry.');
      }
    } catch (err) {
      console.error('SOS dispatch error:', err);
      alert('Network error while dispatching SOS. Please check connection.');
    } finally {
      setIsSubmitting(false);
      setHoldProgress(0);
    }
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, []);

  return (
    <div className={cn('relative inline-flex flex-col items-center select-none', className)}>
      <button
        onMouseDown={startHold}
        onMouseUp={cancelHold}
        onMouseLeave={cancelHold}
        onTouchStart={startHold}
        onTouchEnd={cancelHold}
        disabled={isSubmitting}
        aria-label="Hold to Trigger Emergency SOS"
        className={cn(
          'relative flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer shadow-lg overflow-hidden active:scale-95',
          justTriggered
            ? 'bg-emerald-600 text-white border border-emerald-400 shadow-emerald-900/30 animate-pulse'
            : isHolding
            ? 'bg-red-700 text-white border border-red-500 scale-105 shadow-red-900/50 ring-4 ring-red-500/40'
            : 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white border border-red-400/40 shadow-red-900/40'
        )}
      >
        {/* Fill progress background overlay while holding */}
        {isHolding && (
          <div
            className="absolute inset-0 bg-red-900/70 origin-left transition-all ease-linear pointer-events-none"
            style={{ width: `${holdProgress}%` }}
          />
        )}

        <div className="relative z-10 flex items-center gap-2">
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : justTriggered ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-200 animate-bounce" />
          ) : (
            <AlertOctagon className={cn('w-4 h-4', isHolding ? 'animate-ping' : 'animate-pulse')} />
          )}

          <span className="font-extrabold tracking-widest text-xs">
            {isSubmitting
              ? 'Broadcasting...'
              : justTriggered
              ? 'SOS Dispatched'
              : isHolding
              ? `Hold (${Math.ceil((HOLD_DURATION_MS * (100 - holdProgress)) / 100000)}s)`
              : 'Emergency SOS'}
          </span>
        </div>
      </button>
    </div>
  );
}
export default SosTriggerButton;
