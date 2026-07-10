import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';

const StopPassedSchema = z.object({
  trip_id: z.string().uuid(),
  stop_id: z.string().uuid(),
  passed: z.boolean(),
});

export async function POST(req: NextRequest) {
  const auth = await requireRole(['driver']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = StopPassedSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { trip_id, stop_id, passed } = parsed.data;

    // 1. Get trip details to check the bus_id
    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .select('id, bus_id, route_id')
      .eq('id', trip_id)
      .eq('school_id', profile.school_id)
      .single();

    if (tripErr || !trip) {
      return NextResponse.json(
        { error: 'Trip not found or unauthorized' },
        { status: 404 }
      );
    }

    // 2. Get stop details to use its name in the notification
    const { data: stop, error: stopErr } = await supabase
      .from('stops')
      .select('id, name')
      .eq('id', stop_id)
      .eq('route_id', trip.route_id)
      .single();

    if (stopErr || !stop) {
      return NextResponse.json(
        { error: 'Stop not found' },
        { status: 404 }
      );
    }

    // If marking as passed (de-boarding)
    if (passed) {
      // 3. Find all students assigned to this bus and this stop
      const { data: students = [], error: studentsErr } = await supabase
        .from('student_profiles')
        .select(`
          id,
          user:user_profiles (
            full_name
          )
        `)
        .eq('bus_id', trip.bus_id)
        .eq('stop_id', stop.id);

      if (studentsErr) {
        return NextResponse.json(
          { error: 'Failed to fetch assigned students', details: studentsErr },
          { status: 500 }
        );
      }

      // 4. Create announcements for each student
      for (const student of students) {
        const studentName = (student.user as any)?.full_name || 'A student';
        
        await adminClient.from('announcements').insert({
          school_id: profile.school_id,
          created_by: profile.id,
          title: '📢 Student De-boarded',
          body: `${studentName} has safely de-boarded the bus at ${stop.name}.`,
          target_role: 'all',
        });
      }

      // 5. Log audit event
      await adminClient.from('audit_logs').insert({
        school_id: profile.school_id,
        user_id: profile.id,
        action: 'STOP_PASSED',
        table_name: 'stops',
        record_id: stop.id,
        new_values: {
          trip_id,
          stop_id: stop.id,
          stop_name: stop.name,
          students_notified: students.length,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
