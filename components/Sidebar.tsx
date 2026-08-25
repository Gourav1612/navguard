'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Building,
  Shield,
  Users,
  FileText,
  LogOut,
  User,
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
          
          // Admins should not have PiP enabled
          await safeSetDriverStatus(false);
          
          if (data.role === 'admin') {
            const { data: mfaData, error: mfaErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (!mfaErr && mfaData) {
              const { currentLevel, nextLevel } = mfaData;
              // Admin must be AAL2 (or have no MFA enrolled) to view sidebar links
              if (currentLevel === 'aal2' || nextLevel === 'aal1') {
                setMfaVerified(true);
              } else {
                setMfaVerified(false);
              }
            } else {
              setMfaVerified(true);
            }
          } else {
            // Non-admin roles don't have mandatory MFA
            setMfaVerified(true);
          }
        }
      } catch (err) {
        console.error('Failed to verify MFA in sidebar:', err);
        setMfaVerified(true);
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

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Plants', href: '/dashboard?tab=plants', icon: Building },
    { name: 'Users', href: '/dashboard?tab=users', icon: Users },
    { name: 'Audit Logs', href: '/dashboard?tab=audit-logs', icon: FileText },
    { name: 'Settings', href: '/dashboard?tab=settings', icon: Settings },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#351e56] to-[#1a0e2b] text-slate-100 border-r border-[#2d194a] shadow-2xl">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-[#2d194a]/60">
        <img src="/logo.png" alt="Logo" className="w-10 h-10 object-contain bg-white/5 border border-white/10 rounded-xl p-1" />
        <div>
          <h1 className="font-extrabold text-base tracking-wide leading-none text-white">NaviGuard</h1>
          <span className="text-[9px] text-purple-300 font-bold uppercase tracking-widest block mt-1">Workforce Command</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 pl-4 pr-3 py-6 space-y-1.5 overflow-y-auto">
        {!checkingMfa && !mfaVerified ? (
          <div className="flex flex-col items-center justify-center p-6 text-center h-[260px] space-y-3 bg-black/10 border border-white/5 rounded-2xl mx-2">
            <Lock className="w-8 h-8 text-purple-300 animate-pulse" />
            <p className="text-xs font-bold text-white leading-normal">
              MFA Security Locked
            </p>
            <p className="text-[10px] text-purple-200/50 leading-relaxed max-w-[160px] mx-auto">
              Please complete verification to unlock navigation.
            </p>
            <Link
              href="/login/mfa-challenge"
              className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/30 text-purple-200 rounded-xl text-[11px] font-bold transition-all no-underline mt-2"
            >
              Verify MFA Code
            </Link>
          </div>
        ) : !checkingMfa && mfaVerified ? (
          navItems.map((item) => {
            const itemUrl = new URL(item.href, 'http://localhost');
            const itemQueryParam = itemUrl.searchParams.get('tab') || '';
            const isActive = pathname === itemUrl.pathname && currentTab === itemQueryParam;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={(e) => {
                  setIsMobileOpen(false);
                  e.preventDefault();
                  const targetUrl = new URL(item.href, window.location.origin);
                  const tabVal = targetUrl.searchParams.get('tab') || '';
                  const finalPath = tabVal ? `/dashboard?tab=${tabVal}` : '/dashboard';
                  window.history.pushState(null, '', finalPath);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-300',
                  isActive
                    ? 'active-nav-item ml-[-16px] pl-8 rounded-l-none rounded-r-full z-10'
                    : 'text-purple-200/80 hover:text-white hover:bg-white/5 rounded-xl'
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
              <div key={i} className="h-10 bg-white/5 animate-pulse rounded-xl" />
            ))}
          </div>
        )}
      </nav>

      {/* User Footer Profile & Sign out */}
      <div className="p-4 border-t border-[#2d194a]/60 bg-black/10">
        {user ? (
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex items-center justify-center w-9 h-9 bg-white/10 border border-white/10 rounded-full text-white shadow-sm font-bold text-sm">
              {user.full_name ? user.full_name.charAt(0) : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate leading-none text-white">
                {user.full_name || 'User'}
              </p>
              <span className="text-[10px] text-purple-300/70 font-mono block mt-1.5 truncate">
                {user.email}
              </span>
            </div>
          </div>
        ) : (
          <div className="h-9 mb-4 animate-pulse bg-white/5 rounded-lg"></div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-purple-200 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/20 transition-all duration-300"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Navbar (visible only on mobile screen widths, sticks and blurs on scroll) */}
      <div className={cn(
        "lg:hidden sticky top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 transition-all duration-300 text-white",
        isScrolled 
          ? "bg-[#130b24]/75 backdrop-blur-lg shadow-lg border-b border-purple-500/15" 
          : "bg-[#351e56] border-b border-[#2d194a]/60"
      )}>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain bg-white/5 border border-white/10 rounded-lg p-0.5" />
          <span className="font-extrabold text-sm tracking-wide">NaviGuard</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-1 rounded-md text-white hover:bg-white/10 focus:outline-none cursor-pointer transition-all"
        >
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar Desktop Container */}
      <aside className="hidden lg:block w-60 h-screen sticky top-0 flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Dark backdrop overlay when mobile dropdown is open */}
      {isMobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/45 backdrop-blur-2xs z-30 transition-all"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Mobile Overlay Menu (Dropdown sliding down from top navbar) */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-x-0 top-[64px] bg-[#351e56]/95 backdrop-blur-md border-b border-[#2d194a] shadow-2xl z-40 animate-in slide-in-from-top duration-300 overflow-hidden flex flex-col p-5 space-y-4">
          <nav className="space-y-1">
            {!checkingMfa && !mfaVerified ? (
              <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 bg-black/10 border border-white/5 rounded-xl py-8">
                <Lock className="w-6 h-6 text-purple-300 animate-pulse" />
                <p className="text-xs font-bold text-white">MFA Security Locked</p>
                <p className="text-[10px] text-purple-200/50 leading-relaxed max-w-[200px]">
                  Please complete verification to unlock features.
                </p>
              </div>
            ) : !checkingMfa && mfaVerified ? (
              navItems.map((item) => {
                const itemUrl = new URL(item.href, 'http://localhost');
                const itemQueryParam = itemUrl.searchParams.get('tab') || '';
                const isActive = pathname === itemUrl.pathname && currentTab === itemQueryParam;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={(e) => {
                      setIsMobileOpen(false);
                      e.preventDefault();
                      const targetUrl = new URL(item.href, window.location.origin);
                      const tabVal = targetUrl.searchParams.get('tab') || '';
                      const finalPath = tabVal ? `/dashboard?tab=${tabVal}` : '/dashboard';
                      window.history.pushState(null, '', finalPath);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-300 rounded-xl',
                      isActive
                        ? 'bg-white/10 text-white border-l-4 border-purple-400 pl-3'
                        : 'text-purple-200/80 hover:text-white hover:bg-white/5'
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
                  <div key={i} className="h-9 bg-white/5 animate-pulse rounded-lg" />
                ))}
              </div>
            )}
          </nav>
          
          {/* User Footer Profile & Sign out inside dropdown */}
          <div className="pt-4 border-t border-[#2d194a]/60 flex flex-col gap-4">
            {user && (
              <div className="flex items-center gap-3 px-2">
                <div className="flex items-center justify-center w-8 h-8 bg-white/10 border border-white/10 rounded-full text-white shadow-sm font-bold text-sm">
                  {user.full_name ? user.full_name.charAt(0) : 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate leading-none text-white">{user.full_name || 'User'}</p>
                  <span className="text-[10px] text-purple-300/70 font-mono block mt-1 truncate">{user.email}</span>
                </div>
              </div>
            )}
            {showDownloadBtn && (
              <a
                href="/NaviGuard.apk"
                download
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-purple-200 border border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 transition-all duration-300 no-underline text-center cursor-pointer"
              >
                📥 Download Mobile App
              </a>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-purple-200 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/20 transition-all duration-300 cursor-pointer"
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
