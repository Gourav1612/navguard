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

    // 1. Fetch Bus details using the actual DB column names (name, not bus_number)
    const { data: bus, error: busErr } = await adminClient
      .from('buses')
      .select('id, name, registration_plate, route_id, school_id')
      .eq('id', bus_id)
      .maybeSingle();

    if (busErr || !bus) {
      return NextResponse.json(
        { error: `Bus record not found. ID: ${bus_id} | DB error: ${busErr?.message || 'null'}` },
        { status: 404 }
      );
    }

    const busLabel = bus.name || bus.registration_plate || bus_id;

    // 2. Find driver assigned to this bus
    const { data: driver } = await adminClient
      .from('drivers')
      .select('id, user_id')
      .eq('bus_id', bus_id)
      .maybeSingle();

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
            route_id: bus.route_id || null,
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

      // Update bus is_trip_active flag
      await adminClient
        .from('buses')
        .update({ is_trip_active: true } as any)
        .eq('id', bus_id);

      // Insert notification
      if (bus.school_id) {
        await adminClient.from('notifications').insert({
          school_id: bus.school_id,
          title: '🚌 Trip Started by Admin',
          message: `Admin has initiated live transit trip for ${busLabel}.`,
          type: 'general',
        });
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

      if (bus.school_id) {
        await adminClient.from('notifications').insert({
          school_id: bus.school_id,
          title: '🏁 Trip Ended by Admin',
          message: `Admin has completed live transit trip for ${busLabel}.`,
          type: 'general',
        });
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
