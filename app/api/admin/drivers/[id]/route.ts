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

    const { full_name, phone, license_number, license_expiry, bus_id, is_active, password } = parsed.data;

    // Convert empty string bus_id to null
    const finalBusId = bus_id && typeof bus_id === 'string' && bus_id.trim() !== '' ? bus_id.trim() : null;

    // Check if the bus_id is already assigned to a different driver
    if (finalBusId) {
      const { data: busTaken } = await adminClient
        .from('drivers')
        .select('id, user:user_profiles(full_name)')
        .eq('bus_id', finalBusId)
        .neq('id', id)
        .maybeSingle();

      if (busTaken) {
        const driverName = (busTaken.user as any)?.full_name || 'Another driver';
        return NextResponse.json(
          { error: `This bus is already assigned to driver: ${driverName}`, code: 'BUS_TAKEN' },
          { status: 409 }
        );
      }
    }

    // 1. Update public.drivers details
    const driverUpdates: any = {};
    if (license_number !== undefined) driverUpdates.license_number = license_number;
    if (license_expiry !== undefined) driverUpdates.license_expiry = license_expiry;
    if (bus_id !== undefined) driverUpdates.bus_id = finalBusId;
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

    // 3. Update auth password if provided
    if (password) {
      const { error: passwordErr } = await adminClient.auth.admin.updateUserById(
        driver.user_id,
        {
          password: password,
          user_metadata: {
            login_attempts: 0,
            login_locked: false,
          }
        }
      );

      if (passwordErr) {
        return NextResponse.json(
          { error: `Failed to update driver password: ${passwordErr.message}`, code: 'SERVER_ERROR' },
          { status: 500 }
        );
      }
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
      .select('id, user_id, bus_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !driver) {
      return NextResponse.json(
        { error: 'Driver not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 1. Delete any historical or active trips referencing this driver to satisfy ON DELETE RESTRICT
    await adminClient.from('trips').delete().eq('driver_id', id);

    // 2. Clean up any automated announcements posted by this driver to bypass foreign key constraints
    await adminClient.from('announcements').delete().eq('created_by', driver.user_id);

    // 3. Delete from drivers table
    const { error: driverDelErr } = await adminClient.from('drivers').delete().eq('id', id);
    if (driverDelErr) {
      return NextResponse.json(
        { error: `Failed to remove driver record: ${driverDelErr.message}`, code: 'SERVER_ERROR', details: driverDelErr },
        { status: 500 }
      );
    }

    // 5. Delete user from auth (cascades to user_profiles)
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(driver.user_id);
    
    if (authDeleteErr) {
      return NextResponse.json(
        { 
          error: `Failed to delete driver auth user: ${authDeleteErr.message}`, 
          code: 'SERVER_ERROR', 
          details: authDeleteErr 
        },
        { status: 500 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
