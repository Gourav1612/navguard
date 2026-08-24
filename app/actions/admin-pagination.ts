'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';
import { PaginatedResult, ServerActionResponse } from '@/types/pagination';

/**
 * Server Action: Delete User by ID (Auth + Profile)
 */
export async function deleteUserAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  // Super Admin cannot delete themselves
  if (id === auth.user.id) {
    return { success: false, error: 'Cannot delete your own account' };
  }

  const adminClient = createAdminClient();

  try {
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, role')
      .eq('id', id)
      .maybeSingle();

    if (!profile) return { success: false, error: 'User profile not found' };

    // Delete user from auth.users (Cascade deletes live_locations and user_profiles)
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(id);
    if (authDeleteErr) return { success: false, error: authDeleteErr.message };

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete user' };
  }
}

/**
 * Server Action: Delete Plant by ID
 */
export async function deletePlantAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: plant } = await adminClient
      .from('plants')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (!plant) return { success: false, error: 'Plant not found' };

    // 1. Clear plant_id on user profiles
    await adminClient.from('user_profiles').update({ plant_id: null }).eq('plant_id', id);

    // 2. Clear plant_id on audit logs
    await adminClient.from('audit_logs').update({ plant_id: null }).eq('plant_id', id);

    // 3. Delete the plant
    const { error: delErr } = await adminClient.from('plants').delete().eq('id', id);
    if (delErr) return { success: false, error: delErr.message };

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete plant' };
  }
}

/**
 * Server Action: Fetch Paginated Audit Logs
 */
export async function getPaginatedAuditLogs(page: number = 1, pageSize: number = 10): Promise<PaginatedResult<any>> {
  const auth = await requireRole(['admin']);
  if (auth.error) throw new Error('Unauthorized');

  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from('audit_logs')
    .select(`
      id,
      action,
      table_name,
      record_id,
      ip_address,
      created_at,
      user:user_profiles(full_name, email)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const mapped = (data || []).map((log: any) => {
    const userObj = Array.isArray(log.user) ? log.user[0] : log.user;
    return {
      ...log,
      user: userObj || null,
    };
  });

  const totalCount = count ?? mapped.length;
  return {
    data: mapped,
    count: totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
    pageSize,
  };
}
