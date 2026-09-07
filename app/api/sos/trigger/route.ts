import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['worker', 'supervisor', 'manager', 'admin']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const { latitude, longitude, accuracy, message } = body;

    // Fetch complete user profile with plant and supervisor details
    const { data: userProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select(`
        id,
        full_name,
        email,
        role,
        plant_id,
        supervisor_id,
        plant:plants(name)
      `)
      .eq('id', auth.profile.id)
      .single();

    if (profileErr || !userProfile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const plantName = Array.isArray(userProfile.plant) 
      ? userProfile.plant[0]?.name 
      : (userProfile.plant as any)?.name || 'General Facility';

    // Insert active SOS alert
    const { data: alertData, error: insertErr } = await adminClient
      .from('emergency_alerts')
      .insert({
        sender_id: userProfile.id,
        supervisor_id: userProfile.supervisor_id || null,
        plant_id: userProfile.plant_id || null,
        sender_role: userProfile.role,
        sender_name: userProfile.full_name || userProfile.email || 'Staff Member',
        plant_name: plantName,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        accuracy: accuracy ? Number(accuracy) : 0,
        status: 'active',
        message: message || 'Emergency SOS Triggered',
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('Failed to create emergency alert:', insertErr);
      return NextResponse.json({ error: 'Failed to record emergency alert', details: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, alert: alertData });
  } catch (err: any) {
    console.error('Error in POST /api/sos/trigger:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
