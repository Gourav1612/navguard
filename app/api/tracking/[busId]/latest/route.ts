import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ busId: string }> }
) {
  const { busId } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Verify user is logged in
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // 2. Retrieve user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('school_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 3. Check if bus belongs to user's school (tenant check)
    const { data: bus, error: busErr } = await supabase
      .from('buses')
      .select('id, school_id')
      .eq('id', busId)
      .maybeSingle();

    if (busErr || !bus) {
      return NextResponse.json(
        { error: 'Bus not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (bus.school_id !== profile.school_id) {
      return NextResponse.json(
        { error: 'Access denied', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // 4. Check if there is an active trip on this bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, status')
      .eq('bus_id', busId)
      .eq('status', 'active')
      .maybeSingle();

    // 5. Query latest location log
    const { data: latestLoc } = await supabase
      .from('bus_locations')
      .select('latitude, longitude, speed, heading, recorded_at')
      .eq('bus_id', busId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      bus_id: busId,
      latitude: latestLoc ? Number(latestLoc.latitude) : null,
      longitude: latestLoc ? Number(latestLoc.longitude) : null,
      speed: latestLoc ? Number(latestLoc.speed) : 0,
      heading: latestLoc ? Number(latestLoc.heading) : 0,
      recorded_at: latestLoc ? latestLoc.recorded_at : null,
      trip_status: activeTrip ? 'active' : 'inactive',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
