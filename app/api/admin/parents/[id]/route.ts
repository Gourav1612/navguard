import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CreateParentSchema } from '@/lib/validations';

// PATCH /api/admin/parents/[id]
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
    const partialSchema = CreateParentSchema.partial();
    const parsed = partialSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: parent, error: fetchErr } = await adminClient
      .from('parent_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !parent) {
      return NextResponse.json(
        { error: 'Parent not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { full_name, phone, student_ids } = parsed.data;

    // 1. Update user_profiles
    const profileUpdates: any = {};
    if (full_name !== undefined) profileUpdates.full_name = full_name;
    if (phone !== undefined) profileUpdates.phone = phone;

    if (Object.keys(profileUpdates).length > 0) {
      await adminClient
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', parent.user_id);
    }

    // 2. Synchronize student links if student_ids is updated
    if (student_ids !== undefined) {
      // Clear old links
      await adminClient
        .from('parent_student_links')
        .delete()
        .eq('parent_id', id);

      // Insert new links
      if (student_ids.length > 0) {
        const linksToInsert = student_ids.map((studentId) => ({
          parent_id: id,
          student_id: studentId,
          relationship: 'guardian',
        }));

        await adminClient
          .from('parent_student_links')
          .insert(linksToInsert);
      }
    }

    // Fetch updated complete parent record
    const { data: updatedParent } = await adminClient
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
      .eq('id', id)
      .single();

    return NextResponse.json(updatedParent);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/parents/[id]
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
    const { data: parent, error: fetchErr } = await adminClient
      .from('parent_profiles')
      .select('id, user_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (fetchErr || !parent) {
      return NextResponse.json(
        { error: 'Parent not found or access denied', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Deleting the auth user automatically cascades and deletes parent profile row, links, etc.
    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(parent.user_id);

    if (authDeleteErr) {
      // Fallback direct delete
      await adminClient.from('parent_profiles').delete().eq('id', id);
    }

    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
