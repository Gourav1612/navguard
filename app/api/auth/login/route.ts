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

    // Use SSR server client so session cookies are automatically set via cookies headers
    const supabase = await createSupabaseServerClient();
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Initialize admin client to query profiles and log audits (bypasses RLS session cookie propagation lag)
    const adminClient = createAdminClient();

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
