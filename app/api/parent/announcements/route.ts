import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    // 1. Fetch parent's school_id and linked student bus_ids (using adminClient to bypass RLS)
    const { data: parentRaw } = await adminClient
      .from('parent_profiles')
      .select(`
        school_id,
        links:parent_student_links(
          student:student_profiles(bus_id)
        )
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!parentRaw) {
      return NextResponse.json([]);
    }

    const parentBusIds = (parentRaw?.links || [])
      .map((l: any) => l.student?.bus_id)
      .filter(Boolean);

    // 2. Query announcements matching school_id AND (bus_id IS NULL OR bus_id IN parentBusIds)
    let query = adminClient
      .from('announcements')
      .select('id, bus_id, title, body, created_at')
      .eq('school_id', parentRaw.school_id)
      .in('target_role', ['all', 'parent'])
      .order('created_at', { ascending: false });

    if (parentBusIds.length > 0) {
      query = query.or(`bus_id.is.null,bus_id.in.(${parentBusIds.join(',')})`);
    } else {
      query = query.is('bus_id', null);
    }

    const { data: announcements, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch announcements', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(announcements || []);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
