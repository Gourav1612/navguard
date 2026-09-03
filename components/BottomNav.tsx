'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Map, ClipboardList, Bell, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Capacitor } from '@capacitor/core';
import { safeSetDriverStatus } from '@/lib/capacitor-plugins';
import { PortalSwitcher } from '@/components/PortalSwitcher';

interface UserProfile {
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
          
          // Set driver status on native client for all tracked roles
          await safeSetDriverStatus(data.role === 'worker' || data.role === 'supervisor' || data.role === 'manager');
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
            <PortalSwitcher />
          </div>

          {/* Nav Links */}
          <nav className="pl-4 pr-3 py-6 space-y-1.5">
            {tabs.map((tab) => {
              const tabUrl = new URL(tab.href, 'http://localhost');
              const tabQueryParam = tabUrl.searchParams.get('tab') || '';
              const isActive = pathname === tabUrl.pathname && currentTab === tabQueryParam;
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

        {/* Footer Profile & Sign out */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/40">
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
        {/* Mobile Header */}
        <header className={cn(
          "md:hidden sticky top-0 z-30 flex items-center justify-between px-6 py-4 transition-all duration-300 text-white w-full",
          isScrolled 
            ? "bg-[#090A0F]/85 backdrop-blur-lg shadow-lg border-b border-zinc-800" 
            : "bg-[#090A0F] border-b border-zinc-800/80 shadow-md"
        )}>
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Logo" className="w-8 h-8 object-contain rounded-lg" />
            <span className="font-extrabold text-sm tracking-wide">NaviGuard</span>
          </div>
          <div className="flex items-center gap-2">
            <PortalSwitcher />
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 text-white border border-zinc-700 transition-all cursor-pointer text-xs leading-none shadow-sm"
                title="Download App"
              >
                📥
              </a>
            )}
            
            {/* Header Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowProfileMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl py-1 z-50 border border-slate-100 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-[#f6f5fa]">
                    <p className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">{activeUser.role}</p>
                    <p className="text-sm font-bold text-slate-800 truncate mt-0.5">{activeUser.full_name}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm text-red-650 hover:bg-red-50/50 font-bold transition cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 pb-24 md:pb-6 overflow-y-auto px-4 lg:px-8 pt-6 w-full max-w-5xl mx-auto animate-in fade-in duration-300">
          {children}
        </main>

        {/* Floating Mobile Bottom Navigation Bar (Hidden on md and up) */}
        <nav className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-white/90 backdrop-blur-md border border-slate-150/80 py-2 px-6 flex items-center justify-around rounded-3xl shadow-[0_10px_30px_-5px_rgba(0,0,0,0.1)] z-30">
          {tabs.map((tab) => {
            const tabUrl = new URL(tab.href, 'http://localhost');
            const tabQueryParam = tabUrl.searchParams.get('tab') || '';
            const isActive = pathname === tabUrl.pathname && currentTab === tabQueryParam;
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
      </div>
    </div>
  );
}
export default BottomNav;
