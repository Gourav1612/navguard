import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateStudentSchema } from '@/lib/validations';

// PATCH /api/admin/students/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const partialSchema = CreateStudentSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: student, error: fetchErr } = await adminClient
      .from('student_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !student) {
      return NextResponse.json(
        { error: 'Student not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { full_name, phone, grade, roll_number, bus_id, stop_id, is_active } = parsed.data;

    // 1. Update public.student_profiles
    const studentUpdates: any = {};
    if (grade !== undefined) studentUpdates.grade = grade;
    if (roll_number !== undefined) studentUpdates.roll_number = roll_number;
    if (bus_id !== undefined) studentUpdates.bus_id = bus_id;
    if (stop_id !== undefined) studentUpdates.stop_id = stop_id;

    if (Object.keys(studentUpdates).length > 0) {
      await adminClient
        .from('student_profiles')
        .update(studentUpdates)
        .eq('id', id);
    }

    // 2. Update user_profiles
    const profileUpdates: any = {};
    if (full_name !== undefined) profileUpdates.full_name = full_name;
    if (phone !== undefined) profileUpdates.phone = phone;
    if (is_active !== undefined) profileUpdates.is_active = is_active;

    if (Object.keys(profileUpdates).length > 0) {
      await adminClient
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', student.user_id);
    }

    // Fetch updated complete student record
    const { data: updatedStudent } = await adminClient
      .from('student_profiles')
      .select(`
        *,
        bus:buses(id, name),
        stop:stops(id, name),
        user:user_profiles(full_name, email, phone)
      `)
      .eq('id', id)
      .single();

    return NextResponse.json(updatedStudent);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/students/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const { id } = await params;
  const adminClient = createAdminClient();

  try {
    // Verify ownership
    const { data: student, error: fetchErr } = await adminClient
      .from('student_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !student) {
      return NextResponse.json(
        { error: 'Student not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Deleting the auth user automatically cascades and deletes student profile row, parent links, etc.
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(student.user_id);

    if (authDeleteErr) {
      // Fallback direct delete
      await adminClient.from('student_profiles').delete().eq('id', id);
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
