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

    // Check if any driver is assigned to this bus
    const { data: driverCheck } = await supabase
      .from('drivers')
      .select('id, user:user_profiles(full_name)')
      .eq('bus_id', id)
      .maybeSingle();

    if (driverCheck) {
      const driverName = (driverCheck.user as any)?.full_name || 'A driver';
      return NextResponse.json(
        { error: `Cannot delete bus because it is currently assigned to driver: ${driverName}. Unassign them first.`, code: 'ASSIGNED_TO_DRIVER' },
        { status: 400 }
      );
    }

    // Check if the bus has any associated trips to protect trip history integrity
    const { data: tripCheck } = await supabase
      .from('trips')
      .select('id')
      .eq('bus_id', id)
      .limit(1)
      .maybeSingle();

    if (tripCheck) {
      return NextResponse.json(
        { error: 'Cannot delete bus because it is linked to active or historical trip logs.', code: 'ASSIGNED_TO_TRIP' },
        { status: 400 }
      );
    }

    const { error: deleteErr } = await supabase
      .from('buses')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return NextResponse.json(
        { error: 'Failed to delete bus', code: 'SERVER_ERROR', details: deleteErr },
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
