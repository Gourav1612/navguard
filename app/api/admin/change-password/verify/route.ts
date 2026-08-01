import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const auth = await requireRole(['admin'], { skipMfa: true });
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const { code, newPassword } = await request.json();

    if (!code || code.trim().length !== 6) {
      return NextResponse.json(
        { error: 'Verification code must be 6 digits.' },
        { status: 400 }
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    const cleanCode = code.trim();
    const savedOtp = user.user_metadata?.password_change_otp;
    const expiresAt = user.user_metadata?.password_change_otp_expires;

    if (!savedOtp || !expiresAt) {
      return NextResponse.json(
        { error: 'No active password change session found. Please request a new OTP code.' },
        { status: 400 }
      );
    }

    if (Date.now() > Number(expiresAt)) {
      return NextResponse.json(
        { error: 'Verification code has expired (valid for 10 min). Please request a new code.' },
        { status: 400 }
      );
    }

    if (savedOtp !== cleanCode) {
      const currentAttempts = Number(user.user_metadata?.password_change_otp_attempts || 0);
      const newAttempts = currentAttempts + 1;

      if (newAttempts >= 5) {
        // Clear OTP metadata after 5 invalid attempts for security
        await supabase.auth.updateUser({
          data: {
            password_change_otp: null,
            password_change_otp_expires: null,
            password_change_otp_attempts: 0,
          },
        });
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Session invalidated. Please request a new OTP code.' },
          { status: 400 }
        );
      }

      await supabase.auth.updateUser({
        data: {
          password_change_otp_attempts: newAttempts,
        },
      });

      return NextResponse.json(
        { error: `Incorrect verification code. ${5 - newAttempts} attempts remaining.` },
        { status: 400 }
      );
    }

    // OTP Verified! Update password in Supabase Auth & clear OTP session
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: {
        password_change_otp: null,
        password_change_otp_expires: null,
        password_change_otp_attempts: 0,
      },
    });

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update password: ' + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Admin password updated successfully!',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Server error verifying password change' },
      { status: 500 }
    );
  }
}
