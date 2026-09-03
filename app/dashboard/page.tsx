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
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6 animate-pulse">
      <div className="h-8 bg-slate-200 rounded-xl w-1/4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="h-28 bg-slate-200 rounded-2xl" />
        <div className="h-28 bg-slate-200 rounded-2xl" />
        <div className="h-28 bg-slate-200 rounded-2xl" />
        <div className="h-28 bg-slate-200 rounded-2xl" />
      </div>
      <div className="h-96 bg-slate-200 rounded-2xl" />
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const tab = resolvedParams.tab || '';

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

  if (!userRole) {
    redirect('/login');
  }

  // Render correct dashboard view wrapped in the appropriate layout, passing search params
  switch (userRole) {
    case 'admin':
      return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-[#f4f2f8] w-full">
          <Sidebar />
          <main className="flex-1 min-w-0 p-4 lg:p-8 overflow-y-auto lg:h-screen">
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
