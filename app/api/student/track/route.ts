import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { calculateETA } from '@/lib/eta';

export async function GET() {
  const auth = await requireRole(['student']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Fetch student profile details
    const { data: student, error: studentErr } = await supabase
      .from('student_profiles')
      .select(`
        id,
        bus_id,
        stop:stops(id, name, stop_order, latitude, longitude)
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (studentErr || !student) {
      return NextResponse.json(
        { error: 'Student profile not found', code: 'NOT_FOUND', details: studentErr },
        { status: 404 }
      );
    }

    if (!student.bus_id) {
      return NextResponse.json(
        { error: 'No bus unit assigned to this student profile', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    const childStop = (Array.isArray(student.stop) ? student.stop[0] : student.stop) as any;

    // 2. Fetch active trip details for the bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, route_id')
      .eq('bus_id', student.bus_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!activeTrip) {
      return NextResponse.json({
        bus_id: student.bus_id,
        active_trip_id: null,
        latest_location: null,
        eta_minutes: null,
      });
    }

    // 3. Fetch latest bus position coordinates log
    const { data: latestLoc } = await supabase
      .from('bus_locations')
      .select('latitude, longitude, speed, heading, recorded_at')
      .eq('trip_id', activeTrip.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 4. Fetch route stops list to calculate path distance
    const { data: route } = await supabase
      .from('routes')
      .select(`
        stops(
          id,
          name,
          stop_order,
          latitude,
          longitude
        )
      `)
      .eq('id', activeTrip.route_id)
      .single();

    const stopsList = (route?.stops || [])
      .sort((a: any, b: any) => a.stop_order - b.stop_order)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        stop_order: s.stop_order,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
      }));

    let etaMinutes = null;
    let latestLocFormatted = null;

    if (latestLoc) {
      latestLocFormatted = {
        latitude: Number(latestLoc.latitude),
        longitude: Number(latestLoc.longitude),
        speed: Number(latestLoc.speed),
        heading: Number(latestLoc.heading),
        recorded_at: latestLoc.recorded_at,
      };

      if (childStop) {
        etaMinutes = calculateETA(
          latestLocFormatted.latitude,
          latestLocFormatted.longitude,
          stopsList,
          childStop.stop_order
        );
      }
    }

    return NextResponse.json({
      bus_id: student.bus_id,
      active_trip_id: activeTrip.id,
      latest_location: latestLocFormatted,
      eta_minutes: etaMinutes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
