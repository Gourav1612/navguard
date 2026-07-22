import { createSupabaseServerClient } from './supabase/server';
import { NextResponse } from 'next/server';

export async function requireRole(allowedRoles: string[], options?: { skipMfa?: boolean }) {
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

  // MFA check for admin API requests (unless explicitly skipped e.g. for login/otp endpoints)
  if (profile.role === 'admin' && !options?.skipMfa) {
    const { data: mfaData, error: mfaErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!mfaErr && mfaData) {
      const { currentLevel, nextLevel } = mfaData;
      if (nextLevel === 'aal2' && currentLevel === 'aal1') {
        return {
          error: NextResponse.json(
            { error: 'Multi-factor authentication challenge required', code: 'MFA_REQUIRED' },
            { status: 401 }
          ),
        };
      }
      if (nextLevel === 'aal1') {
        return {
          error: NextResponse.json(
            { error: 'Multi-factor authentication enrollment required', code: 'MFA_SETUP_REQUIRED' },
            { status: 401 }
          ),
        };
      }
    }
  }

  return { user, profile };
}
export default requireRole;
