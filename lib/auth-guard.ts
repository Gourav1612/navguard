import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabase/server';

export interface UserProfile {
  id: string;
  role: string;
  plant_id: string | null;
  is_active: boolean;
  full_name?: string | null;
  email?: string | null;
}

type RequireRoleResult =
  | { user: User; profile: UserProfile; error?: never }
  | { user?: never; profile?: never; error: NextResponse };

function verifySupabaseJwtSignature(token: string, secret: string): { sub: string; email?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    // Check HS256 signature with SUPABASE_JWT_SECRET
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const expectedSigStd = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64');

    const cleanSig = signatureB64.replace(/=/g, '');
    const cleanExp = expectedSig.replace(/=/g, '');
    const cleanStd = expectedSigStd.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    if (cleanSig !== cleanExp && cleanSig !== cleanStd && signatureB64 !== expectedSigStd) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (payload && payload.sub) {
      return { sub: payload.sub, email: payload.email };
    }
  } catch (err) {
    console.error('Telemetry JWT Signature fallback check error:', err);
  }
  return null;
}

async function getAuthenticatedUser(req?: NextRequest) {
  // Check for Bearer token first (used by native Android foreground service)
  const authHeader = req?.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const accessToken = authHeader.substring(7).trim();
    if (accessToken) {
      const supabaseAnon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      // 1. Try standard Supabase Auth session validation
      try {
        const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);
        if (!error && user) {
          return { user, supabase: supabaseAnon, usedBearerToken: true };
        }
      } catch (err) {
        console.warn('Supabase auth.getUser check failed, checking JWT cryptographic signature:', err);
      }

      // 2. Cryptographic signature fallback (for background polling when token is expired but signature is valid)
      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (jwtSecret) {
        const verified = verifySupabaseJwtSignature(accessToken, jwtSecret);
        if (verified) {
          const userObj = {
            id: verified.sub,
            email: verified.email || '',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: new Date().toISOString(),
          } as any;
          return { user: userObj, supabase: supabaseAnon, usedBearerToken: true };
        }
      }
    }
  }

  // Fall back to cookie-based Supabase session (web/PWA)
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { user: error ? null : user, supabase, usedBearerToken: false };
}

export async function requireRole(allowedRoles: string[], options?: { skipMfa?: boolean }): Promise<RequireRoleResult> {
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

  // Always use admin client for profile role lookups to bypass RLS restrictions
  const { createAdminClient } = await import('./supabase/server');
  const profileClient = createAdminClient();
  const { data: profile } = await profileClient
    .from('user_profiles')
    .select('id, role, plant_id, is_active, full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return {
      error: NextResponse.json(
        { error: 'Profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      ),
    };
  }

  // Note: is_active is used for telemetry streaming pause/resume, handled specifically in /api/worker/location

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
