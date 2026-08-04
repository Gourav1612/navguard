import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const { bus_id, action } = await req.json();

    if (!bus_id) {
      return NextResponse.json({ error: 'Missing bus_id parameter' }, { status: 400 });
    }

    if (action !== 'start' && action !== 'end') {
      return NextResponse.json({ error: 'Action must be "start" or "end"' }, { status: 400 });
    }

    // 1. Fetch Bus & Driver assignment details
    const { data: bus, error: busErr } = await adminClient
      .from('buses')
      .select('id, bus_number, route_id, school_id')
      .eq('id', bus_id)
      .single();

    if (busErr || !bus) {
      return NextResponse.json({ error: 'Bus record not found' }, { status: 404 });
    }

    // Find driver assigned to this bus
    const { data: driver } = await adminClient
      .from('drivers')
      .select('id, user_id')
      .eq('bus_id', bus_id)
      .maybeSingle();

    if (action === 'start') {
      // Find or create active trip
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
            route_id: bus.route_id,
            driver_id: driver?.id || null,
            status: 'active',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (tripErr) {
          console.error('Failed to create trip:', tripErr);
        } else {
          activeTrip = newTrip;
        }
      }

      // Update bus status or metadata
      await adminClient
        .from('buses')
        .update({ is_trip_active: true } as any)
        .eq('id', bus_id);

      // Create Admin Notification
      await adminClient.from('notifications').insert({
        school_id: bus.school_id,
        title: '🚌 Trip Started by Admin',
        message: `Admin has initiated live transit trip for Bus ${bus.bus_number}.`,
        type: 'general',
      });

      return NextResponse.json({
        success: true,
        message: `Trip started for Bus ${bus.bus_number}`,
        trip_id: activeTrip?.id,
        is_trip_active: true,
      });
    } else {
      // End Trip
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

      // Create Admin Notification
      await adminClient.from('notifications').insert({
        school_id: bus.school_id,
        title: '🏁 Trip Ended by Admin',
        message: `Admin has completed live transit trip for Bus ${bus.bus_number}.`,
        type: 'general',
      });

      return NextResponse.json({
        success: true,
        message: `Trip completed for Bus ${bus.bus_number}`,
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
