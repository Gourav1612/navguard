'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Bus,
  Map,
  Shield,
  Users,
  UserCheck,
  Compass,
  FileText,
  LogOut,
  User,
  Menu,
  X,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserProfile {
  full_name: string;
  email: string;
  role: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || '';
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

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

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Buses', href: '/dashboard?tab=buses', icon: Bus },
    { name: 'Routes', href: '/dashboard?tab=routes', icon: Map },
    { name: 'Drivers', href: '/dashboard?tab=drivers', icon: UserCheck },
    { name: 'Parents', href: '/dashboard?tab=parents', icon: Users },
    { name: 'Students', href: '/dashboard?tab=students', icon: Users },
    { name: 'Assignments', href: '/dashboard?tab=assignments', icon: Compass },
    { name: 'Import Data', href: '/dashboard?tab=import', icon: Upload },
    { name: 'Audit Logs', href: '/dashboard?tab=audit-logs', icon: FileText },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#351e56] to-[#1a0e2b] text-slate-100 border-r border-[#2d194a] shadow-2xl">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-[#2d194a]/60">
        <div className="flex items-center justify-center w-10 h-10 bg-white/10 rounded-xl text-white font-black text-xl shadow-lg border border-white/10 backdrop-blur-md">
          NG
        </div>
        <div>
          <h1 className="font-extrabold text-base tracking-wide leading-none text-white">NaviGuard AI</h1>
          <span className="text-[9px] text-purple-300 font-bold uppercase tracking-widest block mt-1">Transport Admin</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 pl-4 pr-3 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const itemUrl = new URL(item.href, 'http://localhost');
          const itemQueryParam = itemUrl.searchParams.get('tab') || '';
          const isActive = pathname === itemUrl.pathname && currentTab === itemQueryParam;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setIsMobileOpen(false)}
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
        })}
      </nav>

      {/* User Footer Profile & Sign out */}
      <div className="p-4 border-t border-[#2d194a]/60 bg-black/10">
        {user ? (
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex items-center justify-center w-9 h-9 bg-white/10 border border-white/10 rounded-full text-white shadow-sm font-bold text-sm">
              {user.full_name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate leading-none text-white">
                {user.full_name}
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
      {/* Mobile Top Navbar (visible only on mobile screen widths) */}
      <div className="lg:hidden flex items-center justify-between px-6 py-4 bg-[#351e56] border-b border-[#2d194a]/60 text-slate-100">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 bg-white/10 rounded-lg text-white font-black text-lg border border-white/10">
            NG
          </div>
          <span className="font-extrabold text-sm tracking-wide">NaviGuard AI</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none"
        >
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar Desktop Container */}
      <aside className="hidden lg:block w-60 h-screen sticky top-0 flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Sidebar Mobile Overlay Menu */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="relative w-64 max-w-xs h-full flex flex-col">
            {sidebarContent}
          </div>
          {/* Overlay Click-to-close */}
          <div
            className="flex-1 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
          />
        </div>
      )}
    </>
  );
}
export default Sidebar;
