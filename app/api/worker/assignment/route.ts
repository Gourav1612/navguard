import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireRole(['worker', 'admin', 'supervisor', 'manager']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();
  try {
    const { data: workerRaw, error: workerErr } = await adminClient
      .from('user_profiles')
      .select(`
        id,
        full_name,
        email,
        phone,
        plant_id,
        supervisor_id,
        location_interval,
        is_active,
        plant:plants(id, name, code, latitude, longitude, radius_meters)
      `)
      .eq('id', auth.profile.id)
      .single();

    if (workerErr || !workerRaw) {
      return NextResponse.json({ error: 'Worker profile not found' }, { status: 404 });
    }

    const plantObj = Array.isArray(workerRaw.plant) ? workerRaw.plant[0] : workerRaw.plant;

    // Fetch Supervisor Details
    let supervisor = null;
    if (workerRaw.supervisor_id) {
      const { data: supRaw } = await adminClient
        .from('user_profiles')
        .select('id, full_name, email, phone')
        .eq('id', workerRaw.supervisor_id)
        .single();
      supervisor = supRaw;
    }

    // Fetch Plant Manager Details (peer manager/s for the same plant)
    let plantManager = null;
    if (workerRaw.plant_id) {
      const { data: mgrRaw } = await adminClient
        .from('user_profiles')
        .select('id, full_name, email, phone')
        .eq('plant_id', workerRaw.plant_id)
        .eq('role', 'manager')
        .limit(1)
        .maybeSingle();
      plantManager = mgrRaw;
    }

    return NextResponse.json({
      worker: {
        id: workerRaw.id,
        full_name: workerRaw.full_name,
        email: workerRaw.email,
        phone: workerRaw.phone,
        location_interval: workerRaw.location_interval,
        is_active: workerRaw.is_active,
      },
      plant: plantObj || null,
      supervisor,
      plantManager,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
