import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RouteSchema } from '@/lib/validations';
import { optimizeRouteWithGemini } from '@/lib/gemini-optimizer';

// PATCH /api/admin/routes/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    const body = await req.json();
    const partialSchema = RouteSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: route, error: fetchErr } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !route) {
      return NextResponse.json(
        { error: 'Route not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { name, bus_id, description, is_active, stops } = parsed.data;

    // 1. Update route details
    const { data: updatedRoute, error: updateErr } = await supabase
      .from('routes')
      .update({
        name,
        bus_id,
        description,
        is_active,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: 'Failed to update route', code: 'SERVER_ERROR', details: updateErr },
        { status: 500 }
      );
    }

    // 2. If stops array is provided, update/insert/delete them dynamically
    if (stops !== undefined) {
      const keptStopIds = stops.map((s) => s.id).filter(Boolean) as string[];

      // Delete stops that are no longer in the payload list
      const deleteQuery = supabase.from('stops').delete().eq('route_id', id);
      if (keptStopIds.length > 0) {
        deleteQuery.not('id', 'in', `(${keptStopIds.join(',')})`);
      }
      const { error: delErr } = await deleteQuery;
      if (delErr) {
        return NextResponse.json(
          { error: 'Failed to clear removed stops', code: 'SERVER_ERROR', details: delErr },
          { status: 500 }
        );
      }

      if (stops.length > 0) {
        // Optimize stops ordering
        const optimizedStops = await optimizeRouteWithGemini(stops);

        const stopsToInsert: any[] = [];
        const stopsToUpdate: any[] = [];

        optimizedStops.forEach((stop, idx) => {
          const stopData = {
            school_id: profile.school_id,
            name: stop.name,
            address: stop.address || null,
            latitude: stop.latitude,
            longitude: stop.longitude,
            stop_order: idx,
          };

          if (stop.id) {
            stopsToUpdate.push({
              id: stop.id,
              ...stopData,
            });
          } else {
            stopsToInsert.push({
              route_id: id,
              ...stopData,
            });
          }
        });

        // 1. Temporary step: Update stop_order to a large positive offset (10000+) to avoid UNIQUE constraint collisions
        for (let i = 0; i < stopsToUpdate.length; i++) {
          const updateStop = stopsToUpdate[i];
          const { error: tempErr } = await supabase
            .from('stops')
            .update({
              stop_order: 10000 + i,
            })
            .eq('id', updateStop.id);

          if (tempErr) {
            return NextResponse.json(
              { error: 'Failed to apply temporary stop order offsets.', code: 'SERVER_ERROR', details: tempErr },
              { status: 500 }
            );
          }
        }

        // 2. Execute updates to final values in-place to preserve references
        for (const updateStop of stopsToUpdate) {
          const { error: updErr } = await supabase
            .from('stops')
            .update({
              name: updateStop.name,
              address: updateStop.address,
              latitude: updateStop.latitude,
              longitude: updateStop.longitude,
              stop_order: updateStop.stop_order,
            })
            .eq('id', updateStop.id);

          if (updErr) {
            return NextResponse.json(
              { error: 'Failed to update stop sequence details', code: 'SERVER_ERROR', details: updErr },
              { status: 500 }
            );
          }
        }

        // 3. Execute inserts for new stops
        if (stopsToInsert.length > 0) {
          const { error: insErr } = await supabase
            .from('stops')
            .insert(stopsToInsert);

          if (insErr) {
            return NextResponse.json(
              { error: 'Failed to insert new stops to route', code: 'SERVER_ERROR', details: insErr },
              { status: 500 }
            );
          }
        }
      }
    }

    return NextResponse.json(updatedRoute);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/routes/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  try {
    // Verify ownership
    const { data: route, error: fetchErr } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !route) {
      return NextResponse.json(
        { error: 'Route not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Clean up any historical trips linked to this route first to prevent foreign key blocks
    const { error: tripsDeleteErr } = await supabase.from('trips').delete().eq('route_id', id);
    if (tripsDeleteErr) {
      return NextResponse.json(
        { 
          error: `Failed to clean up route's trip history: ${tripsDeleteErr.message}`, 
          code: 'SERVER_ERROR', 
          details: tripsDeleteErr 
        },
        { status: 500 }
      );
    }

    const { error: deleteErr } = await supabase
      .from('routes')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return NextResponse.json(
        { error: 'Failed to delete route', code: 'SERVER_ERROR', details: deleteErr },
        { status: 500 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
