import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sendVerificationEmail } from '@/lib/mail';
import crypto from 'crypto';

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [name, domain] = parts;
  const maskedName = name.length <= 2 ? name[0] + '*' : name.slice(0, 2) + '*'.repeat(Math.max(name.length - 2, 2));
  return `${maskedName}@${domain}`;
}

export async function POST() {
  const auth = await requireRole(['admin'], { skipMfa: true });
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const supabase = await createSupabaseServerClient();
  const targetEmail = profile?.email || user.email;

  if (!targetEmail) {
    return NextResponse.json({ error: 'No email address found for admin user' }, { status: 400 });
  }

  try {
    // Generate 6-digit OTP using secure randomInt
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes valid

    // Update user metadata in Supabase
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        password_change_otp: otp,
        password_change_otp_expires: expiry,
        password_change_otp_attempts: 0,
      },
    });

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to generate password reset session', details: updateError.message },
        { status: 500 }
      );
    }

    // Call mail dispatcher
    const subject = '🔐 NaviGuard Security — Admin Password Change Code';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 36px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #d1fae5; border-radius: 20px; background-color: #ffffff; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 60px; height: 60px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            <span style="font-size: 30px;">🔐</span>
          </div>
          <h2 style="color: #065f46; margin: 0 0 6px 0; font-weight: 900; font-size: 22px; letter-spacing: -0.3px;">Admin Password Change</h2>
          <p style="color: #059669; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0;">NaviGuard Security Portal</p>
        </div>

        <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          A request was initiated from the Admin Panel to change your account password.
        </p>

        <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); padding: 20px; text-align: center; border-radius: 16px; margin: 24px 0; border: 1px solid #a7f3d0;">
          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #047857; display: block; margin-bottom: 8px;">Verification Code</span>
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #065f46; font-family: monospace;">${otp}</span>
        </div>

        <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 24px;">
          ⏱️ This code is valid for <strong>10 minutes</strong>. Do not share this OTP code with anyone.
        </p>

        <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; text-align: center;">
          <p style="color: #94a3b8; font-size: 11px; margin: 0;">If you did not request a password change, please ignore this email.</p>
        </div>
      </div>
    `;

    const mailResult = await sendVerificationEmail({
      to: targetEmail,
      subject,
      otp,
      html,
    });

    if (!mailResult.success) {
      return NextResponse.json(
        { error: 'Failed to send OTP email: ' + (mailResult.error || 'Check SMTP configuration') },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email: maskEmail(targetEmail),
      sentRealEmail: mailResult.sentRealEmail,
      message: 'OTP verification code dispatched to your email.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error generating OTP' }, { status: 500 });
  }
}
