import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// POST /api/admin/buses/[id]/ping
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Verify bus exists and belongs to the admin's school
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

    // 2. Update the open_app_requested_at timestamp to now
    const { error: updateErr } = await supabase
      .from('buses')
      .update({ open_app_requested_at: new Date().toISOString() })
      .eq('id', id);

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to ping driver app', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Driver app ping request sent' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
