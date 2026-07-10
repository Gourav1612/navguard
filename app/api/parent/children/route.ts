import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';

export async function GET() {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();

  try {
    // 1. Fetch parent profile and linked student profiles nested
    const { data: parentRaw, error: parentErr } = await supabase
      .from('parent_profiles')
      .select(`
        id,
        links:parent_student_links(
          student:student_profiles(
            id,
            grade,
            bus:buses(id, name, registration_plate),
            stop:stops(id, name, latitude, longitude, stop_order),
            user:user_profiles(full_name)
          )
        )
      `)
      .eq('user_id', user.id)
      .maybeSingle();

    if (parentErr || !parentRaw) {
      return NextResponse.json(
        { error: 'Parent profile not found', code: 'NOT_FOUND', details: parentErr },
        { status: 404 }
      );
    }

    const links = parentRaw.links || [];

    // 2. Map children details and check if there's an active trip for their assigned bus
    const mapped = await Promise.all(
      links.map(async (lnk: any) => {
        const s = lnk.student;
        if (!s) return null;

        const busObj = Array.isArray(s.bus) ? s.bus[0] : s.bus;
        const stopObj = Array.isArray(s.stop) ? s.stop[0] : s.stop;
        const userObj = Array.isArray(s.user) ? s.user[0] : s.user;

        let activeTripId = null;
        let latestLocation = null;
        let driverUser = null;

        if (busObj?.id) {
          // Fetch assigned driver profile for this bus
          const { data: driverObj } = await supabase
            .from('drivers')
            .select(`
              id,
              user:user_profiles(full_name, phone)
            `)
            .eq('bus_id', busObj.id)
            .eq('is_active', true)
            .maybeSingle();

          if (driverObj?.user) {
            const rawUser = driverObj.user;
            driverUser = Array.isArray(rawUser) ? rawUser[0] : rawUser;
          }

          // Fetch active trip
          const { data: activeTrip } = await supabase
            .from('trips')
            .select('id')
            .eq('bus_id', busObj.id)
            .eq('status', 'active')
            .maybeSingle();

          if (activeTrip) {
            activeTripId = activeTrip.id;

            // Fetch latest bus coordinate from bus_locations
            const { data: locationObj } = await supabase
              .from('bus_locations')
              .select('latitude, longitude, speed, recorded_at')
              .eq('bus_id', busObj.id)
              .eq('trip_id', activeTripId)
              .order('recorded_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (locationObj) {
              latestLocation = {
                latitude: Number(locationObj.latitude),
                longitude: Number(locationObj.longitude),
                speed: Number(locationObj.speed),
                recorded_at: locationObj.recorded_at,
              };
            }
          }
        }

        return {
          student_id: s.id,
          full_name: userObj?.full_name || 'Unknown Child',
          grade: s.grade || '',
          bus: busObj
            ? {
                id: busObj.id,
                name: busObj.name,
                registration_plate: busObj.registration_plate,
                active_trip_id: activeTripId,
                driver: driverUser
                  ? {
                      full_name: driverUser.full_name,
                      phone: driverUser.phone || 'No phone registered',
                    }
                  : null,
                latest_location: latestLocation,
              }
            : null,
          stop: stopObj
            ? {
                id: stopObj.id,
                name: stopObj.name,
                latitude: Number(stopObj.latitude),
                longitude: Number(stopObj.longitude),
                stop_order: stopObj.stop_order,
              }
            : null,
        };
      })
    );

    // Filter out null values in map output
    return NextResponse.json(mapped.filter((item) => item !== null));
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}

const LinkStudentSchema = z.object({
  name: z.string().min(1),
  roll_number: z.string().min(1),
  grade: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const auth = await requireRole(['parent']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const supabase = await createSupabaseServerClient();
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const parsed = LinkStudentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Name, roll number, and grade are required fields.' },
        { status: 400 }
      );
    }

    const { name, roll_number, grade } = parsed.data;

    // 1. Get parent profile
    const { data: parentProfile, error: parentErr } = await supabase
      .from('parent_profiles')
      .select('id, school_id')
      .eq('user_id', user.id)
      .single();

    if (parentErr || !parentProfile) {
      return NextResponse.json(
        { error: 'Parent profile not found.' },
        { status: 404 }
      );
    }

    // 2. Search for student profile
    const { data: studentProfiles, error: studentErr } = await supabase
      .from('student_profiles')
      .select(`
        id,
        user:user_profiles (
          id,
          full_name,
          school_id
        )
      `)
      .eq('roll_number', roll_number)
      .eq('grade', grade);

    if (studentErr || !studentProfiles) {
      return NextResponse.json(
        { error: 'Failed to search for student profile.' },
        { status: 500 }
      );
    }

    // Find the student matching name and school_id
    const matchedStudent = studentProfiles.find((sp: any) => {
      const u = sp.user;
      return (
        u &&
        u.full_name.toLowerCase().trim() === name.toLowerCase().trim() &&
        u.school_id === parentProfile.school_id
      );
    });

    if (!matchedStudent) {
      return NextResponse.json(
        { error: 'No student found matching those details in your school.' },
        { status: 404 }
      );
    }

    // 3. Check if link already exists
    const { data: existingLink } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('parent_id', parentProfile.id)
      .eq('student_id', matchedStudent.id)
      .maybeSingle();

    if (existingLink) {
      return NextResponse.json(
        { error: 'This student is already linked to your profile.' },
        { status: 409 }
      );
    }

    // 4. Create the link
    const { error: linkInsertErr } = await adminClient
      .from('parent_student_links')
      .insert({
        parent_id: parentProfile.id,
        student_id: matchedStudent.id,
        relationship: 'guardian',
      });

    if (linkInsertErr) {
      return NextResponse.json(
        { error: 'Failed to establish parent-student link.', details: linkInsertErr },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
