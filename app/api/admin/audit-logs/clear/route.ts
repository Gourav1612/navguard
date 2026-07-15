import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // Only allow admins to clear logs to reduce database size and load
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const { error } = await adminClient
      .from('audit_logs')
      .delete()
      .eq('school_id', profile.school_id);

    if (error) {
      return NextResponse.json(
        { error: `Failed to clear logs: ${error.message}`, code: 'SERVER_ERROR', details: error },
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
