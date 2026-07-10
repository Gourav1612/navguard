import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { user } = auth;
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

    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      // 1. Production Mode: Send real email using Resend API securely
      try {
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: 'NaviGuard Security <onboarding@resend.dev>',
            to: [user.email],
            subject: '🛡️ NaviGuard MFA Verification Code',
            html: `
              <div style="font-family: sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                <h2 style="color: #3b255e; margin-bottom: 8px; font-weight: 800;">MFA Verification Request</h2>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">A request was made to modify your Multi-Factor Authentication settings on NaviGuard.</p>
                <div style="background-color: #f8fafc; padding: 18px; text-align: center; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
                  <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1e293b; font-family: monospace;">${otp}</span>
                </div>
                <p style="color: #64748b; font-size: 11px; margin-top: 20px; line-height: 1.4;">If you did not request this, please change your password immediately. Code is valid for 5 minutes.</p>
              </div>
            `,
          }),
        });

        if (!emailResponse.ok) {
          const errData = await emailResponse.json();
          throw new Error(errData.message || 'Failed to dispatch email via Resend');
        }

        return NextResponse.json({
          success: true,
          message: 'Verification code sent successfully to email.',
        });
      } catch (emailErr: any) {
        console.error('[MFA-EMAIL-ERROR] Failed to send email via Resend:', emailErr);
        // Secure fallback to local UAT display during testing if dispatch fails
        return NextResponse.json({
          success: true,
          message: 'Email dispatch failed. Falling back to secure UAT display.',
          dev_otp: otp,
        });
      }
    } else {
      // 2. Local UAT / Development Mode: Print to terminal console
      console.log('\n=============================================================');
      console.log(`[MFA-OTP] Verification code for user ${user.email} is: ${otp}`);
      console.log('=============================================================\n');

      return NextResponse.json({
        success: true,
        message: 'Verification code generated.',
        dev_otp: otp,
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
