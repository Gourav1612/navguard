import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { StopSchema } from '@/lib/validations';

// PATCH /api/admin/stops/[id]
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
    const partialSchema = StopSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: stop, error: fetchErr } = await supabase
      .from('stops')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !stop) {
      return NextResponse.json(
        { error: 'Stop not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { data: updatedStop, error: updateErr } = await supabase
      .from('stops')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to update stop', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedStop);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/stops/[id]
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
    const { data: stop, error: fetchErr } = await supabase
      .from('stops')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !stop) {
      return NextResponse.json(
        { error: 'Stop not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { error: deleteErr } = await supabase
      .from('stops')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return NextResponse.json(
        { error: 'Failed to delete stop', code: 'SERVER_ERROR', details: deleteErr },
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
