import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST() {
  const auth = await requireRole(['admin'], { skipMfa: true });
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    const { data: factors, error: listErr } = await adminClient.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    if (factors?.factors) {
      const unverifiedTotpFactors = factors.factors.filter(
        (f: any) => f.factor_type === 'totp' && f.status === 'unverified'
      );

      for (const factor of unverifiedTotpFactors) {
        await adminClient.auth.admin.mfa.deleteFactor({
          userId: user.id,
          id: factor.id,
        });
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
