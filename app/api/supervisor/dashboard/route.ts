import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireRole(['supervisor', 'admin', 'manager']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();
  try {
    // 1. Fetch Supervisor Profile
    const { data: supervisorProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('id, full_name, email, phone, role, plant_id, plant:plants(*)')
      .eq('id', auth.user.id)
      .single();

    if (profileErr || !supervisorProfile) {
      return NextResponse.json({ error: 'Supervisor profile not found' }, { status: 404 });
    }

    const plantObj = Array.isArray(supervisorProfile.plant)
      ? supervisorProfile.plant[0]
      : supervisorProfile.plant;

    // 2. Fetch Plant Manager details if supervisor belongs to a plant
    let plantManager = null;
    if (supervisorProfile.plant_id) {
      const { data: manager } = await adminClient
        .from('user_profiles')
        .select('id, full_name, email, phone')
        .eq('plant_id', supervisorProfile.plant_id)
        .eq('role', 'manager')
        .limit(1)
        .maybeSingle();
      plantManager = manager;
    }

    // 3. Fetch Direct Workers under this supervisor
    const { data: workers = [], error: workersErr } = await adminClient
      .from('user_profiles')
      .select('id, full_name, email, phone, role, is_active')
      .eq('supervisor_id', supervisorProfile.id)
      .eq('role', 'worker');

    if (workersErr) {
      return NextResponse.json({ error: workersErr.message }, { status: 500 });
    }

    const workerIds = (workers || []).map((w: any) => w.id);

    // 4. Fetch Live Locations of assigned workers
    let formattedLocations: any[] = [];
    if (workerIds.length > 0) {
      const { data: locations = [] } = await adminClient
        .from('live_locations')
        .select(`
          id,
          user_id,
          latitude,
          longitude,
          speed,
          heading,
          accuracy,
          battery_level,
          is_tracking,
          recorded_at,
          user:user_profiles(id, full_name, role, plant_id, supervisor_id)
        `)
        .in('user_id', workerIds);

      formattedLocations = (locations || []).map((loc: any) => {
        const userObj = Array.isArray(loc.user) ? loc.user[0] : loc.user;
        const recTime = new Date(loc.recorded_at).getTime();
        const isStale = Date.now() - recTime > 30000;

        return {
          ...loc,
          latitude: Number(loc.latitude),
          longitude: Number(loc.longitude),
          speed: isStale ? 0 : Number(loc.speed || 0),
          is_tracking: loc.is_tracking && !isStale,
          is_stale: isStale,
          user: userObj || null,
        };
      });
    }

    return NextResponse.json({
      profile: {
        ...supervisorProfile,
        plant: plantObj || null,
      },
      plantManager,
      workers: workers || [],
      locations: formattedLocations,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
