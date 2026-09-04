import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LoginSchema } from '@/lib/validations';
import { sendVerificationEmail } from '@/lib/mail';
import crypto from 'crypto';

function getAppOrigin(req?: NextRequest) {
  if (req) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`;
    }
  }

  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {}
  }

  if (req) {
    return req.nextUrl.origin;
  }

  return 'http://localhost:3000';
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

    const rawIdentifier = (parsed.data.identifier || parsed.data.email || '').trim();
    const { password, ip } = parsed.data;

    // Use admin client to query user profile by Username or Email
    const adminClient = createAdminClient();
    const isEmailInput = rawIdentifier.includes('@');

    let profileObj: any = null;
    let targetEmail: string | null = null;

    if (isEmailInput) {
      targetEmail = rawIdentifier.toLowerCase();
      const { data } = await adminClient
        .from('user_profiles')
        .select('id, plant_id, full_name, role, email')
        .eq('email', targetEmail)
        .maybeSingle();
      profileObj = data;
    } else {
      // Find auth user by user_metadata.username or email prefix
      const { data: authUsersData } = await adminClient.auth.admin.listUsers();
      const matchedUser = (authUsersData?.users || []).find((u) => {
        const uName = u.user_metadata?.username || (u.email ? u.email.split('@')[0] : '');
        return uName.toLowerCase() === rawIdentifier.toLowerCase();
      });

      if (matchedUser && matchedUser.email) {
        targetEmail = matchedUser.email;
        const { data } = await adminClient
          .from('user_profiles')
          .select('id, plant_id, full_name, role, email')
          .eq('id', matchedUser.id)
          .maybeSingle();
        profileObj = data;
      }
    }

    if (!targetEmail) {
      return NextResponse.json(
        { error: 'Invalid username or password.', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    let fetchedUser: any = null;
    if (profileObj) {
      const { data: { user } } = await adminClient.auth.admin.getUserById(profileObj.id);
      if (user) {
        fetchedUser = user;
      }
    }

    if (fetchedUser) {
      const attempts = Number(fetchedUser.user_metadata?.login_attempts || 0);
      const isLocked = fetchedUser.user_metadata?.login_locked === true || attempts >= 5;
      if (isLocked) {
        const isAdmin = profileObj?.role === 'admin';
        if (isAdmin) {
          const lastSentAt = Number(fetchedUser.user_metadata?.password_reset_token_sent_at || 0);
          const canSendEmail = Date.now() - lastSentAt > 2 * 60 * 1000;

          if (canSendEmail) {
            const newToken = crypto.randomUUID();
            const tokenExpires = Date.now() + 10 * 60 * 1000;

            await adminClient.auth.admin.updateUserById(profileObj.id, {
              user_metadata: {
                ...fetchedUser.user_metadata,
                login_locked: true,
                password_reset_token: newToken,
                password_reset_token_expires: tokenExpires,
                password_reset_token_sent_at: Date.now(),
              }
            });

            const origin = getAppOrigin(req);
            const resetUrl = `${origin}/reset-password?token=${newToken}&email=${encodeURIComponent(targetEmail!)}`;
            const html = `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 36px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #d1fae5; border-radius: 20px; background-color: #ffffff; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
                <div style="text-align: center; margin-bottom: 24px;">
                  <div style="width: 60px; height: 60px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
                    <span style="font-size: 30px;">🔑</span>
                  </div>
                  <h2 style="color: #065f46; margin: 0 0 6px 0; font-weight: 900; font-size: 22px; letter-spacing: -0.3px;">Admin Password Reset Request</h2>
                  <p style="color: #059669; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0;">NaviGuard Security Command</p>
                </div>

                <div style="background-color: #f0fdf4; border: 1px solid #d1fae5; border-radius: 14px; padding: 18px; margin-bottom: 24px;">
                  <p style="color: #1e293b; font-size: 14px; line-height: 1.6; margin: 0;">
                    Hello <strong>${profileObj.full_name || 'System Administrator'}</strong>,<br/><br/>
                    Your Admin account (<span style="color: #047857; font-weight: 600;">${targetEmail}</span>) is locked. A new password reset link has been generated for your account.
                  </p>
                </div>

                <div style="text-align: center; margin: 28px 0;">
                  <a href="${resetUrl}" target="_blank" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: 800; border-radius: 14px; display: inline-block; font-size: 14px; letter-spacing: 0.3px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);">Reset Admin Password</a>
                </div>

                <div style="border-top: 1px solid #f1f5f9; padding-top: 18px; margin-top: 24px; text-align: center;">
                  <p style="color: #64748b; font-size: 11px; margin: 0;">
                    ⏱️ Password reset link is valid for <strong>10 minutes</strong>. If you did not initiate this request, please contact system administration immediately.
                  </p>
                </div>
              </div>
            `;

            try {
              await sendVerificationEmail({
                to: targetEmail!,
                subject: '🔑 NaviGuard Admin — New Password Reset Link',
                otp: newToken,
                html,
              });
            } catch (mErr) {
              console.error('[Login] Failed to re-dispatch reset email:', mErr);
            }

            return NextResponse.json(
              { error: 'Account is locked. A NEW password reset link has been dispatched to your email. Please check your inbox.', code: 'UNAUTHORIZED' },
              { status: 401 }
            );
          }

          return NextResponse.json(
            { error: 'Account is locked. A reset link was recently sent to your email. Please check your inbox or wait 2 minutes to request a new link.', code: 'UNAUTHORIZED' },
            { status: 401 }
          );
        }

        return NextResponse.json(
          { error: 'Account is locked due to 5 failed login attempts. Please contact your Administrator to unlock or reset your password.', code: 'UNAUTHORIZED' },
          { status: 401 }
        );
      }
    }

    // Use SSR server client so session cookies are automatically set via cookies headers
    const supabase = await createSupabaseServerClient();
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password,
    });

    if (authError || !authData.user) {
      if (profileObj && fetchedUser) {
        const currentAttempts = Number(fetchedUser.user_metadata?.login_attempts || 0);
        const newAttempts = currentAttempts + 1;
        const reachedLimit = newAttempts >= 5;
        const isAdmin = profileObj.role === 'admin';
        
        const lastSentAt = Number(fetchedUser.user_metadata?.password_reset_token_sent_at || 0);
        const canSendEmail = Date.now() - lastSentAt > 2 * 60 * 1000;
        const resetToken = reachedLimit && isAdmin ? (canSendEmail || !fetchedUser.user_metadata?.password_reset_token ? crypto.randomUUID() : fetchedUser.user_metadata.password_reset_token) : null;
        const resetTokenExpires = reachedLimit && isAdmin ? Date.now() + 10 * 60 * 1000 : null;

        // Update failed attempts counter and status
        await adminClient.auth.admin.updateUserById(profileObj.id, {
          user_metadata: {
            ...fetchedUser.user_metadata,
            login_attempts: newAttempts,
            login_locked: reachedLimit ? true : false,
            password_reset_token: resetToken,
            password_reset_token_expires: resetTokenExpires,
            password_reset_token_sent_at: reachedLimit && isAdmin && canSendEmail ? Date.now() : lastSentAt,
          }
        });

        if (reachedLimit) {
          if (isAdmin) {
            if (canSendEmail) {
              // Dispatch reset password link via email ONLY for Admin
              try {
                const origin = getAppOrigin(req);
                const resetUrl = `${origin}/reset-password?token=${resetToken}&email=${encodeURIComponent(targetEmail)}`;
                const html = `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 36px 24px; max-width: 500px; margin: 0 auto; border: 1px solid #d1fae5; border-radius: 20px; background-color: #ffffff; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
                    <div style="text-align: center; margin-bottom: 24px;">
                      <div style="width: 60px; height: 60px; background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 18px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
                        <span style="font-size: 30px;">🔑</span>
                      </div>
                      <h2 style="color: #065f46; margin: 0 0 6px 0; font-weight: 900; font-size: 22px; letter-spacing: -0.3px;">Admin Password Reset Request</h2>
                      <p style="color: #059669; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin: 0;">NaviGuard Security Command</p>
                    </div>

                    <div style="background-color: #f0fdf4; border: 1px solid #d1fae5; border-radius: 14px; padding: 18px; margin-bottom: 24px;">
                      <p style="color: #1e293b; font-size: 14px; line-height: 1.6; margin: 0;">
                        Hello <strong>${profileObj.full_name || 'System Administrator'}</strong>,<br/><br/>
                        <strong>5 consecutive failed login attempts</strong> were recorded for your Admin account (<span style="color: #047857; font-weight: 600;">${targetEmail}</span>). To protect system security, your account has been temporarily locked.
                      </p>
                    </div>

                    <div style="text-align: center; margin: 28px 0;">
                      <a href="${resetUrl}" target="_blank" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: 800; border-radius: 14px; display: inline-block; font-size: 14px; letter-spacing: 0.3px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);">Reset Admin Password</a>
                    </div>

                    <div style="border-top: 1px solid #f1f5f9; padding-top: 18px; margin-top: 24px; text-align: center;">
                      <p style="color: #64748b; font-size: 11px; margin: 0;">
                        ⏱️ Password reset link is valid for <strong>10 minutes</strong>. If you did not initiate this request, please contact system administration immediately.
                      </p>
                    </div>
                  </div>
                `;

                await sendVerificationEmail({
                  to: targetEmail,
                  subject: '🔑 NaviGuard Admin — Password Reset Link (5 Failed Login Attempts)',
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
          } else {
            // Non-Admin: Record an urgent Audit Log Lockout Alert for Admin
            await adminClient.from('audit_logs').insert({
              plant_id: profileObj.plant_id,
              user_id: profileObj.id,
              action: 'DELETE',
              table_name: 'user_profiles (LOCKOUT ALERT)',
              record_id: profileObj.id,
              ip_address: ip || req.headers.get('x-forwarded-for') || undefined,
              user_agent: req.headers.get('user-agent') || undefined,
            });

            return NextResponse.json(
              { error: 'Account is locked due to 5 failed login attempts. Please contact your Administrator to unlock or reset your password.', code: 'UNAUTHORIZED' },
              { status: 401 }
            );
          }
        }
      }

      return NextResponse.json(
        { error: 'Invalid username or password.', code: 'UNAUTHORIZED' },
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
