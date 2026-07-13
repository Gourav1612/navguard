import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // Allow admins to end active ongoing trips
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

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

    // 1. Fetch trip details and verify it exists
    const { data: trip, error: tripFetchErr } = await adminClient
      .from('trips')
      .select('id, status')
      .eq('id', trip_id)
      .maybeSingle();

    if (tripFetchErr || !trip) {
      return NextResponse.json(
        { error: 'Trip record not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (trip.status !== 'active') {
      return NextResponse.json(
        { error: 'Trip is not active', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    // 2. Update status to completed using the adminClient
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
