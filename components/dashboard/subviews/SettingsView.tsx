'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, Settings, MapPin, Globe, Save, Info, CheckCircle2, AlertTriangle, Link2, KeyRound, ShieldCheck, Lock, Eye, EyeOff, Send, Mail } from 'lucide-react';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[280px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin mr-2" />
      Loading Map view...
    </div>
  ),
});

export default function SettingsView() {
  const supabase = createBrowserSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [schoolAddress, setSchoolAddress] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  // Link parsing states
  const [inputMode, setInputMode] = useState<'link' | 'manual'>('link');
  const [mapsLink, setMapsLink] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Admin Password Change (Email OTP) states
  const [adminEmail, setAdminEmail] = useState('');
  const [otpStep, setOtpStep] = useState<'initial' | 'otp_sent' | 'success'>('initial');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Cooldown timer for OTP resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Request OTP for password change
  const handleRequestPasswordOtp = async () => {
    setPwdError(null);
    setPwdSuccess(null);
    setOtpSending(true);

    try {
      const res = await fetch('/api/admin/change-password/request-otp', {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP code');
      }

      setAdminEmail(data.email || 'your registered email');
      setOtpStep('otp_sent');
      setPwdSuccess(`Verification code sent to ${data.email || 'your email'}`);
      setResendCooldown(60);
    } catch (err: any) {
      setPwdError(err.message || 'Failed to request OTP code.');
    } finally {
      setOtpSending(false);
    }
  };

  // Verify OTP and Update Password
  const handleVerifyOtpAndChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (otpCode.trim().length !== 6) {
      setPwdError('Verification code must be exactly 6 digits.');
      return;
    }

    if (newPassword.length < 6) {
      setPwdError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation password do not match.');
      return;
    }

    setOtpVerifying(true);

    try {
      const res = await fetch('/api/admin/change-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: otpCode.trim(),
          newPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify OTP or update password');
      }

      setOtpStep('success');
      setPwdSuccess('Admin password updated successfully! Please use your new password on next login.');
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdError(err.message || 'Failed to verify OTP.');
    } finally {
      setOtpVerifying(false);
    }
  };

  useEffect(() => {
    async function loadSchoolData() {
      try {
        // Fetch current user details
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();

        if (profile?.school_id) {
          setSchoolId(profile.school_id);
          
          // Fetch school details
          const { data: school } = await supabase
            .from('schools')
            .select('*')
            .eq('id', profile.school_id)
            .single();

          if (school) {
            setSchoolName(school.name || '');
            setSchoolAddress(school.address || '');
            if (school.latitude !== undefined && school.latitude !== null) {
              setLatitude(Number(school.latitude));
            } else {
              setLatitude(null);
            }
            if (school.longitude !== undefined && school.longitude !== null) {
              setLongitude(Number(school.longitude));
            } else {
              setLongitude(null);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load settings data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSchoolData();
  }, [supabase]);

  function parseCoordinates(url: string): { latitude: number; longitude: number } | null {
    // 1. Check for @lat,lng format
    const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      return {
        latitude: parseFloat(atMatch[1]),
        longitude: parseFloat(atMatch[2]),
      };
    }

    // 2. Check for query parameter format (e.g. query=lat,lng or q=lat,lng)
    const qMatch = url.match(/[?&](query|q)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) {
      return {
        latitude: parseFloat(qMatch[2]),
        longitude: parseFloat(qMatch[3]),
      };
    }

    return null;
  }

  const handleResolveLink = async () => {
    if (!mapsLink.trim()) return;
    setErrorMsg(null);
    setResolvingLink(true);

    try {
      // 1. Call API to follow redirects and get expanded URL
      const res = await fetch(`/api/resolve-map-link?url=${encodeURIComponent(mapsLink.trim())}`);
      const data = await res.json();
      
      if (!res.ok || !data.expandedUrl) {
        throw new Error(data.error || 'Failed to expand link');
      }

      // 2. Parse coordinates from the expanded URL
      const coords = parseCoordinates(data.expandedUrl);
      if (!coords) {
        throw new Error('Could not extract coordinates from the Google Maps link. Please enter them manually.');
      }

      setLatitude(coords.latitude);
      setLongitude(coords.longitude);
      setSuccessMsg('Coordinates successfully extracted from Google Maps link!');
      
      // Auto clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resolve link.');
    } finally {
      setResolvingLink(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId) return;

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('schools')
        .update({
          name: schoolName,
          address: schoolAddress,
          latitude,
          longitude,
        })
        .eq('id', schoolId);

      if (error) throw error;

      setSuccessMsg('School profile and location settings updated successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Loading settings panels...</p>
      </div>
    );
  }

  const mapStops = latitude !== null && longitude !== null ? [
    {
      id: 'school',
      name: `🏫 ${schoolName || 'School'}`,
      latitude,
      longitude,
      stop_order: 0,
      address: schoolAddress,
    }
  ] : [];

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" /> System Settings
        </h2>
        <p className="text-slate-500 text-sm font-medium">
          Configure school identity, geo-campus coordinates, and client routing defaults.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left column: Form */}
        <form onSubmit={handleSaveSettings} className="lg:col-span-3 space-y-6 bg-white border border-slate-150 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 border-b pb-3 border-slate-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-500" /> School Campus Profile
          </h3>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-250 rounded-xl text-emerald-800 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">School Name</label>
              <input
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Enter official school name"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Campus Address</label>
              <input
                type="text"
                required
                value={schoolAddress}
                onChange={(e) => setSchoolAddress(e.target.value)}
                placeholder="Enter campus address"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
              />
            </div>

            {/* Coordinates Input Tab selection */}
            <div className="border-t border-slate-100 pt-4 mt-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Campus Coordinates</label>
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit mb-4">
                <button
                  type="button"
                  onClick={() => setInputMode('link')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    inputMode === 'link' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Google Maps Link
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    inputMode === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Manual Input
                </button>
              </div>

              {inputMode === 'link' ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="url"
                        value={mapsLink}
                        onChange={(e) => setMapsLink(e.target.value)}
                        placeholder="Paste Google Maps share link (e.g. https://maps.app.goo.gl/...)"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                      />
                      <Link2 className="w-4 h-4 text-slate-400 absolute left-4.5 top-1/2 -translate-y-1/2" />
                    </div>
                    <button
                      type="button"
                      disabled={resolvingLink || !mapsLink.trim()}
                      onClick={handleResolveLink}
                      className="px-4 py-3 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm shadow-purple-500/10 cursor-pointer disabled:opacity-50"
                    >
                      {resolvingLink ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Extract'
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                    Open Google Maps, search for your school, click Share, copy the link, and paste it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={latitude !== null ? latitude : ''}
                      onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                      placeholder="e.g. 27.5609"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={longitude !== null ? longitude : ''}
                      onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                      placeholder="e.g. 76.6111"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Configuration
            </button>
          </div>
        </form>

        {/* Right column: Map preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <MapPin className="w-4.5 h-4.5 text-red-500" /> Geographic Location Preview
            </h3>
            <div className="h-[280px] rounded-xl overflow-hidden border border-slate-150">
              <LiveMap
                busId="dummy"
                stops={mapStops}
                initialLocation={latitude !== null && longitude !== null ? { latitude, longitude } : { latitude: 27.5609, longitude: 76.6111 }}
                showBus={false}
                focusLocation={latitude !== null && longitude !== null ? { latitude, longitude } : null}
              />
            </div>
            <div className="text-[10px] text-slate-400 font-medium leading-relaxed flex items-start gap-1 p-2 bg-slate-50 rounded-xl">
              <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>Current coordinates: {latitude !== null ? latitude.toFixed(6) : 'Not Configured'}, {longitude !== null ? longitude.toFixed(6) : 'Not Configured'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Password Change (Email OTP) Section */}
      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-600" /> Admin Account Security & Password
            </h3>
            <p className="text-slate-500 text-xs font-medium">
              Update your admin password securely using 2-step email verification (OTP).
            </p>
          </div>
          {otpStep !== 'initial' && (
            <button
              type="button"
              onClick={() => {
                setOtpStep('initial');
                setPwdError(null);
                setPwdSuccess(null);
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 transition underline self-start sm:self-auto cursor-pointer"
            >
              Cancel / Reset
            </button>
          )}
        </div>

        {pwdError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold animate-in fade-in duration-200">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <span>{pwdError}</span>
          </div>
        )}

        {pwdSuccess && (
          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-250 rounded-xl text-emerald-800 text-xs font-semibold animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <span>{pwdSuccess}</span>
          </div>
        )}

        {otpStep === 'initial' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-br from-slate-50 to-purple-50/40 border border-purple-100 rounded-2xl">
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-purple-950 uppercase tracking-wider flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-purple-600" /> Email Verification Required
              </h4>
              <p className="text-slate-500 text-xs font-medium max-w-lg">
                Clicking the button will generate a 6-digit OTP code and send it to your registered admin email address.
              </p>
            </div>
            <button
              type="button"
              disabled={otpSending}
              onClick={handleRequestPasswordOtp}
              className="px-5 py-3 bg-[#5c3b99] hover:bg-[#4a2e7c] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm shadow-purple-500/20 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {otpSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending Code...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Password OTP Code
                </>
              )}
            </button>
          </div>
        )}

        {(otpStep === 'otp_sent' || otpStep === 'success') && (
          <form onSubmit={handleVerifyOtpAndChangePassword} className="space-y-4 max-w-lg">
            <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl text-xs text-purple-900 font-medium flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-purple-600 flex-shrink-0" />
              <span>Enter the 6-digit verification code sent to <strong>{adminEmail}</strong></span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">6-Digit Verification Code (OTP)</label>
              <div className="relative">
                <input
                  type="text"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 849201"
                  className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-lg font-black tracking-widest font-mono focus:outline-none transition"
                />
                <KeyRound className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 chars"
                    className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={resendCooldown > 0 || otpSending}
                onClick={handleRequestPasswordOtp}
                className="text-xs font-bold text-purple-700 hover:text-purple-900 disabled:text-slate-400 transition cursor-pointer"
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
              </button>

              <button
                type="submit"
                disabled={otpVerifying || otpCode.length !== 6 || newPassword.length < 6 || newPassword !== confirmPassword}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-2 shadow-md shadow-purple-500/20 cursor-pointer disabled:opacity-50"
              >
                {otpVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Verify & Change Password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
