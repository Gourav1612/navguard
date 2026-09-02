'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, Building, Users, UserCheck, ChevronDown, Eye } from 'lucide-react';

interface PortalOption {
  key: string;
  label: string;
  roleRequired: string;
  icon: any;
  color: string;
}

export function PortalSwitcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentView = searchParams.get('view') || '';
  
  const [userRole, setUserRole] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function fetchUserRole() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUserRole(data.role);
        }
      } catch (err) {
        console.error('Failed to fetch role for portal switcher:', err);
      }
    }
    fetchUserRole();
  }, []);

  if (!userRole) return null;

  // Determine allowed portals based on role hierarchy
  const allPortals: PortalOption[] = [
    { key: 'admin', label: 'Admin Command Center', roleRequired: 'admin', icon: Shield, color: 'text-red-500 bg-red-50' },
    { key: 'manager', label: 'Plant Manager Portal', roleRequired: 'manager', icon: Building, color: 'text-purple-600 bg-purple-50' },
    { key: 'supervisor', label: 'Supervisor Portal', roleRequired: 'supervisor', icon: Users, color: 'text-amber-600 bg-amber-50' },
    { key: 'worker', label: 'Worker Portal', roleRequired: 'worker', icon: UserCheck, color: 'text-blue-600 bg-blue-50' },
  ];

  let allowedPortals: PortalOption[] = [];
  if (userRole === 'admin') {
    allowedPortals = allPortals;
  } else if (userRole === 'manager') {
    allowedPortals = allPortals.filter((p) => p.key !== 'admin');
  } else if (userRole === 'supervisor') {
    allowedPortals = allPortals.filter((p) => p.key === 'supervisor' || p.key === 'worker');
  } else {
    // Workers only have worker portal
    return null;
  }

  // Active view defaults to user's native role if not specified in search params
  const activeKey = currentView || userRole;
  const currentOption = allPortals.find((p) => p.key === activeKey) || allowedPortals[0];

  const handleSelect = (key: string) => {
    setOpen(false);
    if (key === userRole) {
      router.push('/dashboard');
    } else {
      router.push(`/dashboard?view=${key}`);
    }
  };

  return (
    <div className="relative w-full text-left z-50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-100 transition shadow-sm cursor-pointer"
        title="Switch Portal View"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
          <span className="truncate text-zinc-300 font-medium">View:</span>
          <span className="font-extrabold truncate text-white">{currentOption.label}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 mt-2 w-full bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="px-3.5 py-2 bg-zinc-950 border-b border-zinc-800">
              <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider block">
                SWITCH PORTAL VIEW
              </span>
              <span className="text-[10px] text-zinc-400 font-medium block mt-0.5">
                Role: <strong className="uppercase text-white">{userRole}</strong>
              </span>
            </div>

            <div className="p-1 space-y-1">
              {allowedPortals.map((portal) => {
                const IconComponent = portal.icon;
                const isSelected = portal.key === activeKey;

                return (
                  <button
                    key={portal.key}
                    onClick={() => handleSelect(portal.key)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left rounded-lg text-xs font-bold transition cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-800 text-white border border-zinc-700'
                        : 'text-zinc-300 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300">
                        <IconComponent className="w-3.5 h-3.5" />
                      </div>
                      <span className="truncate">{portal.label}</span>
                    </div>
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white flex-shrink-0"></span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default PortalSwitcher;
