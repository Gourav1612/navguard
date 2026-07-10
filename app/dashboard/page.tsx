import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';

const AdminDashboardView = dynamic(() => import('@/components/dashboard/AdminDashboardView'), {
  loading: () => <DashboardLoader />,
});
const ParentDashboardView = dynamic(() => import('@/components/dashboard/ParentDashboardView'), {
  loading: () => <DashboardLoader />,
});
const DriverDashboardView = dynamic(() => import('@/components/dashboard/DriverDashboardView'), {
  loading: () => <DashboardLoader />,
});
const StudentDashboardView = dynamic(() => import('@/components/dashboard/StudentDashboardView'), {
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
  searchParams: Promise<{ tab?: string; busId?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const tab = resolvedParams.tab || '';
  const busId = resolvedParams.busId || '';

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    redirect('/login');
  }

  // Render correct dashboard view wrapped in the appropriate layout, passing search params
  switch (profile.role) {
    case 'admin':
      return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-[#f4f2f8] w-full">
          <Sidebar />
          <main className="flex-1 p-4 lg:p-8 overflow-y-auto lg:h-screen">
            <AdminDashboardView tab={tab} />
          </main>
        </div>
      );
    case 'parent':
      return (
        <BottomNav>
          <ParentDashboardView tab={tab} busId={busId} />
        </BottomNav>
      );
    case 'driver':
      return (
        <BottomNav>
          <DriverDashboardView tab={tab} />
        </BottomNav>
      );
    case 'student':
      return (
        <BottomNav>
          <StudentDashboardView tab={tab} />
        </BottomNav>
      );
    default:
      redirect('/login');
  }
}
