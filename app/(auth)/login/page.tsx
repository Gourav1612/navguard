'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { LoginSchema } from '@/lib/validations';
import type { z } from 'zod';

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
      // 800ms max timeout for public IP fetch to keep login quick
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

      // Login succeeded. Redirect to the unified dashboard.
      router.refresh();
      router.push('/dashboard');
    } catch (err: any) {
      setError('A connection error occurred. Please check network settings.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f4f2f8]">
      {/* Left Column: Accent Graphic & Brand Pitch */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-[#351e56] via-[#5c3b99] to-[#1a0e2b] text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"></div>
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-xl text-white font-black text-xl backdrop-blur-md border border-white/20">
            NG
          </div>
          <span className="font-extrabold text-lg tracking-wider text-white">NaviGuard AI</span>
        </div>

        <div className="space-y-6 relative z-10 max-w-md my-auto">
          <h2 className="text-4xl font-black tracking-tight leading-tight text-white">
            Ensuring Safety in Student Transportation
          </h2>
          <p className="text-purple-200/90 text-sm leading-relaxed font-semibold">
            Eliminating school bus tracking uncertainty. Access live locations, automated route ETAs, and role-based operator controls all from a unified dashboard.
          </p>
          <div className="flex items-center gap-4 pt-4">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/10 border border-white/20 text-white backdrop-blur-md">
              🟢 Live GPS Tracking
            </span>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/10 border border-white/20 text-white backdrop-blur-md">
              ⚡ Instant ETAs
            </span>
          </div>
        </div>

        <div className="text-xs text-purple-300 relative z-10 font-semibold font-mono">
          &copy; {new Date().getFullYear()} NaviGuard AI Transport SaaS. All rights reserved.
        </div>
      </div>

      {/* Right Column: Clean Form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8 bg-white border-l border-slate-150">
        <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header Title */}
          <div className="space-y-2">
            <h3 className="text-3xl font-black text-[#1e1b4b] tracking-tight">Sign In</h3>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Access your NaviGuard account dashboard
            </p>
          </div>

          {/* Alert Error Banner */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm animate-in shake duration-200">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="font-medium">{error}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Email Address
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  disabled={loading}
                  placeholder="name@school.edu"
                  className={`block w-full pl-10 pr-3 py-3 border rounded-xl text-sm transition focus:outline-none focus:ring-2 ${
                    errors.email
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-slate-200 focus:ring-[#5c3b99]/20 focus:border-[#5c3b99]'
                  }`}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs font-semibold text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Password
                </label>
              </div>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  disabled={loading}
                  placeholder="••••••••"
                  className={`block w-full pl-10 pr-10 py-3 border rounded-xl text-sm transition focus:outline-none focus:ring-2 ${
                    errors.password
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-slate-200 focus:ring-[#5c3b99]/20 focus:border-[#5c3b99]'
                  }`}
                  {...register('password')}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-650 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs font-semibold text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.password.message}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center w-full py-3.5 px-4 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-xl text-sm font-bold transition-all shadow-lg hover:shadow-xl shadow-purple-500/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Verifying account...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
