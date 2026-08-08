import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LocationSchema } from '@/lib/validations';
import { getDistanceMeters } from '@/lib/utils';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createAdminClient();

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

    // 1. Fetch driver profile & bus details
    const { data: driver, error: driverErr } = await supabase
      .from('drivers')
      .select('id, bus_id, school_id')
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

    // Fetch bus details
    const { data: bus, error: busErr } = await adminSupabase
      .from('buses')
      .select('id, name, school_id, open_app_requested_at')
      .eq('id', bus_id)
      .single();

    if (busErr) {
      return NextResponse.json(
        { error: 'Failed to load bus details', code: 'SERVER_ERROR', details: busErr },
        { status: 500 }
      );
    }

    if (!bus) {
      return NextResponse.json(
        { error: 'Bus not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const activeSchoolId = bus.school_id || driver.school_id || profile?.school_id;

    let openAppRequested = false;
    if (bus?.open_app_requested_at) {
      const requestedTime = new Date(bus.open_app_requested_at).getTime();
      const elapsed = Date.now() - requestedTime;
      if (elapsed < 60000) {
        openAppRequested = true;
        // Acknowledge and clear it immediately
        await adminSupabase
          .from('buses')
          .update({ open_app_requested_at: null })
          .eq('id', bus.id);
      }
    }
    
    // Fetch active route assigned to this bus from routes table
    const { data: route } = await adminSupabase
      .from('routes')
      .select('id')
      .eq('bus_id', bus_id)
      .eq('is_active', true)
      .maybeSingle();

    const activeRouteId = route?.id;
    const userMetadata = typeof user.user_metadata === 'object' && user.user_metadata ? user.user_metadata : {};

    // 2. Fetch last recorded bus location to check for movement & idle halt time
    const { data: lastLoc } = await adminSupabase
      .from('bus_locations')
      .select('latitude, longitude, recorded_at')
      .eq('bus_id', bus_id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLoc) {
      const distFromLast = getDistanceMeters(
        Number(lastLoc.latitude),
        Number(lastLoc.longitude),
        latitude,
        longitude
      );

      const timeDiffSec = (Date.now() - new Date(lastLoc.recorded_at).getTime()) / 1000;

      // Anti-GPS Spoofing Check
      if (timeDiffSec > 0) {
        const calculatedSpeedKmh = (distFromLast / timeDiffSec) * 3.6;
        if (distFromLast > 50 && calculatedSpeedKmh > 150) {
          return NextResponse.json(
            { error: 'Forbidden: Anomalous telemetry data (GPS spoofing threshold exceeded)', code: 'SPOOFING_DETECTED' },
            { status: 400 }
          );
        }
      }

      // ⏱️ 10-MINUTE HALT / IDLE TIMEOUT ALERT
      // If bus moved less than 15 meters and time passed is > 10 minutes
      const lastHaltStart = Number(userMetadata.halt_started_at || 0);
      const haltAlertSent = userMetadata.halt_alert_sent === true;

      if (distFromLast < 15) {
        const haltStartTime = lastHaltStart || Date.now();
        const haltDurationMins = (Date.now() - haltStartTime) / (1000 * 60);

        if (!lastHaltStart) {
          await adminSupabase.auth.admin.updateUserById(user.id, {
            user_metadata: { ...userMetadata, halt_started_at: haltStartTime },
          });
        }

        if (haltDurationMins >= 10 && !haltAlertSent) {
          // Trigger Extended Halt Alert Notification for Admin
          if (activeSchoolId) {
            await adminSupabase.from('notifications').insert({
              school_id: activeSchoolId,
              title: '⏱️ Extended Bus Halt Alert',
              message: `Bus ${bus?.name || bus_id} has been stationary at the same position for over 10 minutes.`,
              type: 'general',
            });
          }

          // Mark halt alert as sent to prevent spamming
          await adminSupabase.auth.admin.updateUserById(user.id, {
            user_metadata: { ...userMetadata, halt_alert_sent: true },
          });
        }
      } else {
        // Bus moved > 15m: Reset halt tracker
        if (lastHaltStart || haltAlertSent) {
          await adminSupabase.auth.admin.updateUserById(user.id, {
            user_metadata: { ...userMetadata, halt_started_at: null, halt_alert_sent: false },
          });
        }
      }
    }

    // ⚠️ 3. ROUTE DEVIATION CHECK (> 300m off-route)
    if (activeRouteId) {
      const { data: stops = [] } = await adminSupabase
        .from('stops')
        .select('latitude, longitude, name')
        .eq('route_id', activeRouteId);

      if (stops && stops.length > 0) {
        let minDistanceToRoute = Infinity;
        for (const stop of stops) {
          const dist = getDistanceMeters(latitude, longitude, Number(stop.latitude), Number(stop.longitude));
          if (dist < minDistanceToRoute) {
            minDistanceToRoute = dist;
          }
        }

        // If minimum distance from any route stop exceeds 300 meters
        if (minDistanceToRoute > 300) {
          const lastDevAlert = Number(user.user_metadata?.last_deviation_alert_at || 0);
          const canSendDevAlert = Date.now() - lastDevAlert > 5 * 60 * 1000; // 5-min cooldown

          if (canSendDevAlert && activeSchoolId) {
            await adminSupabase.from('notifications').insert({
              school_id: activeSchoolId,
              title: '⚠️ Route Deviation Alert',
              message: `Bus ${bus?.name || bus_id} has drifted ${Math.round(minDistanceToRoute)}m off its scheduled route alignment.`,
              type: 'general',
            });

            await adminSupabase.auth.admin.updateUserById(user.id, {
              user_metadata: { ...user.user_metadata, last_deviation_alert_at: Date.now() },
            });
          }
        }
      }
    }

    // 4. Update / Insert latest bus location in bus_locations table using upsert
    const { data: newLocation, error: locErr } = await adminSupabase
      .from('bus_locations')
      .upsert(
        {
          bus_id,
          trip_id: trip_id || null,
          latitude,
          longitude,
          speed,
          heading,
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'bus_id' }
      )
      .select('id, recorded_at')
      .single();

    if (locErr || !newLocation) {
      return NextResponse.json(
        { error: 'Failed to record bus telemetry location', code: 'SERVER_ERROR', details: locErr },
        { status: 500 }
      );
    }

    // Fetch latest bus is_trip_active status
    const { data: busData } = await adminSupabase
      .from('buses')
      .select('is_trip_active')
      .eq('id', bus_id)
      .maybeSingle();

    const isTripActive = busData?.is_trip_active || false;

    return NextResponse.json(
      {
        id: newLocation.id,
        recorded_at: newLocation.recorded_at,
        is_trip_active: isTripActive,
        open_app_requested: openAppRequested,
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
