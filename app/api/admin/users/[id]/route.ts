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

    // 1. Update user details in Auth if password or email is changed
    const authUpdatePayload: any = {};
    if (parsed.data.email) authUpdatePayload.email = parsed.data.email;
    if (parsed.data.password) authUpdatePayload.password = parsed.data.password;
    
    // Always sync metadata in auth
    authUpdatePayload.user_metadata = {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      plant_id: parsed.data.plant_id || null,
      supervisor_id: parsed.data.supervisor_id || null,
      location_interval: parsed.data.location_interval || 10,
    };

    const { error: authErr } = await adminClient.auth.admin.updateUserById(id, authUpdatePayload);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 500 });
    }

    // 2. Update user_profiles details
    const profileUpdatePayload: any = {};
    if (parsed.data.full_name !== undefined) profileUpdatePayload.full_name = parsed.data.full_name;
    if (parsed.data.role !== undefined) profileUpdatePayload.role = parsed.data.role;
    if (parsed.data.plant_id !== undefined) profileUpdatePayload.plant_id = parsed.data.plant_id || null;
    if (parsed.data.supervisor_id !== undefined) profileUpdatePayload.supervisor_id = parsed.data.supervisor_id || null;
    if (parsed.data.phone !== undefined) profileUpdatePayload.phone = parsed.data.phone || null;
    if (parsed.data.is_active !== undefined) profileUpdatePayload.is_active = parsed.data.is_active;
    if (parsed.data.location_interval !== undefined) profileUpdatePayload.location_interval = parsed.data.location_interval;

    const { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .update(profileUpdatePayload)
      .eq('id', id)
      .select()
      .single();

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    return NextResponse.json(profile);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
