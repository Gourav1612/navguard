import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Fetch driver profile, assigned bus, route, stops, and student lists per stop in a single nested select
    const { data: driverRaw, error: driverErr } = await supabase
      .from('drivers')
      .select(`
        id,
        license_number,
        school_id,
        bus:buses(
          id,
          name,
          registration_plate,
          routes(
            id,
            name,
            stops(
              id,
              name,
              stop_order,
              latitude,
              longitude,
              student_profiles(
                id,
                grade,
                user:user_profiles(full_name)
              )
            )
          )
        )
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (driverErr || !driverRaw) {
      return NextResponse.json(
        { error: 'Driver profile not found', code: 'NOT_FOUND', details: driverErr },
        { status: 404 }
      );
    }

    const busObj = (Array.isArray(driverRaw.bus) ? driverRaw.bus[0] : driverRaw.bus) as any;
    // Driver must have a bus assigned
    if (!busObj) {
      return NextResponse.json({
        driver: { id: driverRaw.id, license_number: driverRaw.license_number },
        bus: null,
        route: null,
        active_trip: null,
      });
    }

    // Bus must have a route assigned
    const routeRaw = Array.isArray(busObj.routes) ? busObj.routes[0] : busObj.routes;
    
    // Check if there is an active trip on this bus
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, status, started_at')
      .eq('bus_id', busObj.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!routeRaw) {
      return NextResponse.json({
        driver: { id: driverRaw.id, license_number: driverRaw.license_number },
        bus: { id: busObj.id, name: busObj.name, registration_plate: busObj.registration_plate },
        route: null,
        active_trip: activeTrip ? { trip_id: activeTrip.id, status: activeTrip.status, started_at: activeTrip.started_at } : null,
      });
    }

    // Sort stops and format nested students list
    const stopsRaw = routeRaw.stops || [];
    const stopsSorted = [...stopsRaw]
      .sort((a: any, b: any) => a.stop_order - b.stop_order)
      .map((stop: any) => {
        const studentsRaw = stop.student_profiles || [];
        const studentsFormatted = studentsRaw.map((s: any) => {
          const userObj = Array.isArray(s.user) ? s.user[0] : s.user;
          return {
            id: s.id,
            full_name: userObj?.full_name || 'Unknown Student',
            grade: s.grade || '',
          };
        });

        return {
          id: stop.id,
          name: stop.name,
          stop_order: stop.stop_order,
          latitude: Number(stop.latitude),
          longitude: Number(stop.longitude),
          students: studentsFormatted,
        };
      });

    // Set default school coordinates for Sunrise Public School
    const school = {
      name: 'Sunrise Public School Campus',
      latitude: 27.5609,
      longitude: 76.6111,
    };

    return NextResponse.json({
      driver: { id: driverRaw.id, license_number: driverRaw.license_number },
      bus: { id: busObj.id, name: busObj.name, registration_plate: busObj.registration_plate },
      route: {
        id: routeRaw.id,
        name: routeRaw.name,
        stops: stopsSorted,
        school,
      },
      active_trip: activeTrip
        ? {
            trip_id: activeTrip.id,
            status: activeTrip.status,
            started_at: activeTrip.started_at,
          }
        : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
