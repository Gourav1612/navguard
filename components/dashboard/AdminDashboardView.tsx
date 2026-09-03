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
    <div className="w-full h-[450px] bg-slate-200 rounded-2xl animate-pulse flex items-center justify-center text-slate-400 font-bold text-sm">
      Initializing Map Telemetry...
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

  const [disablingMfa, setDisablingMfa] = useState(false);

  const handleDisableMfa = async () => {
    if (!mfaFactorId) return;
    if (!confirm('Are you sure you want to disable Multi-Factor Authentication (MFA) for your account?')) return;
    setDisablingMfa(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
      if (error) throw error;
      setMfaEnabled(false);
      setMfaFactorId(null);
      alert('Multi-Factor Authentication disabled successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to disable MFA');
    } finally {
      setDisablingMfa(false);
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

  const togglePacketStreaming = async (userId?: string, currentIsActive?: boolean) => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !currentIsActive,
        }),
      });
      if (!res.ok) throw new Error('Failed to toggle tracking state');
      refetch();
    } catch (err: any) {
      alert(err.message || 'Failed to toggle packet streaming state');
    }
  };

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
    <div className="space-y-6 pb-12">
      {/* Scope Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Workforce Command Center</h2>
          <p className="text-slate-500 text-xs font-medium mt-0.5">Real-time GPS telemetry, active personnel monitoring, and geofence telemetry</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl">
            <Building className="w-4 h-4 text-slate-400" />
            <select
              value={selectedPlantId}
              onChange={(e) => setSelectedPlantId(e.target.value)}
              className="bg-transparent text-xs font-extrabold text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="all">All Plant Sites Scope</option>
              {plants.map((plant: any) => (
                <option key={plant.id} value={plant.id}>{plant.name} ({plant.code})</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => refetch()}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
            title="Refresh Real-time Telemetry"
          >
            <Radio className={`w-4 h-4 ${isLoading ? 'animate-spin text-zinc-900' : 'text-slate-600'}`} />
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 text-white flex items-center justify-center font-black shadow-md">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Total Plant Sites</span>
            <span className="text-2xl font-black text-slate-900 tracking-tight">{data?.metrics?.total_plants ?? 0}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center font-black shadow-md">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Live Active Shifts</span>
            <span className="text-2xl font-black text-slate-900 tracking-tight">{data?.metrics?.active_shifts ?? 0}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Supervisors</span>
            <span className="text-2xl font-black text-slate-900 tracking-tight">{data?.metrics?.total_supervisors ?? 0}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black shadow-md">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Total Workers</span>
            <span className="text-2xl font-black text-slate-900 tracking-tight">{data?.metrics?.total_workers ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Live Map Interface */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-lg font-bold text-slate-800 tracking-tight">Geofence & Personnel Live Radar</h3>
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            Live Sync ({filteredLocations.length} Active Nodes)
          </span>
        </div>
        <AdminMap plants={plants} locations={filteredLocations} />
      </div>

      {/* Personnel Telemetry Table */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800 tracking-tight">Active Personnel Telemetry</h3>
        
        {/* Desktop View Table */}
        <div className="hidden md:block bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-6 py-4">Full Name</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Tracking Status</th>
                  <th className="px-6 py-4">Speed</th>
                  <th className="px-6 py-4">Battery</th>
                  <th className="px-6 py-4">Accuracy</th>
                  <th className="px-6 py-4">Last Update</th>
                  <th className="px-6 py-4 text-right">Telemetry Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {filteredLocations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-slate-400 font-medium">
                      No active telemetry data streaming for this scope.
                    </td>
                  </tr>
                ) : (
                  filteredLocations.map((loc: any) => {
                    const isStale = loc.is_stale;
                    const roleLabel = loc.user?.role === 'manager' ? 'Plant Manager' : loc.user?.role === 'supervisor' ? 'Supervisor' : 'Worker';
                    const isActiveTelemetry = loc.user?.is_active !== false;

                    return (
                      <tr key={loc.id} className="hover:bg-slate-50/50 transition duration-150">
                        <td className="px-6 py-4.5">
                          <div className="font-bold text-slate-900">{loc.user?.full_name}</div>
                          {loc.user?.supervisor_name && (
                            <span className="text-[10px] text-slate-450 font-semibold block mt-0.5">
                              Supervisor: {loc.user.supervisor_name}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4.5">
                          <span className={`px-2 py-0.5 inline-block text-[9px] font-bold rounded-lg uppercase ${
                            loc.user?.role === 'manager' 
                              ? 'bg-purple-100 text-purple-700' 
                              : loc.user?.role === 'supervisor' 
                                ? 'bg-amber-100 text-amber-700' 
                                : 'bg-blue-100 text-blue-700'
                          }`}>
                            {roleLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4.5">
                          <Badge status={isStale ? 'offline' : (loc.is_tracking ? 'active' : 'pending')} />
                        </td>
                        <td className="px-6 py-4.5 font-mono font-semibold text-slate-800">
                          {loc.speed.toFixed(1)} km/h
                        </td>
                        <td className="px-6 py-4.5 font-semibold text-slate-700">
                          {loc.battery_level !== null ? `${loc.battery_level}%` : '—'}
                        </td>
                        <td className="px-6 py-4.5 text-slate-500 font-medium">
                          {loc.accuracy.toFixed(1)} m
                        </td>
                        <td className="px-6 py-4.5 text-slate-500 text-xs font-semibold flex items-center gap-1.5 mt-2 border-0">
                          <Clock className="w-3.5 h-3.5 text-slate-450" />
                          {isStale ? (
                            <span className="text-red-500 font-bold">Offline ({formatDateTime(loc.recorded_at)})</span>
                          ) : (
                            formatDateTime(loc.recorded_at)
                          )}
                        </td>
                        <td className="px-6 py-4.5 text-right">
                          <button
                            onClick={() => togglePacketStreaming(loc.user?.id, isActiveTelemetry)}
                            className={`px-3 py-1.5 text-[10px] font-black rounded-xl transition-all border cursor-pointer shadow-xs ${
                              isActiveTelemetry
                                ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                                : 'bg-red-500 text-white border-red-600 hover:bg-red-600'
                            }`}
                            title={isActiveTelemetry ? 'Click to Pause Packet Streaming' : 'Click to Enable Packet Streaming'}
                          >
                            {isActiveTelemetry ? '((o)) STREAMING' : '⏸ PAUSED'}
                          </button>
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
            <div className="bg-white border border-slate-150 rounded-2xl p-8 text-center text-slate-400 text-xs font-semibold">
              No active telemetry data streaming for this scope.
            </div>
          ) : (
            filteredLocations.map((loc: any) => {
              const isStale = loc.is_stale;
              const roleLabel = loc.user?.role === 'manager' ? 'Plant Manager' : loc.user?.role === 'supervisor' ? 'Supervisor' : 'Worker';

              return (
                <div key={loc.id} className="bg-white border border-slate-155 rounded-2xl p-5 shadow-sm space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{loc.user?.full_name}</h4>
                      <span className={`px-2 py-0.5 mt-1.5 inline-block text-[9px] font-bold rounded-lg uppercase ${
                        loc.user?.role === 'manager' 
                          ? 'bg-purple-100 text-purple-700' 
                          : loc.user?.role === 'supervisor' 
                            ? 'bg-amber-100 text-amber-700' 
                            : 'bg-blue-100 text-blue-700'
                      }`}>
                        {roleLabel}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-extrabold uppercase ${
                      isStale 
                        ? 'bg-red-50 text-red-800 border border-red-100' 
                        : (loc.is_tracking 
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' 
                            : 'bg-slate-50 text-slate-500 border border-slate-150')
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isStale ? 'bg-red-500' : (loc.is_tracking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')
                      }`}></span>
                      {isStale ? 'Offline' : (loc.is_tracking ? 'Active' : 'Pending')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3.5 border-t border-slate-100 text-xs font-semibold">
                    <div>
                      <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Speed</span>
                      <span className="text-slate-700 block mt-0.5 font-mono">{loc.speed.toFixed(1)} km/h</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Battery</span>
                      <span className="text-slate-700 block mt-0.5">{loc.battery_level !== null ? `${loc.battery_level}%` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">GPS Accuracy</span>
                      <span className="text-slate-750 block mt-0.5">{loc.accuracy.toFixed(1)} meters</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Last Telemetry</span>
                      <span className="text-slate-500 block mt-0.5 text-[11px] font-semibold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {isStale ? <span className="text-red-500">Offline</span> : 'Just now'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Telemetry Stream:</span>
                    <button
                      onClick={() => togglePacketStreaming(loc.user?.id, loc.user?.is_active !== false)}
                      className={`px-3 py-1.5 text-[10px] font-black rounded-xl transition-all border cursor-pointer shadow-xs ${
                        loc.user?.is_active !== false
                          ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                          : 'bg-red-500 text-white border-red-600 hover:bg-red-600'
                      }`}
                    >
                      {loc.user?.is_active !== false ? '((o)) STREAMING' : '⏸ PAUSED'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MFA Security Controls Card */}
      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-800">
            <ShieldCheckIcon className="w-5.5 h-5.5" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm leading-tight">MFA Security Control</h3>
            <span className="text-[10px] text-slate-400 font-bold block mt-1">Configure multi-factor credentials verification settings</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Authentication Status:</span>
              {mfaEnabled ? (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-700 border border-green-155">
                  SECURE (TOTP ACTIVE)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-155">
                  MFA INACTIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 max-w-md">
              {mfaEnabled 
                ? "Your administrator account is secured with secondary code authorization."
                : "Secondary credentials authorization is disabled. Scan dynamic QR codes to secure your panel session."}
            </p>
          </div>

          <div>
            {mfaEnabled ? (
              <button
                type="button"
                onClick={handleDisableMfa}
                disabled={disablingMfa}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer border border-red-600 disabled:opacity-50"
              >
                {disablingMfa ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                Disable MFA
              </button>
            ) : (
              <Link
                href="/admin/mfa-setup"
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
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
