import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { StopSchema } from '@/lib/validations';

// GET /api/admin/stops
export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { searchParams } = new URL(req.url);
  const routeId = searchParams.get('route_id');

  if (!routeId) {
    return NextResponse.json(
      { error: 'Missing route_id parameter', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();

  try {
    const { data: stops, error } = await supabase
      .from('stops')
      .select('*')
      .eq('route_id', routeId)
      .eq('school_id', profile.school_id)
      .order('stop_order', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch stops', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map to number coordinates
    const mapped = (stops || []).map((stop: any) => ({
      id: stop.id,
      route_id: stop.route_id,
      school_id: stop.school_id,
      name: stop.name,
      address: stop.address,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      stop_order: stop.stop_order,
      created_at: stop.created_at,
    }));

    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// POST /api/admin/stops
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const parsed = StopSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { route_id, name, address, latitude, longitude, stop_order } = parsed.data;

    // Verify route belongs to this school
    const { data: route } = await supabase
      .from('routes')
      .select('id')
      .eq('id', route_id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (!route) {
      return NextResponse.json(
        { error: 'Route not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    let finalStopOrder = stop_order;

    // Check for duplicate stop_order on this route
    const { data: duplicate } = await supabase
      .from('stops')
      .select('id')
      .eq('route_id', route_id)
      .eq('stop_order', stop_order)
      .maybeSingle();

    if (duplicate) {
      // Find the maximum stop_order currently on this route to resolve conflict
      const { data: routeStops } = await supabase
        .from('stops')
        .select('stop_order')
        .eq('route_id', route_id);

      const maxOrder = (routeStops || []).reduce((max: number, s: any) => Math.max(max, Number(s.stop_order)), -1);
      finalStopOrder = maxOrder + 1;
    }

    const { data: newStop, error: insertError } = await supabase
      .from('stops')
      .insert({
        route_id,
        school_id: profile.school_id,
        name,
        address: address || null,
        latitude,
        longitude,
        stop_order: finalStopOrder,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Failed to create stop', code: 'SERVER_ERROR', details: insertError },
        { status: 500 }
      );
    }

    return NextResponse.json(newStop, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
