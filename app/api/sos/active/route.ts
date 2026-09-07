import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function GET() {
  const auth = await requireRole(['worker', 'supervisor', 'manager', 'admin']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();

  try {
    const callerRole = auth.profile.role;
    const callerId = auth.profile.id;
    const callerPlantId = auth.profile.plant_id;

    let query = adminClient
      .from('emergency_alerts')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (callerRole === 'admin') {
      // Admin sees all active alerts across all plants
    } else if (callerRole === 'manager') {
      // Manager sees all active alerts from their plant
      if (callerPlantId) {
        query = query.eq('plant_id', callerPlantId);
      } else {
        query = query.eq('sender_id', callerId);
      }
    } else if (callerRole === 'supervisor') {
      // Supervisor sees:
      // 1. Worker alerts where supervisor_id = supervisor.id
      // 2. Manager alerts for their plant
      // 3. Their own alert
      if (callerPlantId) {
        query = query.or(
          `and(sender_role.eq.worker,supervisor_id.eq.${callerId}),and(sender_role.eq.manager,plant_id.eq.${callerPlantId}),sender_id.eq.${callerId}`
        );
      } else {
        query = query.or(`and(sender_role.eq.worker,supervisor_id.eq.${callerId}),sender_id.eq.${callerId}`);
      }
    } else {
      // Worker only sees their own active alert
      query = query.eq('sender_id', callerId);
    }

    const { data: alerts, error: queryErr } = await query;

    if (queryErr) {
      console.error('Failed to fetch active alerts:', queryErr);
      return NextResponse.json({ error: 'Failed to fetch active alerts' }, { status: 500 });
    }

    return NextResponse.json({ alerts: alerts || [] });
  } catch (err: any) {
    console.error('Error in GET /api/sos/active:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
