import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ busId: string }> }
) {
  const auth = await requireRole(['admin', 'driver', 'parent', 'student']);
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const { busId } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Check if bus belongs to user's school (tenant check)
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

    if (profile.role === 'driver') {
      const { data: driver } = await supabase
        .from('drivers')
        .select('bus_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (driver?.bus_id !== busId) {
        return NextResponse.json(
          { error: 'Access denied: Driver is not assigned to this bus', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }
    }

    if (profile.role === 'student') {
      const { data: student } = await supabase
        .from('student_profiles')
        .select('bus_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (student?.bus_id !== busId) {
        return NextResponse.json(
          { error: 'Access denied: Student is not assigned to this bus', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }
    }

    if (profile.role === 'parent') {
      const { data: parent } = await supabase
        .from('parent_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!parent) {
        return NextResponse.json(
          { error: 'Parent profile not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      const { data: links } = await supabase
        .from('parent_student_links')
        .select('student:student_profiles(bus_id)')
        .eq('parent_id', parent.id);

      const hasLinkedChildOnBus = (links || []).some((link: any) => {
        const student = Array.isArray(link.student) ? link.student[0] : link.student;
        return student?.bus_id === busId;
      });

      if (!hasLinkedChildOnBus) {
        return NextResponse.json(
          { error: 'Access denied: No linked child is assigned to this bus', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }
    }

    // 2. Check if there is an active trip on this bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, status')
      .eq('bus_id', busId)
      .eq('status', 'active')
      .maybeSingle();

    // 3. Query latest location log
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
