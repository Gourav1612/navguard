'use client';

import { useQuery } from '@tanstack/react-query';
import { 
  Loader2, 
  Bus, 
  ShieldAlert, 
  UserCheck, 
  Users, 
  Radio, 
  Lock, 
  Unlock, 
  ShieldCheck as ShieldCheckIcon, 
  Send, 
  Key, 
  X 
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/Badge';
import { formatDateTime } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

// Import all admin subviews
import BusesView from './subviews/BusesView';
import RoutesView from './subviews/RoutesView';
import DriversView from './subviews/DriversView';
import ParentsView from './subviews/ParentsView';
import StudentsView from './subviews/StudentsView';
import AssignmentsView from './subviews/AssignmentsView';
import ImportView from './subviews/ImportView';
import AuditLogsView from './subviews/AuditLogsView';
import SettingsView from './subviews/SettingsView';

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
  const tab = searchParams.get('tab') || '';
  
  // MFA states
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);

  // Fetch dashboard stats
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard metrics');
      return res.json();
    },
    refetchInterval: 15000,
    enabled: !tab,
  });

  // Verify MFA status on mount
  const checkMfaStatus = async () => {
    try {
      const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
      if (factorsErr) throw factorsErr;

      const activeTotp = factors?.totp?.find((f: any) => f.status === 'verified');
      if (activeTotp) {
        setMfaEnabled(true);
        setMfaFactorId(activeTotp.id);

        // Check if authentication assurance level requires challenge (MFA enabled but not verified in this session)
        const { data: mfaData, error: mfaErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!mfaErr && mfaData) {
          const { currentLevel, nextLevel } = mfaData;
          if (nextLevel === 'aal2' && currentLevel === 'aal1') {
            router.replace('/login/mfa-challenge');
            return;
          }
        }
      } else {
        setMfaEnabled(false);
        setMfaFactorId(null);
        // Force redirect to enrollment page if no verified MFA factor is set up yet
        router.replace('/admin/mfa-setup');
      }
    } catch (err) {
      console.error('Failed to list MFA factors:', err);
    }
  };

  useEffect(() => {
    checkMfaStatus();
  }, [tab]);

  const [endingTripId, setEndingTripId] = useState<string | null>(null);

  const handleEndTrip = async (tripId: string) => {
    if (!confirm('Are you sure you want to force end this active trip? This will set its status to Completed.')) {
      return;
    }
    setEndingTripId(tripId);
    try {
      const res = await fetch('/api/admin/trips/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to end trip');
      }
      refetch();
    } catch (err: any) {
      alert(err.message || 'An error occurred.');
    } finally {
      setEndingTripId(null);
    }
  };

  // Request email OTP
  const handleRequestOtp = async () => {
    setOtpError(null);
    setOtpLoading(true);
    try {
      const res = await fetch('/api/admin/mfa/send-otp', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request code');

      setShowOtpModal(true);
    } catch (err: any) {
      setOtpError(err.message || 'Failed to request verification code.');
    } finally {
      setOtpLoading(false);
    }
  };

  // Verify OTP and Disable MFA
  const handleVerifyAndDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || otpCode.length !== 6) return;

    setOtpError(null);
    setOtpLoading(true);

    try {
      // 1. Verify OTP code with API
      const res = await fetch('/api/admin/mfa/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otpCode }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'OTP verification failed');

      // 2. Perform client-side unenrollment
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({
        factorId: mfaFactorId,
      });
      if (unenrollErr) throw unenrollErr;

      // Refresh session immediately to downgrade local token to aal1
      await supabase.auth.refreshSession();

      setOtpSuccess(true);
      setTimeout(() => {
        setShowOtpModal(false);
        setOtpSuccess(false);
        setOtpCode('');
        checkMfaStatus();
      }, 2000);
    } catch (err: any) {
      setOtpError(err.message || 'OTP verification or unenrollment failed.');
    } finally {
      setOtpLoading(false);
    }
  };

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
    case 'settings':
      return <SettingsView />;
  }

  // Fallback to Main Stats Dashboard
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Loading transport logs...</p>
      </div>
    );
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
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {active_trips.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-400 font-medium">
                      No active trips currently running.
                    </td>
                  </tr>
                ) : (
                  active_trips.map((trip: any) => {
                    const hasLoc = !!trip.latest_location;
                    const isEnding = endingTripId === trip.trip_id;
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
                        <td className="px-6 py-4.5 text-right">
                          <button
                            onClick={() => handleEndTrip(trip.trip_id)}
                            disabled={isEnding}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400 text-red-600 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg text-[10px] font-bold tracking-wider transition cursor-pointer"
                          >
                            {isEnding ? 'Ending...' : '🛑 End Trip'}
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
      </div>

      {/* MFA Security Controls Card */}
      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl text-[#5c3b99]">
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
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-700 border border-green-150">
                  SECURE (TOTP ACTIVE)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-150">
                  MFA INACTIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 max-w-md">
              {mfaEnabled 
                ? "Your administrator account is secured with secondary code authorization. You can disable it below."
                : "Secondary credentials authorization is disabled. Scan dynamic QR codes to secure your panel session."}
            </p>
          </div>

          <div>
            {mfaEnabled ? (
              <button
                onClick={handleRequestOtp}
                disabled={otpLoading}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-150 text-red-700 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {otpLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
                Disable MFA Setup
              </button>
            ) : (
              <Link
                href="/admin/mfa-setup"
                className="px-4 py-2 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm shadow-purple-500/10 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Set Up MFA
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* OTP Verification Modal Prompt */}
      {showOtpModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white border border-slate-150 rounded-3xl p-6 max-w-sm w-full space-y-5 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowOtpModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-650 p-1 rounded-lg transition"
            >
              <X className="w-4.5 h-4.5" />
            </button>

            <div className="text-center space-y-1">
              <div className="w-11 h-11 bg-red-50 border border-red-100 rounded-2xl flex items-center justify-center text-red-650 mx-auto mb-2">
                <Unlock className="w-5 h-5" />
              </div>
              <h4 className="font-extrabold text-slate-800 text-sm">Verify Action Consent</h4>
              <p className="text-[11px] text-slate-400 leading-normal max-w-[240px] mx-auto">
                A 6-digit OTP code has been logged/sent to your registered admin email. Enter it below to un-enroll TOTP.
              </p>
            </div>



            {otpError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[10px] font-bold leading-normal">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
                <span>{otpError}</span>
              </div>
            )}

            {otpSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-250 rounded-xl text-emerald-800 text-center text-xs font-bold flex items-center justify-center gap-1.5 animate-in zoom-in-95 duration-150">
                <ShieldCheckIcon className="w-4.5 h-4.5 text-emerald-600 animate-bounce" />
                <span>MFA Factor Disabled Successfully!</span>
              </div>
            ) : (
              <form onSubmit={handleVerifyAndDisable} className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="block w-full py-3 px-4 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-center text-lg font-bold font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-purple-100"
                  />
                  <Key className="w-4 h-4 text-slate-350 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowOtpModal(false)}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={otpLoading || otpCode.length !== 6}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md shadow-red-500/10 transition cursor-pointer disabled:opacity-50"
                  >
                    {otpLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                    ) : (
                      'Confirm Disable'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
