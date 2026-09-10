import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeErrorResponse } from '@/lib/security-utils';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const refreshToken = body.refresh_token;

    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json({ error: 'Missing refresh_token in request' }, { status: 400 });
    }

    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabaseAnon.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      return NextResponse.json(
        { error: error?.message || 'Failed to refresh session', code: 'REFRESH_FAILED' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Server error refreshing auth token', 500);
  }
}
