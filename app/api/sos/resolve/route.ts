import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guard';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager', 'supervisor']);
  if (auth.error) return auth.error;

  const adminClient = createAdminClient();

  try {
    const body = await req.json().catch(() => ({}));
    const { alertId } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'Alert ID is required' }, { status: 400 });
    }

    // Fetch the target alert
    const { data: alert, error: fetchErr } = await adminClient
      .from('emergency_alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (fetchErr || !alert) {
      return NextResponse.json({ error: 'Emergency alert not found' }, { status: 404 });
    }

    // Authorization verification based on hierarchy:
    const callerRole = auth.profile.role;
    const callerPlantId = auth.profile.plant_id;
    const callerId = auth.profile.id;

    let isAuthorized = false;
    if (callerRole === 'admin') {
      isAuthorized = true;
    } else if (callerRole === 'manager' && callerPlantId === alert.plant_id) {
      isAuthorized = true;
    } else if (callerRole === 'supervisor') {
      if (alert.sender_role === 'worker' && alert.supervisor_id === callerId) {
        isAuthorized = true;
      } else if (alert.sender_role === 'manager' && alert.plant_id === callerPlantId) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized to resolve this emergency alert' }, { status: 403 });
    }

    // Update status to resolved
    const { data: updatedAlert, error: updateErr } = await adminClient
      .from('emergency_alerts')
      .update({
        status: 'resolved',
        resolved_by: callerId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', alertId)
      .select('*')
      .single();

    if (updateErr) {
      console.error('Failed to resolve alert:', updateErr);
      return NextResponse.json({ error: 'Failed to update alert status' }, { status: 500 });
    }

    return NextResponse.json({ success: true, alert: updatedAlert });
  } catch (err: any) {
    console.error('Error in POST /api/sos/resolve:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
