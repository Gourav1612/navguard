import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sendVerificationEmail } from '@/lib/mail';

export async function POST() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes from now

    // Update user metadata in Supabase
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        mfa_otp: otp,
        mfa_otp_expires: expiry,
      },
    });

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to save verification code', details: updateError },
        { status: 500 }
      );
    }

    // Call mail dispatcher
    const subject = 'NaviGuard MFA Verification Code';
    const html = `
      <div style="font-family: sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #3b255e; margin-bottom: 8px; font-weight: 800;">MFA Verification Request</h2>
        <p style="color: #475569; font-size: 14px; line-height: 1.5;">A request was made to modify your Multi-Factor Authentication settings on NaviGuard.</p>
        <div style="background-color: #f8fafc; padding: 18px; text-align: center; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1e293b; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 11px; margin-top: 20px; line-height: 1.4;">If you did not request this, please change your password immediately. Code is valid for 5 minutes.</p>
      </div>
    `;

    const mailResult = await sendVerificationEmail({
      to: profile?.email || user.email!,
      subject,
      otp,
      html,
    });

    if (!mailResult.success) {
      return NextResponse.json(
        { error: 'Failed to send email verification.', details: mailResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent successfully to email.',
      // Only include UAT developer code in response if NO real email was sent (local testing fallback)
      ...(!mailResult.sentRealEmail ? { dev_otp: otp } : {})
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
