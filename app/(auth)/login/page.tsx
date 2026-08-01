'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, Eye, EyeOff, AlertCircle, KeyRound, ShieldCheck, CheckCircle2, X, Send } from 'lucide-react';
import { LoginSchema } from '@/lib/validations';
import type { z } from 'zod';
import dynamic from 'next/dynamic';

// Dynamically load Map Animation to bypass SSR errors
const LoginMapAnimation = dynamic(() => import('@/components/LoginMapAnimation'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#0e071e] flex items-center justify-center text-purple-300">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  ),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDownloadBtn, setShowDownloadBtn] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Forgot Password modal states
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStep, setForgotStep] = useState<'initial' | 'otp_sent'>('initial');
  const [forgotOtpSending, setForgotOtpSending] = useState(false);
  const [forgotOtpVerifying, setForgotOtpVerifying] = useState(false);
  const [forgotOtpCode, setForgotOtpCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotShowPassword, setForgotShowPassword] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isNative = (window as any).Capacitor?.isNativePlatform?.() || false;
      setShowDownloadBtn(!isNative);
    }
  }, []);

  // Cooldown timer for OTP resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const handleRequestForgotOtp = async (targetEmail?: string) => {
    const emailToUse = targetEmail || forgotEmail;
    if (!emailToUse || !emailToUse.trim()) {
      setForgotError('Please enter your registered email address.');
      return;
    }

    setForgotError(null);
    setForgotSuccess(null);
    setForgotOtpSending(true);

    try {
      const res = await fetch('/api/auth/forgot-password/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToUse.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to send OTP code');

      setForgotStep('otp_sent');
      setForgotSuccess(data.message || `Verification code sent to ${data.email || emailToUse}`);
      setResendCooldown(60);
    } catch (err: any) {
      setForgotError(err.message || 'Failed to request password reset code.');
    } finally {
      setForgotOtpSending(false);
    }
  };

  const handleVerifyForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(null);

    if (forgotOtpCode.trim().length !== 6) {
      setForgotError('Verification code must be 6 digits.');
      return;
    }

    if (forgotNewPassword.length < 6) {
      setForgotError('New password must be at least 6 characters long.');
      return;
    }

    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Passwords do not match.');
      return;
    }

    setForgotOtpVerifying(true);

    try {
      const res = await fetch('/api/auth/forgot-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim(),
          code: forgotOtpCode.trim(),
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to verify OTP code');

      setShowForgotModal(false);
      setError(null);
      setSuccessBanner('Password updated & account unlocked! Please sign in with your new password.');
      setForgotOtpCode('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setForgotStep('initial');
    } catch (err: any) {
      setForgotError(err.message || 'Verification failed.');
    } finally {
      setForgotOtpVerifying(false);
    }
  };

  const onSubmit = async (values: LoginFormValues) => {
    setError(null);
    setLoading(true);

    let detectedIp: string | undefined = undefined;
    try {
      const ipPromise = fetch('https://api.ipify.org?format=json')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data?.ip || undefined);

      const timeoutPromise = new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), 800)
      );

      detectedIp = await Promise.race([ipPromise, timeoutPromise]);
    } catch (err) {
      console.error('Failed to fetch public IP:', err);
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          ip: detectedIp,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Authentication failed. Please verify credentials.');
        setLoading(false);
        return;
      }

      router.refresh();
      router.push('/dashboard');
    } catch (err: any) {
      setError('A connection error occurred. Please check network settings.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0e071e] text-slate-100 overflow-hidden flex flex-col md:flex-row">
      
      {/* Full-Screen Background Map & Dark Tonal Overlays */}
      <div className="absolute inset-0 z-0">
        <LoginMapAnimation />
        
        {/* Dark Purple Tint & Tonal Gradient Fades */}
        <div className="absolute inset-0 bg-[#0e071e]/25 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e071e]/70 via-transparent to-[#0e071e]/40 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0e071e]/45 via-transparent to-[#0e071e]/55 pointer-events-none" />
      </div>

      {/* Left Column: Form Panel (Semi-transparent bg on both mobile and PC so map is visible behind the form) */}
      <div className="w-full md:w-[45%] lg:w-[40%] min-h-screen flex items-center justify-center p-6 sm:p-12 bg-[#0e071e]/65 md:bg-[#0e071e]/85 z-10 relative border-r border-[#1f133d]/40 backdrop-blur-xs">
        <div className="w-full max-w-md space-y-8 animate-in fade-in duration-300">
          
          {/* Brand Header */}
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="NaviGuard Logo" className="w-10 h-10 object-contain bg-purple-500/5 border border-purple-500/20 rounded-2xl p-1" />
              <span className="font-extrabold text-base tracking-wider text-purple-100">NaviGuard</span>
            </div>
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:text-purple-200 rounded-xl text-[10px] font-bold transition-all no-underline"
              >
                📥 Download App
              </a>
            )}
          </div>

          {/* Title Header */}
          <div className="space-y-2 pt-2">
            <span className="text-[10px] font-black text-purple-400 tracking-widest uppercase block pl-0.5">secured access</span>
            <h2 className="text-3xl lg:text-4xl font-black text-white tracking-tight leading-none">
              Sign in to account<span className="text-purple-500">.</span>
            </h2>
            <p className="text-slate-400 text-xs font-semibold pt-1">
              Eliminating school bus tracking uncertainty.
            </p>
          </div>

          {/* Alert Success Banner */}
          {successBanner && (
            <div className="flex items-start gap-3 p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-2xl text-emerald-200 text-xs animate-in fade-in duration-200">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="font-bold">{successBanner}</div>
            </div>
          )}

          {/* Alert Error Banner */}
          {error && (
            <div className="flex flex-col gap-2 p-4 bg-red-955/40 border border-red-900/60 rounded-2xl text-red-200 text-xs animate-in shake duration-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4.5 h-4.5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="font-bold">{error}</div>
              </div>
              {(error.toLowerCase().includes('attempts') || error.toLowerCase().includes('locked')) && (
                <button
                  type="button"
                  onClick={() => {
                    const currentEmail = (document.getElementById('email') as HTMLInputElement)?.value;
                    if (currentEmail) setForgotEmail(currentEmail);
                    setShowForgotModal(true);
                  }}
                  className="mt-1 px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 rounded-xl font-bold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer w-fit"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Reset Password via Email OTP & Unlock
                </button>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Email Field */}
            <div className="space-y-2">
              <label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-purple-300 block pl-1">
                Email Address
              </label>
              <div className="relative rounded-2xl shadow-2xs">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-4.5 w-4.5 text-purple-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  disabled={loading}
                  placeholder="name@school.edu"
                  className={`block w-full pl-11 pr-3 py-3.5 bg-[#160d2b]/90 border text-white rounded-2xl text-sm transition focus:outline-none focus:ring-4 focus:ring-purple-500/10 ${
                    errors.email
                      ? 'border-red-500/50 focus:ring-red-500/10'
                      : 'border-[#301c56] focus:border-purple-500'
                  }`}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs font-semibold text-red-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex items-center justify-between pl-1 pr-1">
                <label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-purple-300 block">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const currentEmail = (document.getElementById('email') as HTMLInputElement)?.value;
                    if (currentEmail) setForgotEmail(currentEmail);
                    setShowForgotModal(true);
                  }}
                  className="text-[11px] font-bold text-purple-400 hover:text-purple-200 transition cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative rounded-2xl shadow-2xs">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4.5 w-4.5 text-purple-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  disabled={loading}
                  placeholder="••••••••"
                  className={`block w-full pl-11 pr-10 py-3.5 bg-[#160d2b]/90 border text-white rounded-2xl text-sm transition focus:outline-none focus:ring-4 focus:ring-purple-500/10 ${
                    errors.password
                      ? 'border-red-500/50 focus:ring-red-500/10'
                      : 'border-[#301c56] focus:border-purple-500'
                  }`}
                  {...register('password')}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-purple-400 hover:text-purple-300 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs font-semibold text-red-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.password.message}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center w-full py-4 px-4 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:opacity-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-purple-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Verifying Account...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Right Column: Overlay Wave and Masks (only on desktop to blend the map on the right) */}
      <div className="hidden md:block md:w-[55%] lg:w-[60%] relative z-10 pointer-events-none">
        
        {/* Wavy solid color mask to bleed left solid bg into map (matching left panel opacity) */}
        <svg className="absolute top-0 bottom-0 left-0 w-24 h-full text-[#0e071e] opacity-85 fill-current z-20 pointer-events-none -ml-[1px]" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,0 C50,20 70,40 30,60 C70,80 50,90 0,100 Z" />
        </svg>

        {/* Wavy neon dashed stroke */}
        <svg className="absolute top-0 bottom-0 left-0 w-24 h-full z-20 pointer-events-none -ml-[1px]" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,0 C50,20 70,40 30,60 C70,80 50,90 0,100" fill="none" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="3, 5" opacity="0.8" />
        </svg>

        {/* Gradient left-to-right fade overlay to blend map perfectly */}
        <div className="absolute inset-y-0 left-0 w-48 bg-gradient-to-r from-[#0e071e]/85 via-[#0e071e]/50 to-transparent z-10 pointer-events-none" />
      </div>

      {/* Forgot Password & Account Unlock Modal Overlay */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-[#070312]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#130a27] border border-[#2b1754] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-white relative">
            <button
              type="button"
              onClick={() => {
                setShowForgotModal(false);
                setForgotError(null);
                setForgotSuccess(null);
              }}
              className="absolute top-5 right-5 text-purple-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" /> Account Recovery
              </h3>
              <p className="text-xs text-purple-300/70 font-medium">
                Reset password via 6-digit email OTP and unlock your account.
              </p>
            </div>

            {forgotError && (
              <div className="flex items-start gap-2.5 p-3.5 bg-red-950/60 border border-red-800/80 rounded-2xl text-red-200 text-xs font-semibold animate-in shake duration-150">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <span>{forgotError}</span>
              </div>
            )}

            {forgotSuccess && (
              <div className="flex items-start gap-2.5 p-3.5 bg-emerald-950/60 border border-emerald-800/80 rounded-2xl text-emerald-200 text-xs font-semibold animate-in fade-in duration-150">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>{forgotSuccess}</span>
              </div>
            )}

            {forgotStep === 'initial' ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block">
                    Registered Email Address
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@school.edu"
                      className="w-full pl-11 pr-4 py-3.5 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-sm text-white font-medium focus:outline-none transition"
                    />
                    <Mail className="w-4.5 h-4.5 text-purple-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={forgotOtpSending || !forgotEmail.trim()}
                  onClick={() => handleRequestForgotOtp()}
                  className="w-full py-4 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:opacity-95 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 cursor-pointer disabled:opacity-50"
                >
                  {forgotOtpSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending OTP...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send Verification OTP Code
                    </>
                  )}
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyForgotOtp} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block mb-1">
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      required
                      value={forgotOtpCode}
                      onChange={(e) => setForgotOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="849201"
                      className="w-full pl-4 pr-10 py-3 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-lg font-black tracking-widest font-mono text-white focus:outline-none transition"
                    />
                    <KeyRound className="w-5 h-5 text-purple-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block mb-1">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={forgotShowPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        className="w-full pl-4 pr-10 py-3 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-sm text-white focus:outline-none transition"
                      />
                      <button
                        type="button"
                        onClick={() => setForgotShowPassword(!forgotShowPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-200"
                      >
                        {forgotShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-purple-300 block mb-1">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <input
                        type={forgotShowPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={forgotConfirmPassword}
                        onChange={(e) => setForgotConfirmPassword(e.target.value)}
                        placeholder="Re-type new password"
                        className="w-full pl-4 pr-10 py-3 bg-[#1c0f38] border border-[#371f69] focus:border-purple-400 rounded-2xl text-sm text-white focus:outline-none transition"
                      />
                      <Lock className="w-4 h-4 text-purple-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    disabled={resendCooldown > 0 || forgotOtpSending}
                    onClick={() => handleRequestForgotOtp()}
                    className="text-xs font-bold text-purple-300 hover:text-white disabled:text-slate-500 transition cursor-pointer"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
                  </button>

                  <button
                    type="submit"
                    disabled={forgotOtpVerifying || forgotOtpCode.length !== 6 || forgotNewPassword.length < 6 || forgotNewPassword !== forgotConfirmPassword}
                    className="px-5 py-3.5 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:opacity-95 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20 cursor-pointer disabled:opacity-50"
                  >
                    {forgotOtpVerifying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    Reset & Unlock
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
