import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateParentSchema } from '@/lib/validations';

// GET /api/admin/parents
export async function GET() {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    const { data: parents, error } = await supabase
      .from('parent_profiles')
      .select(`
        id,
        user:user_profiles(full_name, email, phone),
        links:parent_student_links(
          student:student_profiles(
            id,
            grade,
            user:user_profiles(full_name)
          )
        )
      `)
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch parents', code: 'SERVER_ERROR', details: error },
        { status: 500 }
      );
    }

    // Map nested fields to expected schema
    const mapped = (parents || []).map((p: any) => {
      const userObj = Array.isArray(p.user) ? p.user[0] : p.user;
      
      const students = (p.links || []).map((lnk: any) => {
        const s = lnk.student;
        const sUser = s ? (Array.isArray(s.user) ? s.user[0] : s.user) : null;
        return {
          id: s?.id || '',
          grade: s?.grade || '',
          user: {
            full_name: sUser?.full_name || 'Unknown Student',
          },
        };
      });

      return {
        id: p.id,
        user: userObj
          ? {
              full_name: userObj.full_name,
              email: userObj.email,
              phone: userObj.phone,
            }
          : null,
        students,
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

// POST /api/admin/parents
export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { profile } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = CreateParentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { full_name, email, phone, password, student_ids = [] } = parsed.data;

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

    // 1. Create auth user with parent role metadata
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'parent',
        school_id: profile.school_id,
      },
    });

    if (authErr || !authData.user) {
      return NextResponse.json(
        { error: authErr?.message || 'Failed to create auth account', code: 'SERVER_ERROR' },
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

    // 3. Create parent profile row
    const { data: newParent, error: parentErr } = await adminClient
      .from('parent_profiles')
      .insert({
        user_id: userId,
        school_id: profile.school_id,
      })
      .select()
      .single();

    if (parentErr || !newParent) {
      await adminClient.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: 'Failed to create parent profile details', code: 'SERVER_ERROR', details: parentErr },
        { status: 500 }
      );
    }

    // 4. Create parent-student links for children
    if (student_ids.length > 0) {
      const linksToInsert = student_ids.map((studentId) => ({
        parent_id: newParent.id,
        student_id: studentId,
        relationship: 'guardian',
      }));

      const { error: linksErr } = await adminClient
        .from('parent_student_links')
        .insert(linksToInsert);

      if (linksErr) {
        // Rollback parent profile and user
        await adminClient.from('parent_profiles').delete().eq('id', newParent.id);
        await adminClient.auth.admin.deleteUser(userId);
        return NextResponse.json(
          { error: 'Failed to link children to parent profile', code: 'SERVER_ERROR', details: linksErr },
          { status: 500 }
        );
      }
    }

    // Write audit log
    await adminClient.from('audit_logs').insert({
      school_id: profile.school_id,
      user_id: auth.user.id,
      action: 'CREATE',
      table_name: 'parent_profiles',
      record_id: newParent.id,
      new_values: { ...newParent, email, full_name, student_ids },
    });

    return NextResponse.json(
      {
        id: newParent.id,
        user_id: userId,
        user: { full_name, email, phone },
        student_ids,
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
