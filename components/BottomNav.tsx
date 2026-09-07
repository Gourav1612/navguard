'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Map, ClipboardList, Bell, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Capacitor } from '@capacitor/core';
import { safeSetDriverStatus, safeSaveTrackingCredentials } from '@/lib/capacitor-plugins';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { EmergencyAlertListener } from '@/components/sos/EmergencyAlertListener';
import { SosTriggerButton } from '@/components/sos/SosTriggerButton';

interface UserProfile {
  id?: string;
  full_name: string;
  email: string;
  role: 'manager' | 'supervisor' | 'worker' | 'admin';
}

export function BottomNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || '';
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showDownloadBtn, setShowDownloadBtn] = useState(false);
  const [isPipMode, setIsPipMode] = useState(false);

  useEffect(() => {
    let timeoutId: any = null;

    const handlePip = (e: any) => {
      const targetPip = !!e.detail?.isPip;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsPipMode(targetPip);
      }, 150);
    };
    const handleResize = () => {
      const isTiny = window.innerWidth > 0 && window.innerHeight > 0 && window.innerWidth < 360 && window.innerHeight < 390;
      setIsPipMode(isTiny);
    };

    window.addEventListener('pip-mode-change', handlePip);
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => {
      window.removeEventListener('pip-mode-change', handlePip);
      window.removeEventListener('resize', handleResize);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    setShowDownloadBtn(!isNative);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data);
          
          const isTrackedRole = data.role === 'worker' || data.role === 'supervisor' || data.role === 'manager';
          await safeSetDriverStatus(isTrackedRole);

          if (isTrackedRole && data.id) {
            const supabase = createBrowserSupabaseClient();
            const sessionRes = await supabase.auth.getSession();
            const sessionToken = sessionRes.data.session?.access_token;
            if (sessionToken) {
              await safeSaveTrackingCredentials(sessionToken, data.id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
      }
    }
    fetchMe();
  }, []);

  const handleLogout = async () => {
    try {
      // Disable driver status on native side before logout
      await safeSetDriverStatus(false);

      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.refresh();
        router.push('/login');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (user && user.role === 'admin') {
    // Admins use the sidebar, return kids layout
    return <div className="min-h-screen bg-slate-50 flex flex-col">{children}</div>;
  }

  const activeUser = user || { full_name: 'Worker', email: '', role: 'worker' as const };

  // Define tabs based on role
  const roleTabs: Record<string, Array<{ name: string; href: string; icon: any }>> = {
    manager: [
      { name: 'Home', href: '/dashboard', icon: Home },
    ],
    supervisor: [
      { name: 'Home', href: '/dashboard', icon: Home },
    ],
    worker: [
      { name: 'Home', href: '/dashboard', icon: Home },
    ],
  };

  const tabs = roleTabs[activeUser.role] || [];

  if (isPipMode) {
    return <div className="fixed inset-0 w-screen h-screen bg-white z-[99999]">{children}</div>;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f4f2f8] w-full">
      {/* Desktop Sidebar (Only visible on md and up) */}
      <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 bg-[#090A0F] text-zinc-100 border-r border-zinc-800/80 shadow-2xl flex-shrink-0 z-30 justify-between">
        <div>
          {/* Brand Header */}
          <div className="flex items-center justify-between px-6 py-6 border-b border-zinc-800/80 gap-2">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Logo" className="w-9 h-9 object-contain rounded-xl" />
              <div>
                <h1 className="font-extrabold text-sm tracking-wide text-white leading-none">NaviGuard</h1>
                <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest block mt-1">{activeUser.role} Portal</span>
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="pl-4 pr-3 py-6 space-y-1.5">
            {tabs.map((tab) => {
              const [tabPath, tabQuery] = tab.href.split('?');
              const searchParams = new URLSearchParams(tabQuery || '');
              const tabQueryParam = searchParams.get('tab') || '';
              const isActive = pathname === tabPath && currentTab === tabQueryParam;
              return (
                <Link
                  key={tab.name}
                  href={tab.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-300',
                    isActive
                      ? 'active-nav-item ml-[-16px] pl-8 rounded-l-none rounded-r-full z-10'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60 rounded-xl'
                  )}
                >
                  <tab.icon className="w-5 h-5 flex-shrink-0" />
                  {tab.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Desktop SOS Trigger & Footer Profile & Sign out */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/40">
          <div className="mb-4">
            <SosTriggerButton userRole={activeUser.role} className="w-full" />
          </div>
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex items-center justify-center w-8 h-8 bg-zinc-800 rounded-full text-white font-bold text-xs">
              {activeUser.full_name ? activeUser.full_name[0] : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate text-white leading-none">{activeUser.full_name}</p>
              <span className="text-[9px] text-zinc-400 font-mono block mt-1 truncate">{activeUser.email}</span>
            </div>
          </div>

          {showDownloadBtn && (
            <a
              href="/NaviGuard.apk"
              download
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 mb-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-zinc-300 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800 transition-all duration-300 no-underline text-center cursor-pointer"
            >
              📥 Download Mobile App
            </a>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-zinc-300 border border-zinc-800 bg-zinc-900/40 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50 transition-all duration-300 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Pane Wrapper */}
      <div className="flex-1 flex flex-col min-h-screen relative overflow-hidden">
        {/* Global Emergency SOS Real-time Listener & Siren */}
        <EmergencyAlertListener currentUserRole={activeUser.role} currentUserId={activeUser.id} />

        {/* Mobile Header */}
        <header className={cn(
          "md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 transition-all duration-300 text-white w-full",
          isScrolled 
            ? "bg-[#090A0F]/85 backdrop-blur-lg shadow-lg border-b border-zinc-800" 
            : "bg-[#090A0F] border-b border-zinc-800/80 shadow-md"
        )}>
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Logo" className="w-7 h-7 object-contain rounded-lg" />
            <span className="font-extrabold text-sm tracking-wide">NaviGuard</span>
          </div>

          <div className="flex items-center gap-2 relative">
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700 transition-all cursor-pointer text-xs leading-none shadow-sm"
                title="Download App"
              >
                📥
              </a>
            )}
            
            {/* User Profile Avatar Trigger Button */}
            <button
              onClick={() => setShowProfileMenu((prev) => !prev)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-tr from-[#5c3b99] to-[#794ed4] text-white font-black text-xs border border-purple-400/40 shadow-sm cursor-pointer active:scale-95 transition-transform"
              title="Profile menu"
            >
              {activeUser.full_name ? activeUser.full_name[0].toUpperCase() : 'U'}
            </button>

            {/* Header Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs" 
                  onClick={() => setShowProfileMenu(false)}
                />
                <div className="absolute right-0 top-10 w-56 bg-white rounded-2xl shadow-2xl py-2 z-50 border border-slate-200/80 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-extrabold text-purple-700 uppercase tracking-widest">{activeUser.role}</p>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{activeUser.full_name}</p>
                    <p className="text-[11px] text-slate-500 truncate font-mono mt-0.5">{activeUser.email}</p>
                  </div>
                  <div className="p-1">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left text-xs text-red-600 hover:bg-red-50 rounded-xl font-bold transition cursor-pointer"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className={cn(
          "flex-1 overflow-y-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 w-full max-w-5xl mx-auto animate-in fade-in duration-300",
          tabs.length > 1 ? "pb-24 md:pb-6" : "pb-8 md:pb-6"
        )}>
          {children}
        </main>

        {/* Floating Mobile Bottom Navigation Bar (Only if multiple tabs) */}
        {tabs.length > 1 && (
          <nav className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-white/90 backdrop-blur-md border border-slate-150/80 py-2 px-6 flex items-center justify-around rounded-3xl shadow-[0_10px_30px_-5px_rgba(0,0,0,0.1)] z-30">
            {tabs.map((tab) => {
              const [tabPath, tabQuery] = tab.href.split('?');
              const searchParams = new URLSearchParams(tabQuery || '');
              const tabQueryParam = searchParams.get('tab') || '';
              const isActive = pathname === tabPath && currentTab === tabQueryParam;
              return (
                <Link
                  key={tab.name}
                  href={tab.href}
                  className={cn(
                    'flex flex-col items-center gap-1.5 py-1 px-4 rounded-xl transition-all duration-300',
                    isActive ? 'text-zinc-900 font-bold scale-105' : 'text-slate-400 hover:text-slate-650'
                  )}
                >
                  <tab.icon className={cn('w-5.5 h-5.5 transition-transform duration-300', isActive ? 'text-zinc-900 scale-110' : 'text-slate-400')} />
                  <span className="text-[9px] tracking-wider uppercase font-bold">{tab.name}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
export default BottomNav;
