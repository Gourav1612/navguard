import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';
import { CreateUserSchema } from '@/lib/validations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    const body = await req.json();
    // Validate updates (making password optional during edit)
    const parsed = CreateUserSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Enforce single-admin limit across the system
    if (parsed.data.role === 'admin') {
      const { data: existingAdmin } = await adminClient
        .from('user_profiles')
        .select('id')
        .eq('role', 'admin')
        .neq('id', id)
        .limit(1)
        .maybeSingle();

      if (existingAdmin) {
        return NextResponse.json(
          { error: 'System limit reached: Only 1 System Administrator account is allowed.' },
          { status: 400 }
        );
      }
    }

    // Fetch existing auth user metadata to preserve fields and UNLOCK account upon admin edit/password update
    const { data: { user: existingAuthUser } } = await adminClient.auth.admin.getUserById(id);

    // 1. Update user details in Auth if password or email is changed
    const authUpdatePayload: any = {};
    if (body.email !== undefined && parsed.data.email) authUpdatePayload.email = parsed.data.email;
    if (body.password !== undefined && parsed.data.password) authUpdatePayload.password = parsed.data.password;
    
    // Always sync metadata in auth AND unlock account (reset failed login attempts counter)
    // Only update metadata fields that were explicitly provided in the request payload body
    const updatedMetadata = { ...existingAuthUser?.user_metadata };
    if (body.full_name !== undefined) updatedMetadata.full_name = parsed.data.full_name;
    if (body.username !== undefined) updatedMetadata.username = parsed.data.username || null;
    if (body.role !== undefined) updatedMetadata.role = parsed.data.role;
    if (body.plant_id !== undefined) updatedMetadata.plant_id = parsed.data.plant_id || null;
    if (body.supervisor_id !== undefined) updatedMetadata.supervisor_id = parsed.data.supervisor_id || null;
    if (body.location_interval !== undefined) updatedMetadata.location_interval = parsed.data.location_interval;
    if (body.is_active !== undefined) updatedMetadata.is_active = parsed.data.is_active;

    authUpdatePayload.user_metadata = {
      ...updatedMetadata,
      login_locked: false,
      login_attempts: 0,
      password_reset_token: null,
      password_reset_token_expires: null,
    };

    const { error: authErr } = await adminClient.auth.admin.updateUserById(id, authUpdatePayload);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 500 });
    }

    // 2. Update user_profiles details
    const profileUpdatePayload: any = {};
    if (body.full_name !== undefined) profileUpdatePayload.full_name = parsed.data.full_name;
    if (body.username !== undefined) profileUpdatePayload.username = parsed.data.username || null;
    if (body.role !== undefined) profileUpdatePayload.role = parsed.data.role;
    if (body.plant_id !== undefined) profileUpdatePayload.plant_id = parsed.data.plant_id || null;
    if (body.supervisor_id !== undefined) profileUpdatePayload.supervisor_id = parsed.data.supervisor_id || null;
    if (body.phone !== undefined) profileUpdatePayload.phone = parsed.data.phone || null;
    if (body.is_active !== undefined) profileUpdatePayload.is_active = parsed.data.is_active;
    if (body.location_interval !== undefined) profileUpdatePayload.location_interval = parsed.data.location_interval;

    let { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .update(profileUpdatePayload)
      .eq('id', id)
      .select()
      .single();

    if (profileErr && profileUpdatePayload.username) {
      delete profileUpdatePayload.username;
      const fallbackRes = await adminClient
        .from('user_profiles')
        .update(profileUpdatePayload)
        .eq('id', id)
        .select()
        .single();
      profile = fallbackRes.data;
      profileErr = fallbackRes.error;
    }

    if (profileErr && !profile) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    return NextResponse.json(profile);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
