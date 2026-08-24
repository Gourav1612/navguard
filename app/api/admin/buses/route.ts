import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BusSchema } from '@/lib/validations';

// GET /api/admin/buses
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
      .from('buses')
      .select(`
        *,
        driver:drivers(
          id,
          user_profiles(full_name, phone)
        ),
        route:routes(id, name)
      `, { count: 'exact' })
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,registration_plate.ilike.%${search}%`);
    }

    if (pageParam) {
      const from = (pageParam - 1) * pageSizeParam;
      const to = from + pageSizeParam - 1;
      query = query.range(from, to);
    }

    const { data: buses, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch buses', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Fetch active trips to map is_trip_active accurately
    const { data: activeTrips = [] } = await supabase
      .from('trips')
      .select('bus_id')
      .eq('status', 'active');

    const activeBusIdSet = new Set((activeTrips || []).map((t: any) => t.bus_id));

    // Map nested data to output schema format
    const mapped = (buses || []).map((bus: any) => {
      const driverObj = Array.isArray(bus.driver) ? bus.driver[0] : bus.driver;
      const routeObj = Array.isArray(bus.route) ? bus.route[0] : bus.route;

      return {
        id: bus.id,
        school_id: bus.school_id,
        name: bus.name,
        registration_plate: bus.registration_plate,
        capacity: bus.capacity,
        status: bus.status,
        location_interval: bus.location_interval,
        created_at: bus.created_at,
        is_trip_active: activeBusIdSet.has(bus.id),
        driver: driverObj
          ? {
              id: driverObj.id,
              full_name: (driverObj.user_profiles as any)?.full_name || 'Assigned Driver',
              phone: (driverObj.user_profiles as any)?.phone || null,
            }
          : null,
        route: routeObj ? { id: routeObj.id, name: routeObj.name } : null,
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

// POST /api/admin/buses
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const parsed = BusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { name, registration_plate, capacity, status, location_interval } = parsed.data;

    // Check for duplicate plate in this school
    const { data: duplicate } = await supabase
      .from('buses')
      .select('id')
      .eq('registration_plate', registration_plate)
      .maybeSingle();

    if (duplicate) {
      return NextResponse.json(
        { error: 'A bus with this registration plate already exists', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    const { data: newBus, error: insertError } = await supabase
      .from('buses')
      .insert({
        school_id: profile.school_id,
        name,
        registration_plate,
        capacity,
        status,
        location_interval,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create bus', code: 'SERVER_ERROR', details: insertError },
        { status: 500 }
      );
    }

    return NextResponse.json(newBus, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
