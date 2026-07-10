'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Bus, ShieldAlert, UserCheck, Users, Radio } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/Badge';
import { formatDateTime } from '@/lib/utils';

// Import all admin subviews
import BusesView from './subviews/BusesView';
import RoutesView from './subviews/RoutesView';
import DriversView from './subviews/DriversView';
import ParentsView from './subviews/ParentsView';
import StudentsView from './subviews/StudentsView';
import AssignmentsView from './subviews/AssignmentsView';
import ImportView from './subviews/ImportView';
import AuditLogsView from './subviews/AuditLogsView';

// Load map dynamically to prevent build failures due to window/document checks during SSR
const AdminMap = dynamic(() => import('@/components/AdminMap').then((m) => m.AdminMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[450px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mr-3" />
      Loading Map Module...
    </div>
  ),
});

export default function AdminDashboardView({ tab }: { tab?: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard metrics');
      return res.json();
    },
    refetchInterval: 15000, // Poll statistics every 15s to keep active trips updated
    enabled: !tab, // Only poll if we are viewing the main dashboard tab
  });

  // Dynamic Routing based on Search Param tab
  switch (tab) {
    case 'buses':
      return <BusesView />;
    case 'routes':
      return <RoutesView />;
    case 'drivers':
      return <DriversView />;
    case 'parents':
      return <ParentsView />;
    case 'students':
      return <StudentsView />;
    case 'assignments':
      return <AssignmentsView />;
    case 'import':
      return <ImportView />;
    case 'audit-logs':
      return <AuditLogsView />;
  }

  // Fallback to Main Stats Dashboard
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-550 font-medium text-sm">Loading transport logs...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto space-y-4">
        <ShieldAlert className="w-16 h-16 text-red-500" />
        <h3 className="text-lg font-bold text-slate-800">Connection Error</h3>
        <p className="text-slate-550 text-sm">
          We experienced an issue fetching live statistics from the server database. Ensure database migrations are completed.
        </p>
        <button
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition shadow"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { metrics, active_trips } = data;

  const stats = [
    { name: 'Total Fleet Buses', value: metrics.total_buses, icon: Bus, color: 'text-blue-600 bg-blue-50 border-blue-100' },
    { name: 'Active Trips', value: metrics.active_trips, icon: Radio, color: 'text-green-600 bg-green-50 border-green-100', pulse: true },
    { name: 'Total Students', value: metrics.total_students, icon: Users, color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { name: 'Active Drivers', value: metrics.total_drivers, icon: UserCheck, color: 'text-amber-600 bg-amber-50 border-amber-100' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Fleet Command</h2>
          <p className="text-slate-500 text-sm font-medium">
            Monitor real-time school bus routes, telemetry, and driver status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live tracking active</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className="flex items-center p-6 bg-white border border-slate-150 rounded-2xl shadow-sm transition hover:shadow-md"
          >
            <div className={`p-4 rounded-xl border ${stat.color} mr-4 relative`}>
              <stat.icon className="w-6 h-6" />
              {stat.pulse && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.name}</p>
              <h4 className="text-3xl font-extrabold text-slate-900 leading-tight mt-1">{stat.value}</h4>
            </div>
          </div>
        ))}
      </div>

      {/* Map Segment */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Active Fleet Map</h3>
        <AdminMap activeTrips={active_trips} />
      </div>

      {/* Active Trips Table */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Ongoing Trips</h3>
        
        <div className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Fleet Bus</th>
                  <th className="px-6 py-4">Assigned Route</th>
                  <th className="px-6 py-4">On-Duty Driver</th>
                  <th className="px-6 py-4">GPS Status</th>
                  <th className="px-6 py-4">Live Speed</th>
                  <th className="px-6 py-4">Last Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {active_trips.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400 font-medium">
                      No active trips currently running.
                    </td>
                  </tr>
                ) : (
                  active_trips.map((trip: any) => {
                    const hasLoc = !!trip.latest_location;
                    return (
                      <tr key={trip.trip_id} className="hover:bg-slate-50/50 transition duration-150">
                        <td className="px-6 py-4.5 font-bold text-slate-900">{trip.bus.name}</td>
                        <td className="px-6 py-4.5 font-medium text-slate-600">{trip.route.name}</td>
                        <td className="px-6 py-4.5 text-slate-600">{trip.driver.full_name}</td>
                        <td className="px-6 py-4.5">
                          <Badge status={hasLoc ? 'active' : 'pending'} />
                        </td>
                        <td className="px-6 py-4.5 font-mono font-semibold text-slate-800">
                          {hasLoc ? `${trip.latest_location.speed.toFixed(1)} km/h` : '—'}
                        </td>
                        <td className="px-6 py-4.5 text-slate-500 text-xs font-medium">
                          {hasLoc ? formatDateTime(trip.latest_location.recorded_at) : 'Waiting for link...'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
