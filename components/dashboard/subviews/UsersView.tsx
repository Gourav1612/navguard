'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateUserSchema, UpdateUserSchema } from '@/lib/validations';
import { deleteUserAction } from '@/app/actions/admin-pagination';
import * as XLSX from 'xlsx';
import { 
  Loader2, 
  Plus, 
  Trash2, 
  Edit2, 
  X, 
  AlertCircle,
  Search,
  CheckCircle,
  XCircle,
  Building,
  Users,
  Eye,
  EyeOff,
  Radio,
  FileSpreadsheet,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { z } from 'zod';

type UserFormValues = z.infer<typeof CreateUserSchema>;

export default function UsersView() {
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [plantFilter, setPlantFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Bulk Import Modal States
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<any | null>(null);

  // Fetch Users
  const { data: users = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['admin-users', roleFilter, plantFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (roleFilter) params.append('role', roleFilter);
      if (plantFilter) params.append('plant_id', plantFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  // Fetch Plants (for select dropdowns)
  const { data: plants = [] } = useQuery({
    queryKey: ['admin-plants'],
    queryFn: async () => {
      const res = await fetch('/api/admin/plants');
      if (!res.ok) throw new Error('Failed to load plants');
      return res.json();
    },
  });

  // Filter Supervisors (for worker onboarding)
  const supervisorsList = users.filter((u: any) => u.role === 'supervisor');

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<UserFormValues>({
    resolver: zodResolver(editingUser ? UpdateUserSchema : CreateUserSchema) as any,
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      password: '',
      role: 'worker',
      plant_id: '',
      supervisor_id: '',
      is_active: true,
      location_interval: 10,
    }
  });

  const selectedRole = watch('role');

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormError(null);
    setShowPassword(false);
    reset({
      full_name: '',
      username: '',
      email: '',
      phone: '',
      password: '',
      role: 'worker',
      plant_id: '',
      supervisor_id: '',
      is_active: true,
      location_interval: 10,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (user: any) => {
    setEditingUser(user);
    setFormError(null);
    setShowPassword(false);
    reset({
      full_name: user.full_name,
      username: user.username || '',
      email: user.email,
      phone: user.phone || '',
      password: '',
      role: user.role,
      plant_id: user.plant?.id || '',
      supervisor_id: user.supervisor_id || user.supervisor?.id || '',
      is_active: user.is_active,
      location_interval: user.location_interval || 10,
    });
    setShowModal(true);
  };

  const togglePacketStreaming = async (user: any) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !user.is_active,
        }),
      });
      if (!res.ok) throw new Error('Failed to update tracking state');
      refetchUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to toggle packet streaming state');
    }
  };

  const onSubmit = async (values: UserFormValues) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PATCH' : 'POST';

      const payload: any = { ...values };
      if (!payload.password || payload.password.trim() === '') {
        delete payload.password;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save user');
      }

      setShowModal(false);
      refetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while saving user details.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to completely delete this user? This will delete their Auth credentials, profile details, and telemetry history.')) {
      return;
    }
    try {
      const res = await deleteUserAction(userId);
      if (!res.success) {
        alert(res.error || 'Failed to delete user');
      } else {
        refetchUsers();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

  // --- Bulk Import Handlers ---
  const handleOpenBulkImport = () => {
    setParsedRows([]);
    setFileName(null);
    setImportError(null);
    setImportSummary(null);
    setShowBulkModal(true);
  };

  const handleDownloadSampleCsv = () => {
    const defaultPlantName = plants.length > 0 ? plants[0].name : 'Plant Site Alpha';
    const sampleHeaders = 'full_name,username,email,phone,password,role,plant_name,location_interval,supervisor_name\n';
    const sampleRow1 = `Vikram Singh,vikram_s,vikram.supervisor@company.com,9876543210,Pass123!,supervisor,${defaultPlantName},10,\n`;
    const sampleRow2 = `Rahul Sharma,rahul_s,rahul.worker@company.com,9876543211,Pass123!,worker,${defaultPlantName},10,Vikram Singh\n`;
    const sampleRow3 = `Anita Verma,anita_v,anita.manager@company.com,9876543212,Pass123!,manager,${defaultPlantName},10,`;

    const blob = new Blob([sampleHeaders + sampleRow1 + sampleRow2 + sampleRow3], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'naviguard_bulk_personnel_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false });

        if (!jsonRows || jsonRows.length === 0) {
          setImportError('No data rows found in the uploaded file.');
          setParsedRows([]);
          return;
        }

        setParsedRows(jsonRows);
      } catch (err: any) {
        setImportError('Failed to parse spreadsheet file. Please verify file format (.csv or .xlsx).');
        setParsedRows([]);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExecuteBulkImport = async () => {
    if (parsedRows.length === 0) return;

    setImporting(true);
    setImportError(null);

    try {
      const res = await fetch('/api/admin/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process bulk import.');

      setImportSummary(data);
      refetchUsers();
    } catch (err: any) {
      setImportError(err.message || 'An error occurred during bulk import execution.');
    } finally {
      setImporting(false);
    }
  };

  const filteredUsers = users.filter((u: any) => 
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Personnel Roster</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenBulkImport}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl transition shadow-sm cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Bulk Import (Excel/CSV)
          </button>

          <button
            onClick={handleOpenCreate}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-extrabold rounded-xl transition shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Onboard Personnel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center bg-white border border-slate-150 rounded-xl px-3.5 py-1 w-full max-w-xs shadow-sm">
          <Search className="w-4.5 h-4.5 text-slate-400 mr-2" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full py-2 text-xs font-semibold text-slate-800 focus:outline-none placeholder:text-slate-400 bg-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-white border border-slate-150 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl shadow-sm focus:outline-none cursor-pointer"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="manager">Plant Manager</option>
            <option value="supervisor">Supervisor</option>
            <option value="worker">Worker</option>
          </select>

          <select
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
            className="bg-white border border-slate-150 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl shadow-sm focus:outline-none cursor-pointer"
          >
            <option value="all">All Sites</option>
            {plants.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {usersLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse">
          <div className="h-44 bg-slate-200 rounded-2xl" />
          <div className="h-44 bg-slate-200 rounded-2xl" />
          <div className="h-44 bg-slate-200 rounded-2xl" />
          <div className="h-44 bg-slate-200 rounded-2xl" />
          <div className="h-44 bg-slate-200 rounded-2xl" />
          <div className="h-44 bg-slate-200 rounded-2xl" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-white border border-slate-155 rounded-2xl p-12 text-center text-slate-400 text-xs font-semibold">
          No personnel accounts match your search filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredUsers.map((user: any) => {
            let roleBadge = 'bg-blue-100 text-blue-800 border-blue-200';
            if (user.role === 'admin') roleBadge = 'bg-red-100 text-red-800 border-red-200';
            if (user.role === 'manager') roleBadge = 'bg-slate-200 text-slate-800 border-slate-300';
            if (user.role === 'supervisor') roleBadge = 'bg-amber-100 text-amber-800 border-amber-200';

            return (
              <div key={user.id} className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4 hover:border-slate-300 transition duration-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 border border-slate-200 text-slate-700 rounded-xl flex items-center justify-center font-extrabold text-sm shadow-2xs">
                      {user.role === 'manager' ? '🏢' : user.role === 'supervisor' ? '👤' : user.role === 'admin' ? '🛡️' : '👷'}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-sm leading-tight">{user.full_name}</h3>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`px-2 py-0.5 inline-block text-[9px] font-bold rounded-lg uppercase border ${roleBadge}`}>
                          {user.role === 'admin' ? 'System Admin' : user.role === 'manager' ? 'Plant Manager' : user.role === 'supervisor' ? 'Supervisor' : 'Worker'}
                        </span>
                        <span className={`inline-flex items-center text-[9px] font-bold ${user.is_active ? 'text-green-600' : 'text-red-500'}`}>
                          {user.is_active ? <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> : <XCircle className="w-2.5 h-2.5 mr-0.5" />}
                          {user.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(user)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg border border-slate-200 transition text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      title="Edit & Change Password / Unlock Account"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit & Unlock</span>
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg border border-red-100 transition cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 text-xs font-semibold text-slate-600">
                  {user.username && <p><span className="text-slate-400 font-bold block text-[9px] uppercase tracking-wider">Username</span><span className="font-mono text-slate-900 font-bold">@{user.username}</span></p>}
                  <p><span className="text-slate-400 font-bold block text-[9px] uppercase tracking-wider">Email Address</span>{user.email}</p>
                  {user.phone && <p><span className="text-slate-400 font-bold block text-[9px] uppercase tracking-wider">Contact Phone</span>{user.phone}</p>}
                </div>

                <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs font-semibold">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Assigned Site</span>
                    <span className="text-slate-700 block mt-0.5 leading-tight flex items-center gap-1">
                      <Building className="w-3.5 h-3.5 text-slate-400" />
                      {user.plant?.name || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Reporting To</span>
                    <span className="text-slate-700 block mt-0.5 leading-tight flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      {user.supervisor?.full_name || '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => togglePacketStreaming(user)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all cursor-pointer border shadow-xs ${
                      user.is_active
                        ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                        : 'bg-red-500 text-white border-red-600 hover:bg-red-600'
                    }`}
                    title={user.is_active ? "Click to Pause Packet Streaming" : "Click to Enable Packet Streaming"}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {user.is_active ? 'Packets: STREAMING' : 'Packets: PAUSED'}
                  </button>
                  <span className="text-[9px] font-mono text-slate-400 font-semibold">
                    Interval: {user.location_interval || 10}s
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Bulk Import Modal --- */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150 space-y-0">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-extrabold text-white text-sm">Bulk Personnel Account Import</h3>
                  <span className="text-[10px] text-slate-400 font-semibold block">Provision multiple accounts via .xlsx or .csv</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              {/* Instructions & Sample Download */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-black text-slate-800">Spreadsheet Template Rules</h4>
                  <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                    Mandatory: <span className="text-slate-900 font-bold">full_name, username, email, phone, password, role, plant_name, location_interval</span>.<br />
                    Workers must specify <span className="text-slate-900 font-bold">supervisor_name</span>. Admin role is prohibited.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSampleCsv}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-250 text-xs font-bold rounded-xl transition cursor-pointer flex-shrink-0 shadow-2xs"
                >
                  <Download className="w-4 h-4 text-emerald-600" />
                  Download Sample CSV
                </button>
              </div>

              {/* Error Banner */}
              {importError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs font-semibold flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>{importError}</div>
                </div>
              )}

              {/* Results Summary Box (Post Execution) */}
              {importSummary && (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-bold">
                    <div className="flex items-center gap-2 text-emerald-900">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span>Batch Completed: {importSummary.successCount} Created, {importSummary.errorCount} Errors</span>
                    </div>
                    <span className="text-slate-500 font-mono text-[11px]">Total Rows: {importSummary.totalRows}</span>
                  </div>

                  {/* Summary Rows Table */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs max-h-60 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Row</th>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3">Email</th>
                          <th className="py-2 px-3">Role</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {importSummary.results.map((res: any, idx: number) => (
                          <tr key={idx} className={res.status === 'error' ? 'bg-red-50/50' : 'bg-white'}>
                            <td className="py-2 px-3 font-mono text-[11px]">{res.row}</td>
                            <td className="py-2 px-3 font-bold text-slate-800">{res.name}</td>
                            <td className="py-2 px-3 text-slate-600">{res.email}</td>
                            <td className="py-2 px-3 uppercase text-[10px] font-bold">{res.role}</td>
                            <td className="py-2 px-3">
                              {res.status === 'success' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 font-extrabold text-[10px]">
                                  <CheckCircle className="w-3.5 h-3.5" /> Success
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-600 font-bold text-[10px]" title={res.error}>
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> {res.error}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Upload Dropzone */}
              {!importSummary && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/50 p-6 rounded-2xl text-center transition cursor-pointer relative">
                    <input
                      type="file"
                      accept=".csv, .xlsx, .xls"
                      onChange={handleFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <UploadCloud className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                    <p className="text-xs font-extrabold text-slate-800">
                      {fileName ? `Selected File: ${fileName}` : 'Click or Drag Excel / CSV file here'}
                    </p>
                    <p className="text-[10px] text-slate-400 font-semibold mt-1">Supports .xlsx, .xls, and .csv formats</p>
                  </div>

                  {/* Parsed Rows Preview Table */}
                  {parsedRows.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black text-slate-800">
                          File Preview ({parsedRows.length} Rows Detected)
                        </h4>
                        <span className="text-[10px] font-bold text-slate-400">Showing first 5 rows</span>
                      </div>

                      <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs max-h-48 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 sticky top-0">
                            <tr>
                              <th className="py-2 px-3">Name</th>
                              <th className="py-2 px-3">Username</th>
                              <th className="py-2 px-3">Email</th>
                              <th className="py-2 px-3">Role</th>
                              <th className="py-2 px-3">Plant</th>
                              <th className="py-2 px-3">Supervisor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {parsedRows.slice(0, 5).map((r: any, idx: number) => (
                              <tr key={idx} className="bg-white">
                                <td className="py-2 px-3 font-bold text-slate-800">{r.full_name || r['Full Name'] || '—'}</td>
                                <td className="py-2 px-3 font-mono text-[10px]">{r.username || r['Username'] || '—'}</td>
                                <td className="py-2 px-3 text-slate-600">{r.email || r['Email'] || '—'}</td>
                                <td className="py-2 px-3 uppercase text-[10px] font-bold">{r.role || r['Role'] || '—'}</td>
                                <td className="py-2 px-3 text-slate-600">{r.plant_name || r['Plant Name'] || '—'}</td>
                                <td className="py-2 px-3 text-slate-600">{r.supervisor_name || r['Supervisor Name'] || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                {importSummary ? 'Close Window' : 'Cancel'}
              </button>

              {!importSummary && (
                <button
                  type="button"
                  onClick={handleExecuteBulkImport}
                  disabled={importing || parsedRows.length === 0}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl transition shadow-md cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Import Batch...
                    </>
                  ) : (
                    'Process Bulk Import'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Single User Modal --- */}
      {showModal && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-2xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-150 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm">{editingUser ? 'Edit Personnel Account' : 'Onboard New Personnel'}</h3>
                <span className="text-[10px] text-slate-400 font-bold block mt-0.5">Fill details to provision credentials & permissions</span>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-650 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-650" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
                  <input
                    type="text"
                    {...register('full_name')}
                    placeholder="e.g. Rahul Sharma"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  {errors.full_name && <p className="text-[10px] text-red-500 font-semibold">{String(errors.full_name.message)}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Username</label>
                  <input
                    type="text"
                    {...register('username')}
                    placeholder="e.g. rahul_s"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-800 focus:outline-none font-mono"
                  />
                  {errors.username && <p className="text-[10px] text-red-500 font-semibold">{String(errors.username.message)}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email Address</label>
                  <input
                    type="email"
                    {...register('email')}
                    placeholder="rahul@company.com"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  {errors.email && <p className="text-[10px] text-red-500 font-semibold">{String(errors.email.message)}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Contact Phone</label>
                  <input
                    type="text"
                    {...register('phone')}
                    placeholder="Optional phone number"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {editingUser ? 'New Password (Optional)' : 'Account Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      {...register('password')}
                      placeholder={editingUser ? 'Leave blank to keep current' : 'Min 6 characters'}
                      className="block w-full py-2.5 pl-3 pr-8 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-[10px] text-red-500 font-semibold">{String(errors.password.message)}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Account Role</label>
                  <select
                    {...register('role')}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="worker">Worker</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="manager">Plant Manager</option>
                    <option value="admin">System Admin</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assign Plant Site</label>
                  <select
                    {...register('plant_id')}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="">No Plant Assigned</option>
                    {plants.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assign Supervisor</label>
                  <select
                    {...register('supervisor_id')}
                    disabled={selectedRole !== 'worker'}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="">Select Supervisor</option>
                    {supervisorsList.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Location Telemetry Interval (Seconds) */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Location Telemetry Interval (Seconds)</label>
                <input
                  type="number"
                  min={2}
                  max={300}
                  placeholder="Interval in seconds (default: 10s)"
                  {...register('location_interval', { valueAsNumber: true })}
                  className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-zinc-900 rounded-xl text-xs font-bold text-slate-700 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="is_active"
                  {...register('is_active')}
                  className="rounded border-slate-300 text-zinc-900 focus:ring-zinc-900 h-4 w-4"
                />
                <label htmlFor="is_active" className="text-xs font-bold text-slate-600 cursor-pointer">
                  Activate this user profile immediately
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-extrabold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-extrabold rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Save User Profile'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
