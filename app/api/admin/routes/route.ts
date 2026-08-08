import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RouteSchema } from '@/lib/validations';
import { optimizeRouteWithGemini } from '@/lib/gemini-optimizer';

// GET /api/admin/routes
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
      .from('routes')
      .select(`
        *,
        stops(*),
        bus:buses(id, name)
      `, { count: 'exact' })
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (pageParam) {
      const from = (pageParam - 1) * pageSizeParam;
      const to = from + pageSizeParam - 1;
      query = query.range(from, to);
    }

    const { data: routes, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch routes', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map to ensure stops are ordered by stop_order
    const mapped = (routes || []).map((route: any) => {
      const stopsSorted = (route.stops || []).sort((a: any, b: any) => a.stop_order - b.stop_order);
      const busObj = Array.isArray(route.bus) ? route.bus[0] : route.bus;

      return {
        id: route.id,
        name: route.name,
        bus_id: route.bus_id,
        description: route.description,
        is_active: route.is_active,
        bus: busObj ? { id: busObj.id, name: busObj.name } : null,
        stops: stopsSorted.map((stop: any) => ({
          id: stop.id,
          name: stop.name,
          address: stop.address,
          stop_order: stop.stop_order,
          latitude: Number(stop.latitude),
          longitude: Number(stop.longitude),
        })),
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

// POST /api/admin/routes
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const parsed = RouteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { name, bus_id, description, is_active, stops = [] } = parsed.data;

    // 1. Insert route
    const { data: newRoute, error: routeErr } = await supabase
      .from('routes')
      .insert({
        school_id: profile.school_id,
        bus_id: bus_id && typeof bus_id === 'string' && bus_id.trim() !== '' ? bus_id.trim() : null,
        name,
        description: description || null,
        is_active,
      })
      .select()
      .single();

    if (routeErr || !newRoute) {
      return NextResponse.json(
        { error: 'Failed to create route', code: 'SERVER_ERROR', details: routeErr },
        { status: 500 }
      );
    }

    // 2. Insert stops if provided
    if (stops.length > 0) {
      const optimizedStops = await optimizeRouteWithGemini(stops);
      const stopsToInsert = optimizedStops.map((stop, idx) => ({
        route_id: newRoute.id,
        school_id: profile.school_id,
        name: stop.name,
        address: stop.address || null,
        latitude: stop.latitude,
        longitude: stop.longitude,
        stop_order: idx,
      }));

      const { error: stopsErr } = await supabase
        .from('stops')
        .insert(stopsToInsert);

      if (stopsErr) {
        // Rollback route (clean up) since this is an atomized API
        await supabase.from('routes').delete().eq('id', newRoute.id);
        return NextResponse.json(
          { error: 'Failed to save route stops', code: 'SERVER_ERROR', details: stopsErr },
          { status: 500 }
        );
      }
    }

    // Fetch complete created route
    const { data: completeRoute } = await supabase
      .from('routes')
      .select('*, stops(*)')
      .eq('id', newRoute.id)
      .single();

    return NextResponse.json(completeRoute, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
