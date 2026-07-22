'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, Lock, AlertCircle, ArrowLeft, Key, Mail, ShieldAlert, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function MfaChallengeClient() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  // Email OTP Reset states
  const [resetMode, setResetMode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && window.location.pathname !== '/login/mfa-challenge') {
        window.history.replaceState(null, '', '/login/mfa-challenge');
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function checkFactors() {
      try {
        // 1. Fetch user to verify active session
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          router.replace('/login');
          return;
        }

        // 2. Fetch AAL levels
        const { data: mfaData, error: mfaErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (mfaErr) throw new Error(mfaErr.message);

        // If user session is already verified (AAL2), skip challenge and go to unified dashboard
        if (mfaData && mfaData.currentLevel === 'aal2') {
          router.replace('/dashboard');
          return;
        }

        // 3. Fetch active factors list
        const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
        if (listErr) throw new Error(listErr.message);

        // Find active TOTP factor
        const activeTotp = factors?.totp?.find((f: any) => f.status === 'verified');
        if (!activeTotp) {
          // No active factor found; force MFA setup
          router.replace('/admin/mfa-setup');
          return;
        }

        setFactorId(activeTotp.id);
        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'An error occurred during verification initialization.');
        setLoading(false);
      }
    }

    checkFactors();

    if (typeof window !== 'undefined') {
      const attemptsStr = localStorage.getItem('mfa_failed_attempts') || '0';
      setFailedAttempts(Number(attemptsStr));
    }
  }, [router, supabase]);

  // Standard authenticator verify
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || otpCode.length !== 6) return;
    if (failedAttempts >= 5) return;

    setError(null);
    setVerifying(true);

    try {
      // Create verification challenge
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeErr) throw new Error(challengeErr.message);

      // Verify OTP code
      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: otpCode,
      });

      if (verifyError) throw new Error(verifyError.message);

      setSuccess(true);
      setVerifying(false);
      
      // Clear attempts on success
      localStorage.removeItem('mfa_failed_attempts');

      // Redirect to dynamic Command Dashboard
      router.push('/dashboard');
    } catch (err: any) {
      const currentAttempts = Number(localStorage.getItem('mfa_failed_attempts') || '0') + 1;
      localStorage.setItem('mfa_failed_attempts', String(currentAttempts));
      setFailedAttempts(currentAttempts);

      setError(err.message || 'Invalid authentication code. Please try again.');
      setVerifying(false);
    }
  };

  // Sign out and back to login page (forces cookie clear to prevent loop)
  const handleSignOut = async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
      router.replace('/login');
    } catch (err) {
      router.replace('/login');
    }
  };

  // Trigger Email OTP send
  const handleSendResetOtp = async () => {
    setResetError(null);
    setResetLoading(true);
    try {
      const res = await fetch('/api/admin/mfa/send-otp', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset code');

      setResetMode(true);
    } catch (err: any) {
      setResetError(err.message || 'Failed to send recovery code.');
    } finally {
      setResetLoading(false);
    }
  };

  // Verify Email OTP and unenroll/reset MFA
  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || resetCode.length !== 6) return;

    setResetError(null);
    setResetLoading(true);

    try {
      const res = await fetch('/api/admin/mfa/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resetCode, factorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      setResetSuccess(true);
      setResetLoading(false);

      // Refresh session immediately to downgrade local token to aal1
      await supabase.auth.refreshSession();

      // Reset lockout states
      localStorage.removeItem('mfa_failed_attempts');
      setFailedAttempts(0);

      // Redirect to QR scan screen to bind new authenticator
      setTimeout(() => {
        router.replace('/admin/mfa-setup');
      }, 1500);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset MFA authenticator.');
      setResetLoading(false);
    }
  };

  // Verify Email OTP and unlock/reset failure count without unenrollment
  const handleVerifyUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetCode.length !== 6) return;

    setResetError(null);
    setResetLoading(true);

    try {
      const res = await fetch('/api/admin/mfa/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: resetCode }), // NO factorId passed!
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      setResetSuccess(true);
      setResetLoading(false);

      // Clear lockout states
      localStorage.removeItem('mfa_failed_attempts');
      setFailedAttempts(0);

      setTimeout(() => {
        setResetSuccess(false);
        setResetMode(false);
        setResetCode('');
      }, 1500);
    } catch (err: any) {
      setResetError(err.message || 'Failed to verify unlock code.');
      setResetLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-slate-400 text-sm font-medium">Initializing Multi-Factor Authentication Challenge...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 items-center justify-center p-6 relative overflow-hidden">
      {/* Background Graphic elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/80 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl relative z-10 space-y-6">
        
        {failedAttempts >= 5 ? (
          resetSuccess ? (
            <div className="text-center py-8 space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full mx-auto text-emerald-400">
                <CheckCircle className="w-8 h-8 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white tracking-tight">Security Unlocked</h3>
                <p className="text-slate-400 text-xs">Attempts reset successfully. Loading authenticator view...</p>
              </div>
            </div>
          ) : resetMode ? (
            // Enter Email OTP to unlock
            <>
              <div className="space-y-2 text-center">
                <div className="flex items-center justify-center w-12 h-12 bg-purple-500/10 border border-purple-500/20 rounded-2xl mx-auto text-purple-400 mb-3">
                  <Mail className="w-5 h-5 animate-bounce" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Security Unlock</h2>
                <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed">
                  Enter the 6-digit unlock code sent to your registered admin email to reset attempts.
                </p>
              </div>

              {resetError && (
                <div className="flex items-start gap-3 p-4 bg-red-955/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                  <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="font-medium leading-relaxed">{resetError}</div>
                </div>
              )}

              <form onSubmit={handleVerifyUnlock} className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit OTP"
                    disabled={resetLoading}
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                    className="block w-full py-3.5 px-4 bg-slate-950 border border-slate-800 focus:border-purple-500/50 text-white rounded-xl text-center text-lg font-bold font-mono tracking-widest transition focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  />
                  <Key className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                </div>

                <button
                  type="submit"
                  disabled={resetLoading || resetCode.length !== 6}
                  className="flex items-center justify-center w-full py-4 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-[0.99] disabled:opacity-50"
                >
                  {resetLoading ? (
                    <Loader2 className="w-4.5 h-4.5 animate-spin mx-auto" />
                  ) : (
                    'Verify & Unlock'
                  )}
                </button>
              </form>
            </>
          ) : (
            // Lockout message and "Send OTP" button
            <>
              <div className="space-y-2 text-center">
                <div className="flex items-center justify-center w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-2xl mx-auto text-red-400 mb-3">
                  <ShieldAlert className="w-5 h-5 animate-pulse" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Verification Blocked</h2>
                <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed">
                  You have exceeded the maximum of 5 incorrect MFA attempts.
                </p>
                <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed mt-2">
                  To protect your account, please verify your identity using a fallback code sent to your registered admin email.
                </p>
              </div>

              {resetError && (
                <div className="flex items-start gap-3 p-4 bg-red-955/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                  <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="font-medium leading-relaxed">{resetError}</div>
                </div>
              )}

              <div className="space-y-3">
                <button
                  onClick={handleSendResetOtp}
                  disabled={resetLoading}
                  className="flex items-center justify-center w-full py-4 px-4 bg-gradient-to-r from-red-600 to-amber-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-[0.99] disabled:opacity-50"
                >
                  {resetLoading ? (
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  ) : (
                    '✉ Send Unlock OTP to Email'
                  )}
                </button>
                <button
                  onClick={handleSignOut}
                  className="flex items-center justify-center gap-2 w-full py-3.5 px-4 border border-slate-800 hover:bg-slate-800/50 text-slate-400 rounded-xl text-xs font-semibold uppercase tracking-wider transition cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Login
                </button>
              </div>
            </>
          )
        ) : resetSuccess ? (
          <div className="text-center py-8 space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full mx-auto text-emerald-400">
              <CheckCircle className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white tracking-tight">Authenticator Reset</h3>
              <p className="text-slate-400 text-xs">MFA disabled successfully. Loading security bind setup...</p>
            </div>
          </div>
        ) : resetMode ? (
          // Reset / Recovery flow interface
          <>
            <div className="space-y-2 text-center">
              <div className="flex items-center justify-center w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl mx-auto text-red-400 mb-3">
                <Mail className="w-5 h-5 animate-bounce" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">MFA Email Recovery</h2>
              <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed">
                Enter the 6-digit recovery OTP code sent to your registered admin email.
              </p>
            </div>



            {resetError && (
              <div className="flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="font-medium leading-relaxed">{resetError}</div>
              </div>
            )}

            <form onSubmit={handleVerifyAndReset} className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  disabled={resetLoading}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                  className="block w-full py-3.5 px-4 bg-slate-950 border border-slate-800 focus:border-red-500/50 text-white rounded-xl text-center text-lg font-bold font-mono tracking-widest transition focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
                <Key className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setResetMode(false)}
                  className="flex-1 py-3 px-4 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || resetCode.length !== 6}
                  className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-750 text-white rounded-xl text-sm font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  {resetLoading ? (
                    <Loader2 className="w-4.5 h-4.5 animate-spin mx-auto" />
                  ) : (
                    'Verify & Reset'
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          // Standard MFA Authenticator flow interface
          <>
            <div className="space-y-2 text-center">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 border border-primary/20 rounded-2xl mx-auto text-primary mb-3">
                <Lock className="w-5 h-5 animate-pulse" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Admin MFA Verification</h2>
              <p className="text-slate-400 text-xs max-w-xs mx-auto leading-relaxed">
                Enter the 6-digit security code generated by your Authenticator app.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="font-medium leading-relaxed">{error}</div>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <input
                type="text"
                maxLength={6}
                placeholder="Enter 6-digit code"
                disabled={verifying || success}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                className="block w-full py-3.5 px-4 bg-slate-950 border border-slate-800 focus:border-primary/50 text-white rounded-xl text-center text-lg font-bold font-mono tracking-widest transition focus:outline-none focus:ring-2 focus:ring-primary/20"
              />

              <button
                type="submit"
                disabled={verifying || success || otpCode.length !== 6}
                className="flex items-center justify-center w-full py-3.5 px-4 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Authorizing session...
                  </>
                ) : success ? (
                  'Authentication Verified'
                ) : (
                  'Verify Identity'
                )}
              </button>
            </form>

            {/* Email OTP recovery trigger link */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={handleSendResetOtp}
                disabled={resetLoading}
                className="text-xs font-semibold text-primary hover:text-primary-dark transition cursor-pointer disabled:opacity-50"
              >
                {resetLoading ? 'Requesting code...' : 'Lost Authenticator? Reset MFA via Email'}
              </button>
            </div>
          </>
        )}

        {/* Back to sign in page (forces session sign-out) */}
        <div className="text-center pt-2 border-t border-slate-800/40">
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition font-semibold cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in page
          </button>
        </div>

      </div>
    </div>
  );
}
