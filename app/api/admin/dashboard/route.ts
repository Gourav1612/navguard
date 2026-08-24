import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  try {
    // 1. Fetch metrics in parallel
    const [
      { count: totalPlants, error: plantsErr },
      { count: totalManagers, error: managersErr },
      { count: totalSupervisors, error: supervisorsErr },
      { count: totalWorkers, error: workersErr },
      { count: activeShiftsCount, error: activeShiftsErr },
    ] = await Promise.all([
      supabase
        .from('plants')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'manager'),
      supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'supervisor'),
      supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'worker'),
      supabase
        .from('live_locations')
        .select('*', { count: 'exact', head: true })
        .eq('is_tracking', true),
    ]);

    if (plantsErr || managersErr || supervisorsErr || workersErr || activeShiftsErr) {
      return NextResponse.json(
        { 
          error: 'Failed to retrieve workforce metrics', 
          code: 'SERVER_ERROR',
          details: { plantsErr, managersErr, supervisorsErr, workersErr, activeShiftsErr }
        }, 
        { status: 500 }
      );
    }

    // 2. Fetch Plants data for Leaflet mapping
    const { data: plants } = await supabase
      .from('plants')
      .select('id, name, code, latitude, longitude, radius_meters')
      .order('name', { ascending: true });

    // 3. Fetch Active live locations joined with user profile metadata
    const { data: rawLocations, error: locationsErr } = await supabase
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

    if (locationsErr) {
      return NextResponse.json(
        { error: 'Failed to retrieve active locations feed', code: 'SERVER_ERROR', details: locationsErr },
        { status: 500 }
      );
    }

    const locationsFormatted = (rawLocations || []).map((loc: any) => {
      const userObj = Array.isArray(loc.user) ? loc.user[0] : loc.user;
      const supervisorObj = userObj && Array.isArray(userObj.supervisor) ? userObj.supervisor[0] : (userObj?.supervisor || null);
      
      const recTime = new Date(loc.recorded_at).getTime();
      const isStale = (Date.now() - recTime) > 30000; // stale if no update in 30 seconds

      return {
        id: loc.id,
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
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
          supervisor_name: supervisorObj?.full_name || null
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
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
