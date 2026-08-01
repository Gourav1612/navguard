'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, Lock, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';

const LoginMapAnimation = dynamic(() => import('@/components/LoginMapAnimation'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#0e071e] flex items-center justify-center text-purple-300">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  ),
});

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !email) {
      setError('Invalid or expired password reset link. Please check your email or try logging in again.');
    }
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

      setSuccess('Account unlocked & password updated successfully! Redirecting to login...');
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0e071e] text-slate-100 overflow-hidden flex items-center justify-center p-4">
      {/* Background Map & Dark Tonal Overlays */}
      <div className="absolute inset-0 z-0">
        <LoginMapAnimation />
        <div className="absolute inset-0 bg-[#0e071e]/75 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e071e] via-transparent to-[#0e071e]/60 pointer-events-none" />
      </div>

      <div className="w-full max-w-md bg-[#130a27]/90 border border-[#2b1754] rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 z-10 relative backdrop-blur-md animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="NaviGuard Logo" className="w-9 h-9 object-contain bg-purple-500/10 border border-purple-500/20 rounded-2xl p-1" />
            <span className="font-extrabold text-sm tracking-wider text-purple-100">NaviGuard</span>
          </div>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="inline-flex items-center gap-1 text-xs font-bold text-purple-400 hover:text-purple-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
          </button>
        </div>

        <div className="space-y-1.5 pt-2">
          <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-purple-400" /> Reset Password
          </h2>
          <p className="text-xs text-purple-300/80 font-medium">
            Reset password and unlock account for <strong>{email || 'your account'}</strong>.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-4 bg-red-950/60 border border-red-800/80 rounded-2xl text-red-200 text-xs font-semibold animate-in shake duration-150">
            <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2.5 p-4 bg-emerald-950/60 border border-emerald-800/80 rounded-2xl text-emerald-200 text-xs font-semibold animate-in fade-in duration-150">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block pl-1">
              New Password
            </label>
            <div className="relative rounded-2xl">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-4.5 w-4.5 text-purple-400" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="block w-full pl-11 pr-10 py-3.5 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-sm text-white focus:outline-none transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-purple-400 hover:text-purple-200"
              >
                {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block pl-1">
              Confirm New Password
            </label>
            <div className="relative rounded-2xl">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-4.5 w-4.5 text-purple-400" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                className="block w-full pl-11 pr-10 py-3.5 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-sm text-white focus:outline-none transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !token || newPassword.length < 6 || newPassword !== confirmPassword}
            className="w-full py-4 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:opacity-95 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating Password...
              </>
            ) : (
              'Update Password & Unlock Account'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0e071e] flex items-center justify-center text-purple-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
