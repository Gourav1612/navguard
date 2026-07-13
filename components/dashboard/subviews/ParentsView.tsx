'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Edit2, Trash2, X, Loader2, AlertCircle, Mail, Phone, Users, CheckSquare, Square, Search } from 'lucide-react';
import { CreateParentSchema } from '@/lib/validations';
import type { z } from 'zod';

type ParentFormValues = z.infer<typeof CreateParentSchema>;

export default function AdminParents() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingParent, setEditingParent] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch parents
  const { data: parents = [], isLoading: parentsLoading } = useQuery({
    queryKey: ['admin-parents'],
    queryFn: async () => {
      const res = await fetch('/api/admin/parents');
      if (!res.ok) throw new Error('Failed to fetch parents');
      return res.json();
    },
  });

  // Fetch students for checkboxes selection
  const { data: students = [] } = useQuery({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const res = await fetch('/api/admin/students');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filteredParents = parents.filter((p: any) => 
    p.user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.user?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.user?.phone?.includes(searchQuery)
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ParentFormValues>({
    resolver: zodResolver(CreateParentSchema) as any,
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      password: '',
      student_ids: [],
    },
  });

  // Create parent
  const createMutation = useMutation({
    mutationFn: async (values: ParentFormValues) => {
      const payload = { ...values, student_ids: selectedStudentIds };
      const res = await fetch('/api/admin/parents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to onboard parent');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
      setIsModalOpen(false);
      reset();
      setSelectedStudentIds([]);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Update parent
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<ParentFormValues> }) => {
      const payload = { ...values, student_ids: selectedStudentIds };
      const res = await fetch(`/api/admin/parents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update parent');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
      setIsModalOpen(false);
      setEditingParent(null);
      reset();
      setSelectedStudentIds([]);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Delete parent
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/parents/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete parent');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-parents'] });
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const handleOpenAddModal = () => {
    setEditingParent(null);
    setErrorMessage(null);
    setSelectedStudentIds([]);
    reset({
      full_name: '',
      email: '',
      phone: '',
      password: '',
      student_ids: [],
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (parent: any) => {
    setEditingParent(parent);
    setErrorMessage(null);
    const linkedIds = (parent.students || []).map((s: any) => s.id);
    setSelectedStudentIds(linkedIds);
    reset({
      full_name: parent.user?.full_name || '',
      email: parent.user?.email || '',
      phone: parent.user?.phone || '',
      password: 'PlaceholderPassword123!',
      student_ids: linkedIds,
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this parent account registration? This clears parent dashboards access. Children registrations are untouched.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleToggleStudent = (studentId: string) => {
    if (selectedStudentIds.includes(studentId)) {
      setSelectedStudentIds(selectedStudentIds.filter((id) => id !== studentId));
    } else {
      setSelectedStudentIds([...selectedStudentIds, studentId]);
    }
  };

  const onSubmit = (values: ParentFormValues) => {
    setErrorMessage(null);
    if (editingParent) {
      const { password, ...updateValues } = values;
      updateMutation.mutate({ id: editingParent.id, values: updateValues });
    } else {
      createMutation.mutate(values);
    }
  };

  if (parentsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 animate-pulse">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Accessing parents indexes...</p>
      </div>
    );
  }

  const mutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Parent Profiles</h2>
          <p className="text-slate-500 text-sm font-medium">Manage parent contact credentials, and pair parents to their children for live tracking maps.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-xl text-sm font-bold shadow-lg shadow-purple-500/20 hover:shadow-xl transition-all duration-300 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Parent Profile
        </button>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white border border-slate-150 p-4 rounded-3xl shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <input
            type="text"
            placeholder="Search parents by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 transition font-semibold"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
        </div>
        <div className="text-xs font-bold text-slate-400">
          Showing {filteredParents.length} of {parents.length} records
        </div>
      </div>

      {/* Grid */}
      {filteredParents.length === 0 ? (
        <div className="bg-white border border-slate-150 rounded-3xl p-12 text-center max-w-sm mx-auto space-y-4 shadow-sm">
          <div className="flex items-center justify-center w-12 h-12 bg-slate-50 border border-slate-200 rounded-full mx-auto text-slate-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">No Parent Registrations Found</h4>
            <p className="text-slate-500 text-xs mt-1">Try modifying your search or click add parent profile to onboarding a new parent user.</p>
          </div>
          <button
            onClick={handleOpenAddModal}
            className="px-4.5 py-2.5 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl transition shadow"
          >
            Add Parent Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-2 duration-300">
          {filteredParents.map((parent: any) => {
            // Assign a gorgeous gradient based on parent name initials
            const colors = [
              'from-[#f43f5e] to-[#ec4899]', // rose-pink
              'from-[#3b82f6] to-[#6366f1]', // blue-indigo
              'from-[#10b981] to-[#14b8a6]', // emerald-teal
              'from-[#f59e0b] to-[#eab308]', // amber-yellow
              'from-[#8b5cf6] to-[#a855f7]'  // violet-purple
            ];
            const name = parent.user?.full_name || 'Parent User';
            const initials = name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
            const gradientIndex = name.charCodeAt(0) % colors.length;
            const gradient = colors[gradientIndex];

            return (
              <div
                key={parent.id}
                className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:scale-[1.01] transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  {/* Card Top / Avatar Header */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-bold text-sm tracking-wide shadow-md`}>
                        {initials}
                      </div>
                      <div>
                        <h3 className="font-extrabold text-slate-800 text-base leading-snug">{parent.user?.full_name}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-slate-450 mt-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          <span className="truncate max-w-[180px] font-medium">{parent.user?.email}</span>
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-100/60">
                      Parent Link
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="mt-5 pt-4 border-t border-slate-100 space-y-4">
                    <div className="flex items-center gap-2.5 text-xs text-slate-650 bg-slate-50 border border-slate-150 px-3.5 py-2.5 rounded-2xl">
                      <Phone className="w-4 h-4 text-purple-500" />
                      <span className="font-bold text-slate-700">{parent.user?.phone || 'No phone registered'}</span>
                    </div>

                    {/* Linked Students Roster */}
                    <div className="space-y-2 bg-[#f6f5fa] border border-[#e8e6f0] p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold text-purple-900/60 uppercase tracking-widest block">Linked Children Roster</span>
                        <span className="text-[10px] font-bold text-purple-500 bg-white border border-purple-100/60 px-2 py-0.5 rounded-full">
                          {parent.students?.length || 0} assigned
                        </span>
                      </div>
                      
                      {parent.students && parent.students.length > 0 ? (
                        <div className="flex flex-col gap-2 mt-2">
                          {parent.students.map((s: any) => (
                            <div key={s.id} className="flex items-center justify-between text-xs bg-white border border-slate-100 px-3 py-2.5 rounded-xl shadow-xs">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                <span className="font-bold text-slate-700">{s.user?.full_name}</span>
                              </div>
                              <span className="text-slate-500 font-bold bg-slate-50 border border-slate-150 px-2.5 py-0.5 rounded-lg text-[9px]">
                                Grade {s.grade}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic block py-2.5 text-center bg-white/50 border border-dashed border-slate-200 rounded-xl">
                          No linked children assigned
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => handleOpenEditModal(parent)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-slate-200 hover:border-slate-350 hover:bg-slate-50 text-slate-650 rounded-xl text-xs font-bold transition duration-200 cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                    Edit Details
                  </button>
                  <button
                    onClick={() => handleDelete(parent.id)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-red-100 hover:border-red-250 hover:bg-red-50/50 text-red-650 rounded-xl text-xs font-bold transition duration-200 disabled:opacity-50 cursor-pointer"
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Onboard / Edit Parent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          <div className="relative bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 border border-slate-100">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-[#f6f5fa]">
              <h3 className="font-extrabold text-slate-900 text-base">
                {editingParent ? 'Edit Parent Profile' : 'Onboard Parent User'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-650 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4.5">
              {errorMessage && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Full Name *</label>
                  <input
                    type="text"
                    disabled={mutating}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 transition"
                    {...register('full_name')}
                  />
                  {errors.full_name && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.full_name.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Phone Number</label>
                  <input
                    type="text"
                    disabled={mutating}
                    placeholder="+919000000000"
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 transition"
                    {...register('phone')}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Email Address *</label>
                <input
                  type="email"
                  disabled={mutating || !!editingParent}
                  placeholder="name@gmail.com"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 disabled:opacity-50 transition"
                  {...register('email')}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.email.message}</p>}
              </div>

              {!editingParent && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assign Password *</label>
                  <input
                    type="password"
                    disabled={mutating}
                    placeholder="Min 8 characters, 1 upper, 1 digit"
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 transition"
                    {...register('password')}
                  />
                  {errors.password && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.password.message}</p>}
                </div>
              )}

              {/* Student Checklist Selection */}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Link Children Profiles</label>
                <div className="max-h-[140px] overflow-y-auto border border-slate-150 rounded-xl divide-y divide-slate-100 p-2 space-y-1">
                  {students.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic p-3 text-center">No students registered in directory.</p>
                  ) : (
                    students.map((student: any) => {
                      const isChecked = selectedStudentIds.includes(student.id);
                      return (
                        <div
                          key={student.id}
                          onClick={() => handleToggleStudent(student.id)}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer text-xs transition font-semibold"
                        >
                          <div className="flex items-center gap-2.5">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-purple-650" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300" />
                            )}
                            <span className="text-slate-850 font-bold">{student.user?.full_name}</span>
                          </div>
                          <span className="text-slate-400 text-[10px] font-bold">Grade {student.grade}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutating}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-xl text-xs font-bold transition hover:shadow-lg shadow-purple-500/25 cursor-pointer disabled:opacity-50"
                >
                  {mutating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editingParent ? 'Save Details' : 'Onboard Parent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
