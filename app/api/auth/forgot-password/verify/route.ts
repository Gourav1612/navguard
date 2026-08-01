import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Please enter your email address.' }, { status: 400 });
    }

    if (!code || code.trim().length !== 6) {
      return NextResponse.json({ error: 'Verification code must be 6 digits.' }, { status: 400 });
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters long.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    const adminClient = createAdminClient();

    // Fetch user profile by email
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', cleanEmail)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User account not found.' }, { status: 404 });
    }

    // Fetch user auth record
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(profile.id);

    if (getUserError || !user) {
      return NextResponse.json({ error: 'User account not found.' }, { status: 404 });
    }

    const savedOtp = user.user_metadata?.password_reset_otp;
    const expiresAt = user.user_metadata?.password_reset_otp_expires;

    if (!savedOtp || !expiresAt) {
      return NextResponse.json(
        { error: 'No active password reset session found. Please request a new code.' },
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
      const currentAttempts = Number(user.user_metadata?.password_reset_otp_attempts || 0);
      const newAttempts = currentAttempts + 1;

      if (newAttempts >= 5) {
        await adminClient.auth.admin.updateUserById(profile.id, {
          user_metadata: {
            ...user.user_metadata,
            password_reset_otp: null,
            password_reset_otp_expires: null,
            password_reset_otp_attempts: 0,
          },
        });
        return NextResponse.json(
          { error: 'Too many incorrect attempts. Code invalidated. Please request a new OTP code.' },
          { status: 400 }
        );
      }

      await adminClient.auth.admin.updateUserById(profile.id, {
        user_metadata: {
          ...user.user_metadata,
          password_reset_otp_attempts: newAttempts,
        },
      });

      return NextResponse.json(
        { error: `Incorrect verification code. ${5 - newAttempts} attempts remaining.` },
        { status: 400 }
      );
    }

    // OTP Verified! Update password AND unlock account completely!
    const { error: updateError } = await adminClient.auth.admin.updateUserById(profile.id, {
      password: newPassword,
      user_metadata: {
        ...user.user_metadata,
        login_attempts: 0,
        login_locked: false,
        password_reset_otp: null,
        password_reset_otp_expires: null,
        password_reset_otp_attempts: 0,
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
      message: 'Password reset and account unlocked successfully! You can now sign in with your new password.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Server error verifying password reset' },
      { status: 500 }
    );
  }
}
