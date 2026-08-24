import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET() {
  // Allow admins, managers, and supervisors to fetch live tracking pins
  const auth = await requireRole(['admin', 'manager', 'supervisor']);
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  try {
    const { data: locations, error } = await supabase
      .from('live_locations')
      .select(`
        id,
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        battery_level,
        is_tracking,
        recorded_at,
        user:user_profiles(
          id,
          full_name,
          role,
          plant_id,
          supervisor_id,
          supervisor:user_profiles!supervisor_id(full_name)
        )
      `);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Format relationship structures
    const formatted = (locations || []).map((loc: any) => {
      const userObj = Array.isArray(loc.user) ? loc.user[0] : loc.user;
      const supervisorObj = userObj && Array.isArray(userObj.supervisor) ? userObj.supervisor[0] : (userObj?.supervisor || null);
      
      return {
        id: loc.id,
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        speed: Number(loc.speed || 0),
        heading: Number(loc.heading || 0),
        accuracy: Number(loc.accuracy || 0),
        battery_level: loc.battery_level,
        is_tracking: loc.is_tracking,
        recorded_at: loc.recorded_at,
        user: userObj ? {
          id: userObj.id,
          full_name: userObj.full_name,
          role: userObj.role,
          plant_id: userObj.plant_id,
          supervisor_name: supervisorObj?.full_name || null
        } : null
      };
    });

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
