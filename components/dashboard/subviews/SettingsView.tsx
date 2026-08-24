'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, Settings, ShieldCheck, Lock, Eye, EyeOff, Send, Mail, KeyRound, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SettingsSkeleton } from '@/components/ui/Skeleton';

export default function SettingsView() {
  const supabase = createBrowserSupabaseClient();
  const [loading, setLoading] = useState(false);
  const [otpStep, setOtpStep] = useState<'initial' | 'otp_sent' | 'success'>('initial');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  
  const [adminEmail, setAdminEmail] = useState('');
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

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-[#5c3b99]" /> Security & Account
          </h2>
          <p className="text-slate-500 text-sm font-medium">
            Manage your Super Admin credentials, password verification, and authentication settings.
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
            className="text-xs font-bold text-[#5c3b99] hover:underline cursor-pointer"
          >
            Reset Form
          </button>
        )}
      </div>

      {pwdError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold animate-in fade-in duration-200">
          <AlertTriangle className="w-4 h-4 text-red-650 flex-shrink-0 mt-0.5" />
          <span>{pwdError}</span>
        </div>
      )}

      {pwdSuccess && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-250 rounded-xl text-emerald-800 text-xs font-semibold animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <span>{pwdSuccess}</span>
        </div>
      )}

      <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
        <h3 className="text-base font-extrabold text-slate-800 border-b pb-3 border-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#5c3b99]" /> Password Reset Credentials
        </h3>

        {otpStep === 'initial' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-br from-slate-50 to-purple-50/40 border border-purple-100 rounded-2xl">
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-purple-950 uppercase tracking-wider flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-[#5c3b99]" /> Verification Code (OTP) Required
              </h4>
              <p className="text-slate-500 text-xs font-medium max-w-md leading-relaxed">
                Click to request a secure 6-digit verification code sent to your registered admin email address.
              </p>
            </div>
            <button
              type="button"
              disabled={otpSending}
              onClick={handleRequestPasswordOtp}
              className="px-5 py-3.5 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {otpSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Request OTP Code
                </>
              )}
            </button>
          </div>
        )}

        {(otpStep === 'otp_sent' || otpStep === 'success') && (
          <form onSubmit={handleVerifyOtpAndChangePassword} className="space-y-4">
            <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#5c3b99] flex-shrink-0" />
              <span>Verification code transmitted to: <strong>{adminEmail}</strong></span>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">6-Digit OTP Code</label>
              <input
                type="text"
                maxLength={6}
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 123456"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-lg font-black tracking-widest font-mono focus:outline-none transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650 cursor-pointer border-0 bg-transparent p-0"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none transition"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={resendCooldown > 0 || otpSending}
                onClick={handleRequestPasswordOtp}
                className="text-xs font-bold text-[#5c3b99] hover:underline disabled:text-slate-400 transition cursor-pointer bg-transparent border-0 p-0"
              >
                {resendCooldown > 0 ? `Resend OTP code in ${resendCooldown}s` : 'Resend Code'}
              </button>

              <button
                type="submit"
                disabled={otpVerifying || otpCode.length !== 6 || newPassword.length < 6 || newPassword !== confirmPassword}
                className="px-5 py-3.5 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {otpVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Verify & Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
