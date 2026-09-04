import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { sendVerificationEmail } from '@/lib/mail';

export async function POST(request: Request) {
  const auth = await requireRole(['admin'], { skipMfa: true });
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
      const currentAttempts = Number(user.user_metadata?.mfa_otp_attempts || 0);
      const newAttempts = currentAttempts + 1;

      if (newAttempts >= 5) {
        // Generate new 6-digit OTP
        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes from now

        // Update user metadata in Supabase
        await supabase.auth.updateUser({
          data: {
            mfa_otp: newOtp,
            mfa_otp_expires: expiry,
            mfa_otp_attempts: 0,
          },
        });

        // Send new email code
        const subject = 'NaviGuard MFA Verification Code';
        const html = `
          <div style="font-family: sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <h2 style="color: #10b981; margin-bottom: 8px; font-weight: 800;">MFA Verification Request</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.5;">A request was made to modify your Multi-Factor Authentication settings on NaviGuard. Your previous verification attempts were exceeded.</p>
            <div style="background-color: #f8fafc; padding: 18px; text-align: center; border-radius: 12px; margin: 20px 0; border: 1px dashed #cbd5e1;">
              <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1e293b; font-family: monospace;">${newOtp}</span>
            </div>
            <p style="color: #64748b; font-size: 11px; margin-top: 20px; line-height: 1.4;">If you did not request this, please change your password immediately. Code is valid for 5 minutes.</p>
          </div>
        `;

        await sendVerificationEmail({
          to: user.email!,
          subject,
          otp: newOtp,
          html,
        });

        return NextResponse.json(
          { error: 'Maximum attempts exceeded. A new verification code has been sent to your email.' },
          { status: 400 }
        );
      } else {
        // Increment attempts count in user metadata
        await supabase.auth.updateUser({
          data: {
            mfa_otp_attempts: newAttempts,
          },
        });

        return NextResponse.json(
          { error: `Incorrect verification code. Attempts remaining: ${5 - newAttempts}` },
          { status: 400 }
        );
      }
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
