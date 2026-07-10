'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldAlert, History, Activity, Terminal } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/utils';

export default function AdminAuditLogs() {
  const { data: logs = [], isLoading, error } = useQuery({
    queryKey: ['admin-audit-logs'],
    queryFn: async () => {
      const supabase = createBrowserSupabaseClient();
      
      const { data, error: queryErr } = await supabase
        .from('audit_logs')
        .select(`
          id,
          action,
          table_name,
          record_id,
          ip_address,
          created_at,
          user:user_profiles(full_name, email)
        `)
        .order('created_at', { ascending: false })
        .limit(100); // Limit to latest 100 entries for performance

      if (queryErr) throw queryErr;
      
      // Map to normalize user fields
      return (data || []).map((log: any) => {
        const userObj = Array.isArray(log.user) ? log.user[0] : log.user;
        return {
          ...log,
          user: userObj || null,
        };
      });
    },
    refetchInterval: 20000, // Poll logs every 20s
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Compiling audit trials...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-sm mx-auto space-y-4">
        <ShieldAlert className="w-14 h-14 text-red-500" />
        <h3 className="text-sm font-bold text-slate-800">Permission Check Failed</h3>
        <p className="text-slate-500 text-xs">
          Verify that your administrator session is authenticated and RLS database triggers are active.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">System Audit Logs</h2>
        <p className="text-slate-500 text-sm font-medium">Review operational logs, account mutations, database updates, and tracking events.</p>
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Action Event</th>
                <th className="px-6 py-4">Database Table</th>
                <th className="px-6 py-4">Target ID</th>
                <th className="px-6 py-4">Executing Operator</th>
                <th className="px-6 py-4">IP Address</th>
                <th className="px-6 py-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No system audit logs found in database.
                  </td>
                </tr>
              ) : (
                logs.map((log: any) => {
                  // Style badge based on DB transaction type
                  let actionColor = 'bg-slate-100 text-slate-700';
                  if (log.action === 'INSERT' || log.action === 'CREATE') actionColor = 'bg-emerald-50 text-emerald-800 border-emerald-100';
                  else if (log.action === 'UPDATE') actionColor = 'bg-blue-50 text-blue-800 border-blue-100';
                  else if (log.action === 'DELETE') actionColor = 'bg-rose-50 text-rose-800 border-rose-100';
                  else if (log.action === 'LOGIN') actionColor = 'bg-purple-50 text-purple-800 border-purple-100';

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/30 transition duration-150 font-medium">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${actionColor}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-slate-500 flex items-center gap-1.5 mt-2">
                        <Terminal className="w-3.5 h-3.5 text-slate-400" />
                        {log.table_name || 'auth'}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-slate-400 truncate max-w-[120px]">{log.record_id || '—'}</td>
                      <td className="px-6 py-4">
                        {log.user ? (
                          <div>
                            <div className="font-bold text-slate-800">{log.user.full_name}</div>
                            <div className="text-[10px] text-slate-400 leading-none mt-0.5">{log.user.email}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-xs">System Task / Trigger</span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{log.ip_address || '127.0.0.1'}</td>
                      <td className="px-6 py-4 text-slate-500 text-xs">{formatDateTime(log.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
