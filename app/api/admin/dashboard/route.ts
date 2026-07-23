import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Fetch metrics in parallel
    const [
      { count: totalBuses, error: busesErr },
      { count: activeTripsCount, error: activeTripsErr },
      { count: totalStudents, error: studentsErr },
      { count: totalDrivers, error: driversErr },
    ] = await Promise.all([
      supabase
        .from('buses')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', profile.school_id),
      supabase
        .from('trips')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', profile.school_id)
        .eq('status', 'active'),
      supabase
        .from('student_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', profile.school_id),
      supabase
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', profile.school_id),
    ]);

    if (busesErr || activeTripsErr || studentsErr || driversErr) {
      return NextResponse.json(
        { 
          error: 'Failed to retrieve metrics', 
          code: 'SERVER_ERROR',
          details: { busesErr, activeTripsErr, studentsErr, driversErr }
        }, 
        { status: 500 }
      );
    }

    // 2. Fetch detailed active trips
    const { data: activeTripsRaw, error: tripsError } = await supabase
      .from('trips')
      .select(`
        id,
        buses (id, name),
        drivers (id, user_profiles (full_name)),
        routes (id, name)
      `)
      .eq('school_id', profile.school_id)
      .eq('status', 'active');

    if (tripsError) {
      return NextResponse.json(
        { error: 'Failed to retrieve active trips', code: 'SERVER_ERROR', details: tripsError },
        { status: 500 }
      );
    }

    // 3. For each active trip, fetch its latest location from bus_locations
    const activeTripsWithLocation = await Promise.all(
      (activeTripsRaw || []).map(async (trip: any) => {
        const { data: locationData } = await supabase
          .from('bus_locations')
          .select('latitude, longitude, speed, heading, recorded_at')
          .eq('trip_id', trip.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Safe type casts
        const busObj = trip.buses || {};
        const driverObj = trip.drivers || {};
        const routeObj = trip.routes || {};

        return {
          trip_id: trip.id,
          bus: {
            id: busObj.id || null,
            name: busObj.name || 'Unknown Bus',
          },
          driver: {
            full_name: driverObj.user_profiles?.full_name || 'Unassigned Driver',
          },
          route: {
            name: routeObj.name || 'No Route Assigned',
          },
          latest_location: locationData
            ? {
                latitude: Number(locationData.latitude),
                longitude: Number(locationData.longitude),
                speed: Number(locationData.speed),
                heading: Number(locationData.heading),
                recorded_at: locationData.recorded_at,
              }
            : null,
        };
      })
    );

    // 4. Fetch all buses for this school to show both active and inactive drivers' last locations
    const { data: allBuses } = await supabase
      .from('buses')
      .select('id, name, registration_plate')
      .eq('school_id', profile.school_id);

    const allBusesWithLocation = await Promise.all(
      (allBuses || []).map(async (bus: any) => {
        const { data: locationData } = await supabase
          .from('bus_locations')
          .select('latitude, longitude, speed, heading, recorded_at')
          .eq('bus_id', bus.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const activeTrip: any = (activeTripsRaw || []).find((t: any) => {
          const busObj: any = t.buses || {};
          return busObj.id === bus.id;
        });

        return {
          bus_id: bus.id,
          bus_name: bus.name,
          registration_plate: bus.registration_plate,
          is_active: !!activeTrip,
          trip_id: activeTrip?.id || null,
          driver_name: activeTrip?.drivers?.user_profiles?.full_name || 'Inactive',
          route_name: activeTrip?.routes?.name || 'No Active Route',
          latest_location: locationData
            ? {
                latitude: Number(locationData.latitude),
                longitude: Number(locationData.longitude),
                speed: Number(locationData.speed),
                heading: Number(locationData.heading),
                recorded_at: locationData.recorded_at,
              }
            : null,
        };
      })
    );

    return NextResponse.json({
      metrics: {
        total_buses: totalBuses || 0,
        active_trips: activeTripsCount || 0,
        total_students: totalStudents || 0,
        total_drivers: totalDrivers || 0,
      },
      active_trips: activeTripsWithLocation,
      buses_locations: allBusesWithLocation,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
