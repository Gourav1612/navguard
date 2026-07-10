import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BusSchema } from '@/lib/validations';

// GET /api/admin/buses
export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const { data: buses, error } = await supabase
      .from('buses')
      .select(`
        *,
        driver:drivers(
          id,
          user_profiles(full_name, phone)
        ),
        route:routes(id, name)
      `)
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch buses', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map nested data to output schema format
    const mapped = (buses || []).map((bus: any) => {
      const driverObj = Array.isArray(bus.driver) ? bus.driver[0] : bus.driver;
      // Note: routes can be one-to-many. In nested fetch it returns as array or single.
      const routeObj = Array.isArray(bus.route) ? bus.route[0] : bus.route;

      return {
        id: bus.id,
        school_id: bus.school_id,
        name: bus.name,
        registration_plate: bus.registration_plate,
        capacity: bus.capacity,
        status: bus.status,
        driver: driverObj
          ? {
              id: driverObj.id,
              user: {
                full_name: driverObj.user_profiles?.full_name || 'Unknown',
                phone: driverObj.user_profiles?.phone || '',
              },
            }
          : null,
        route: routeObj
          ? {
              id: routeObj.id,
              name: routeObj.name,
            }
          : null,
        created_at: bus.created_at,
      };
    });

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

    const { name, registration_plate, capacity, status } = parsed.data;

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
