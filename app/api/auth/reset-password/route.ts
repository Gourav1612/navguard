import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { token, email, newPassword } = await request.json();

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Missing email parameter.' }, { status: 400 });
    }

    if (!token || !token.trim()) {
      return NextResponse.json({ error: 'Invalid or missing password reset token.' }, { status: 400 });
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters long.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();
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

    const savedToken = user.user_metadata?.password_reset_token;
    const expiresAt = user.user_metadata?.password_reset_token_expires;

    if (!savedToken || !expiresAt) {
      return NextResponse.json(
        { error: 'No active password reset link found or link was already used.' },
        { status: 400 }
      );
    }

    if (Date.now() > Number(expiresAt)) {
      return NextResponse.json(
        { error: 'Password reset link has expired (valid for 10 min). Please try logging in again to trigger a new link.' },
        { status: 400 }
      );
    }

    if (savedToken !== cleanToken) {
      return NextResponse.json(
        { error: 'Invalid password reset token link.' },
        { status: 400 }
      );
    }

    // Token Verified! Update password AND unlock account completely!
    const { error: updateError } = await adminClient.auth.admin.updateUserById(profile.id, {
      password: newPassword,
      user_metadata: {
        ...user.user_metadata,
        login_attempts: 0,
        login_locked: false,
        password_reset_token: null,
        password_reset_token_expires: null,
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
      message: 'Account unlocked and password updated successfully! You can now sign in.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Server error resetting password' },
      { status: 500 }
    );
  }
}
