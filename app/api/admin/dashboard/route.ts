import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();
  try {
    // 1. Fetch metrics in parallel using admin client
    const [
      { count: totalPlants, error: plantsErr },
      { count: totalManagers, error: managersErr },
      { count: totalSupervisors, error: supervisorsErr },
      { count: totalWorkers, error: workersErr },
      { count: activeShiftsCount, error: activeShiftsErr },
    ] = await Promise.all([
      adminClient.from('plants').select('*', { count: 'exact', head: true }),
      adminClient.from('user_profiles').select('*', { count: 'exact', head: true }).eq('role', 'manager'),
      adminClient.from('user_profiles').select('*', { count: 'exact', head: true }).eq('role', 'supervisor'),
      adminClient.from('user_profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker'),
      adminClient.from('live_locations').select('*', { count: 'exact', head: true }).eq('is_tracking', true),
    ]);

    if (plantsErr || managersErr || supervisorsErr || workersErr || activeShiftsErr) {
      console.warn('[Admin Dashboard API] Warning in metrics fetch:', { plantsErr, managersErr, supervisorsErr, workersErr, activeShiftsErr });
    }

    // 2. Fetch Plants data for Leaflet mapping
    const { data: plants } = await adminClient
      .from('plants')
      .select('id, name, code, latitude, longitude, radius_meters')
      .order('name', { ascending: true });

    // 3. Fetch Active live locations joined with user profile metadata
    const { data: rawLocations, error: locationsErr } = await adminClient
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
          is_active
        )
      `);

    if (locationsErr) {
      console.warn('[Admin Dashboard API] Warning in locations fetch:', locationsErr);
    }

    const locationsFormatted = (rawLocations || []).map((loc: any) => {
      const userObj = Array.isArray(loc.user) ? loc.user[0] : loc.user;
      const recTime = new Date(loc.recorded_at).getTime();
      const isStale = (Date.now() - recTime) > 30000; // stale if no update in 30 seconds

      return {
        id: loc.id,
        latitude: Number(loc.latitude || 0),
        longitude: Number(loc.longitude || 0),
        speed: isStale ? 0 : Number(loc.speed || 0),
        heading: Number(loc.heading || 0),
        accuracy: Number(loc.accuracy || 0),
        battery_level: loc.battery_level,
        is_tracking: loc.is_tracking && !isStale,
        recorded_at: loc.recorded_at,
        is_stale: isStale,
        user: userObj ? {
          id: userObj.id,
          full_name: userObj.full_name,
          role: userObj.role,
          plant_id: userObj.plant_id,
          is_active: userObj.is_active,
          supervisor_name: null
        } : null
      };
    });

    return NextResponse.json({
      metrics: {
        total_plants: totalPlants || 0,
        total_managers: totalManagers || 0,
        total_supervisors: totalSupervisors || 0,
        total_workers: totalWorkers || 0,
        active_shifts: activeShiftsCount || 0,
      },
      plants: plants || [],
      locations: locationsFormatted,
    });
  } catch (err: any) {
    console.error('[Admin Dashboard API] Error:', err);
    return NextResponse.json({
      metrics: {
        total_plants: 0,
        total_managers: 0,
        total_supervisors: 0,
        total_workers: 0,
        active_shifts: 0,
      },
      plants: [],
      locations: [],
    });
  }
}
