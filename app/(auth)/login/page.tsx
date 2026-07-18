'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, Eye, EyeOff, AlertCircle } from 'lucide-react';
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
    <div className="relative min-h-screen bg-[#0e071e] text-slate-100 flex items-center justify-center p-4 sm:p-8 overflow-hidden">
      
      {/* Full-Screen Background Map & Dark Tonal Overlays */}
      <div className="absolute inset-0 z-0">
        <LoginMapAnimation />
        
        {/* Dark Purple Tint & Tonal Gradient Fades covering the entire screen */}
        <div className="absolute inset-0 bg-[#0e071e]/75 backdrop-blur-xs pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e071e]/70 via-[#0e071e]/40 to-[#0e071e]/80 pointer-events-none" />
      </div>

      {/* Centered Login Card */}
      <div className="w-full max-w-md bg-[#140b2a]/95 border border-[#301c56]/80 rounded-3xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] space-y-8 animate-in fade-in zoom-in-95 duration-300 z-10 relative">
        
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 bg-purple-500/10 border border-purple-500/25 rounded-2xl text-purple-400 font-black text-xl shadow-inner">
            NG
          </div>
          <span className="font-extrabold text-base tracking-wider text-purple-100">NaviGuard AI</span>
        </div>

        {/* Title Header */}
        <div className="space-y-2 text-center">
          <span className="text-[10px] font-black text-purple-400 tracking-widest uppercase block">secured access</span>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
            Sign in to account<span className="text-purple-500">.</span>
          </h2>
          <p className="text-slate-400 text-xs font-semibold pt-1">
            Eliminating school bus tracking uncertainty.
          </p>
        </div>

        {/* Alert Error Banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-955/40 border border-red-900/60 rounded-2xl text-red-200 text-xs animate-in shake duration-200">
            <AlertCircle className="w-4.5 h-4.5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="font-bold text-left">{error}</div>
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
                className={`block w-full pl-11 pr-3 py-3.5 bg-[#160d2b]/95 border text-white rounded-2xl text-sm transition focus:outline-none focus:ring-4 focus:ring-purple-500/10 ${
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
            <label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-purple-300 block pl-1">
              Password
            </label>
            <div className="relative rounded-2xl shadow-2xs">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-4.5 w-4.5 text-purple-400" />
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                disabled={loading}
                placeholder="••••••••"
                className={`block w-full pl-11 pr-10 py-3.5 bg-[#160d2b]/95 border text-white rounded-2xl text-sm transition focus:outline-none focus:ring-4 focus:ring-purple-500/10 ${
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
  );
}
