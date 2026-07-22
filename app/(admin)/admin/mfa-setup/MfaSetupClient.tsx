'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, ShieldCheck, QrCode, Lock, AlertCircle, Copy, Check } from 'lucide-react';

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
    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && window.location.pathname !== '/admin/mfa-setup') {
        window.history.replaceState(null, '', '/admin/mfa-setup');
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function checkAndEnroll() {
      try {
        console.log('[MFA] 1. Starting getUser...');
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        console.log('[MFA] 1. getUser completed. User:', user?.id, 'Error:', userErr?.message);
        
        if (userErr || !user) {
          console.log('[MFA] Redirecting to login: no user session');
          router.replace('/login');
          return;
        }

        console.log('[MFA] 2. Starting user_profiles query...');
        const { data: profile, error: profileErr } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        console.log('[MFA] 2. user_profiles query completed. Role:', profile?.role, 'Error:', profileErr?.message);

        if (!profile || profile.role !== 'admin') {
          console.log('[MFA] Redirecting: user is not an admin', profile?.role);
          router.replace('/');
          return;
        }

        console.log('[MFA] 3. Starting listFactors...');
        const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
        console.log('[MFA] 3. listFactors completed. Factors:', factors, 'Error:', factorsErr?.message);
        if (factorsErr) throw new Error(factorsErr.message);

        const activeTotp = factors?.totp?.find((f: any) => f.status === 'verified');
        if (activeTotp) {
          console.log('[MFA] User already has active verified TOTP. Redirecting to dashboard...');
          setSuccess(true);
          setLoading(false);
          setTimeout(() => {
            router.push('/admin/dashboard');
          }, 1500);
          return;
        }

        // Clean up any existing unverified or pending factors to prevent "factor already exists" error
        if (factors?.all && factors.all.length > 0) {
          console.log('[MFA] Found pending factors. Cleaning up...');
          for (const factor of factors.all) {
            await supabase.auth.mfa.unenroll({ factorId: factor.id });
            console.log('[MFA] Cleaned up factor:', factor.id);
          }
        }

        console.log('[MFA] 4. Starting enroll...');
        const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: user.email ? `${user.email} - ${suffix}` : `Admin - ${suffix}`,
        });
        console.log('[MFA] 4. enroll completed. EnrollData ID:', enrollData?.id, 'Error:', enrollErr?.message);

        if (enrollErr) throw new Error(enrollErr.message);

        setFactorId(enrollData.id);
        if (enrollData.totp) {
          setQrCodeSvg(enrollData.totp.qr_code);
          setSecret(enrollData.totp.secret);
        }
        setLoading(false);
      } catch (err: any) {
        console.error('[MFA] Error caught in checkAndEnroll:', err);
        setError(err.message || 'An error occurred during MFA setup initialization.');
        setLoading(false);
      }
    }

    checkAndEnroll();
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

      setSuccess(true);
      setVerifying(false);
      
      // Redirect to Admin Dashboard
      setTimeout(() => {
        router.push('/admin/dashboard');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check your authenticator code.');
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white">
        <Loader2 className="w-10 h-10 text-primary-dark animate-spin mb-4" />
        <p className="text-slate-400 text-sm font-medium">Securing access environment...</p>
      </div>
    );
  }

  const qrCodeUrl = qrCodeSvg 
    ? `data:image/svg+xml;utf8,${encodeURIComponent(qrCodeSvg)}` 
    : null;

  return (
    <div className="flex min-h-screen bg-slate-950 items-center justify-center p-6 relative overflow-hidden">
      {/* Background Graphic elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg bg-slate-900/40 border border-slate-800/80 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl relative z-10 space-y-6">
        
        {success ? (
          <div className="text-center py-8 space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full mx-auto text-emerald-400">
              <ShieldCheck className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white tracking-tight">Security Hardening Complete</h3>
              <p className="text-slate-400 text-sm">MFA factor verified. Redirecting to admin session...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="space-y-2 text-center">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 border border-primary/20 rounded-2xl mx-auto text-primary mb-3">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Admin MFA Mandatory Enrollment</h2>
              <p className="text-slate-400 text-xs max-w-sm mx-auto leading-relaxed">
                Protect your administrator credentials. Scan the QR code with Google Authenticator, Authy, or Microsoft Authenticator.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-950/40 border border-red-800/50 rounded-2xl text-red-300 text-xs animate-in shake duration-200">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="font-medium leading-relaxed">{error}</div>
              </div>
            )}

            {/* Step 1: Scan QR Code */}
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-300">1</span>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Scan authenticator QR code</h4>
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-6 bg-slate-950/50 border border-slate-800/50 p-6 rounded-2xl">
                {qrCodeSvg && (
                  <div className="bg-white p-3 rounded-2xl shadow-lg border border-slate-100 flex-shrink-0 animate-in zoom-in-95">
                    <img src={qrCodeSvg} alt="MFA QR Code" className="w-36 h-36" />
                  </div>
                )}
                <div className="space-y-3 flex-1 text-center sm:text-left">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    If you cannot scan the QR code, copy and enter the text key manually into your authenticator app.
                  </p>
                  
                  {secret && (
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-2.5 rounded-xl text-xs font-mono font-bold text-slate-300 max-w-[240px] mx-auto sm:mx-0">
                      <span className="truncate flex-1">{secret}</span>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded transition"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Validate Verification Code */}
            <form onSubmit={handleVerify} className="space-y-4 pt-2 border-t border-slate-800/50">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-300">2</span>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Verify Authenticator Code</h4>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit verification code"
                  disabled={verifying}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="block w-full py-3.5 px-4 bg-slate-950 border border-slate-800 focus:border-primary/50 text-white rounded-xl text-center text-lg font-bold font-mono tracking-widest transition focus:outline-none focus:ring-2 focus:ring-primary/20"
                />

                <button
                  type="submit"
                  disabled={verifying || otpCode.length !== 6}
                  className="flex items-center justify-center w-full py-3.5 px-4 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
