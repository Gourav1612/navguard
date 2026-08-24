import { createSupabaseServerClient } from './supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getAuthenticatedUser(req?: NextRequest) {
  // Check for Bearer token first (used by native Android foreground service)
  const authHeader = req?.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const accessToken = authHeader.substring(7);
    // Validate the JWT with Supabase using anon client
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);
    if (!error && user) {
      return { user, supabase: supabaseAnon, usedBearerToken: true };
    }
  }

  // Fall back to cookie-based Supabase session (web/PWA)
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user: error ? null : user, supabase, usedBearerToken: false };
}

export async function requireRole(allowedRoles: string[], options?: { skipMfa?: boolean }) {
  // Attempt to read the request from Next.js headers (works in App Router route handlers)
  let req: NextRequest | undefined;
  try {
    const { headers } = await import('next/headers');
    const headerStore = await headers();
    // Reconstruct a minimal request-like object with just the authorization header
    req = { headers: headerStore } as unknown as NextRequest;
  } catch {
    // headers() not available (e.g. middleware context) — fall back to cookies only
  }

  const { user, supabase, usedBearerToken } = await getAuthenticatedUser(req);

  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized session', code: 'UNAUTHORIZED' },
        { status: 401 }
      ),
    };
  }

  // For bearer-token requests the supabase anon client doesn't have cookie-based session
  // so we use createAdminClient to fetch the profile by user.id safely
  const { createAdminClient } = await import('./supabase/server');
  const profileClient = usedBearerToken ? createAdminClient() : supabase;
  const { data: profile } = await profileClient
    .from('user_profiles')
    .select('id, role, plant_id, is_active, full_name, email')
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
