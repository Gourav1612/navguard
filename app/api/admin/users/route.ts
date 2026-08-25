import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';
import { CreateUserSchema } from '@/lib/validations';

export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const url = new NextRequest(req.url);
  const searchParams = url.nextUrl.searchParams;
  const role = searchParams.get('role') || '';
  const plantId = searchParams.get('plant_id') || '';

  const adminClient = createAdminClient();
  try {
    let query = adminClient
      .from('user_profiles')
      .select(`
        id,
        role,
        full_name,
        email,
        phone,
        avatar_url,
        is_active,
        location_interval,
        created_at,
        plant:plants(id, name, code)
      `);

    if (role) {
      query = query.eq('role', role);
    }
    if (plantId) {
      query = query.eq('plant_id', plantId);
    }

    const { data: users, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Format relation response objects if they are returned as arrays
    const formatted = (users || []).map((u: any) => {
      const plantObj = Array.isArray(u.plant) ? u.plant[0] : u.plant;
      return {
        ...u,
        plant: plantObj || null,
        supervisor: null,
      };
    });

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Create the user in Auth
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.full_name,
        role: parsed.data.role,
        plant_id: parsed.data.plant_id || null,
        supervisor_id: parsed.data.supervisor_id || null,
        location_interval: parsed.data.location_interval || 10,
      }
    });

    if (authErr || !authUser.user) {
      return NextResponse.json({ error: authErr?.message || 'Auth registration failed' }, { status: 500 });
    }

    // 2. The trigger handles profile creation. Update phone, is_active, and details explicitly to confirm sync
    const { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .update({
        phone: parsed.data.phone || null,
        is_active: parsed.data.is_active ?? true,
        location_interval: parsed.data.location_interval || 10,
      })
      .eq('id', authUser.user.id)
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
