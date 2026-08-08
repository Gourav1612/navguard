import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateDriverSchema } from '@/lib/validations';

// GET /api/admin/drivers
export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const pageParam = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : null;
  const pageSizeParam = searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 10;
  const search = searchParams.get('search')?.trim() || '';

  try {
    let query = supabase
      .from('drivers')
      .select(`
        *,
        bus:buses(id, name),
        user:user_profiles!inner(full_name, email, phone)
      `, { count: 'exact' })
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('user.full_name', `%${search}%`);
    }

    if (pageParam) {
      const from = (pageParam - 1) * pageSizeParam;
      const to = from + pageSizeParam - 1;
      query = query.range(from, to);
    }

    const { data: drivers, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch drivers', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map nested fields to expected schema
    const mapped = (drivers || []).map((d: any) => {
      const busObj = Array.isArray(d.bus) ? d.bus[0] : d.bus;
      const userObj = Array.isArray(d.user) ? d.user[0] : d.user;

      return {
        id: d.id,
        user_id: d.user_id,
        license_number: d.license_number,
        license_expiry: d.license_expiry,
        is_active: d.is_active,
        bus: busObj ? { id: busObj.id, name: busObj.name } : null,
        user: userObj
          ? {
              full_name: userObj.full_name,
              email: userObj.email,
              phone: userObj.phone,
            }
          : null,
      };
    });

    if (pageParam) {
      const totalCount = count ?? mapped.length;
      return NextResponse.json({
        data: mapped,
        count: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSizeParam)),
        currentPage: pageParam,
        pageSize: pageSizeParam,
      });
    }

    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// POST /api/admin/drivers
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = CreateDriverSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { full_name, email, phone, password, license_number, license_expiry, bus_id } = parsed.data;

    // Check if email already registered in profiles
    const { data: existingProfile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: 'This email is already registered', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    // Check if the bus_id is already assigned to another driver
    if (bus_id) {
      const { data: busTaken } = await adminClient
        .from('drivers')
        .select('id, user:user_profiles(full_name)')
        .eq('bus_id', bus_id)
        .maybeSingle();

      if (busTaken) {
        const driverName = (busTaken.user as any)?.full_name || 'Another driver';
        return NextResponse.json(
          { error: `This bus is already assigned to driver: ${driverName}`, code: 'BUS_TAKEN' },
          { status: 409 }
        );
      }
    }

    // 1. Create user in Supabase auth using service role admin client
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'driver',
        school_id: profile.school_id,
      },
    });

    if (authErr || !authData.user) {
      return NextResponse.json(
        { error: authErr?.message || 'Failed to create auth user', code: 'SERVER_ERROR' },
        { status: 500 }
      );
    }

    const userId = authData.user.id;

    // 2. Update phone number on the automatically created profile (trigger does name, email, role, school)
    if (phone) {
      await adminClient
        .from('user_profiles')
        .update({ phone })
        .eq('id', userId);
    }

    // 3. Create driver profile record
    const { data: newDriver, error: driverErr } = await adminClient
      .from('drivers')
      .insert({
        user_id: userId,
        school_id: profile.school_id,
        bus_id: bus_id || null,
        license_number,
        license_expiry: license_expiry || null,
        is_active: true,
      })
      .select()
      .single();

    if (driverErr || !newDriver) {
      // Clean up auth user to keep state consistent on failure
      await adminClient.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: 'Failed to create driver details', code: 'SERVER_ERROR', details: driverErr },
        { status: 500 }
      );
    }

    // Write audit log
    await adminClient.from('audit_logs').insert({
      school_id: profile.school_id,
      user_id: auth.user.id,
      action: 'CREATE',
      table_name: 'drivers',
      record_id: newDriver.id,
      new_values: { ...newDriver, email, full_name },
    });

    return NextResponse.json(
      {
        id: newDriver.id,
        user_id: userId,
        license_number,
        license_expiry,
        is_active: true,
        bus: bus_id ? { id: bus_id } : null,
        user: { full_name, email, phone },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
