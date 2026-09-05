import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireRole(['manager', 'admin']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();
  try {
    // 1. Fetch Manager Profile
    const { data: managerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('id, full_name, email, phone, role, plant_id, location_interval, is_active, plant:plants(*)')
      .eq('id', auth.user.id)
      .single();

    if (profileErr || !managerProfile) {
      return NextResponse.json({ error: 'Manager profile not found' }, { status: 404 });
    }

    const plantObj = Array.isArray(managerProfile.plant)
      ? managerProfile.plant[0]
      : managerProfile.plant;

    const plantId = managerProfile.plant_id;

    if (!plantId) {
      return NextResponse.json({
        profile: {
          ...managerProfile,
          plant: plantObj || null,
        },
        plant: plantObj || null,
        supervisors: [],
        workers: [],
        locations: [],
      });
    }

    // 2. Fetch all personnel profiles in this plant
    const { data: profiles = [], error: profilesErr } = await adminClient
      .from('user_profiles')
      .select('id, full_name, email, phone, role, supervisor_id, is_active')
      .eq('plant_id', plantId);

    if (profilesErr) {
      return NextResponse.json({ error: profilesErr.message }, { status: 500 });
    }

    const profilesList = (profiles || []) as any[];
    const supervisors = profilesList.filter((p) => p.role === 'supervisor');
    const workers = profilesList.filter((p) => p.role === 'worker');
    const userIds = profilesList.map((p) => p.id);

    // 3. Fetch Live Locations of all plant personnel
    let formattedLocations: any[] = [];
    if (userIds.length > 0) {
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
        .in('user_id', userIds);

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
        ...managerProfile,
        plant: plantObj || null,
      },
      plant: plantObj || null,
      supervisors,
      workers,
      locations: formattedLocations,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
