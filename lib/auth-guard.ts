import { createSupabaseServerClient } from './supabase/server';
import { NextResponse } from 'next/server';

export async function requireRole(allowedRoles: string[]) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized session', code: 'UNAUTHORIZED' },
        { status: 401 }
      ),
    };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, role, school_id, is_active, full_name, email')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return {
      error: NextResponse.json(
        { error: 'Profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      ),
    };
  }

  if (!profile.is_active) {
    return {
      error: NextResponse.json(
        { error: 'Account disabled', code: 'FORBIDDEN' },
        { status: 403 }
      ),
    };
  }

  if (!allowedRoles.includes(profile.role)) {
    return {
      error: NextResponse.json(
        { error: 'Access denied: forbidden role', code: 'FORBIDDEN' },
        { status: 403 }
      ),
    };
  }

  return { user, profile };
}
export default requireRole;
