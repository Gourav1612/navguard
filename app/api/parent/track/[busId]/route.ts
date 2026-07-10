import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { calculateETA } from '@/lib/eta';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ busId: string }> }
) {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const { busId } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Fetch parent profile
    const { data: parent, error: parentErr } = await supabase
      .from('parent_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (parentErr || !parent) {
      return NextResponse.json(
        { error: 'Parent profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 2. Fetch linked student assigned to this bus unit (authorization check)
    const { data: links, error: linksErr } = await supabase
      .from('parent_student_links')
      .select(`
        student:student_profiles(
          id,
          bus_id,
          stop:stops(id, name, stop_order, latitude, longitude)
        )
      `)
      .eq('parent_id', parent.id);

    const childObj = (links || [])
      .map((lnk: any) => lnk.student)
      .find((s: any) => s?.bus_id === busId);

    if (!childObj) {
      return NextResponse.json(
        { error: 'Access denied: No linked children on this bus unit', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    const childStop = childObj.stop;

    // 3. Get active trip details for this bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, route_id')
      .eq('bus_id', busId)
      .eq('status', 'active')
      .maybeSingle();

    if (!activeTrip) {
      return NextResponse.json({
        bus_id: busId,
        active_trip_id: null,
        latest_location: null,
        child_stop: childStop ? { name: childStop.name, stop_order: childStop.stop_order } : null,
        eta_minutes: null,
        route_stops: [],
      });
    }

    // 4. Fetch route stops list
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

    // 5. Fetch latest bus coordinate log
    const { data: latestLoc } = await supabase
      .from('bus_locations')
      .select('latitude, longitude, speed, heading, recorded_at')
      .eq('trip_id', activeTrip.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
      bus_id: busId,
      active_trip_id: activeTrip.id,
      latest_location: latestLocFormatted,
      child_stop: childStop ? { name: childStop.name, stop_order: childStop.stop_order } : null,
      eta_minutes: etaMinutes,
      route_stops: stopsList,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
