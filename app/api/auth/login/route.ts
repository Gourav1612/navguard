import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LoginSchema } from '@/lib/validations';
import { sendVerificationEmail } from '@/lib/mail';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request payload', 
          code: 'VALIDATION_ERROR', 
          details: parsed.error.format() 
        }, 
        { status: 400 }
      );
    }

    const { email, password, ip } = parsed.data;

    // Use admin client to query user lockout status
    const adminClient = createAdminClient();
    
    // Find the user's profile to get their auth user ID
    const { data: profileObj } = await adminClient
      .from('user_profiles')
      .select('id, school_id, full_name')
      .eq('email', email)
      .maybeSingle();

    let fetchedUser: any = null;
    if (profileObj) {
      const { data: { user }, error: userError } = await adminClient.auth.admin.getUserById(profileObj.id);
      if (user) {
        fetchedUser = user;
        const isLocked = user.user_metadata?.login_locked === true;
        if (isLocked) {
          return NextResponse.json(
            { error: 'Your account is locked due to too many failed login attempts. Please contact Admin.', code: 'FORBIDDEN' },
            { status: 403 }
          );
        }
      }
    }

    // Use SSR server client so session cookies are automatically set via cookies headers
    const supabase = await createSupabaseServerClient();
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      if (profileObj && fetchedUser) {
        const currentAttempts = Number(fetchedUser.user_metadata?.login_attempts || 0);
        const newAttempts = currentAttempts + 1;
        const locked = newAttempts >= 5;

        const resetToken = locked ? crypto.randomUUID() : null;
        const resetTokenExpires = locked ? Date.now() + 15 * 60 * 1000 : null;

        // Update failed attempts and lock status in Supabase auth user_metadata
        await adminClient.auth.admin.updateUserById(profileObj.id, {
          user_metadata: {
            ...fetchedUser.user_metadata,
            login_attempts: newAttempts,
            login_locked: locked,
            password_reset_token: resetToken,
            password_reset_token_expires: resetTokenExpires,
          }
        });

        if (locked) {
          // Trigger a system alert notification for the school admin
          await adminClient.from('notifications').insert({
            school_id: profileObj.school_id,
            title: '🔒 User Login Locked',
            message: `${profileObj.full_name || email} (${email}) has been locked out after 5 failed login attempts. Password reset link dispatched to email.`,
            type: 'general',
          });

          // Dispatch magic reset link via email
          try {
            const origin = req.headers.get('origin') || 'https://navguard-eight.vercel.app';
            const resetUrl = `${origin}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
            const html = `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <div style="width: 56px; height: 56px; background-color: #fee2e2; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                    <span style="font-size: 28px;">🔒</span>
                  </div>
                  <h2 style="color: #991b1b; margin: 0 0 6px 0; font-weight: 800; font-size: 20px;">Account Locked Security Alert</h2>
                  <p style="color: #64748b; font-size: 13px; margin: 0;">NaviGuard Security System</p>
                </div>

                <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
                  Hello ${profileObj.full_name || 'NaviGuard User'}, your account was locked after <strong>5 consecutive failed login attempts</strong>.
                </p>
                <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                  To unlock your account and set a new password, click the secure reset button below:
                </p>

                <div style="text-align: center; margin: 28px 0;">
                  <a href="${resetUrl}" target="_blank" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: 800; border-radius: 12px; display: inline-block; font-size: 14px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);">Reset Password & Unlock Account</a>
                </div>

                <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 24px;">
                  ⏱️ This reset link is valid for <strong>15 minutes</strong>. If you did not initiate this login, someone else tried to log in to your account.
                </p>

                <div style="border-t: 1px solid #f1f5f9; pt-16px; margin-top: 24px; text-align: center;">
                  <p style="color: #94a3b8; font-size: 11px; margin: 0;">NaviGuard Automated Security System</p>
                </div>
              </div>
            `;

            await sendVerificationEmail({
              to: email,
              subject: '🔒 NaviGuard — Account Locked: Reset Password Link',
              otp: resetToken!,
              html,
            });
          } catch (mailErr) {
            console.error('Failed to send magic reset link email:', mailErr);
          }

          return NextResponse.json(
            { error: 'Account locked due to 5 failed login attempts. A password reset link has been sent to your registered email.', code: 'FORBIDDEN' },
            { status: 403 }
          );
        }

        return NextResponse.json(
          { error: `Incorrect password. Attempts remaining: ${5 - newAttempts}`, code: 'UNAUTHORIZED' },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: authError?.message || 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Clear failed attempts counter and unlock on successful login
    if (profileObj && fetchedUser) {
      await adminClient.auth.admin.updateUserById(profileObj.id, {
        user_metadata: {
          ...fetchedUser.user_metadata,
          login_attempts: 0,
          login_locked: false,
        }
      });
    }

    // Retrieve user profile (role, full_name, school_id)
    const { data: profile, error: profileError } = await adminClient
      .from('user_profiles')
      .select('role, full_name, school_id, is_active')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'User profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (!profile.is_active) {
      // Deactivated account
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: 'Account disabled', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // Write audit log using the system admin client
    await adminClient.from('audit_logs').insert({
      school_id: profile.school_id,
      user_id: authData.user.id,
      action: 'LOGIN',
      table_name: 'user_profiles',
      record_id: authData.user.id,
      ip_address: ip || req.headers.get('x-forwarded-for') || undefined,
      user_agent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: profile.role,
        full_name: profile.full_name,
        school_id: profile.school_id,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
