import Sidebar from '@/components/Sidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 p-4 lg:p-8 overflow-y-auto lg:h-screen">
        {children}
      </main>
    </div>
  );
}
