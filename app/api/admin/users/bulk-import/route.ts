import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth-guard';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin']);
  if (auth.error) return auth.error;

  const { user } = auth;
  const adminClient = createAdminClient();

  try {
    const body = await req.json();
    const rawRows = Array.isArray(body.rows) ? body.rows : [];

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: 'No data rows found in uploaded file.', code: 'INVALID_DATA' },
        { status: 400 }
      );
    }

    // Attach original row index (1-indexed) to preserve original row numbers
    const indexedRows = rawRows.map((r: any, i: number) => ({ ...r, __rowNum: i + 1 }));

    // Sort rows so supervisors and managers are processed BEFORE workers
    // This allows workers to reference supervisors created in the same import batch!
    const sortedRows = [...indexedRows].sort((a: any, b: any) => {
      const roleA = String(a.role || a['Role'] || a['role'] || '').trim().toLowerCase();
      const roleB = String(b.role || b['Role'] || b['role'] || '').trim().toLowerCase();
      
      const priority = (role: string) => {
        if (role === 'manager' || role === 'supervisor') return 1;
        if (role === 'worker') return 2;
        return 3;
      };
      return priority(roleA) - priority(roleB);
    });

    // Fetch existing plants for name-to-ID resolution
    const { data: plantsData } = await adminClient.from('plants').select('id, name');
    const plants = plantsData || [];

    // Fetch existing supervisors for name/username resolution
    const { data: supervisorsData } = await adminClient
      .from('user_profiles')
      .select('id, full_name, username, email')
      .eq('role', 'supervisor');
    const supervisors: any[] = supervisorsData || [];

    let successCount = 0;
    let errorCount = 0;
    const resultsMap = new Map<number, {
      row: number;
      name: string;
      email: string;
      role: string;
      status: 'success' | 'error';
      error?: string;
    }>();

    for (const r of sortedRows) {
      const rowNum = r.__rowNum;

      // Extract & normalize fields
      const fullName = String(r.full_name || r['Full Name'] || r['full_name'] || r['Name'] || '').trim();
      const username = String(r.username || r['Username'] || r['username'] || '').trim().replace(/^@/, '');
      const email = String(r.email || r['Email'] || r['Email Address'] || r['email_address'] || '').trim().toLowerCase();
      const phone = String(r.phone || r['Phone'] || r['phone'] || r['Contact Phone'] || '').trim();
      const password = String(r.password || r['Password'] || r['password'] || '').trim();
      const role = String(r.role || r['Role'] || r['role'] || '').trim().toLowerCase();
      const plantName = String(r.plant_name || r['Plant Name'] || r['Plant'] || r['plant_id'] || '').trim();
      const supervisorName = String(r.supervisor_name || r['Supervisor Name'] || r['Supervisor'] || r['supervisor_username'] || r['supervisor'] || '').trim().replace(/^@/, '');
      
      const rawInterval = Number(r.location_interval || r['Location Interval'] || r['location_interval'] || 10);
      const locationInterval = isNaN(rawInterval) || rawInterval < 2 ? 10 : rawInterval;

      // Mandatory Field Validations
      if (!fullName) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: '—', email: email || '—', role: role || '—', status: 'error', error: 'Full Name is required.' });
        continue;
      }
      if (!username) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email: email || '—', role: role || '—', status: 'error', error: 'Username is required.' });
        continue;
      }
      if (!email) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email: '—', role: role || '—', status: 'error', error: 'Email Address is required.' });
        continue;
      }
      if (!phone) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role: role || '—', status: 'error', error: 'Phone Number is required.' });
        continue;
      }
      if (!password || password.length < 6) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role: role || '—', status: 'error', error: 'Password is required and must be at least 6 characters.' });
        continue;
      }
      if (!role) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role: '—', status: 'error', error: 'Account Role is required.' });
        continue;
      }

      // Security Check: Disallow Admin role in Bulk Import
      if (role === 'admin') {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: 'Admin accounts cannot be created via bulk import.' });
        continue;
      }

      if (!['worker', 'supervisor', 'manager'].includes(role)) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: `Invalid role '${role}'. Allowed roles: worker, supervisor, manager.` });
        continue;
      }

      if (!plantName) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: 'Plant Site Name is required.' });
        continue;
      }

      // Resolve Plant Site Name -> Plant ID
      const matchedPlant = plants.find((p) => p.name.toLowerCase().trim() === plantName.toLowerCase().trim());
      if (!matchedPlant) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: `Plant site '${plantName}' not found. Please specify a valid plant site.` });
        continue;
      }

      // Resolve Supervisor for Worker role
      let supervisorId: string | null = null;
      if (role === 'worker') {
        if (!supervisorName) {
          errorCount++;
          resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: 'Supervisor Name or Username is required for Workers.' });
          continue;
        }

        const matchedSup = supervisors.find(
          (s) =>
            s.full_name.toLowerCase().trim() === supervisorName.toLowerCase().trim() ||
            (s.username && s.username.toLowerCase().trim() === supervisorName.toLowerCase().trim()) ||
            s.email.toLowerCase().trim() === supervisorName.toLowerCase().trim()
        );

        if (!matchedSup) {
          errorCount++;
          resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: `Supervisor '${supervisorName}' not found. Please specify an existing Supervisor.` });
          continue;
        }
        supervisorId = matchedSup.id;
      }

      // Provision Supabase Auth User
      const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role,
          username,
          full_name: fullName,
          is_active: true,
        },
      });

      if (authErr || !authUser.user) {
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: authErr?.message || 'Failed to create auth account.' });
        continue;
      }

      // Insert User Profile payload
      const profilePayload: any = {
        id: authUser.user.id,
        full_name: fullName,
        username,
        email,
        phone,
        role,
        plant_id: matchedPlant.id,
        supervisor_id: supervisorId,
        location_interval: locationInterval,
        is_active: true,
      };

      let { error: profileErr } = await adminClient
        .from('user_profiles')
        .upsert(profilePayload, { onConflict: 'id' });

      if (profileErr && profilePayload.username) {
        // Fallback if username column is missing from user_profiles table in PostgREST schema cache
        delete profilePayload.username;
        const fallbackRes = await adminClient
          .from('user_profiles')
          .upsert(profilePayload, { onConflict: 'id' });
        profileErr = fallbackRes.error;
      }

      if (profileErr) {
        // Cleanup Auth user if profile creation fails
        await adminClient.auth.admin.deleteUser(authUser.user.id);
        errorCount++;
        resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'error', error: profileErr.message || 'Failed to create profile record.' });
        continue;
      }

      // If created user is a supervisor, dynamically add them to supervisors list for remaining workers in this batch!
      if (role === 'supervisor') {
        supervisors.push({
          id: authUser.user.id,
          full_name: fullName,
          username,
          email,
        });
      }

      // Write Audit Log
      await adminClient.from('audit_logs').insert({
        plant_id: matchedPlant.id,
        user_id: user.id,
        action: 'CREATE',
        table_name: 'user_profiles (BULK IMPORT)',
        record_id: authUser.user.id,
      });

      successCount++;
      resultsMap.set(rowNum, { row: rowNum, name: fullName, email, role, status: 'success' });
    }

    // Re-order results to match original spreadsheet row order (1..N)
    const finalResults = rawRows.map((_: any, idx: number) => resultsMap.get(idx + 1)!).filter(Boolean);

    return NextResponse.json({
      success: true,
      totalRows: rawRows.length,
      successCount,
      errorCount,
      results: finalResults,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Bulk import processing failed', code: 'SERVER_ERROR' },
      { status: 500 }
    );
  }
}
