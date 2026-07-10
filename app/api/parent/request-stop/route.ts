import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';

const RequestStopSchema = z.object({
  student_id: z.string().uuid(),
  stop_name: z.string().min(1, 'Stop name is required'),
  address: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export async function POST(req: NextRequest) {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = RequestStopSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { student_id, stop_name, address, latitude, longitude } = parsed.data;

    // 1. Verify parent-student links
    const { data: link, error: linkErr } = await supabase
      .from('parent_student_links')
      .select('id, student_id, student_profiles ( bus_id, school_id )')
      .eq('student_id', student_id)
      .single();

    if (linkErr || !link) {
      return NextResponse.json(
        { error: 'Unauthorized student link' },
        { status: 403 }
      );
    }

    const studentProfile = link.student_profiles as any;
    if (!studentProfile.bus_id) {
      return NextResponse.json(
        { error: 'Student is not assigned to a bus fleet route' },
        { status: 400 }
      );
    }

    // 2. Find route linked to bus
    const { data: route, error: routeErr } = await supabase
      .from('routes')
      .select('id')
      .eq('bus_id', studentProfile.bus_id)
      .maybeSingle();

    if (routeErr || !route) {
      return NextResponse.json(
        { error: 'Route not configured for this student\'s bus unit' },
        { status: 400 }
      );
    }

    // 3. Find stops to compute max stop_order
    const { data: stops = [] } = await supabase
      .from('stops')
      .select('stop_order')
      .eq('route_id', route.id);

    const maxOrder = (stops || []).reduce((max: number, s: any) => Math.max(max, Number(s.stop_order)), -1);
    const stopOrder = maxOrder + 1;

    // 4. Create custom stop using admin client (since parents have RLS read-only on stops)
    const { data: newStop, error: stopErr } = await adminClient
      .from('stops')
      .insert({
        route_id: route.id,
        school_id: studentProfile.school_id,
        name: `[Home] ${stop_name}`,
        address: address || null,
        latitude,
        longitude,
        stop_order: stopOrder,
      })
      .select()
      .single();

    if (stopErr || !newStop) {
      return NextResponse.json(
        { error: 'Failed to create stop', details: stopErr },
        { status: 500 }
      );
    }

    // 5. Update student's stop_id in student_profiles
    const { error: studentErr } = await adminClient
      .from('student_profiles')
      .update({
        stop_id: newStop.id,
      })
      .eq('id', student_id);

    if (studentErr) {
      return NextResponse.json(
        { error: 'Failed to assign stop to student profile', details: studentErr },
        { status: 500 }
      );
    }

    // 6. Log audit event
    await adminClient.from('audit_logs').insert({
      school_id: studentProfile.school_id,
      user_id: profile.id,
      action: 'PARENT_REQUEST_STOP',
      table_name: 'stops',
      record_id: newStop.id,
      new_values: {
        student_id,
        stop_id: newStop.id,
        name: newStop.name,
        latitude,
        longitude,
      },
    });

    return NextResponse.json({ success: true, stop: newStop });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
