import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();

  try {
    const { bus_id, action } = await req.json();

    if (!bus_id) {
      return NextResponse.json({ error: 'Missing bus_id parameter' }, { status: 400 });
    }

    if (action !== 'start' && action !== 'end') {
      return NextResponse.json({ error: 'Action must be "start" or "end"' }, { status: 400 });
    }

    // 1. Fetch Bus details (buses table has: id, name, registration_plate, school_id etc — NOT route_id)
    const { data: bus, error: busErr } = await adminClient
      .from('buses')
      .select('id, name, registration_plate, school_id')
      .eq('id', bus_id)
      .eq('school_id', auth.profile.school_id)
      .maybeSingle();

    if (busErr || !bus) {
      return NextResponse.json(
        { error: `Bus not found (id: ${bus_id})` },
        { status: 404 }
      );
    }

    const busLabel = bus.name || bus.registration_plate || bus_id;

    // 2. Find the route assigned to this bus (routes.bus_id → buses.id)
    const { data: routeRow } = await adminClient
      .from('routes')
      .select('id')
      .eq('bus_id', bus_id)
      .maybeSingle();

    const routeId = routeRow?.id || null;

    // 3. Find the driver assigned to this bus
    const { data: driver } = await adminClient
      .from('drivers')
      .select('id, school_id')
      .eq('bus_id', bus_id)
      .maybeSingle();

    const schoolId = bus.school_id || driver?.school_id || null;

    if (action === 'start') {
      // Check for an already active trip first
      let { data: activeTrip } = await adminClient
        .from('trips')
        .select('id')
        .eq('bus_id', bus_id)
        .eq('status', 'active')
        .maybeSingle();

      if (!activeTrip) {
        const { data: newTrip, error: tripErr } = await adminClient
          .from('trips')
          .insert({
            bus_id,
            route_id: routeId,
            driver_id: driver?.id || null,
            school_id: schoolId,
            status: 'active',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (tripErr) {
          console.error('Failed to create trip:', tripErr);
          return NextResponse.json(
            { error: `Failed to create trip: ${tripErr.message}` },
            { status: 500 }
          );
        }
        activeTrip = newTrip;
      }

      // Update bus is_trip_active flag
      await adminClient
        .from('buses')
        .update({ is_trip_active: true } as any)
        .eq('id', bus_id);

      // Insert announcement for parents assigned to this bus & notifications for driver
      if (schoolId) {
        try {
          await adminClient.from('announcements').insert({
            school_id: schoolId,
            bus_id: bus_id,
            title: action === 'start' ? '🚌 Bus Trip Started' : '🏁 Bus Trip Completed',
            body: action === 'start'
              ? `Bus ${busLabel} trip has been initiated by Admin. Live GPS tracking is now active for your child's route.`
              : `Bus ${busLabel} trip has been completed by Admin.`,
            target_role: 'parent',
            created_at: new Date().toISOString(),
          });
        } catch (_) {}
      }

      return NextResponse.json({
        success: true,
        message: `Trip started for ${busLabel}`,
        trip_id: activeTrip?.id,
        is_trip_active: true,
      });

    } else {
      // End all active trips for this bus
      await adminClient
        .from('trips')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
        })
        .eq('bus_id', bus_id)
        .eq('status', 'active');

      await adminClient
        .from('buses')
        .update({ is_trip_active: false } as any)
        .eq('id', bus_id);

      if (schoolId) {
        try {
          await adminClient.from('announcements').insert({
            school_id: schoolId,
            bus_id: bus_id,
            title: '🏁 Bus Trip Completed',
            body: `Bus ${busLabel} trip has been completed by Admin.`,
            target_role: 'parent',
            created_at: new Date().toISOString(),
          });
        } catch (_) {}
      }

      return NextResponse.json({
        success: true,
        message: `Trip completed for ${busLabel}`,
        is_trip_active: false,
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to toggle trip status' },
      { status: 500 }
    );
  }
}
