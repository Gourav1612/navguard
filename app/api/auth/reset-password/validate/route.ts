import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { timingSafeMatch, safeErrorResponse } from '@/lib/security-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';

export async function GET(request: Request) {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(clientIp, {
    prefix: 'reset_password_validate_ip',
    maxRequests: 10,
    windowSeconds: 300, // 5 minutes
  });
  if (!rateLimit.allowed) return rateLimit.response!;

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token')?.trim();
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!token || !email) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch user profile by email
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, role')
      .eq('email', email)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ valid: false });
    }

    // Fetch user auth record
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(profile.id);

    if (getUserError || !user) {
      return NextResponse.json({ valid: false });
    }

    const savedToken = user.user_metadata?.password_reset_token;
    const expiresAt = user.user_metadata?.password_reset_token_expires;

    if (!savedToken || !expiresAt) {
      return NextResponse.json({ valid: false });
    }

    if (Date.now() > Number(expiresAt)) {
      return NextResponse.json({ valid: false });
    }

    // Timing-safe match against stored token
    if (!timingSafeMatch(String(savedToken), token)) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({ valid: true });
  } catch (err: unknown) {
    return safeErrorResponse(err, 'Validation error', 500);
  }
}
