'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, ShieldCheck, Lock, AlertCircle, Copy, Check, RefreshCw } from 'lucide-react';

export default function MfaSetupClient() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAndEnroll() {
      // Safety timeout: Ensure loading is never stuck indefinitely
      const timeoutId = setTimeout(() => {
        if (isMounted) {
          console.warn('[MFA] Setup check timed out after 5s');
          setLoading(false);
        }
      }, 5000);

      try {
        setLoading(true);
        setError(null);

        // 1. Fetch user session
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        
        if (userErr || !user) {
          clearTimeout(timeoutId);
          if (isMounted) router.replace('/login');
          return;
        }

        // 2. Fetch user profile role
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (!profile || profile.role !== 'admin') {
          clearTimeout(timeoutId);
          if (isMounted) router.replace('/');
          return;
        }

        // 3. Reset any pending unverified factors via server admin API first
        try {
          await fetch('/api/admin/mfa/reset-unverified', { method: 'POST' });
        } catch (e) {
          console.warn('[MFA] Failed to reset unverified factors via API:', e);
        }

        // 4. Check existing factors
        const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
        if (factorsErr) throw new Error(factorsErr.message);

        const activeTotp = factors?.all?.find(
          (f: any) => f.factor_type === 'totp' && f.status === 'verified'
        );

        if (activeTotp) {
          clearTimeout(timeoutId);
          if (isMounted) {
            setSuccess(true);
            setLoading(false);
            window.location.href = '/login/mfa-challenge';
          }
          return;
        }

        // 5. Enroll new TOTP factor
        const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: user.email ? `${user.email} - ${suffix}` : `Admin - ${suffix}`,
        });

        if (enrollErr) throw new Error(enrollErr.message);

        clearTimeout(timeoutId);
        if (isMounted) {
          setFactorId(enrollData.id);
          if (enrollData.totp) {
            setQrCodeSvg(enrollData.totp.qr_code);
            setSecret(enrollData.totp.secret);
          }
          setLoading(false);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.error('[MFA] Error in checkAndEnroll:', err);
        if (isMounted) {
          setError(err.message || 'An error occurred during MFA setup initialization.');
          setLoading(false);
        }
      }
    }

    checkAndEnroll();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  const handleCopySecret = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || otpCode.length !== 6) return;

    setError(null);
    setVerifying(true);

    try {
      // Create verification challenge
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeErr) throw new Error(challengeErr.message);

      // Verify OTP code
      const { data: verifyData, error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: otpCode,
      });

      if (verifyErr) throw new Error(verifyErr.message);

      // Refresh session locally
      const { data: refreshData } = await supabase.auth.refreshSession();
      const accessToken = verifyData?.access_token || refreshData?.session?.access_token;
      const refreshToken = verifyData?.refresh_token || refreshData?.session?.refresh_token;

      // Synchronize AAL2 session cookies to server via API endpoint
      if (accessToken && refreshToken) {
        await fetch('/api/auth/mfa/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
          }),
        });
      }

      setSuccess(true);
      setVerifying(false);
      
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check your authenticator code.');
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#090A0F] text-white">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-zinc-400 text-sm font-medium">Securing access environment...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#090A0F] items-center justify-center p-6 relative overflow-hidden">
      {/* Background Graphic elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-zinc-700/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg bg-zinc-900/60 border border-zinc-800 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl relative z-10 space-y-6">
        
        {success ? (
          <div className="text-center py-8 space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full mx-auto text-emerald-400">
              <ShieldCheck className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white tracking-tight">Security Hardening Complete</h3>
              <p className="text-zinc-400 text-sm">MFA factor verified. Redirecting to admin session...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="space-y-2 text-center">
              <div className="flex items-center justify-center w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mx-auto text-emerald-400 mb-3">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Admin MFA Enrollment</h2>
              <p className="text-zinc-400 text-xs max-w-sm mx-auto leading-relaxed">
                Protect your administrator credentials. Scan the QR code with Google Authenticator, Authy, or Microsoft Authenticator.
              </p>
            </div>

            {error && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="font-medium leading-relaxed">{error}</div>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry MFA Enrollment Setup
                </button>
              </div>
            )}

            {/* Step 1: Scan QR Code */}
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">1</span>
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Scan authenticator QR code</h4>
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-6 bg-zinc-950/50 border border-zinc-800/50 p-6 rounded-2xl">
                {qrCodeSvg ? (
                  <div className="bg-white p-3 rounded-2xl shadow-lg border border-zinc-100 flex-shrink-0 animate-in zoom-in-95">
                    <img src={qrCodeSvg} alt="MFA QR Code" className="w-36 h-36" />
                  </div>
                ) : (
                  <div className="w-36 h-36 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800">
                    <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                  </div>
                )}
                <div className="space-y-3 flex-1 text-center sm:text-left">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    If you cannot scan the QR code, copy and enter the text key manually into your authenticator app.
                  </p>
                  
                  {secret && (
                    <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-2.5 rounded-xl text-xs font-mono font-bold text-zinc-300 max-w-[240px] mx-auto sm:mx-0">
                      <span className="truncate flex-1">{secret}</span>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded transition cursor-pointer"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Validate Verification Code */}
            <form onSubmit={handleVerify} className="space-y-4 pt-2 border-t border-zinc-800/50">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">2</span>
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Verify Authenticator Code</h4>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit verification code"
                  disabled={verifying}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="block w-full py-3.5 px-4 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 text-white rounded-xl text-center text-lg font-bold font-mono tracking-widest transition focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />

                <button
                  type="submit"
                  disabled={verifying || otpCode.length !== 6}
                  className="flex items-center justify-center w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Validating secure handshake...
                    </>
                  ) : (
                    'Verify and Secure Account'
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
