'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Building,
  Users,
  FileText,
  LogOut,
  Menu,
  X,
  Lock,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Capacitor } from '@capacitor/core';
import { safeSetDriverStatus } from '@/lib/capacitor-plugins';

interface UserProfile {
  full_name: string;
  email: string;
  role: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createBrowserSupabaseClient();
  const currentTab = searchParams.get('tab') || '';
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [checkingMfa, setCheckingMfa] = useState(true);
  const [showDownloadBtn, setShowDownloadBtn] = useState(false);

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
    async function checkMfaAndFetchMe() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data);
          
          await safeSetDriverStatus(false);
          
          if (data.role === 'admin') {
            try {
              const { data: factors } = await supabase.auth.mfa.listFactors();
              const activeTotp = factors?.all?.find(
                (f: any) => f.factor_type === 'totp' && f.status === 'verified'
              );
              const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
              
              if (!activeTotp || mfaData?.currentLevel !== 'aal2') {
                setMfaVerified(false);
              } else {
                setMfaVerified(true);
              }
            } catch (e) {
              setMfaVerified(false);
            }
          } else {
            setMfaVerified(true);
          }
        }
      } catch (err) {
        console.error('Failed to fetch user in sidebar:', err);
        setMfaVerified(false);
      } finally {
        setCheckingMfa(false);
      }
    }
    checkMfaAndFetchMe();
  }, [supabase]);

  const handleLogout = async () => {
    try {
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

  const isLocked =
    pathname === '/admin/mfa-setup' ||
    pathname === '/login/mfa-challenge' ||
    (user?.role === 'admin' && !mfaVerified);

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Plants', href: '/dashboard?tab=plants', icon: Building },
    { name: 'Users', href: '/dashboard?tab=users', icon: Users },
    { name: 'Audit Logs', href: '/dashboard?tab=audit-logs', icon: FileText },
    { name: 'Settings', href: '/dashboard?tab=settings', icon: Settings },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#090A0F] text-zinc-100 border-r border-zinc-800/80 shadow-2xl">
      {/* Brand Header */}
      <div className="flex flex-col gap-3 px-6 py-5 border-b border-zinc-800/80">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Logo" className="w-8 h-8 object-contain rounded-xl" />
          <div>
            <h1 className="font-extrabold text-sm tracking-wide leading-none text-white">NaviGuard</h1>
            <span className="text-[9px] text-zinc-400 font-mono uppercase tracking-widest block mt-1">Workforce Command</span>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 pl-4 pr-3 py-6 space-y-1.5 overflow-y-auto">
        {!checkingMfa ? (
          navItems.map((item) => {
            const [itemPath, itemQuery] = item.href.split('?');
            const itemQueryParam = new URLSearchParams(itemQuery || '').get('tab') || '';
            const isActive = !isLocked && pathname === itemPath && currentTab === itemQueryParam;

            if (isLocked) {
              return (
                <div
                  key={item.name}
                  title="MFA Security Hardening Active: Setup/Verify MFA to unlock nav options"
                  className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-600 opacity-40 cursor-not-allowed select-none rounded-xl bg-zinc-950/20 border border-zinc-900/50"
                >
                  <item.icon className="w-5 h-5 flex-shrink-0 text-zinc-600" />
                  <span>{item.name}</span>
                  <Lock className="w-3.5 h-3.5 text-zinc-500 ml-auto flex-shrink-0" />
                </div>
              );
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={(e) => {
                  setIsMobileOpen(false);
                  e.preventDefault();
                  const [targetPath, targetQuery] = item.href.split('?');
                  const tabVal = new URLSearchParams(targetQuery || '').get('tab') || '';
                  const finalPath = tabVal ? `/dashboard?tab=${tabVal}` : '/dashboard';
                  window.history.pushState(null, '', finalPath);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-300',
                  isActive
                    ? 'bg-zinc-900 text-white font-semibold border-l-2 border-white ml-[-16px] pl-8 rounded-l-none rounded-r-xl'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900/40 rounded-xl'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {item.name}
              </Link>
            );
          })
        ) : (
          <div className="space-y-3 px-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-zinc-900 animate-pulse rounded-xl" />
            ))}
          </div>
        )}
      </nav>

      {/* User Footer Profile & Sign out */}
      <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/50">
        {user ? (
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex items-center justify-center w-9 h-9 bg-zinc-900 border border-zinc-800 rounded-full text-white shadow-sm font-bold text-sm">
              {user.full_name ? user.full_name.charAt(0) : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate leading-none text-white">
                {user.full_name || 'User'}
              </p>
              <span className="text-[10px] text-zinc-400 font-mono block mt-1.5 truncate">
                {user.email}
              </span>
            </div>
          </div>
        ) : (
          <div className="h-9 mb-4 animate-pulse bg-zinc-900 rounded-lg"></div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-300 border border-zinc-800 bg-zinc-900/40 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50 transition-all duration-300 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Navbar */}
      <div className={cn(
        "lg:hidden sticky top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 transition-all duration-300 text-white",
        isScrolled 
          ? "bg-[#090A0F]/85 backdrop-blur-lg shadow-lg border-b border-zinc-800" 
          : "bg-[#090A0F] border-b border-zinc-800/80"
      )}>
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Logo" className="w-8 h-8 object-contain rounded-lg" />
          <span className="font-extrabold text-sm tracking-wide">NaviGuard</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-1 rounded-md text-white hover:bg-zinc-800 focus:outline-none cursor-pointer transition-all"
        >
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar Desktop Container */}
      <aside className="hidden lg:block w-64 h-screen sticky top-0 flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Dark backdrop overlay when mobile dropdown is open */}
      {isMobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-xs z-30 transition-all"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Mobile Overlay Menu */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-x-0 top-[64px] bg-[#090A0F]/95 backdrop-blur-md border-b border-zinc-800 shadow-2xl z-40 animate-in slide-in-from-top duration-300 overflow-hidden flex flex-col p-5 space-y-4">
          <nav className="space-y-1">
            {!checkingMfa ? (
              navItems.map((item) => {
                const [itemPath, itemQuery] = item.href.split('?');
                const itemQueryParam = new URLSearchParams(itemQuery || '').get('tab') || '';
                const isActive = !isLocked && pathname === itemPath && currentTab === itemQueryParam;

                if (isLocked) {
                  return (
                    <div
                      key={item.name}
                      title="MFA Security Hardening Active: Setup/Verify MFA to unlock nav options"
                      className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-zinc-600 opacity-40 cursor-not-allowed select-none rounded-xl bg-zinc-950/20 border border-zinc-900/50"
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0 text-zinc-600" />
                      <span>{item.name}</span>
                      <Lock className="w-3.5 h-3.5 text-zinc-500 ml-auto flex-shrink-0" />
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={(e) => {
                      setIsMobileOpen(false);
                      e.preventDefault();
                      const [targetPath, targetQuery] = item.href.split('?');
                      const tabVal = new URLSearchParams(targetQuery || '').get('tab') || '';
                      const finalPath = tabVal ? `/dashboard?tab=${tabVal}` : '/dashboard';
                      window.history.pushState(null, '', finalPath);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-300 rounded-xl',
                      isActive
                        ? 'bg-zinc-900 text-white border-l-2 border-white pl-4'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-900/40'
                    )}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {item.name}
                  </Link>
                );
              })
            ) : (
              <div className="space-y-2.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-9 bg-zinc-900 animate-pulse rounded-lg" />
                ))}
              </div>
            )}
          </nav>
          
          {/* User Footer Profile & Sign out inside dropdown */}
          <div className="pt-4 border-t border-zinc-800/80 flex flex-col gap-4">
            {user && (
              <div className="flex items-center gap-3 px-2">
                <div className="flex items-center justify-center w-8 h-8 bg-zinc-900 border border-zinc-800 rounded-full text-white shadow-sm font-bold text-sm">
                  {user.full_name ? user.full_name.charAt(0) : 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate leading-none text-white">{user.full_name || 'User'}</p>
                  <span className="text-[10px] text-zinc-400 font-mono block mt-1 truncate">{user.email}</span>
                </div>
              </div>
            )}
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-300 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/80 transition-all duration-300 no-underline text-center cursor-pointer"
              >
                📥 Download Mobile App
              </a>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-300 border border-zinc-800 hover:bg-red-955/30 hover:text-red-300 hover:border-red-900/50 transition-all duration-300 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export default Sidebar;
