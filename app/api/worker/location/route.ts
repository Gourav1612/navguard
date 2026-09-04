import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { LocationSchema } from '@/lib/validations';
import { createAdminClient } from '@/lib/supabase/server';
import { safeErrorResponse } from '@/lib/security-utils';

// In-memory geocode cache to resolve road names without duplicate API calls
const geocodeCache = new Map<string, { address: string; timestamp: number }>();

async function getRoadName(lat: number, lng: number): Promise<string> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.address;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: { 'User-Agent': 'NaviGuard-Telemetry-Engine/1.0' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const addr = data.address;
      const road = addr?.road || addr?.street || addr?.pedestrian || addr?.neighbourhood || addr?.suburb || 'Field Transit Route';
      const area = addr?.suburb || addr?.city_district || addr?.city || '';
      const formatted = area && area !== road ? `${road}, ${area}` : road;
      geocodeCache.set(cacheKey, { address: formatted, timestamp: Date.now() });
      return formatted;
    }
  } catch {}

  return 'Field Transit Route';
}

// In-memory telemetry state machine to track stationary dwell and packet arrival
interface UserTelemetryState {
  lastLat: number;
  lastLng: number;
  lastPacketTime: number;
  stationarySince: number;
  isTracking: boolean;
  lastRoadName: string;
  stationaryAlertSent: boolean;
  delayAlertSent: boolean;
}

const userStateStore = new Map<string, UserTelemetryState>();

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    const userId = auth.user.id;
    const now = Date.now();

    // Check if Admin has enabled or paused tracking for this user profile
    const { data: userProfile } = await adminClient
      .from('user_profiles')
      .select('id, full_name, role, is_active, location_interval, plant_id, supervisor_id')
      .eq('id', userId)
      .single();

    if (userProfile && !userProfile.is_active) {
      // Admin has paused tracking for this user: set is_tracking = false in DB
      await adminClient
        .from('live_locations')
        .update({ is_tracking: false, recorded_at: new Date().toISOString() })
        .eq('user_id', userId);

      userStateStore.delete(userId);

      return NextResponse.json({
        success: false,
        trackingEnabled: false,
        is_paused: true,
        message: 'Packet streaming paused by Admin'
      }, { status: 403 });
    }

    const currentLat = parsed.data.latitude;
    const currentLng = parsed.data.longitude;
    const isTracking = parsed.data.is_tracking;
    const expectedInterval = (userProfile?.location_interval || 10);

    // Resolve current road/location name
    const roadName = await getRoadName(currentLat, currentLng);

    // Telemetry State & Smart Alert Engine
    let state = userStateStore.get(userId);

    if (!state) {
      // 1. Initial State / Tracking Started Alert
      state = {
        lastLat: currentLat,
        lastLng: currentLng,
        lastPacketTime: now,
        stationarySince: now,
        isTracking: isTracking,
        lastRoadName: roadName,
        stationaryAlertSent: false,
        delayAlertSent: false,
      };
      userStateStore.set(userId, state);

      if (isTracking) {
        // Record Tracking Started Notification
        await adminClient.from('audit_logs').insert({
          plant_id: userProfile?.plant_id,
          user_id: userId,
          action: 'TRACKING_STARTED',
          table_name: 'live_locations',
          record_id: userId,
          ip_address: roadName,
          user_agent: `${userProfile?.full_name || 'Personnel'} (${userProfile?.role || 'worker'}) started live tracking near ${roadName}`,
        });
      }
    } else {
      // 2. Transition from stopped to tracking
      if (!state.isTracking && isTracking) {
        await adminClient.from('audit_logs').insert({
          plant_id: userProfile?.plant_id,
          user_id: userId,
          action: 'TRACKING_STARTED',
          table_name: 'live_locations',
          record_id: userId,
          ip_address: roadName,
          user_agent: `${userProfile?.full_name || 'Personnel'} (${userProfile?.role || 'worker'}) resumed tracking at ${roadName}`,
        });
        state.isTracking = true;
        state.stationarySince = now;
        state.stationaryAlertSent = false;
      }

      // 3. Packet Delay / Late Telemetry Alert
      const packetDelta = now - state.lastPacketTime;
      if (!state.delayAlertSent && packetDelta > (expectedInterval * 2000) && packetDelta > 60000) {
        state.delayAlertSent = true;
        await adminClient.from('audit_logs').insert({
          plant_id: userProfile?.plant_id,
          user_id: userId,
          action: 'TELEMETRY_DELAY',
          table_name: 'live_locations',
          record_id: userId,
          ip_address: roadName,
          user_agent: `Telemetry packet delay: GPS update from ${userProfile?.full_name || 'worker'} delayed by ${Math.round(packetDelta / 1000)}s near ${roadName}`,
        });
      } else if (packetDelta <= (expectedInterval * 1500)) {
        state.delayAlertSent = false;
      }

      // 4. Movement & Stationary / Long Stoppage Alert (15 minutes threshold)
      const distanceMoved = calculateDistanceMeters(state.lastLat, state.lastLng, currentLat, currentLng);
      if (distanceMoved > 25) {
        // Active movement detected: reset stationary counter
        state.stationarySince = now;
        state.stationaryAlertSent = false;
        state.lastLat = currentLat;
        state.lastLng = currentLng;
      } else {
        const stationaryDuration = now - state.stationarySince;
        // 15 minutes (900,000 ms) stoppage threshold
        if (!state.stationaryAlertSent && stationaryDuration >= 15 * 60 * 1000) {
          state.stationaryAlertSent = true;
          const mins = Math.round(stationaryDuration / 60000);
          await adminClient.from('audit_logs').insert({
            plant_id: userProfile?.plant_id,
            user_id: userId,
            action: 'STATIONARY_ALERT',
            table_name: 'live_locations',
            record_id: userId,
            ip_address: roadName,
            user_agent: `Stationary alert: ${userProfile?.full_name || 'Worker'} has been stationary for ${mins} mins at ${roadName}`,
          });
        }
      }

      state.lastPacketTime = now;
      state.lastRoadName = roadName;
    }

    // Persist live location record
    const { data: location, error } = await adminClient
      .from('live_locations')
      .upsert({
        user_id: userId,
        latitude: currentLat,
        longitude: currentLng,
        speed: parsed.data.speed,
        heading: parsed.data.heading,
        accuracy: parsed.data.accuracy,
        battery_level: parsed.data.battery_level,
        is_tracking: isTracking,
        recorded_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      return safeErrorResponse(error, 'Failed to save telemetry location', 500);
    }

    return NextResponse.json({
      success: true,
      trackingEnabled: true,
      interval: expectedInterval,
      road_name: roadName,
      location
    });
  } catch (err: unknown) {
    return safeErrorResponse(err, 'Server error processing location telemetry', 500);
  }
}
