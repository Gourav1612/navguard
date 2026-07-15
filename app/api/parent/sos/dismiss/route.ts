import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // Only authenticated parent roles can clear the SOS state of their linked child
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const { student_id } = body;

    if (!student_id) {
      return NextResponse.json(
        { error: 'Missing student_id parameter', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // 1. Fetch parent profile and verify ownership link
    const { data: parent, error: parentErr } = await supabase
      .from('parent_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (parentErr || !parent) {
      return NextResponse.json(
        { error: 'Parent profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { data: link, error: linkErr } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('parent_id', parent.id)
      .eq('student_id', student_id)
      .maybeSingle();

    if (linkErr || !link) {
      return NextResponse.json(
        { error: 'Forbidden: Child student profile is not linked to this parent', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // 2. Perform the update to reset the SOS status on the student profile
    const { error: updateErr } = await supabase
      .from('student_profiles')
      .update({
        sos_active: false,
        sos_reported_at: null,
      })
      .eq('id', student_id);

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to clear student SOS alert', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
