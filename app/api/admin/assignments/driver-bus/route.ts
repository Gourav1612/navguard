import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DriverBusAssignmentSchema } from '@/lib/validations';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const parsed = DriverBusAssignmentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { driver_id, bus_id } = parsed.data;

    // Verify driver ownership
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('id', driver_id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (!driver) {
      return NextResponse.json(
        { error: 'Driver not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Update assignment in database
    const { error: updateErr } = await supabase
      .from('drivers')
      .update({
        bus_id: bus_id || null,
      })
      .eq('id', driver_id);

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to update driver assignment', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      driver_id,
      bus_id: bus_id || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
