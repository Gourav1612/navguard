import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { LoginSchema } from '@/lib/validations';

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

        // Update failed attempts and lock status in Supabase auth user_metadata
        await adminClient.auth.admin.updateUserById(profileObj.id, {
          user_metadata: {
            ...fetchedUser.user_metadata,
            login_attempts: newAttempts,
            login_locked: locked,
          }
        });

        if (locked) {
          // Trigger a system alert notification for the school admin
          await adminClient.from('notifications').insert({
            school_id: profileObj.school_id,
            title: '🔒 User Login Locked',
            message: `${profileObj.full_name || email} (${email}) has been locked out after 5 failed login attempts. Password reset is required.`,
            type: 'general',
          });

          return NextResponse.json(
            { error: 'Your account has been locked due to too many failed attempts. Admin has been notified.', code: 'FORBIDDEN' },
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
