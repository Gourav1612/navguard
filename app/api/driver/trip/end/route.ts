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
    const { trip_id } = body;

    if (!trip_id) {
      return NextResponse.json(
        { error: 'Missing trip_id parameter', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // 1. Fetch driver profile using adminClient to ensure it bypasses any RLS issues
    const { data: driver, error: driverErr } = await adminClient
      .from('drivers')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (driverErr || !driver) {
      return NextResponse.json(
        { error: 'Driver profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 2. Fetch trip details and verify driver matches
    const { data: trip, error: tripFetchErr } = await adminClient
      .from('trips')
      .select('id, status, driver_id')
      .eq('id', trip_id)
      .maybeSingle();

    if (tripFetchErr || !trip) {
      return NextResponse.json(
        { error: 'Trip record not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (trip.driver_id !== driver.id) {
      return NextResponse.json(
        { error: 'Forbidden: Driver is not assigned to this trip record', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    if (trip.status !== 'active') {
      return NextResponse.json(
        { error: 'Trip is not active', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    // 3. Update status to completed using adminClient to ensure it succeeds
    const endedAt = new Date().toISOString();
    const { data: updatedTrip, error: updateErr } = await adminClient
      .from('trips')
      .update({
        status: 'completed',
        ended_at: endedAt,
      })
      .eq('id', trip_id)
      .select()
      .single();

    if (updateErr || !updatedTrip) {
      return NextResponse.json(
        { error: 'Failed to end trip record', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      trip_id,
      status: 'completed',
      ended_at: updatedTrip.ended_at,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
