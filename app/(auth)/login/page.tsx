'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isNative = (window as any).Capacitor?.isNativePlatform?.() || false;
      setShowDownloadBtn(!isNative);
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<any>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      identifier: '',
      password: '',
    },
  });

  const onSubmit = async (values: any) => {
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
          identifier: values.identifier,
          password: values.password,
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
    <div className="relative min-h-screen bg-[#090A0F] text-zinc-100 overflow-hidden flex flex-col md:flex-row">
      
      {/* Full-Screen Background Map & Dark Overlays */}
      <div className="absolute inset-0 z-0">
        <LoginMapAnimation />
        
        {/* Subtle Map Overlays */}
        <div className="absolute inset-0 bg-[#090A0F]/5 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090A0F]/60 via-transparent to-[#090A0F]/20 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#090A0F]/20 via-transparent to-[#090A0F]/60 pointer-events-none" />
      </div>

      {/* Left Column: Form Panel (Ultra-Clear Crystal Glassmorphism) */}
      <div className="w-full md:w-[45%] lg:w-[40%] min-h-screen flex items-center justify-center p-6 sm:p-12 bg-black/20 md:bg-[#090A0F]/25 z-10 relative border-r border-white/10 backdrop-blur-xs shadow-2xl">
        <div className="w-full max-w-md space-y-8 animate-in fade-in duration-300">
          
          {/* Brand Header */}
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="NaviGuard Logo" className="w-10 h-10 object-contain rounded-xl" />
              <span className="font-extrabold text-base tracking-wider text-white">NaviGuard</span>
            </div>
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:text-white rounded-xl text-[10px] font-bold transition-all no-underline"
              >
                📥 Download App
              </a>
            )}
          </div>

          {/* Title Header */}
          <div className="space-y-2 pt-2">
            <span className="text-xs font-mono tracking-[0.25em] text-zinc-400 uppercase block pl-0.5">SECURED ACCESS</span>
            <h2 className="text-3xl lg:text-4xl font-black text-white tracking-tight leading-none">
              Sign in to account<span className="text-zinc-400">.</span>
            </h2>
          </div>

          {/* Alert Error Banner */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-red-300 text-xs animate-in shake duration-200">
              <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="font-bold">{error}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Username / Email Field */}
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block pl-1">
                Username / Email
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-4.5 w-4.5 text-zinc-400" />
                </div>
                <input
                  id="identifier"
                  type="text"
                  disabled={loading}
                  placeholder="Enter Username or Email"
                  className={`block w-full pl-11 pr-3 py-3.5 bg-zinc-950/70 border text-white placeholder:text-zinc-500 rounded-xl text-sm transition focus:border-white focus:ring-1 focus:ring-white/40 focus:outline-none backdrop-blur-md ${
                    errors.identifier
                      ? 'border-red-500/50 focus:ring-red-500/10'
                      : 'border-zinc-800/80'
                  }`}
                  {...register('identifier')}
                />
              </div>
              {errors.identifier && (
                <p className="text-xs font-semibold text-red-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {String((errors.identifier as any)?.message || '')}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block pl-1">
                Password
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4.5 w-4.5 text-zinc-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  disabled={loading}
                  placeholder="Enter Password"
                  className={`block w-full pl-11 pr-10 py-3.5 bg-zinc-950/70 border text-white placeholder:text-zinc-500 rounded-xl text-sm transition focus:border-white focus:ring-1 focus:ring-white/40 focus:outline-none backdrop-blur-md ${
                    errors.password
                      ? 'border-red-500/50 focus:ring-red-500/10'
                      : 'border-zinc-800/80'
                  }`}
                  {...register('password')}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-zinc-400 hover:text-white focus:outline-none cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs font-semibold text-red-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {String((errors.password as any)?.message || '')}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-950 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-white/5 active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2 text-zinc-950" />
                  Verifying Account...
                </>
              ) : (
                'SIGN IN'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Right Column: Wavy Dashed Divider Line */}
      <div className="hidden md:block md:w-[55%] lg:w-[60%] relative z-10 pointer-events-none">
        {/* Wavy silver dashed divider stroke */}
        <svg className="absolute top-0 bottom-0 left-0 w-24 h-full z-20 pointer-events-none -ml-[1px]" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,0 C50,20 70,40 30,60 C70,80 50,90 0,100" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="3, 5" opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}
