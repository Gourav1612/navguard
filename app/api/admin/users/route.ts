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
        supervisor_id,
        created_at,
        plant:plants(id, name, code)
      `);

    if (role) {
      query = query.eq('role', role);
    } else {
      query = query.neq('role', 'admin');
    }

    if (plantId) {
      query = query.eq('plant_id', plantId);
    }

    const { data: users, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch auth users to get user_metadata.username and user_metadata.supervisor_id
    const { data: authUsersData } = await adminClient.auth.admin.listUsers();
    const authUsersMap = new Map((authUsersData?.users || []).map((u) => [u.id, u]));

    // Build user profiles map for resolving supervisor details
    const profilesMap = new Map((users || []).map((u: any) => [u.id, u]));

    // Format relation response objects and attach username and supervisor
    const formatted = (users || []).map((u: any) => {
      const plantObj = Array.isArray(u.plant) ? u.plant[0] : u.plant;
      const authUser = authUsersMap.get(u.id);
      const username = u.username || authUser?.user_metadata?.username || (u.email ? u.email.split('@')[0] : '');
      const supervisorId = u.supervisor_id || authUser?.user_metadata?.supervisor_id || null;

      let supervisorObj = null;
      if (supervisorId) {
        const supProfile = profilesMap.get(supervisorId);
        const supAuth = authUsersMap.get(supervisorId);
        const supName = supProfile?.full_name || supAuth?.user_metadata?.full_name || 'Supervisor';
        const supEmail = supProfile?.email || supAuth?.email || '';
        supervisorObj = {
          id: supervisorId,
          full_name: supName,
          email: supEmail,
        };
      }

      return {
        ...u,
        username,
        supervisor_id: supervisorId,
        plant: plantObj || null,
        supervisor: supervisorObj,
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

    // Enforce single-admin limit across the system
    if (parsed.data.role === 'admin') {
      const { count } = await adminClient
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      
      if ((count || 0) >= 1) {
        return NextResponse.json(
          { error: 'System limit reached: Only 1 System Administrator account is allowed.' },
          { status: 400 }
        );
      }
    }

    // 1. Create the user in Auth
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.full_name,
        username: parsed.data.username || null,
        role: parsed.data.role,
        plant_id: parsed.data.plant_id || null,
        supervisor_id: parsed.data.supervisor_id || null,
        location_interval: parsed.data.location_interval || 10,
      }
    });

    if (authErr || !authUser.user) {
      return NextResponse.json({ error: authErr?.message || 'Auth registration failed' }, { status: 500 });
    }

    // 2. The trigger handles profile creation. Update details explicitly
    const profilePayload: any = {
      phone: parsed.data.phone || null,
      supervisor_id: parsed.data.supervisor_id || null,
      is_active: parsed.data.is_active ?? false,
      location_interval: parsed.data.location_interval || 10,
    };
    if (parsed.data.username) profilePayload.username = parsed.data.username;

    let { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .update(profilePayload)
      .eq('id', authUser.user.id)
      .select()
      .single();

    if (profileErr && profilePayload.username) {
      // Fallback if username column does not exist in remote table
      delete profilePayload.username;
      const fallbackRes = await adminClient
        .from('user_profiles')
        .update(profilePayload)
        .eq('id', authUser.user.id)
        .select()
        .single();
      profile = fallbackRes.data;
      profileErr = fallbackRes.error;
    }

    if (profileErr && !profile) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ...(profile || {}),
      username: parsed.data.username || authUser.user.email?.split('@')[0] || '',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
