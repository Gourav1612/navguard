import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LoginSchema } from '@/lib/validations';
import { sendVerificationEmail } from '@/lib/mail';
import crypto from 'crypto';

function getAppOrigin() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (!configuredUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL environment variable is required but not set');
  }

  try {
    return new URL(configuredUrl).origin;
  } catch {
    throw new Error(`Invalid APP_URL config: ${configuredUrl}`);
  }
}

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
      .select('id, plant_id, full_name')
      .eq('email', email)
      .maybeSingle();

    let fetchedUser: any = null;
    if (profileObj) {
      const { data: { user }, error: userError } = await adminClient.auth.admin.getUserById(profileObj.id);
      if (user) {
        fetchedUser = user;
      }
    }

    if (fetchedUser) {
      const attempts = Number(fetchedUser.user_metadata?.login_attempts || 0);
      const isLocked = fetchedUser.user_metadata?.login_locked === true || attempts >= 5;
      if (isLocked) {
        return NextResponse.json(
          { error: 'Account is locked due to too many failed login attempts. Please check your email for reset instructions.', code: 'UNAUTHORIZED' },
          { status: 401 }
        );
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
        const reachedLimit = newAttempts >= 5;
        const lastSentAt = Number(fetchedUser.user_metadata?.password_reset_token_sent_at || 0);
        // Rate-limiting: Only dispatch a new email if 2 minutes have passed since last dispatch
        const canSendEmail = Date.now() - lastSentAt > 2 * 60 * 1000;
        const resetToken = reachedLimit ? (canSendEmail || !fetchedUser.user_metadata?.password_reset_token ? crypto.randomUUID() : fetchedUser.user_metadata.password_reset_token) : null;
        const resetTokenExpires = reachedLimit ? Date.now() + 10 * 60 * 1000 : null;

        // Update failed attempts counter, reset token, and rate-limit timestamp
        await adminClient.auth.admin.updateUserById(profileObj.id, {
          user_metadata: {
            ...fetchedUser.user_metadata,
            login_attempts: newAttempts,
            login_locked: reachedLimit ? true : false,
            password_reset_token: resetToken,
            password_reset_token_expires: resetTokenExpires,
            password_reset_token_sent_at: reachedLimit && canSendEmail ? Date.now() : lastSentAt,
          }
        });

        if (reachedLimit) {
          if (canSendEmail) {
            // Dispatch reset password link via email
            try {
              const origin = getAppOrigin();
              const resetUrl = `${origin}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
              const html = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
                  <div style="text-align: center; margin-bottom: 24px;">
                    <div style="width: 56px; height: 56px; background-color: #f3e8ff; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                      <span style="font-size: 28px;">🔑</span>
                    </div>
                    <h2 style="color: #581c87; margin: 0 0 6px 0; font-weight: 800; font-size: 20px;">Password Reset Request</h2>
                    <p style="color: #64748b; font-size: 13px; margin: 0;">NaviGuard Account Security</p>
                  </div>

                  <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
                    Hello ${profileObj.full_name || 'NaviGuard User'}, <strong>5 consecutive failed login attempts</strong> were recorded for your account (${email}).
                  </p>
                  <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                    To set a new password for your account, click the secure button below:
                  </p>

                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${resetUrl}" target="_blank" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: 800; border-radius: 12px; display: inline-block; font-size: 14px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);">Reset Account Password</a>
                  </div>

                  <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin-bottom: 24px;">
                    ⏱️ This link is valid for <strong>10 minutes</strong>. If you did not attempt to log in, please ignore this email.
                  </p>

                  <div style="border-t: 1px solid #f1f5f9; pt-16px; margin-top: 24px; text-align: center;">
                    <p style="color: #94a3b8; font-size: 11px; margin: 0;">NaviGuard Automated Security System</p>
                  </div>
                </div>
              `;

              await sendVerificationEmail({
                to: email,
                subject: '🔑 NaviGuard — Password Reset Link (5 Failed Login Attempts)',
                otp: resetToken!,
                html,
              });
            } catch (mailErr) {
              console.error('Failed to send reset link email:', mailErr);
            }
          }

          return NextResponse.json(
            { error: 'Account is locked due to too many failed login attempts. Please check your email for reset instructions.', code: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }
      }

      return NextResponse.json(
        { error: 'Invalid email or password.', code: 'UNAUTHORIZED' },
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

    // Retrieve user profile (role, full_name, plant_id)
    const { data: profile, error: profileError } = await adminClient
      .from('user_profiles')
      .select('role, full_name, plant_id, is_active')
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
        { error: 'Your account has been deactivated. Please contact support.', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Save role & is_active in user_metadata so middleware & server components always have instant access to user role
    await adminClient.auth.admin.updateUserById(authData.user.id, {
      user_metadata: {
        ...authData.user.user_metadata,
        role: profile.role,
        is_active: profile.is_active,
        login_attempts: 0,
        login_locked: false,
      }
    });

    // Write audit log using the system admin client
    await adminClient.from('audit_logs').insert({
      plant_id: profile.plant_id,
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
        plant_id: profile.plant_id,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
