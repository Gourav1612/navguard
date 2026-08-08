import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BusSchema } from '@/lib/validations';

// PATCH /api/admin/buses/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const partialSchema = BusSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: bus, error: fetchErr } = await supabase
      .from('buses')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !bus) {
      return NextResponse.json(
        { error: 'Bus not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { data: updatedBus, error: updateErr } = await supabase
      .from('buses')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to update bus', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedBus);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/buses/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // Verify ownership
    const { data: bus, error: fetchErr } = await supabase
      .from('buses')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !bus) {
      return NextResponse.json(
        { error: 'Bus not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 1. Unassign this bus from any routes
    await supabase.from('routes').update({ bus_id: null }).eq('bus_id', id);

    // 2. Unassign this bus from any drivers
    await supabase.from('drivers').update({ bus_id: null }).eq('bus_id', id);

    // 3. Unassign this bus from any student profiles
    await supabase.from('student_profiles').update({ bus_id: null, stop_id: null }).eq('bus_id', id);

    // 4. Delete real-time telemetry records for this bus
    await supabase.from('bus_locations').delete().eq('bus_id', id);

    // 5. Unlink from active/historical trips
    await supabase.from('trips').update({ bus_id: null }).eq('bus_id', id);

    // 6. Clean up announcements referencing this bus
    await supabase.from('announcements').delete().eq('bus_id', id);

    // 7. Delete the bus record
    const { error: deleteErr } = await supabase
      .from('buses')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return NextResponse.json(
        { error: `Failed to delete bus: ${deleteErr.message}`, code: 'SERVER_ERROR', details: deleteErr },
        { status: 500 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
