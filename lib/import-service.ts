import { SupabaseClient } from '@supabase/supabase-js';
import { runWithConcurrencyLimit } from './async';
import { generateTempPassword } from './security';

export interface ImportRow {
  role: 'driver' | 'parent' | 'student';
  full_name: string;
  email: string;
  phone?: string | null;
  password?: string | null;
  license_number?: string | null;
  license_expiry?: string | null;
  grade?: string | null;
  roll_number?: string | null;
  parent_email?: string | null;
}

export interface ImportResult {
  summary: {
    total_processed: number;
    success_count: number;
    failure_count: number;
    links_succeeded: number;
    links_failed: number;
  };
  successes: any[];
  failures: any[];
  links: {
    successes: string[];
    failures: any[];
  };
}

export async function executeImport(
  adminClient: SupabaseClient,
  rows: ImportRow[],
  schoolId: string,
  adminUserId: string
): Promise<ImportResult> {
  const successes: any[] = [];
  const failures: any[] = [];

  // Phase 0: Check for duplicates in request
  const validRowsToProcess: { rowIndex: number; rowData: ImportRow }[] = [];
  const emailsToCheck = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const rawRow = rows[i];

    const emailLower = rawRow.email.toLowerCase();
    if (emailsToCheck.has(emailLower)) {
      failures.push({
        row: rowIndex,
        email: rawRow.email,
        error: 'Duplicate email address within the import file'
      });
      continue;
    }

    emailsToCheck.add(emailLower);
    validRowsToProcess.push({
      rowIndex,
      rowData: rawRow
    });
  }

  // Phase 0.5: Query database for existing emails
  const existingEmailsSet = new Set<string>();
  if (emailsToCheck.size > 0) {
    const { data: existingProfiles } = await adminClient
      .from('user_profiles')
      .select('email')
      .in('email', Array.from(emailsToCheck));

    if (existingProfiles) {
      for (const p of existingProfiles) {
        existingEmailsSet.add(p.email.toLowerCase());
      }
    }
  }

  // Filter out already registered emails
  const finalRowsToProcess = validRowsToProcess.filter(({ rowIndex, rowData }) => {
    const emailLower = rowData.email.toLowerCase();
    if (existingEmailsSet.has(emailLower)) {
      failures.push({
        row: rowIndex,
        email: rowData.email,
        error: 'This email is already registered in user profiles'
      });
      return false;
    }
    return true;
  });

  // Phase 1: Create auth users concurrently (concurrency = 5)
  const creationResults = await runWithConcurrencyLimit(5, finalRowsToProcess, async ({ rowIndex, rowData }) => {
    const { role, full_name, email, password } = rowData;

    const finalPassword = password && password.trim().length >= 8 
      ? password 
      : generateTempPassword();

    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: {
        full_name,
        role,
        school_id: schoolId,
      }
    });

    if (authErr || !authData.user) {
      return {
        success: false,
        rowIndex,
        email,
        error: `Auth account creation failed: ${authErr?.message || 'Unknown error'}`
      };
    }

    return {
      success: true,
      rowIndex,
      userId: authData.user.id,
      rowData,
      temp_password: finalPassword
    };
  });

  const successfulCreations: any[] = [];
  for (const res of creationResults) {
    if (!res.success) {
      failures.push({
        row: res.rowIndex,
        email: res.email,
        error: res.error
      });
    } else {
      successfulCreations.push(res);
    }
  }

  const failedUserIds = new Set<string>();

  const handleProfileFailure = async (userId: string, email: string, rowIndex: number, errorMsg: string) => {
    failedUserIds.add(userId);
    await adminClient.auth.admin.deleteUser(userId);
    failures.push({
      row: rowIndex,
      email,
      error: `Failed to create role profile: ${errorMsg}`
    });
  };

  // Phase 2: Bulk update phone numbers in user_profiles
  const profilesToUpsert = successfulCreations
    .filter(c => c.rowData.phone && c.rowData.phone.trim())
    .map(c => ({
      id: c.userId,
      school_id: schoolId,
      role: c.rowData.role,
      full_name: c.rowData.full_name,
      email: c.rowData.email,
      phone: c.rowData.phone.trim()
    }));

  if (profilesToUpsert.length > 0) {
    const { error: upsertErr } = await adminClient
      .from('user_profiles')
      .upsert(profilesToUpsert);

    if (upsertErr) {
      console.error('Bulk upsert user profiles failed, falling back to individual updates', upsertErr);
      await Promise.all(profilesToUpsert.map(p => 
        adminClient
          .from('user_profiles')
          .update({ phone: p.phone })
          .eq('id', p.id)
      ));
    }
  }

  // Phase 3: Insert role-specific profile records
  const driversToInsert: any[] = [];
  const parentsToInsert: any[] = [];
  const studentsToInsert: any[] = [];
  const processedStudents: { userId: string; parentEmail: string }[] = [];

  for (const c of successfulCreations) {
    const { userId, rowData } = c;
    if (rowData.role === 'driver') {
      driversToInsert.push({
        user_id: userId,
        school_id: schoolId,
        license_number: rowData.license_number || 'UNKNOWN',
        license_expiry: rowData.license_expiry || null,
        is_active: true,
      });
    } else if (rowData.role === 'parent') {
      parentsToInsert.push({
        user_id: userId,
        school_id: schoolId,
      });
    } else if (rowData.role === 'student') {
      studentsToInsert.push({
        user_id: userId,
        school_id: schoolId,
        grade: rowData.grade || '1',
        roll_number: rowData.roll_number || 'UNKNOWN',
      });
      if (rowData.parent_email && rowData.parent_email.trim() && rowData.parent_email !== 'null') {
        processedStudents.push({ userId, parentEmail: rowData.parent_email.trim() });
      }
    }
  }

  // Drivers
  let insertedDrivers: any[] = [];
  if (driversToInsert.length > 0) {
    const { data, error: driverErr } = await adminClient
      .from('drivers')
      .insert(driversToInsert)
      .select('id, user_id');

    if (driverErr) {
      console.error('Bulk insert drivers failed, falling back to individual inserts:', driverErr);
      for (const record of driversToInsert) {
        const { error: indErr } = await adminClient.from('drivers').insert(record);
        if (indErr) {
          const creation = successfulCreations.find(c => c.userId === record.user_id);
          await handleProfileFailure(record.user_id, creation.rowData.email, creation.rowIndex, indErr.message);
        }
      }
    } else if (data) {
      insertedDrivers = data;
    }
  }

  // Parents
  let insertedParents: any[] = [];
  if (parentsToInsert.length > 0) {
    const { data, error: parentErr } = await adminClient
      .from('parent_profiles')
      .insert(parentsToInsert)
      .select('id, user_id');

    if (parentErr) {
      console.error('Bulk insert parent_profiles failed, falling back to individual inserts:', parentErr);
      for (const record of parentsToInsert) {
        const { error: indErr } = await adminClient.from('parent_profiles').insert(record);
        if (indErr) {
          const creation = successfulCreations.find(c => c.userId === record.user_id);
          await handleProfileFailure(record.user_id, creation.rowData.email, creation.rowIndex, indErr.message);
        }
      }
    } else if (data) {
      insertedParents = data;
    }
  }

  // Students
  let insertedStudents: any[] = [];
  if (studentsToInsert.length > 0) {
    const { data, error: studentErr } = await adminClient
      .from('student_profiles')
      .insert(studentsToInsert)
      .select('id, user_id');

    if (studentErr) {
      console.error('Bulk insert student_profiles failed, falling back to individual inserts:', studentErr);
      for (const record of studentsToInsert) {
        const { error: indErr } = await adminClient.from('student_profiles').insert(record);
        if (indErr) {
          const creation = successfulCreations.find(c => c.userId === record.user_id);
          await handleProfileFailure(record.user_id, creation.rowData.email, creation.rowIndex, indErr.message);
        }
      }
    } else if (data) {
      insertedStudents = data;
    }
  }

  // Filter out any users that failed profile insertion
  const finalSuccesses = successfulCreations.filter(c => !failedUserIds.has(c.userId));

  for (const c of finalSuccesses) {
    successes.push({
      row: c.rowIndex,
      email: c.rowData.email,
      role: c.rowData.role,
      full_name: c.rowData.full_name,
      temp_password: c.temp_password
    });
  }

  // Phase 4: Write audit logs in bulk
  if (finalSuccesses.length > 0) {
    const auditLogsToInsert = finalSuccesses.map(c => ({
      school_id: schoolId,
      user_id: adminUserId,
      action: 'CREATE',
      table_name: c.rowData.role === 'driver' ? 'drivers' : c.rowData.role === 'student' ? 'student_profiles' : 'parent_profiles',
      record_id: c.userId,
      new_values: { email: c.rowData.email, full_name: c.rowData.full_name, role: c.rowData.role },
    }));

    const { error: auditErr } = await adminClient.from('audit_logs').insert(auditLogsToInsert);
    if (auditErr) {
      console.error('Failed to write audit logs in bulk, trying individually in background:', auditErr);
      Promise.all(auditLogsToInsert.map(log => adminClient.from('audit_logs').insert(log))).catch(console.error);
    }
  }

  // Phase 5: Student-to-Parent linking
  const linkSuccesses: string[] = [];
  const linkFailures: { studentEmail: string; parentEmail: string; error: string }[] = [];

  const validProcessedStudents = processedStudents.filter(s => !failedUserIds.has(s.userId));

  if (validProcessedStudents.length > 0) {
    const studentEmailMap = new Map<string, string>();
    for (const c of finalSuccesses) {
      studentEmailMap.set(c.userId, c.rowData.email);
    }

    const parentEmailToProfileId = new Map<string, string>();
    const parentUserIdToProfileId = new Map<string, string>();

    if (insertedParents) {
      for (const p of insertedParents) {
        parentUserIdToProfileId.set(p.user_id, p.id);
      }
    }

    for (const c of finalSuccesses) {
      if (c.rowData.role === 'parent') {
        const profileId = parentUserIdToProfileId.get(c.userId);
        if (profileId) {
          parentEmailToProfileId.set(c.rowData.email.toLowerCase(), profileId);
        }
      }
    }

    const missingParentEmails = Array.from(new Set(
      validProcessedStudents
        .map(s => s.parentEmail.toLowerCase())
        .filter(email => !parentEmailToProfileId.has(email))
    ));

    if (missingParentEmails.length > 0) {
      const { data: dbParentUserProfiles } = await adminClient
        .from('user_profiles')
        .select('id, email')
        .eq('role', 'parent')
        .in('email', missingParentEmails);

      if (dbParentUserProfiles && dbParentUserProfiles.length > 0) {
        const dbParentUserIds = dbParentUserProfiles.map(p => p.id);

        const { data: dbParentProfiles } = await adminClient
          .from('parent_profiles')
          .select('id, user_id')
          .in('user_id', dbParentUserIds);

        if (dbParentProfiles && dbParentProfiles.length > 0) {
          const dbParentUserIdToProfileId = new Map<string, string>();
          for (const p of dbParentProfiles) {
            dbParentUserIdToProfileId.set(p.user_id, p.id);
          }

          for (const u of dbParentUserProfiles) {
            const profileId = dbParentUserIdToProfileId.get(u.id);
            if (profileId) {
              parentEmailToProfileId.set(u.email.toLowerCase(), profileId);
            }
          }
        }
      }
    }

    const studentUserIdToProfileId = new Map<string, string>();
    if (insertedStudents) {
      for (const s of insertedStudents) {
        studentUserIdToProfileId.set(s.user_id, s.id);
      }
    }

    const linksToInsert: any[] = [];
    for (const studentLink of validProcessedStudents) {
      const { userId: studentUserId, parentEmail } = studentLink;
      const studentEmail = studentEmailMap.get(studentUserId) || 'Unknown';
      const parentEmailLower = parentEmail.toLowerCase();

      const studentProfileId = studentUserIdToProfileId.get(studentUserId);
      const parentProfileId = parentEmailToProfileId.get(parentEmailLower);

      if (!studentProfileId) {
        linkFailures.push({
          studentEmail,
          parentEmail,
          error: 'Student profile detail record not found'
        });
        continue;
      }

      if (!parentProfileId) {
        linkFailures.push({
          studentEmail,
          parentEmail,
          error: 'No parent account with this email was found'
        });
        continue;
      }

      linksToInsert.push({
        parent_id: parentProfileId,
        student_id: studentProfileId,
        relationship: 'guardian'
      });
    }

    if (linksToInsert.length > 0) {
      const { error: linkErr } = await adminClient
        .from('parent_student_links')
        .insert(linksToInsert);

      if (linkErr) {
        console.error('Bulk link insert failed, falling back to individual inserts:', linkErr);
        for (const link of linksToInsert) {
          const studentUid = Array.from(studentUserIdToProfileId.entries())
            .find(([_, pid]) => pid === link.student_id)?.[0];
          const studentEmail = studentUid ? (studentEmailMap.get(studentUid) || 'Unknown') : 'Unknown';

          const parentEmail = Array.from(parentEmailToProfileId.entries())
            .find(([_, pid]) => pid === link.parent_id)?.[0] || 'Unknown';

          const { error: indErr } = await adminClient
            .from('parent_student_links')
            .insert(link);

          if (indErr) {
            linkFailures.push({
              studentEmail,
              parentEmail,
              error: `Link insertion failed: ${indErr.message}`
            });
          } else {
            linkSuccesses.push(`${studentEmail} linked to ${parentEmail}`);
          }
        }
      } else {
        for (const link of linksToInsert) {
          const studentUid = Array.from(studentUserIdToProfileId.entries())
            .find(([_, pid]) => pid === link.student_id)?.[0];
          const studentEmail = studentUid ? (studentEmailMap.get(studentUid) || 'Unknown') : 'Unknown';

          const parentEmail = Array.from(parentEmailToProfileId.entries())
            .find(([_, pid]) => pid === link.parent_id)?.[0] || 'Unknown';

          linkSuccesses.push(`${studentEmail} linked to ${parentEmail}`);
        }
      }
    }
  }

  return {
    summary: {
      total_processed: rows.length,
      success_count: successes.length,
      failure_count: failures.length,
      links_succeeded: linkSuccesses.length,
      links_failed: linkFailures.length
    },
    successes,
    failures,
    links: {
      successes: linkSuccesses,
      failures: linkFailures
    }
  };
}
