'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Map, ClipboardList, Bell, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserProfile {
  full_name: string;
  email: string;
  role: 'driver' | 'parent' | 'student' | 'admin';
}

export function BottomNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || '';
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

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
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
      }
    }
    fetchMe();
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.refresh();
        router.push('/login');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (!user || user.role === 'admin') {
    // Admins use the sidebar, return kids layout
    return <div className="min-h-screen bg-slate-50 flex flex-col">{children}</div>;
  }

  // Define tabs based on role
  const roleTabs: Record<string, Array<{ name: string; href: string; icon: any }>> = {
    driver: [
      { name: 'Home', href: '/dashboard', icon: Home },
      { name: 'Route Map', href: '/dashboard?tab=route', icon: Map },
      { name: 'Trip Tracker', href: '/dashboard?tab=trip', icon: ClipboardList },
    ],
    parent: [
      { name: 'Home', href: '/dashboard', icon: Home },
      { name: 'Alerts', href: '/dashboard?tab=announcements', icon: Bell },
    ],
    student: [
      { name: 'Home', href: '/dashboard', icon: Home },
      { name: 'Live Map', href: '/dashboard?tab=track', icon: Map },
    ],
  };

  const tabs = roleTabs[user.role] || [];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f4f2f8] w-full">
      {/* Desktop Sidebar (Only visible on md and up) */}
      <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 bg-gradient-to-b from-[#351e56] to-[#1a0e2b] text-slate-100 border-r border-[#2d194a]/60 shadow-2xl flex-shrink-0 z-30 justify-between">
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-6 py-6 border-b border-[#2d194a]/60">
            <img src="/logo.png" alt="Logo" className="w-9 h-9 object-contain bg-white/5 border border-white/10 rounded-xl p-1" />
            <div>
              <h1 className="font-extrabold text-sm tracking-wide text-white leading-none">NaviGuard AI</h1>
              <span className="text-[9px] text-purple-300 font-bold uppercase tracking-widest block mt-1">{user.role} Portal</span>
            </div>
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
                      : 'text-purple-200/80 hover:text-white hover:bg-white/5 rounded-xl'
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
        <div className="p-4 border-t border-[#2d194a]/60 bg-black/10">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex items-center justify-center w-8 h-8 bg-white/10 rounded-full text-white font-bold text-xs">
              {user.full_name ? user.full_name[0] : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate text-white leading-none">{user.full_name}</p>
              <span className="text-[9px] text-purple-300/70 font-mono block mt-1 truncate">{user.email}</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-purple-200 border border-white/10 hover:bg-red-500/10 hover:text-red-350 hover:border-red-500/20 transition-all duration-300 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Pane Wrapper */}
      <div className="flex-1 flex flex-col min-h-screen relative overflow-hidden">
        {/* Mobile Header (Hidden on md and up, sticks and blurs on scroll) */}
        <header className={cn(
          "md:hidden sticky top-0 z-30 flex items-center justify-between px-6 py-4 transition-all duration-300 text-white w-full",
          isScrolled 
            ? "bg-[#351e56]/35 backdrop-blur-lg shadow-lg border-b border-purple-500/15" 
            : "bg-gradient-to-r from-[#351e56] to-[#5c3b99] border-b border-transparent shadow-md"
        )}>
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain bg-white/5 border border-white/10 rounded-lg p-0.5" />
            <span className="font-extrabold text-sm tracking-wide">NaviGuard AI</span>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold uppercase text-xs border border-white/10 focus:outline-none transition-all shadow-sm cursor-pointer"
            >
              {user.full_name ? user.full_name[0] : <User className="w-4 h-4" />}
            </button>
            
            {/* Header Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setShowProfileMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl py-1 z-50 border border-slate-100 animate-in fade-in slide-in-from-top-2 duration-150 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-[#f6f5fa]">
                    <p className="text-[10px] font-bold text-purple-650 uppercase tracking-widest">{user.role}</p>
                    <p className="text-sm font-bold text-slate-800 truncate mt-0.5">{user.full_name}</p>
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
                  isActive ? 'text-[#3b255e] font-bold scale-105' : 'text-slate-400 hover:text-slate-650'
                )}
              >
                <tab.icon className={cn('w-5.5 h-5.5 transition-transform duration-300', isActive ? 'text-[#5c3b99] scale-110' : 'text-slate-400')} />
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
