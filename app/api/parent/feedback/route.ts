import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    const { student_id, reason, message } = await req.json();

    if (!student_id || !reason || !message) {
      return NextResponse.json(
        { error: 'Student, reason and message details are required', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }

    // 1. Fetch parent's full name and school_id
    const { data: parentProfile, error: parentErr } = await adminClient
      .from('parent_profiles')
      .select(`
        school_id,
        user_profiles(full_name)
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (parentErr || !parentProfile) {
      return NextResponse.json(
        { error: 'Parent profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const parentName = parentProfile.user_profiles
      ? (Array.isArray(parentProfile.user_profiles) ? parentProfile.user_profiles[0].full_name : (parentProfile.user_profiles as any).full_name)
      : 'Unknown Parent';

    // 2. Fetch student's full name and grade
    const { data: studentProfile, error: studentErr } = await adminClient
      .from('student_profiles')
      .select(`
        grade,
        user_profiles(full_name)
      `)
      .eq('id', student_id)
      .maybeSingle();

    if (studentErr || !studentProfile) {
      return NextResponse.json(
        { error: 'Student profile not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const studentName = studentProfile.user_profiles
      ? (Array.isArray(studentProfile.user_profiles) ? studentProfile.user_profiles[0].full_name : (studentProfile.user_profiles as any).full_name)
      : 'Unknown Child';

    // 3. Construct description and insert alert notification
    const alertTitle = `⚠️ Helpdesk: ${reason}`;
    const alertMessage = `Parent "${parentName}" reported an issue for Child "${studentName}" (Grade ${studentProfile.grade || 'N/A'}): ${message}`;

    const { error: insertErr } = await adminClient
      .from('notifications')
      .insert({
        school_id: parentProfile.school_id,
        title: alertTitle,
        message: alertMessage,
        type: 'feedback',
      });

    if (insertErr) {
      throw insertErr;
    }

    return NextResponse.json({ success: true, message: 'Alert reported to admin successfully.' });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
