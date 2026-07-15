import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // Only authenticated student roles can trigger their own SOS
  const auth = await requireRole(['student']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'trigger'; // 'trigger' or 'dismiss'

    const updateFields = action === 'trigger'
      ? { sos_active: true, sos_reported_at: new Date().toISOString() }
      : { sos_active: false, sos_reported_at: null };

    const { data: updated, error } = await supabase
      .from('student_profiles')
      .update(updateFields)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: 'Failed to update SOS status', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, sos_active: updated.sos_active });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
