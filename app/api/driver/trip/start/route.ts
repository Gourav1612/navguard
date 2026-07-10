import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const { bus_id, route_id } = body;

    if (!bus_id || !route_id) {
      return NextResponse.json(
        { error: 'Missing bus_id or route_id parameters', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // 1. Fetch driver profile using adminClient to bypass RLS school_id checks
    const { data: driver, error: driverErr } = await adminClient
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

    // Validate that driver is assigned to this bus
    if (driver.bus_id !== bus_id) {
      return NextResponse.json(
        { error: 'Forbidden: Driver is not assigned to this bus unit', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // 2. Check if there is already an active trip for this bus
    const { data: activeTrip } = await adminClient
      .from('trips')
      .select('id')
      .eq('bus_id', bus_id)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTrip) {
      return NextResponse.json(
        { error: 'A trip is already active for this bus unit', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    // 3. Start trip using adminClient to ensure the database record is inserted successfully
    const { data: newTrip, error: tripErr } = await adminClient
      .from('trips')
      .insert({
        bus_id,
        driver_id: driver.id,
        route_id,
        school_id: driver.school_id,
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (tripErr || !newTrip) {
      return NextResponse.json(
        { error: 'Failed to start trip log record', code: 'SERVER_ERROR', details: tripErr },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        trip_id: newTrip.id,
        status: 'active',
        started_at: newTrip.started_at,
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
