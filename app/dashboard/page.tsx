import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';

const AdminDashboardView = dynamic(() => import('@/components/dashboard/AdminDashboardView'), {
  loading: () => <DashboardLoader />,
});
const ManagerDashboardView = dynamic(() => import('@/components/dashboard/ManagerDashboardView'), {
  loading: () => <DashboardLoader />,
});
const SupervisorDashboardView = dynamic(() => import('@/components/dashboard/SupervisorDashboardView'), {
  loading: () => <DashboardLoader />,
});
const WorkerDashboardView = dynamic(() => import('@/components/dashboard/WorkerDashboardView'), {
  loading: () => <DashboardLoader />,
});

function DashboardLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
      <p className="text-slate-500 font-bold text-sm">Loading view module...</p>
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{ tab?: string; view?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const tab = resolvedParams.tab || '';
  const requestedView = resolvedParams.view || '';

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  let userRole = user.user_metadata?.role;
  let isActive = user.user_metadata?.is_active ?? true;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profile) {
    userRole = profile.role;
    isActive = profile.is_active;
  }

  if (!userRole || !isActive) {
    redirect('/login');
  }

  // Role Hierarchy View Switcher:
  // Admin: can view 'admin', 'manager', 'supervisor', 'worker'
  // Manager: can view 'manager', 'supervisor', 'worker'
  // Supervisor: can view 'supervisor', 'worker'
  // Worker: can view 'worker'
  let effectiveRole = userRole;
  if (requestedView) {
    if (userRole === 'admin' && ['admin', 'manager', 'supervisor', 'worker'].includes(requestedView)) {
      effectiveRole = requestedView;
    } else if (userRole === 'manager' && ['manager', 'supervisor', 'worker'].includes(requestedView)) {
      effectiveRole = requestedView;
    } else if (userRole === 'supervisor' && ['supervisor', 'worker'].includes(requestedView)) {
      effectiveRole = requestedView;
    }
  }

  // Render correct dashboard view wrapped in the appropriate layout, passing search params
  switch (effectiveRole) {
    case 'admin':
      return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-[#090A0F] text-zinc-100 w-full">
          <Sidebar />
          <main className="flex-1 min-w-0 p-4 lg:p-8 overflow-y-auto lg:h-screen bg-[#090A0F]">
            <AdminDashboardView tab={tab} />
          </main>
        </div>
      );
    case 'manager':
      return (
        <BottomNav>
          <ManagerDashboardView tab={tab} />
        </BottomNav>
      );
    case 'supervisor':
      return (
        <BottomNav>
          <SupervisorDashboardView tab={tab} />
        </BottomNav>
      );
    case 'worker':
      return (
        <BottomNav>
          <WorkerDashboardView tab={tab} />
        </BottomNav>
      );
    default:
      redirect('/login');
  }
}
