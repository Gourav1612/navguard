import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token')?.trim();
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!token || !email) {
      return NextResponse.json({ valid: false, reason: 'missing_params' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch user profile by email
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (!profile) {
      return NextResponse.json({ valid: false, reason: 'user_not_found' });
    }

    // Fetch user auth record
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(profile.id);

    if (getUserError || !user) {
      return NextResponse.json({ valid: false, reason: 'user_not_found' });
    }

    const savedToken = user.user_metadata?.password_reset_token;
    const expiresAt = user.user_metadata?.password_reset_token_expires;

    if (!savedToken || savedToken !== token) {
      return NextResponse.json({ valid: false, reason: 'invalid_token' });
    }

    if (Date.now() > Number(expiresAt)) {
      return NextResponse.json({ valid: false, reason: 'expired_token' });
    }

    return NextResponse.json({ valid: true });
  } catch (err: any) {
    return NextResponse.json({ valid: false, error: err.message }, { status: 500 });
  }
}
