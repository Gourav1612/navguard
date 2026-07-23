import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createAdminClient();

  try {
    const { type, message } = await req.json();

    if (!type || !message) {
      return NextResponse.json(
        { error: 'Missing type or message', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // 1. Fetch school_id of the driver using session client
    const { data: driverRaw, error: driverErr } = await supabase
      .from('drivers')
      .select('school_id, license_number')
      .eq('user_id', user.id)
      .single();

    if (driverErr || !driverRaw) {
      return NextResponse.json(
        { error: 'Driver profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 2. Insert notification using adminSupabase to bypass SELECT policy restriction
    const { data, error } = await adminSupabase
      .from('notifications')
      .insert({
        school_id: driverRaw.school_id,
        title: type === 'gps_off' ? '📶 Driver GPS Interrupted' : '⚠️ Trip Ended Early',
        message: `${profile.full_name}: ${message}`,
        type,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save notification', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
