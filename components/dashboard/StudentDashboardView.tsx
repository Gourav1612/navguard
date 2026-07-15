'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, Bus, MapPin, Calendar, Compass, AlertCircle, PhoneCall, AlertOctagon } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

// Import the tracking view (students can track using the parent map component!)
import ParentTrackView from './subviews/ParentTrackView';

export default function StudentDashboardView({ tab }: { tab?: string }) {
  const [sosLoading, setSosLoading] = useState(false);

  // 1. Fetch student assignment details
  const { data: assignment, isLoading: assignmentLoading, error: assignmentError, refetch } = useQuery({
    queryKey: ['student-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/student/assignment');
      if (!res.ok) throw new Error('Failed to load assignment details');
      return res.json();
    },
    refetchInterval: 15000, // Refetch every 15s to capture live trip changes
  });

  const handleSosAction = async (action: 'trigger' | 'dismiss') => {
    if (action === 'trigger' && !confirm('WARNING: Are you sure you want to trigger the emergency SOS alert? This will immediately notify your parents!')) {
      return;
    }
    
    setSosLoading(true);
    try {
      const res = await fetch('/api/student/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update SOS status');
      }
      refetch();
    } catch (err: any) {
      alert(err.message || 'An error occurred.');
    } finally {
      setSosLoading(false);
    }
  };

  // 2. Fetch student announcements
  const { data: announcements = [], isLoading: announcementsLoading } = useQuery({
    queryKey: ['student-announcements'],
    queryFn: async () => {
      const res = await fetch('/api/student/announcements');
      if (!res.ok) throw new Error('Failed to fetch student announcements');
      return res.json();
    },
    enabled: !tab, // Only load bulletins if viewing main dashboard tab
  });

  // Handle dynamic student tab routing
  if (tab === 'track' && assignment?.bus?.id) {
    return <ParentTrackView busId={assignment.bus.id} />;
  }

  const loading = assignmentLoading || announcementsLoading;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Opening student portal...</p>
      </div>
    );
  }

  if (assignmentError || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-3">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <h3 className="font-bold text-slate-800 text-sm">Sync Error</h3>
        <p className="text-slate-555 text-xs font-semibold">Verify your student directory connection details.</p>
      </div>
    );
  }

  const { bus, stop, route } = assignment;
  const isTripActive = !!bus?.active_trip_id;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Title Header with Gradient Accents */}
      <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-ping"></span>
            <span className="text-[10px] font-black text-primary uppercase tracking-widest bg-purple-50 px-2 py-0.5 rounded border border-purple-100/50">Student Portal</span>
          </div>
          <h2 className="text-2xl font-black text-[#1e1b4b] tracking-tight mt-2.5">Student Dashboard</h2>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mt-1">Track your route schedules and timing updates</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100/60 flex-shrink-0 self-start sm:self-auto">
          <span className="relative flex h-2 w-2 mr-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          System Synced
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Transit Details */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block pl-1">Transit Details</h3>
            
            {bus ? (
              <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3.5">
                    <div className="flex items-center justify-center w-12 h-12 bg-purple-50 border border-purple-100 rounded-2xl text-[#5c3b99] shadow-sm">
                      <Bus className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-slate-800 text-base leading-none">{bus.name}</h4>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-2">assigned transport unit</span>
                    </div>
                  </div>
                  {isTripActive ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-green-50 text-green-700 border border-green-150/60 relative animate-pulse shadow-sm shadow-green-500/5">
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 mr-0.5"></span>
                      RUNNING
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest bg-slate-50 text-slate-550 border border-slate-150">
                      ⚫ IDLE
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-4 bg-[#f8f7fc] border border-[#e8e6f0] rounded-2xl text-xs font-medium">
                    <div className="space-y-1">
                      <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-widest block">Designated Stop</span>
                      <span className="font-bold text-slate-800 text-sm block">{stop?.name || 'Unassigned'}</span>
                    </div>
                    <MapPin className="w-5 h-5 text-purple-500 opacity-60 flex-shrink-0" />
                  </div>
                  
                  {route?.name && (
                    <div className="flex items-center justify-between p-4 bg-[#f8f7fc] border border-[#e8e6f0] rounded-2xl text-xs font-medium">
                      <div className="space-y-1">
                        <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-widest block">Assigned Route</span>
                        <span className="font-bold text-slate-800 text-sm block truncate max-w-[140px]">{route.name}</span>
                      </div>
                      <Compass className="w-5 h-5 text-purple-500 opacity-60 flex-shrink-0" />
                    </div>
                  )}
                </div>

                {/* Action Track button */}
                {isTripActive && (
                  <div className="pt-2">
                    <Link
                      href={`/dashboard?tab=track&busId=${bus.id}`}
                      className="block w-full text-center py-3.5 bg-gradient-to-r from-[#5c3b99] to-[#432775] hover:from-[#4f3085] hover:to-[#381e64] text-white text-xs font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-purple-500/20 hover:shadow-xl hover:scale-[1.005] transition-all duration-300 cursor-pointer"
                    >
                      Track Bus Location Live
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-150 rounded-3xl p-8 text-center space-y-4 shadow-sm">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
                <div>
                  <h4 className="font-extrabold text-slate-850 text-sm">Bus Assignment Missing</h4>
                  <p className="text-slate-550 text-xs leading-relaxed mt-1">
                    You do not have a bus route linked to your student profile. Contact school admin.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* SOS Emergency Panic Card */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block pl-1">Emergency Panic Center</h3>
            
            <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-6 relative overflow-hidden">
              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
                <div className="flex items-center justify-center w-12 h-12 bg-red-50 border border-red-100 rounded-2xl text-red-650 shadow-sm">
                  <AlertOctagon className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-850 text-base leading-none">SOS Panic Controller</h4>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-2">instant parent notification</span>
                </div>
              </div>

              {assignment?.sos_active ? (
                <div className="space-y-5 animate-in fade-in zoom-in-95 duration-300">
                  <div className="p-5 bg-red-600 border border-red-700 text-white rounded-2xl flex items-start gap-4 shadow-lg shadow-red-500/10 relative overflow-hidden">
                    <span className="absolute inset-0 bg-white/5 animate-pulse"></span>
                    <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-xl flex-shrink-0 animate-bounce">
                      <AlertOctagon className="w-5.5 h-5.5 text-white" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-black text-sm tracking-wide">🚨 EMERGENCY SOS ALARM ACTIVE!</p>
                      <p className="text-[11px] text-red-100 leading-relaxed font-semibold">Your parents have been immediately notified with critical alert notifications. Keep calm, stay on the bus, and wait for assistance.</p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleSosAction('dismiss')}
                    disabled={sosLoading}
                    className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-755 text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer border border-slate-250 disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow"
                  >
                    {sosLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : 'Cancel Emergency SOS Alarm'}
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex gap-3 text-slate-550 text-xs leading-relaxed font-semibold">
                    <span className="text-base flex-shrink-0">⚠️</span>
                    <p>Press the button below <b>ONLY in case of absolute emergencies</b> (e.g. accident, physical injury, danger, or vehicle breakdowns). This will trigger a critical emergency panic notification directly to your parent's phone.</p>
                  </div>
                  
                  <button
                    onClick={() => handleSosAction('trigger')}
                    disabled={sosLoading}
                    className="w-full py-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white text-xs font-black tracking-widest uppercase rounded-2xl transition hover:shadow-xl shadow-red-500/20 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {sosLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <PhoneCall className="w-4 h-4 text-white animate-bounce" />
                        Trigger SOS Panic Alarm
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}
