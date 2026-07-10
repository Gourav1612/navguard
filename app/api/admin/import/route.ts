import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';
import { executeImport } from '@/lib/import-service';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.rows)) {
      return NextResponse.json(
        { error: 'Invalid request payload. Expected an array of rows.', code: 'INVALID_PAYLOAD' },
        { status: 400 }
      );
    }

    const result = await executeImport(
      adminClient,
      body.rows,
      profile.school_id,
      auth.user.id
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
