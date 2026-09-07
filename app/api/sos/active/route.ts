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

    // Exclude alerts triggered by the caller themselves (sender should not receive incoming siren/banner)
    query = query.neq('sender_id', callerId);

    if (callerRole === 'admin') {
      // Admin sees all active alerts across all plants (except own)
    } else if (callerRole === 'manager') {
      // Manager sees active alerts from their plant
      if (callerPlantId) {
        query = query.eq('plant_id', callerPlantId);
      } else {
        return NextResponse.json({ alerts: [] });
      }
    } else if (callerRole === 'supervisor') {
      // Supervisor sees:
      // 1. Worker alerts where supervisor_id = supervisor.id
      // 2. Manager alerts for their plant
      if (callerPlantId) {
        query = query.or(
          `and(sender_role.eq.worker,supervisor_id.eq.${callerId}),and(sender_role.eq.manager,plant_id.eq.${callerPlantId})`
        );
      } else {
        query = query.eq('sender_role', 'worker').eq('supervisor_id', callerId);
      }
    } else {
      // Workers do not receive incoming emergency alerts for other personnel
      return NextResponse.json({ alerts: [] });
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
