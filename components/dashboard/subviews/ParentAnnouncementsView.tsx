'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Bell, Calendar, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

export default function ParentAnnouncements() {
  // Fetch parent announcements
  const { data: announcements = [], isLoading, error } = useQuery({
    queryKey: ['parent-announcements'],
    queryFn: async () => {
      const res = await fetch('/api/parent/announcements');
      if (!res.ok) throw new Error('Failed to load announcements');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Opening bulletin...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4 space-y-3">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
        <h3 className="font-bold text-slate-800 text-sm">Sync Error</h3>
        <p className="text-slate-500 text-xs">Verify your internet link connection.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-sm mx-auto pt-2 animate-in fade-in duration-200">
      {/* Title */}
      <div>
        <h2 className="text-xl font-black text-slate-900 tracking-tight">Announcements</h2>
        <p className="text-slate-500 text-xs font-semibold">Keep up-to-date with transport updates, routes notices, and schedules changes.</p>
      </div>

      {/* Bulletins List */}
      <div className="space-y-4">
        {announcements.length === 0 ? (
          <div className="bg-white border border-slate-150 rounded-2xl p-10 text-center space-y-2.5">
            <Bell className="w-8 h-8 text-slate-350 mx-auto" />
            <h4 className="font-bold text-slate-800 text-sm">No Announcements</h4>
            <p className="text-slate-500 text-xs leading-relaxed">
              School administration hasn't posted any recent transport announcements.
            </p>
          </div>
        ) : (
          announcements.map((bulletin: any) => (
            <div
              key={bulletin.id}
              className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-3.5 hover:shadow-md transition duration-200"
            >
              <div className="space-y-1">
                <h3 className="font-extrabold text-slate-900 text-sm flex items-start gap-2">
                  <span className="p-1 rounded bg-amber-50 text-amber-600 border border-amber-100 flex-shrink-0">
                    📢
                  </span>
                  {bulletin.title}
                </h3>
                <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5 pt-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDateTime(bulletin.created_at)}
                </div>
              </div>

              <p className="text-slate-600 text-xs leading-relaxed font-medium whitespace-pre-line">
                {bulletin.body}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
