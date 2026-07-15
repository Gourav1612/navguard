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
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1e1b4b] tracking-tight">Student Dashboard</h2>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mt-1">Track your route schedules and timing updates</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Transport Assignment */}
        <div className="space-y-4">
          <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block">Transit Details</h3>
          
          {bus ? (
            <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-11 h-11 bg-purple-50 border border-purple-100 rounded-2xl text-[#5c3b99] shadow-sm">
                    <Bus className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-800 text-sm leading-tight">{bus.name}</h4>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1">assigned bus</span>
                  </div>
                </div>
                {isTripActive ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-150/60 relative animate-pulse">
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 mr-0.5"></span>
                    RUNNING
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-50 text-slate-500 border border-slate-150">
                    ⚫ IDLE
                  </span>
                )}
              </div>

              <div className="space-y-3 bg-[#f6f5fa] border border-[#e8e6f0] p-4 rounded-2xl text-xs text-slate-650">
                <div className="flex items-center justify-between">
                  <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-purple-500" /> Designated Stop
                  </span>
                  <span className="font-bold text-slate-850 bg-white border border-slate-100 px-2.5 py-0.5 rounded-lg shadow-2xs">
                    {stop?.name || 'Unassigned'}
                  </span>
                </div>
                
                {route?.name && (
                  <div className="flex items-center justify-between">
                    <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-purple-500" /> Route Name
                    </span>
                    <span className="font-bold text-slate-850 bg-white border border-slate-100 px-2.5 py-0.5 rounded-lg shadow-2xs truncate max-w-[160px]">
                      {route.name}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Track button */}
              {isTripActive && (
                <div className="pt-2">
                  <Link
                    href={`/dashboard?tab=track&busId=${bus.id}`}
                    className="block w-full text-center py-3 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-500/20 hover:shadow-xl transition-all duration-300 cursor-pointer animate-pulse"
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
                <p className="text-slate-500 text-xs leading-relaxed mt-1">
                  You do not have a bus route linked to your student profile. Contact school admin.
                </p>
              </div>
            </div>
          )}

          {/* SOS Emergency Button Card */}
          <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-4 mt-6">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center justify-center w-11 h-11 bg-red-50 border border-red-100 rounded-2xl text-red-650 shadow-sm">
                <AlertOctagon className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-800 text-sm leading-tight">SOS Panic Button</h4>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1">emergency help</span>
              </div>
            </div>

            {assignment?.sos_active ? (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-red-800 text-xs font-bold leading-relaxed relative overflow-hidden">
                  <span className="absolute inset-0 bg-red-500/5 animate-pulse"></span>
                  <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-650 animate-bounce" />
                  <div className="space-y-1">
                    <p className="font-black">🚨 EMERGENCY ALERT SENDING...</p>
                    <p className="text-[10px] text-red-700 leading-normal font-semibold">Your parents have been notified immediately with your live location tracking coordinates. Keep calm and stay on the bus.</p>
                  </div>
                </div>
                <button
                  onClick={() => handleSosAction('dismiss')}
                  disabled={sosLoading}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold rounded-xl transition cursor-pointer border border-slate-250 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {sosLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Cancel SOS Alert'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[11px] text-slate-550 leading-relaxed font-semibold">
                  Press this button only in case of an absolute emergency (e.g. accident, health issue, or lost route). This will instantly alert your parent's phone dashboard.
                </p>
                <button
                  onClick={() => handleSosAction('trigger')}
                  disabled={sosLoading}
                  className="w-full py-3 bg-red-600 hover:bg-red-750 text-white text-xs font-black tracking-wider uppercase rounded-xl transition cursor-pointer hover:shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {sosLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '🆘 Trigger SOS Emergency'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: School Bulletins */}
        <div className="space-y-4">
          <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block">School Bulletins</h3>
          
          {announcements.length === 0 ? (
            <div className="bg-white border border-slate-150 rounded-3xl p-12 text-center text-slate-455 text-xs font-bold shadow-sm">
              📢 No notices posted recently.
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((item: any) => (
                <div key={item.id} className="bg-white border border-slate-150 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all duration-300 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 bg-amber-50 border border-amber-100 rounded-lg text-amber-600 text-xs">📢</span>
                      {item.title}
                    </h4>
                  </div>
                  <p className="text-slate-600 text-xs leading-relaxed font-semibold">
                    {item.body}
                  </p>
                  <div className="pt-2.5 border-t border-slate-50 flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    <Calendar className="w-3.5 h-3.5 text-slate-350" />
                    <span>Posted {formatDateTime(item.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
