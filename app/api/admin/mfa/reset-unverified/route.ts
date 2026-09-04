import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST() {
  const auth = await requireRole(['admin'], { skipMfa: true });
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    const { data, error: listErr } = await adminClient.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    const factorList = (data as any)?.factors || (data as any) || [];

    if (Array.isArray(factorList)) {
      for (const factor of factorList) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          await adminClient.auth.admin.mfa.deleteFactor({
            userId: user.id,
            id: factor.id,
          });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to reset unverified factors' },
      { status: 500 }
    );
  }
}
