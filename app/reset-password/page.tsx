'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, Lock, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2, ArrowLeft, Clock, FileX } from 'lucide-react';
import dynamic from 'next/dynamic';

const LoginMapAnimation = dynamic(() => import('@/components/LoginMapAnimation'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#090A0F] flex items-center justify-center text-emerald-400">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  ),
});

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenStatus, setTokenStatus] = useState<'valid' | 'expired' | 'invalid'>('valid');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      if (!token || !email) {
        setTokenStatus('invalid');
        setCheckingToken(false);
        return;
      }

      try {
        const res = await fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`);
        const data = await res.json();

        if (data.valid) {
          setTokenStatus('valid');
        } else {
          setTokenStatus(data.reason === 'expired_token' ? 'expired' : 'invalid');
        }
      } catch (e) {
        setTokenStatus('invalid');
      } finally {
        setCheckingToken(false);
      }
    }

    validateToken();
  }, [token, email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token || !email) {
      setError('Missing token or email parameter.');
      return;
    }

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess('Password updated successfully! Redirecting to login page...');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#090A0F] text-zinc-100 overflow-hidden flex items-center justify-center p-6">
      {/* Background Map & Dark Tonal Overlays */}
      <div className="absolute inset-0 z-0">
        <LoginMapAnimation />
        <div className="absolute inset-0 bg-[#090A0F]/70 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090A0F] via-transparent to-[#090A0F]/60 pointer-events-none" />
      </div>

      <div className="w-full max-w-md bg-zinc-900/80 border border-zinc-800/80 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 z-10 relative backdrop-blur-2xl animate-in fade-in duration-300">
        
        {/* Loading Spinner State */}
        {checkingToken ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs font-bold text-zinc-400">Verifying security token...</p>
          </div>
        ) : tokenStatus !== 'valid' ? (
          /* Link Expired / Invalid Token Screen */
          <div className="text-center space-y-6 py-4 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-3xl flex items-center justify-center mx-auto text-red-400">
              {tokenStatus === 'expired' ? <Clock className="w-8 h-8 text-red-400" /> : <FileX className="w-8 h-8 text-red-400" />}
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-white">
                {tokenStatus === 'expired' ? 'Link Expired (10 Min Passed)' : 'Page Not Found / Invalid Link'}
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed max-w-xs mx-auto font-medium">
                {tokenStatus === 'expired'
                  ? 'This password reset link has expired after 10 minutes or has already been used. Please log in again to trigger a fresh link.'
                  : 'This password reset link is invalid or has already been used.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push('/login')}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Return to Login Screen
            </button>
          </div>
        ) : (
          /* Valid Token Reset Form */
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src="/logo.svg" alt="NaviGuard Logo" className="w-10 h-10 object-contain rounded-xl" />
                <span className="font-extrabold text-sm tracking-wider text-white">NaviGuard</span>
              </div>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="inline-flex items-center gap-1 text-xs font-bold text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
              </button>
            </div>

            <div className="space-y-1.5 pt-2">
              <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-400" /> Reset Password
              </h2>
              <p className="text-xs text-zinc-400 font-medium">
                Set a new password for <strong className="text-emerald-400">{email || 'your account'}</strong>.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-4 bg-red-950/40 border border-red-800/50 rounded-2xl text-red-300 text-xs font-semibold animate-in shake duration-150">
                <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-2.5 p-4 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl text-emerald-300 text-xs font-semibold animate-in fade-in duration-150">
                <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 pt-2">
              <div className="space-y-2">
                <label className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-400 block pl-1">
                  New Password
                </label>
                <div className="relative rounded-xl">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4.5 w-4.5 text-zinc-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="block w-full pl-11 pr-10 py-3.5 bg-zinc-950/70 border border-zinc-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 text-white placeholder:text-zinc-500 rounded-xl text-sm focus:outline-none transition backdrop-blur-md"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-zinc-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono font-black uppercase tracking-widest text-zinc-400 block pl-1">
                  Confirm New Password
                </label>
                <div className="relative rounded-xl">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4.5 w-4.5 text-zinc-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type new password"
                    className="block w-full pl-11 pr-10 py-3.5 bg-zinc-950/70 border border-zinc-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 text-white placeholder:text-zinc-500 rounded-xl text-sm focus:outline-none transition backdrop-blur-md"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !token || newPassword.length < 6 || newPassword !== confirmPassword}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating Password...
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#090A0F] flex items-center justify-center text-emerald-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
