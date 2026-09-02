import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { LocationSchema } from '@/lib/validations';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  // Validate session - supports both cookie-based web session and Bearer headers from Android foreground service
  const auth = await requireRole(['worker', 'manager', 'supervisor']);
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    
    // Accept telemetry payload: map GPS coordinates input keys (lat/lng or latitude/longitude) to validation schema
    const mappedPayload = {
      latitude: body.lat !== undefined ? body.lat : body.latitude,
      longitude: body.lng !== undefined ? body.lng : body.longitude,
      speed: body.speed,
      heading: body.heading,
      accuracy: body.accuracy !== undefined ? body.accuracy : 0,
      battery_level: body.battery_level !== undefined ? body.battery_level : 100,
      is_tracking: body.is_tracking !== undefined ? body.is_tracking : true,
    };

    const parsed = LocationSchema.safeParse(mappedPayload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid telemetry payload', details: parsed.error.format() }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Check if Admin has enabled or paused tracking for this user profile
    const { data: userProfile } = await adminClient
      .from('user_profiles')
      .select('is_active, location_interval')
      .eq('id', auth.user.id)
      .single();

    if (userProfile && !userProfile.is_active) {
      // Admin has paused tracking for this user: set is_tracking = false in DB
      await adminClient
        .from('live_locations')
        .update({ is_tracking: false, recorded_at: new Date().toISOString() })
        .eq('user_id', auth.user.id);

      return NextResponse.json({
        success: false,
        trackingEnabled: false,
        message: 'Packet streaming paused by Admin'
      });
    }

    const { data: location, error } = await adminClient
      .from('live_locations')
      .upsert({
        user_id: auth.user.id,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        speed: parsed.data.speed,
        heading: parsed.data.heading,
        accuracy: parsed.data.accuracy,
        battery_level: parsed.data.battery_level,
        is_tracking: true,
        recorded_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      trackingEnabled: true,
      interval: userProfile?.location_interval || 10,
      location
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
