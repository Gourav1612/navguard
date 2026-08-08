import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();
  const adminClient = createAdminClient();

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
        buses (id, name, registration_plate),
        drivers (id, user_profiles (full_name)),
        routes (id, name, stops (id, name, stop_order, latitude, longitude))
      `)
      .eq('school_id', profile.school_id)
      .eq('status', 'active');

    if (tripsError) {
      return NextResponse.json(
        { error: 'Failed to retrieve active trips', code: 'SERVER_ERROR', details: tripsError },
        { status: 500 }
      );
    }

    // 3. Fetch all buses for this school to determine active/inactive drivers and map locations
    const { data: allBuses } = await supabase
      .from('buses')
      .select('id, name, registration_plate')
      .eq('school_id', profile.school_id);

    const busIds = (allBuses || []).map((b: any) => b.id);

    // Fetch all location records in a single batch query!
    const { data: locationDataList } = busIds.length > 0
      ? await supabase
          .from('bus_locations')
          .select('bus_id, latitude, longitude, speed, heading, recorded_at')
          .in('bus_id', busIds)
      : { data: [] };

    // Group locations by bus_id for O(1) lookups
    const locationsMap = (locationDataList || []).reduce((acc: any, curr: any) => {
      acc[curr.bus_id] = curr;
      return acc;
    }, {});

    // 4. Map detailed active trips
    const activeTripsWithLocation = (activeTripsRaw || []).map((trip: any) => {
      const busObj = Array.isArray(trip.buses) ? trip.buses[0] : (trip.buses || {});
      const driverObj = Array.isArray(trip.drivers) ? trip.drivers[0] : (trip.drivers || {});
      const routeObj = Array.isArray(trip.routes) ? trip.routes[0] : (trip.routes || {});

      const locationData = locationsMap[busObj.id] || null;

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
          id: routeObj.id || null,
          name: routeObj.name || 'No Route Assigned',
          stops: routeObj.stops || [],
        },
        latest_location: (() => {
          if (!locationData) return null;
          const recTime = new Date(locationData.recorded_at).getTime();
          const elapsed = Date.now() - recTime;
          const isStale = elapsed > 8000;

          if (isStale) {
            const driverName = driverObj.user_profiles?.full_name || 'Unassigned Driver';
            // Fire async check to create notifications if not exists
            (async () => {
              try {
                const { data: existingNotif } = await adminClient
                  .from('notifications')
                  .select('id')
                  .eq('type', 'gps_off')
                  .like('message', `%trip:${trip.id}%`)
                  .limit(1)
                  .maybeSingle();

                if (!existingNotif) {
                  const busName = busObj.name || 'Unknown Bus';
                  const busPlate = busObj.registration_plate || 'N/A';
                  await adminClient.from('notifications').insert({
                    school_id: profile.school_id,
                    title: '📶 Driver GPS Interrupted',
                    message: `${driverName} on ${busName} (${busPlate}) went offline or stopped location reporting. [trip:${trip.id}]`,
                    type: 'gps_off',
                  });
                }
              } catch (e) {
                console.error('Failed to auto-insert stale GPS notification:', e);
              }
            })();
          }

          return {
            latitude: Number(locationData.latitude),
            longitude: Number(locationData.longitude),
            speed: isStale ? 0 : Number(locationData.speed),
            heading: Number(locationData.heading),
            recorded_at: locationData.recorded_at,
            is_stale: isStale,
          };
        })(),
      };
    });

    // 5. Map all buses with their locations (both active and inactive)
    const allBusesWithLocation = (allBuses || []).map((bus: any) => {
      const locationData = locationsMap[bus.id] || null;

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
        latest_location: (() => {
          if (!locationData) return null;
          const recTime = new Date(locationData.recorded_at).getTime();
          const elapsed = Date.now() - recTime;
          const isStale = elapsed > 8000;
          return {
            latitude: Number(locationData.latitude),
            longitude: Number(locationData.longitude),
            speed: isStale ? 0 : Number(locationData.speed),
            heading: Number(locationData.heading),
            recorded_at: locationData.recorded_at,
            is_stale: isStale,
          };
        })(),
      };
    });

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
