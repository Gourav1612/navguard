'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';
import { PaginatedResult, ServerActionResponse } from '@/types/pagination';

/**
 * Server Action: Delete Driver by ID
 */
export async function deleteDriverAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: driver } = await adminClient
      .from('drivers')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (!driver) return { success: false, error: 'Driver not found' };

    // 1. Delete associated trips
    await adminClient.from('trips').delete().eq('driver_id', id);

    // 2. Clean up announcements
    await adminClient.from('announcements').delete().eq('created_by', driver.user_id);

    // 3. Delete driver record
    const { error: delErr } = await adminClient.from('drivers').delete().eq('id', id);
    if (delErr) return { success: false, error: delErr.message };

    // 4. Delete auth user
    await adminClient.auth.admin.deleteUser(driver.user_id);

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete driver' };
  }
}

/**
 * Server Action: Delete Bus by ID
 */
export async function deleteBusAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: bus } = await adminClient
      .from('buses')
      .select('id')
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (!bus) return { success: false, error: 'Bus not found' };

    await adminClient.from('routes').update({ bus_id: null }).eq('bus_id', id);
    await adminClient.from('drivers').update({ bus_id: null }).eq('bus_id', id);
    await adminClient.from('student_profiles').update({ bus_id: null, stop_id: null }).eq('bus_id', id);
    await adminClient.from('bus_locations').delete().eq('bus_id', id);
    await adminClient.from('trips').delete().eq('bus_id', id);
    await adminClient.from('announcements').delete().eq('bus_id', id);

    const { error: delErr } = await adminClient.from('buses').delete().eq('id', id);
    if (delErr) return { success: false, error: delErr.message };

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete bus' };
  }
}

/**
 * Server Action: Delete Route by ID
 */
export async function deleteRouteAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: route } = await adminClient
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (!route) return { success: false, error: 'Route not found' };

    await adminClient.from('trips').delete().eq('route_id', id);

    const { data: routeStops } = await adminClient.from('stops').select('id').eq('route_id', id);
    if (routeStops && routeStops.length > 0) {
      const stopIds = routeStops.map((s) => s.id);
      await adminClient.from('student_profiles').update({ stop_id: null }).in('stop_id', stopIds);
    }

    await adminClient.from('stops').delete().eq('route_id', id);
    const { error: delErr } = await adminClient.from('routes').delete().eq('id', id);
    if (delErr) return { success: false, error: delErr.message };

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete route' };
  }
}

/**
 * Server Action: Delete Student by ID
 */
export async function deleteStudentAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: student } = await adminClient
      .from('student_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (!student) return { success: false, error: 'Student not found' };

    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(student.user_id);
    if (authDeleteErr) {
      await adminClient.from('student_profiles').delete().eq('id', id);
    }

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete student' };
  }
}

/**
 * Server Action: Delete Parent by ID
 */
export async function deleteParentAction(id: string): Promise<ServerActionResponse> {
  const auth = await requireRole(['admin']);
  if (auth.error) return { success: false, error: 'Unauthorized' };

  const adminClient = createAdminClient();

  try {
    const { data: parent } = await adminClient
      .from('parent_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (!parent) return { success: false, error: 'Parent not found' };

    await adminClient.from('parent_student_links').delete().eq('parent_id', id);
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(parent.user_id);
    if (authDeleteErr) {
      await adminClient.from('parent_profiles').delete().eq('id', id);
    }

    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete parent' };
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
