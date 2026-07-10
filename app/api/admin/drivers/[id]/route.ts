import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateDriverSchema } from '@/lib/validations';

// PATCH /api/admin/drivers/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const partialSchema = CreateDriverSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: driver, error: fetchErr } = await adminClient
      .from('drivers')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !driver) {
      return NextResponse.json(
        { error: 'Driver not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { full_name, phone, license_number, license_expiry, bus_id, is_active } = parsed.data;

    // 1. Update public.drivers details
    const driverUpdates: any = {};
    if (license_number !== undefined) driverUpdates.license_number = license_number;
    if (license_expiry !== undefined) driverUpdates.license_expiry = license_expiry;
    if (bus_id !== undefined) driverUpdates.bus_id = bus_id;
    if (is_active !== undefined) driverUpdates.is_active = is_active;

    if (Object.keys(driverUpdates).length > 0) {
      await adminClient
        .from('drivers')
        .update(driverUpdates)
        .eq('id', id);
    }

    // 2. Update user_profiles details
    const profileUpdates: any = {};
    if (full_name !== undefined) profileUpdates.full_name = full_name;
    if (phone !== undefined) profileUpdates.phone = phone;
    if (is_active !== undefined) profileUpdates.is_active = is_active;

    if (Object.keys(profileUpdates).length > 0) {
      await adminClient
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', driver.user_id);
    }

    // Fetch updated complete record
    const { data: updatedDriver } = await adminClient
      .from('drivers')
      .select(`
        *,
        bus:buses(id, name),
        user:user_profiles(full_name, email, phone)
      `)
      .eq('id', id)
      .single();

    return NextResponse.json(updatedDriver);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/drivers/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const adminClient = createAdminClient();

  try {
    // Verify ownership
    const { data: driver, error: fetchErr } = await adminClient
      .from('drivers')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !driver) {
      return NextResponse.json(
        { error: 'Driver not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Deleting the auth user automatically cascades and deletes the user profile and driver row!
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(driver.user_id);

    if (authDeleteErr) {
      // Fallback: try deleting driver profile directly if auth deletion fails
      await adminClient.from('drivers').delete().eq('id', id);
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
