import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sendVerificationEmail } from '@/lib/mail';
import { generateSecureOtp, safeErrorResponse } from '@/lib/security-utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';

export async function POST(request: Request) {
  const auth = await requireRole(['admin'], { skipMfa: true });
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const clientIp = getClientIp(request);

  // Rate limiting: Max 3 OTP requests per 5 minutes per user and IP
  const rateLimitUser = checkRateLimit(user.id, {
    prefix: 'mfa_send_otp_user',
    maxRequests: 3,
    windowSeconds: 300,
  });
  if (!rateLimitUser.allowed) return rateLimitUser.response!;

  const rateLimitIp = checkRateLimit(clientIp, {
    prefix: 'mfa_send_otp_ip',
    maxRequests: 5,
    windowSeconds: 300,
  });
  if (!rateLimitIp.allowed) return rateLimitIp.response!;

  const supabase = await createSupabaseServerClient();

  try {
    // Generate cryptographically secure 6-digit OTP using CSPRNG
    const otp = generateSecureOtp();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes from now

    // Update user metadata in Supabase
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        mfa_otp: otp,
        mfa_otp_expires: expiry,
        mfa_otp_attempts: 0,
      },
    });

    if (updateError) {
      return safeErrorResponse(updateError, 'Failed to save verification code. Please try again.', 500);
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
      return safeErrorResponse(mailResult.error, 'Failed to send email verification code.', 500);
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent successfully to email.',
    });
  } catch (err: unknown) {
    return safeErrorResponse(err, 'An error occurred while generating verification code.', 500);
  }
}
