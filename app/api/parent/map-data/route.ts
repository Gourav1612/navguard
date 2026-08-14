import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    // 1. Fetch parent's linked student bus IDs
    const { data: parentRaw, error: parentErr } = await adminClient
      .from('parent_profiles')
      .select(`
        school_id,
        links:parent_student_links(
          student:student_profiles(
            id,
            bus_id,
            user:user_profiles(full_name)
          )
        )
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (parentErr || !parentRaw) {
      return NextResponse.json(
        { error: 'Parent profile not found' },
        { status: 404 }
      );
    }

    const linkedBuses = (parentRaw.links || [])
      .map((lnk: any) => lnk.student)
      .filter((s: any) => s && s.bus_id);

    if (linkedBuses.length === 0) {
      return NextResponse.json({
        busesLocations: [],
        activeTrips: [],
      });
    }

    const busIds = Array.from(new Set(linkedBuses.map((s: any) => s.bus_id as string)));

    // 2. Fetch bus details (name, plate, is_active)
    const { data: buses } = await adminClient
      .from('buses')
      .select('*')
      .in('id', busIds);

    // 3. Fetch drivers details for these buses
    const { data: drivers } = await adminClient
      .from('drivers')
      .select(`
        id,
        bus_id,
        user:user_profiles(full_name, phone)
      `)
      .in('bus_id', busIds)
      .eq('is_active', true);

    // 4. Fetch latest locations for these buses
    const { data: locations } = await adminClient
      .from('bus_locations')
      .select('*')
      .in('bus_id', busIds);

    // 5. Fetch active trips
    const { data: activeTrips } = await adminClient
      .from('trips')
      .select(`
        id,
        bus_id,
        route_id,
        status,
        started_at,
        bus:buses(id, name),
        route:routes(
          id,
          name,
          stops(
            id,
            name,
            latitude,
            longitude,
            stop_order
          )
        )
      `)
      .in('bus_id', busIds)
      .eq('status', 'active');

    // 6. Map to busesLocations format expected by AdminMap
    const busesLocations = (buses || []).map((bus: any) => {
      const loc = (locations || []).find((l: any) => l.bus_id === bus.id);
      const driver = (drivers || []).find((d: any) => d.bus_id === bus.id) as any;
      const activeTrip = (activeTrips || []).find((t: any) => t.bus_id === bus.id) as any;

      return {
        bus_id: bus.id,
        bus_name: bus.name,
        registration_plate: bus.registration_plate || '',
        is_active: !!activeTrip,
        trip_id: activeTrip ? activeTrip.id : null,
        driver_name: driver?.user ? (Array.isArray(driver.user) ? driver.user[0].full_name : driver.user.full_name) : 'Unassigned',
        driver_phone: driver?.user ? (Array.isArray(driver.user) ? driver.user[0].phone : driver.user.phone) : null,
        route_name: activeTrip?.route ? (Array.isArray(activeTrip.route) ? activeTrip.route[0].name : activeTrip.route.name) : 'No Active Route',
        latest_location: loc
          ? {
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
              speed: Number(loc.speed || 0),
              heading: Number(loc.heading || 0),
              recorded_at: loc.recorded_at,
            }
          : null,
      };
    });

    return NextResponse.json({
      busesLocations,
      activeTrips: activeTrips || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
