'use client';

import { useQuery } from '@tanstack/react-query';
import { 
  Loader2, 
  Building, 
  ShieldAlert, 
  UserCheck, 
  Users, 
  Radio, 
  Lock, 
  Unlock, 
  ShieldCheck as ShieldCheckIcon, 
  X,
  MapPin,
  Clock
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/Badge';
import { formatDateTime } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

// Import admin subviews
import PlantsView from './subviews/PlantsView';
import UsersView from './subviews/UsersView';
import AuditLogsView from './subviews/AuditLogsView';
import SettingsView from './subviews/SettingsView';
import { DashboardSkeleton } from '@/components/ui/Skeleton';

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

export default function AdminDashboardView({ tab: initialTab }: { tab?: string }) {
  const supabase = createBrowserSupabaseClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab') || '';
  
  const validTabs = ['plants', 'users', 'audit-logs', 'settings'];
  const tab = validTabs.includes(rawTab) ? rawTab : '';
  const isMainDashboard = !tab;

  // Selected plant filter overlay
  const [selectedPlantId, setSelectedPlantId] = useState<string>('all');

  // Sanitize invalid tab parameter from URL automatically
  useEffect(() => {
    if (rawTab && !validTabs.includes(rawTab)) {
      router.replace('/dashboard');
    }
  }, [rawTab, router]);

  // MFA states
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  // Fetch dashboard stats
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard metrics');
      return res.json();
    },
    refetchInterval: 10000, // reload stats every 10 seconds for real-time responsiveness
    enabled: isMainDashboard,
  });

  // Verify MFA status on mount (for UI state display only; middleware handles route protection)
  const checkMfaStatus = async () => {
    try {
      const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
      if (factorsErr) throw factorsErr;

      const activeTotp = factors?.all?.find((f: any) => f.factor_type === 'totp' && f.status === 'verified');
      if (activeTotp) {
        setMfaEnabled(true);
        setMfaFactorId(activeTotp.id);
      } else {
        setMfaEnabled(false);
        setMfaFactorId(null);
      }
    } catch (err) {
      console.error('Failed to list MFA factors:', err);
    }
  };

  useEffect(() => {
    checkMfaStatus();
  }, [tab]);

  // Real-time location subscriber to refresh state on inserts/updates
  useEffect(() => {
    if (!isMainDashboard) return;

    const channel = supabase
      .channel('admin-dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_locations' },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isMainDashboard, supabase, refetch]);

  // Dynamic Routing based on Search Param tab
  switch (tab) {
    case 'plants':
      return <PlantsView />;
    case 'users':
      return <UsersView />;
    case 'audit-logs':
      return <AuditLogsView />;
    case 'settings':
      return <SettingsView />;
  }

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto space-y-4">
        <ShieldAlert className="w-16 h-16 text-red-500" />
        <h3 className="text-lg font-bold text-slate-800">Connection Error</h3>
        <p className="text-slate-500 text-sm">
          We experienced an issue fetching live statistics from the server database. Ensure database migrations are completed.
        </p>
        <button
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-[#5c3b99] text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition shadow"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { metrics, plants = [], locations = [] } = data;

  // Filter coordinates based on plant filter
  const filteredLocations = selectedPlantId === 'all'
    ? locations
    : locations.filter((loc: any) => loc.user?.plant_id === selectedPlantId);

  const stats = [
    { name: 'Active Plants', value: metrics.total_plants, icon: Building, color: 'text-blue-600 bg-blue-50 border-blue-100' },
    { name: 'Active Shifts', value: metrics.active_shifts, icon: Radio, color: 'text-green-600 bg-green-50 border-green-100', pulse: true },
    { name: 'Total Supervisors', value: metrics.total_supervisors, icon: Users, color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
    { name: 'Total Workers', value: metrics.total_workers, icon: UserCheck, color: 'text-amber-600 bg-amber-50 border-amber-100' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Workforce Command Center</h2>
          <p className="text-slate-500 text-sm font-medium">
            Monitor real-time personnel tracking, geofence safety, and plant operations.
          </p>
        </div>

        {/* Global Plant Filter */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Plant Scope:</span>
          <select
            value={selectedPlantId}
            onChange={(e) => setSelectedPlantId(e.target.value)}
            className="text-xs font-bold text-slate-700 bg-transparent border-0 focus:outline-none cursor-pointer"
          >
            <option value="all">All Plants</option>
            {plants.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
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
      <div className="space-y-3 relative">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800 tracking-tight">Active Plant Mapping</h3>
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-450 uppercase">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            Real-time feed active
          </span>
        </div>
        <AdminMap plants={plants} locations={filteredLocations} selectedPlantId={selectedPlantId} />
      </div>

      {/* Personnel Telemetry Table */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-zinc-100 tracking-tight">Active Personnel Telemetry</h3>
        
        {/* Desktop View Table */}
        <div className="hidden md:block bg-zinc-950/60 border border-zinc-800/80 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900/50 border-b border-zinc-800 text-xs font-mono text-zinc-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Full Name</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Tracking Status</th>
                  <th className="px-6 py-4">Speed</th>
                  <th className="px-6 py-4">Battery</th>
                  <th className="px-6 py-4">Accuracy</th>
                  <th className="px-6 py-4">Last Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50 text-sm text-zinc-300">
                {filteredLocations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-zinc-500 font-medium">
                      No active telemetry data streaming for this scope.
                    </td>
                  </tr>
                ) : (
                  filteredLocations.map((loc: any) => {
                    const isStale = loc.is_stale;
                    const roleLabel = loc.user?.role === 'manager' ? 'Plant Manager' : loc.user?.role === 'supervisor' ? 'Supervisor' : 'Worker';
                    
                    return (
                      <tr key={loc.id} className="hover:bg-zinc-900/30 transition-colors border-b border-zinc-800/50">
                        <td className="px-6 py-4.5">
                          <div className="font-bold text-zinc-100">{loc.user?.full_name}</div>
                          {loc.user?.supervisor_name && (
                            <span className="text-[10px] text-zinc-400 font-semibold block mt-0.5">
                              Supervisor: {loc.user.supervisor_name}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4.5">
                          <span className="px-2.5 py-1 inline-block text-[9px] font-mono font-bold rounded-lg uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                            {roleLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4.5">
                          <Badge status={isStale ? 'offline' : (loc.is_tracking ? 'active' : 'pending')} />
                        </td>
                        <td className="px-6 py-4.5 font-mono font-semibold text-zinc-200">
                          {loc.speed.toFixed(1)} km/h
                        </td>
                        <td className="px-6 py-4.5 font-semibold text-zinc-300">
                          {loc.battery_level !== null ? `${loc.battery_level}%` : '—'}
                        </td>
                        <td className="px-6 py-4.5 text-zinc-400 font-medium">
                          {loc.accuracy.toFixed(1)} m
                        </td>
                        <td className="px-6 py-4.5 text-zinc-400 text-xs font-semibold flex items-center gap-1.5 mt-2 border-0">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          {isStale ? (
                            <span className="text-red-400 font-bold">Offline ({formatDateTime(loc.recorded_at)})</span>
                          ) : (
                            formatDateTime(loc.recorded_at)
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile responsive Cards */}
        <div className="block md:hidden space-y-4">
          {filteredLocations.length === 0 ? (
            <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-8 text-center text-zinc-500 text-xs font-semibold">
              No active telemetry data streaming for this scope.
            </div>
          ) : (
            filteredLocations.map((loc: any) => {
              const isStale = loc.is_stale;
              const roleLabel = loc.user?.role === 'manager' ? 'Plant Manager' : loc.user?.role === 'supervisor' ? 'Supervisor' : 'Worker';

              return (
                <div key={loc.id} className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-bold text-zinc-100 text-sm">{loc.user?.full_name}</h4>
                      <span className="px-2.5 py-1 mt-1.5 inline-block text-[9px] font-mono font-bold rounded-lg uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {roleLabel}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-extrabold uppercase ${
                      isStale 
                        ? 'bg-red-950/30 text-red-400 border border-red-900/40' 
                        : (loc.is_tracking 
                            ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/40' 
                            : 'bg-zinc-800 text-zinc-400 border border-zinc-700')
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isStale ? 'bg-red-500' : (loc.is_tracking ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500')
                      }`}></span>
                      {isStale ? 'Offline' : (loc.is_tracking ? 'Active' : 'Pending')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3.5 border-t border-zinc-800/80 text-xs font-semibold">
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-wider">Speed</span>
                      <span className="text-zinc-200 block mt-0.5 font-mono">{loc.speed.toFixed(1)} km/h</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-wider">Battery</span>
                      <span className="text-zinc-200 block mt-0.5">{loc.battery_level !== null ? `${loc.battery_level}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-wider">GPS Accuracy</span>
                      <span className="text-zinc-200 block mt-0.5">{loc.accuracy.toFixed(1)} meters</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-400 font-bold block uppercase tracking-wider">Last Telemetry</span>
                      <span className="text-zinc-400 block mt-0.5 text-[11px] font-semibold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                        {isStale ? <span className="text-red-400">Offline</span> : 'Just now'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MFA Security Controls Card */}
      <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-300">
            <ShieldCheckIcon className="w-5.5 h-5.5" />
          </div>
          <div>
            <h3 className="font-extrabold text-zinc-100 text-sm leading-tight">MFA Security Control</h3>
            <span className="text-[10px] text-zinc-400 font-bold block mt-1">Configure multi-factor credentials verification settings</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-300">Authentication Status:</span>
              {mfaEnabled ? (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950/30 text-emerald-400 border border-emerald-900/40">
                  SECURE (TOTP ACTIVE)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-950/30 text-amber-400 border border-amber-900/40">
                  MFA INACTIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 max-w-md">
              {mfaEnabled 
                ? "Your administrator account is secured with secondary code authorization."
                : "Secondary credentials authorization is disabled. Scan dynamic QR codes to secure your panel session."}
            </p>
          </div>

          <div>
            {!mfaEnabled && (
              <Link
                href="/admin/mfa-setup"
                className="px-4 py-2 bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Set Up MFA
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
