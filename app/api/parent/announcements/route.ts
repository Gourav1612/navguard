import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const { data: announcements, error } = await supabase
      .from('announcements')
      .select('id, title, body, created_at')
      .eq('school_id', profile.school_id)
      .in('target_role', ['all', 'parent'])
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch announcements', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(announcements);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
