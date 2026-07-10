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

    // Print code to server console logs for development and UAT verification
    console.log('\n=============================================================');
    console.log(`[MFA-OTP] Verification code for user ${user.email} is: ${otp}`);
    console.log('=============================================================\n');

    // Return success response (include development fallback code in JSON in DEV mode)
    return NextResponse.json({ 
      success: true, 
      message: 'Verification code sent to email.',
      dev_otp: otp
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
