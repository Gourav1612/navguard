import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
        bus:buses(id, name),
        stop:stops(id, name, stop_order),
        school_id
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (studentErr || !student) {
      return NextResponse.json(
        { error: 'Student profile not found', code: 'NOT_FOUND', details: studentErr },
        { status: 404 }
      );
    }

    const busObj = Array.isArray(student.bus) ? student.bus[0] : student.bus;
    const stopObj = Array.isArray(student.stop) ? student.stop[0] : student.stop;

    if (!busObj) {
      return NextResponse.json({
        student_id: student.id,
        bus: null,
        stop: stopObj ? { name: stopObj.name, stop_order: stopObj.stop_order } : null,
        route: null,
      });
    }

    // 2. Fetch active trip details for this bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, route_id')
      .eq('bus_id', busObj.id)
      .eq('status', 'active')
      .maybeSingle();

    // 3. Fetch stops on the route linked to the bus
    let routeDetails = null;
    if (activeTrip?.route_id) {
      const { data: route } = await supabase
        .from('routes')
        .select(`
          name,
          stops(
            name,
            stop_order
          )
        `)
        .eq('id', activeTrip.route_id)
        .single();

      if (route) {
        const stopsSorted = (route.stops || [])
          .sort((a: any, b: any) => a.stop_order - b.stop_order)
          .map((s: any) => ({
            name: s.name,
            stop_order: s.stop_order,
          }));

        routeDetails = {
          name: route.name,
          stops: stopsSorted,
        };
      }
    } else {
      // Fallback: query route linked to the bus directly even if trip is inactive
      const { data: route } = await supabase
        .from('routes')
        .select(`
          name,
          stops(
            name,
            stop_order
          )
        `)
        .eq('bus_id', busObj.id)
        .maybeSingle();

      if (route) {
        const stopsSorted = (route.stops || [])
          .sort((a: any, b: any) => a.stop_order - b.stop_order)
          .map((s: any) => ({
            name: s.name,
            stop_order: s.stop_order,
          }));

        routeDetails = {
          name: route.name,
          stops: stopsSorted,
        };
      }
    }

    return NextResponse.json({
      student_id: student.id,
      bus: {
        id: busObj.id,
        name: busObj.name,
        active_trip_id: activeTrip?.id || null,
      },
      stop: stopObj ? { name: stopObj.name, stop_order: stopObj.stop_order } : null,
      route: routeDetails,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
