import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateStudentSchema } from '@/lib/validations';

// GET /api/admin/students
export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const { data: students, error } = await supabase
      .from('student_profiles')
      .select(`
        *,
        bus:buses(id, name),
        stop:stops(id, name),
        user:user_profiles(full_name, email, phone)
      `)
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch students', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map nested data to matching schema
    const mapped = (students || []).map((s: any) => {
      const busObj = Array.isArray(s.bus) ? s.bus[0] : s.bus;
      const stopObj = Array.isArray(s.stop) ? s.stop[0] : s.stop;
      const userObj = Array.isArray(s.user) ? s.user[0] : s.user;

      return {
        id: s.id,
        grade: s.grade,
        roll_number: s.roll_number,
        bus: busObj ? { id: busObj.id, name: busObj.name } : null,
        stop: stopObj ? { id: stopObj.id, name: stopObj.name } : null,
        user: userObj
          ? {
              full_name: userObj.full_name,
              email: userObj.email,
              phone: userObj.phone,
            }
          : null,
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

// POST /api/admin/students
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = CreateStudentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { full_name, email, phone, password, grade, roll_number, bus_id, stop_id } = parsed.data;

    // Check if email already registered in profiles
    const { data: existingProfile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        { error: 'This email is already registered', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    // 1. Create auth user with role student metadata
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'student',
        school_id: profile.school_id,
      },
    });

    if (authErr || !authData.user) {
      return NextResponse.json(
        { error: authErr?.message || 'Failed to create student auth account', code: 'SERVER_ERROR' },
        { status: 500 }
      );
    }

    const userId = authData.user.id;

    // 2. Update phone details
    if (phone) {
      await adminClient
        .from('user_profiles')
        .update({ phone })
        .eq('id', userId);
    }

    // 3. Create student profile record
    const { data: newStudent, error: studentErr } = await adminClient
      .from('student_profiles')
      .insert({
        user_id: userId,
        school_id: profile.school_id,
        bus_id: bus_id || null,
        stop_id: stop_id || null,
        grade,
        roll_number,
      })
      .select()
      .single();

    if (studentErr || !newStudent) {
      await adminClient.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: 'Failed to create student details record', code: 'SERVER_ERROR', details: studentErr },
        { status: 500 }
      );
    }

    // Write audit log
    await adminClient.from('audit_logs').insert({
      school_id: profile.school_id,
      user_id: auth.user.id,
      action: 'CREATE',
      table_name: 'student_profiles',
      record_id: newStudent.id,
      new_values: { ...newStudent, email, full_name },
    });

    return NextResponse.json(
      {
        id: newStudent.id,
        user_id: userId,
        grade,
        roll_number,
        bus: bus_id ? { id: bus_id } : null,
        stop: stop_id ? { id: stop_id } : null,
        user: { full_name, email, phone },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
