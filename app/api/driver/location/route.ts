import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LocationSchema } from '@/lib/validations';

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const parsed = LocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { bus_id, trip_id, latitude, longitude, speed, heading } = parsed.data;

    // 1. Fetch driver profile to verify ownership of the bus
    const { data: driver, error: driverErr } = await supabase
      .from('drivers')
      .select('id, bus_id')
      .eq('user_id', user.id)
      .single();

    if (driverErr || !driver) {
      return NextResponse.json(
        { error: 'Driver profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Verify driver is assigned to this bus
    if (driver.bus_id !== bus_id) {
      return NextResponse.json(
        { error: 'Forbidden: Driver is not assigned to this bus', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // 2. Verify trip is active and belongs to this driver
    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .select('id, status, driver_id, route_id')
      .eq('id', trip_id)
      .maybeSingle();

    if (tripErr || !trip) {
      return NextResponse.json(
        { error: 'Trip record not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (trip.driver_id !== driver.id || trip.status !== 'active') {
      return NextResponse.json(
        { error: 'Forbidden: Trip is inactive or belongs to another driver', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // A. Geofence Check: Verify location is close to assigned route's stops
    if (trip.route_id) {
      const { data: stops } = await supabase
        .from('stops')
        .select('latitude, longitude')
        .eq('route_id', trip.route_id);

      if (stops && stops.length > 0) {
        let isWithinGeofence = false;
        for (const stop of stops) {
          const dist = getDistance(latitude, longitude, Number(stop.latitude), Number(stop.longitude));
          if (dist <= 5000) { // 5km geofence threshold
            isWithinGeofence = true;
            break;
          }
        }

        if (!isWithinGeofence) {
          return NextResponse.json(
            { error: 'Forbidden: Location is too far from the assigned route stops (Geofence exceeded)', code: 'ROUTE_DEVIATION' },
            { status: 400 }
          );
        }
      }
    }

    // B. Anti-GPS Spoofing Check: Verify speed/velocity logic
    const { data: lastLoc } = await supabase
      .from('bus_locations')
      .select('latitude, longitude, recorded_at')
      .eq('trip_id', trip_id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLoc) {
      const distance = getDistance(
        Number(lastLoc.latitude),
        Number(lastLoc.longitude),
        latitude,
        longitude
      );

      const timeDiffSeconds = (new Date().getTime() - new Date(lastLoc.recorded_at).getTime()) / 1000;
      if (timeDiffSeconds > 0) {
        const calculatedSpeedKmh = (distance / timeDiffSeconds) * 3.6;
        if (distance > 50 && calculatedSpeedKmh > 150) {
          return NextResponse.json(
            { error: 'Forbidden: Anomalous telemetry data (GPS spoofing threshold exceeded)', code: 'SPOOFING_DETECTED' },
            { status: 400 }
          );
        }
      }
    }

    // Proximity / Deviation Alerts Check
    if (trip.route_id) {
      const { data: stops = [] } = await supabase
        .from('stops')
        .select('*')
        .eq('route_id', trip.route_id)
        .order('stop_order', { ascending: true });

      if (stops && stops.length > 0) {
        // Fetch stops passed so far in this trip from audit logs
        const { data: passedLogs = [] } = await supabase
          .from('audit_logs')
          .select('record_id')
          .eq('action', 'STOP_PASSED')
          .filter('new_values->>trip_id', 'eq', trip_id);

        const passedStopIds = new Set((passedLogs || []).map((l: any) => l.record_id));

        // Find closest stop index to the current location of the bus
        let closestStopIdx = -1;
        let minDistance = Infinity;
        const distances = stops.map((stop: any, idx: number) => {
          const dist = getDistance(latitude, longitude, Number(stop.latitude), Number(stop.longitude));
          if (dist < minDistance) {
            minDistance = dist;
            closestStopIdx = idx;
          }
          return dist;
        });

        // If closestStopIdx is valid, any stops before closestStopIdx that are not marked passed
        // and are currently > 500m away have been bypassed.
        if (closestStopIdx >= 0) {
          for (let i = 0; i < closestStopIdx; i++) {
            const stop = stops[i];
            const dist = distances[i];

            if (!passedStopIds.has(stop.id) && dist > 500) {
              // Find students assigned to this stop
              const { data: students = [] } = await supabase
                .from('student_profiles')
                .select(`
                  id,
                  user:user_profiles (
                    full_name
                  )
                `)
                .eq('bus_id', bus_id)
                .eq('stop_id', stop.id);

              for (const student of students) {
                const studentName = (student.user as any)?.full_name || 'A student';
                const alertBody = `${studentName} did not de-board at designated stop (${stop.name}) on trip ${trip_id}.`;
                
                // Verify if warning is already sent to prevent spamming
                const { data: existingAlerts } = await supabase
                  .from('announcements')
                  .select('id')
                  .eq('title', '⚠️ Route Deviation Alert')
                  .eq('body', alertBody);

                if (!existingAlerts || existingAlerts.length === 0) {
                  const adminClient = createAdminClient();
                  await adminClient.from('announcements').insert({
                    school_id: driver.school_id,
                    created_by: user.id,
                    title: '⚠️ Route Deviation Alert',
                    body: alertBody,
                    target_role: 'all',
                  });
                }
              }
            }
          }
        }
      }
    }

    // 3. Log GPS coordinates
    const { data: newLocation, error: locErr } = await supabase
      .from('bus_locations')
      .insert({
        bus_id,
        trip_id,
        latitude,
        longitude,
        speed,
        heading,
        recorded_at: new Date().toISOString(),
      })
      .select('id, recorded_at')
      .single();

    if (locErr || !newLocation) {
      return NextResponse.json(
        { error: 'Failed to record bus telemetry location', code: 'SERVER_ERROR', details: locErr },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        id: newLocation.id,
        recorded_at: newLocation.recorded_at,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
