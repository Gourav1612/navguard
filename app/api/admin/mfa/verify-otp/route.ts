import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  const { user } = auth;

  try {
    const { code, factorId } = await request.json();

    if (!code || code.length !== 6) {
      return NextResponse.json(
        { error: 'Verification code must be 6 digits.' },
        { status: 400 }
      );
    }

    // Retrieve temporary code from auth metadata
    const savedOtp = user.user_metadata?.mfa_otp;
    const expiresAt = user.user_metadata?.mfa_otp_expires;

    if (!savedOtp || !expiresAt) {
      return NextResponse.json(
        { error: 'No active OTP verification session found. Request a new code.' },
        { status: 400 }
      );
    }

    if (Date.now() > Number(expiresAt)) {
      return NextResponse.json(
        { error: 'Verification code has expired. Request a new code.' },
        { status: 400 }
      );
    }

    if (savedOtp !== code) {
      return NextResponse.json(
        { error: 'Incorrect verification code. Please check your email.' },
        { status: 400 }
      );
    }

    // If factorId is provided, perform unenrollment on server-side using service role client
    if (factorId) {
      const adminClient = createAdminClient();
      const { error: factorErr } = await adminClient.auth.admin.mfa.deleteFactor({
        userId: user.id,
        id: factorId,
      });

      if (factorErr) {
        return NextResponse.json(
          { error: 'Failed to delete MFA factor verification settings.', details: factorErr.message },
          { status: 500 }
        );
      }
    }

    // Clear verification codes on successful match
    const { error: clearError } = await supabase.auth.updateUser({
      data: {
        mfa_otp: null,
        mfa_otp_expires: null,
      },
    });

    if (clearError) {
      return NextResponse.json(
        { error: 'Verification succeeded but session clear failed.', details: clearError },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
