import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendVerificationEmail } from '@/lib/mail';

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [name, domain] = parts;
  const maskedName = name.length <= 2 ? name[0] + '*' : name.slice(0, 2) + '*'.repeat(Math.max(name.length - 2, 2));
  return `${maskedName}@${domain}`;
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Please enter your registered email address.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const adminClient = createAdminClient();

    // Fetch user profile by email
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, full_name, email')
      .eq('email', cleanEmail)
      .single();

    if (!profile) {
      // Return ambiguous success for privacy, or clear message
      return NextResponse.json({
        success: true,
        email: maskEmail(cleanEmail),
        message: 'If an account exists with this email, a verification code has been sent.',
      });
    }

    // Fetch user auth record
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(profile.id);

    if (getUserError || !user) {
      return NextResponse.json({ error: 'User account not found' }, { status: 404 });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes valid

    // Save OTP to user_metadata
    await adminClient.auth.admin.updateUserById(profile.id, {
      user_metadata: {
        ...user.user_metadata,
        password_reset_otp: otp,
        password_reset_otp_expires: expiry,
        password_reset_otp_attempts: 0,
      },
    });

    // Send email
    const subject = '🔐 NaviGuard — Account Password Reset Code';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 56px; height: 56px; background-color: #f3e8ff; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
            <span style="font-size: 28px;">🔐</span>
          </div>
          <h2 style="color: #0f172a; margin: 0 0 6px 0; font-weight: 800; font-size: 20px;">Password Reset Request</h2>
          <p style="color: #64748b; font-size: 13px; margin: 0;">NaviGuard Account Security</p>
        </div>

        <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          Hello ${profile.full_name || 'NaviGuard User'}, a password reset request was initiated for your account (<strong>${maskEmail(cleanEmail)}</strong>).
        </p>

        <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); padding: 20px; text-align: center; border-radius: 16px; margin: 24px 0; border: 1px solid #e9d5ff;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #7e22ce; display: block; margin-bottom: 8px;">Verification Code</span>
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #581c87; font-family: monospace;">${otp}</span>
        </div>

        <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 24px;">
          ⏱️ Code valid for <strong>10 minutes</strong>. Entering this code will allow you to reset your password and unlock your account.
        </p>

        <div style="border-t: 1px solid #f1f5f9; pt-16px; margin-top: 24px; text-align: center;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">If you did not request a password reset, please ignore this email.</p>
        </div>
      </div>
    `;

    const mailResult = await sendVerificationEmail({
      to: cleanEmail,
      subject,
      otp,
      html,
    });

    if (!mailResult.success) {
      return NextResponse.json(
        { error: 'Failed to send OTP email: ' + (mailResult.error || 'Check email configuration') },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email: maskEmail(cleanEmail),
      message: 'Verification code sent to your email address.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error requesting password reset OTP' }, { status: 500 });
  }
}
