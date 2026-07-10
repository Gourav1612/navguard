'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Edit2, Trash2, X, Loader2, AlertCircle, Mail, BookOpen, Hash, Bus, MapPin } from 'lucide-react';
import { CreateStudentSchema } from '@/lib/validations';
import type { z } from 'zod';
import { parseGoogleMapsLink } from '@/lib/utils';

type StudentFormValues = z.infer<typeof CreateStudentSchema>;

export default function AdminStudents() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedBusIdFilter, setSelectedBusIdFilter] = useState('');

  // Custom Stop States
  const [isCustomStop, setIsCustomStop] = useState(false);
  const [googleMapsLink, setGoogleMapsLink] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [customStopName, setCustomStopName] = useState('');
  const [customStopAddress, setCustomStopAddress] = useState('');
  const [customStopLat, setCustomStopLat] = useState('');
  const [customStopLng, setCustomStopLng] = useState('');

  // Fetch students
  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const res = await fetch('/api/admin/students');
      if (!res.ok) throw new Error('Failed to fetch students');
      return res.json();
    },
  });

  // Fetch buses for dropdown selector
  const { data: buses = [] } = useQuery({
    queryKey: ['admin-buses'],
    queryFn: async () => {
      const res = await fetch('/api/admin/buses');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch routes to grab stops for student assignment
  const { data: routes = [] } = useQuery({
    queryKey: ['admin-routes'],
    queryFn: async () => {
      const res = await fetch('/api/admin/routes');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<StudentFormValues>({
    resolver: zodResolver(CreateStudentSchema),
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      password: '',
      grade: '',
      roll_number: '',
      bus_id: '',
      stop_id: '',
    },
  });

  // Watch bus_id to filter stops list dynamically in the dropdown
  const watchedBusId = watch('bus_id');
  // Find stops linked to route which is linked to watchedBusId
  const assignedRoute = routes.find((r: any) => r.bus_id === watchedBusId);
  const availableStops = assignedRoute?.stops || [];

  // Create student
  const createMutation = useMutation({
    mutationFn: async (values: StudentFormValues) => {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create student');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setIsModalOpen(false);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Update student
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<StudentFormValues> }) => {
      const res = await fetch(`/api/admin/students/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setIsModalOpen(false);
      setEditingStudent(null);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Delete student
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/students/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete student');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
    },
  });

  const handleOpenAddModal = () => {
    setEditingStudent(null);
    setErrorMessage(null);
    setIsCustomStop(false);
    setGoogleMapsLink('');
    setCustomStopName('');
    setCustomStopAddress('');
    setCustomStopLat('');
    setCustomStopLng('');
    reset({
      full_name: '',
      email: '',
      phone: '',
      password: '',
      grade: '',
      roll_number: '',
      bus_id: '',
      stop_id: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (student: any) => {
    setEditingStudent(student);
    setErrorMessage(null);
    setIsCustomStop(false);
    setGoogleMapsLink('');
    setCustomStopName('');
    setCustomStopAddress('');
    setCustomStopLat('');
    setCustomStopLng('');
    reset({
      full_name: student.user?.full_name || '',
      email: student.user?.email || '',
      phone: student.user?.phone || '',
      password: 'PlaceholderPassword123!',
      grade: student.grade,
      roll_number: student.roll_number,
      bus_id: student.bus?.id || '',
      stop_id: student.stop?.id || '',
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete student profile? This removes authentication access. Historical route attachments will update.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleImportGoogleMapsLink = async () => {
    if (!googleMapsLink) return;
    setIsLoadingLink(true);
    try {
      let urlToParse = googleMapsLink.trim();
      if (urlToParse.includes('maps.app.goo.gl') || urlToParse.includes('goo.gl/maps')) {
        const res = await fetch(`/api/resolve-map-link?url=${encodeURIComponent(urlToParse)}`);
        if (!res.ok) throw new Error('Failed to resolve Google Maps short link');
        const data = await res.json();
        urlToParse = data.expandedUrl;
      }
      const parsed = parseGoogleMapsLink(urlToParse);
      if (parsed) {
        setCustomStopLat(parsed.lat.toString());
        setCustomStopLng(parsed.lng.toString());
        if (parsed.name) {
          setCustomStopName((prev) => prev || parsed.name || '');
          setCustomStopAddress((prev) => prev || parsed.name || '');
        }
        setGoogleMapsLink('');
      } else {
        alert('Could not extract coordinates from the Google Maps link.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to process Google Maps link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  const onSubmit = async (values: StudentFormValues) => {
    setErrorMessage(null);
    let finalStopId = values.stop_id;

    if (isCustomStop) {
      if (!customStopName || !customStopLat || !customStopLng) {
        setErrorMessage('Please fill out all custom stop location fields.');
        return;
      }
      
      const lat = Number(customStopLat);
      const lng = Number(customStopLng);
      if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
        setErrorMessage('Enter valid GPS coordinates (Lat -90 to 90, Lng -180 to 180).');
        return;
      }

      if (!assignedRoute?.id) {
        setErrorMessage('A route must be configured for the selected bus to assign a custom stop.');
        return;
      }

      try {
        const stopRes = await fetch('/api/admin/stops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            route_id: assignedRoute.id,
            name: customStopName,
            address: customStopAddress,
            latitude: lat,
            longitude: lng,
            stop_order: availableStops.length,
          }),
        });

        const stopData = await stopRes.json();
        if (!stopRes.ok) {
          throw new Error(stopData.error || 'Failed to create custom stop.');
        }

        finalStopId = stopData.id;
      } catch (err: any) {
        setErrorMessage(err.message || 'An error occurred during custom stop setup.');
        return;
      }
    }

    const payload = {
      ...values,
      stop_id: finalStopId || null,
    };

    if (editingStudent) {
      const { password, ...updateValues } = payload;
      updateMutation.mutate({ id: editingStudent.id, values: updateValues });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Filter student list
  const filteredStudents = selectedBusIdFilter
    ? students.filter((s: any) => s.bus?.id === selectedBusIdFilter)
    : students;

  if (studentsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Reviewing directory rosters...</p>
      </div>
    );
  }

  const mutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Student Directory</h2>
          <p className="text-slate-500 text-sm font-medium">Add enrolled students, assign grades and roll numbers, and configure transport bus routes.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Onboard Student
        </button>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-3 bg-white border border-slate-150 p-4 rounded-2xl shadow-sm">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filter by Bus Shift:</span>
        <select
          value={selectedBusIdFilter}
          onChange={(e) => setSelectedBusIdFilter(e.target.value)}
          className="px-3.5 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 bg-white"
        >
          <option value="">All Buses</option>
          {buses.map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Table Container */}
      <div className="bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-150 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Student Name</th>
                <th className="px-6 py-4">Roll Number</th>
                <th className="px-6 py-4">Grade Group</th>
                <th className="px-6 py-4">Assigned Fleet Bus</th>
                <th className="px-6 py-4">Pickup Stop Name</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No students found matching this criteria.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student: any) => (
                  <tr key={student.id} className="hover:bg-slate-50/30 transition duration-150">
                    <td className="px-6 py-4.5">
                      <div className="font-bold text-slate-900">{student.user?.full_name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" />
                        {student.user?.email}
                      </div>
                    </td>
                    <td className="px-6 py-4.5 font-mono text-xs">{student.roll_number}</td>
                    <td className="px-6 py-4.5 font-semibold text-slate-600">Grade {student.grade}</td>
                    <td className="px-6 py-4.5">
                      {student.bus ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-100">
                          <Bus className="w-3 h-3" /> {student.bus.name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4.5">
                      {student.stop ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-100">
                          <MapPin className="w-3 h-3" /> {student.stop.name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-right space-x-2.5">
                      <button
                        onClick={() => handleOpenEditModal(student)}
                        className="inline-flex items-center justify-center p-2 border border-slate-200 hover:border-slate-300 text-slate-600 rounded-lg transition"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(student.id)}
                        className="inline-flex items-center justify-center p-2 border border-red-200 hover:border-red-300 hover:bg-red-50 text-red-650 rounded-lg transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Onboard / Edit Student Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 border border-slate-100">
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-800 text-base">
                {editingStudent ? 'Edit Student Details' : 'Onboard Student Record'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
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
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
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
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    {...register('phone')}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Email Address *</label>
                <input
                  type="email"
                  disabled={mutating || !!editingStudent}
                  placeholder="student@school.edu"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                  {...register('email')}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.email.message}</p>}
              </div>

              {!editingStudent && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assign Password *</label>
                  <input
                    type="password"
                    disabled={mutating}
                    placeholder="Min 8 characters, 1 upper, 1 digit"
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    {...register('password')}
                  />
                  {errors.password && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.password.message}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block font-sans">Grade Group *</label>
                  <input
                    type="text"
                    disabled={mutating}
                    placeholder="e.g. 5A, 10C"
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    {...register('grade')}
                  />
                  {errors.grade && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.grade.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Roll Number *</label>
                  <input
                    type="text"
                    disabled={mutating}
                    placeholder="e.g. 2025-101"
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    {...register('roll_number')}
                  />
                  {errors.roll_number && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.roll_number.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assign Bus Shift</label>
                  <select
                    disabled={mutating}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-700"
                    {...register('bus_id')}
                  >
                    <option value="">Unassigned</option>
                    {buses.map((bus: any) => (
                      <option key={bus.id} value={bus.id}>
                        {bus.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 bg-slate-50 border border-slate-150 p-4.5 rounded-2xl col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Stop Location Type</label>
                    <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={!isCustomStop}
                          onChange={() => setIsCustomStop(false)}
                          className="text-primary focus:ring-primary"
                        />
                        Pre-defined Stop
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={isCustomStop}
                          onChange={() => setIsCustomStop(true)}
                          className="text-primary focus:ring-primary"
                        />
                        Custom Home Location
                      </label>
                    </div>
                  </div>

                  {!isCustomStop ? (
                    <div className="space-y-1 mt-3">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assign Stop Location</label>
                      <select
                        disabled={mutating || !watchedBusId}
                        className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-700 disabled:opacity-50"
                        {...register('stop_id')}
                      >
                        <option value="">Unassigned</option>
                        {availableStops.map((stop: any) => (
                          <option key={stop.id} value={stop.id}>
                            {stop.name} (Stop {stop.stop_order})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Import from Google Maps Link</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Paste Google Maps URL here..."
                            value={googleMapsLink}
                            onChange={(e) => setGoogleMapsLink(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                          />
                          <button
                            type="button"
                            onClick={handleImportGoogleMapsLink}
                            disabled={isLoadingLink || !googleMapsLink}
                            className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center justify-center min-w-[80px]"
                          >
                            {isLoadingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Stop Name *</label>
                          <input
                            type="text"
                            placeholder="e.g. Priyas Home Stop"
                            value={customStopName}
                            onChange={(e) => setCustomStopName(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Address Details</label>
                          <input
                            type="text"
                            placeholder="e.g. Plot 15, Sector 5"
                            value={customStopAddress}
                            onChange={(e) => setCustomStopAddress(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Latitude *</label>
                          <input
                            type="text"
                            placeholder="GPS Latitude"
                            value={customStopLat}
                            onChange={(e) => setCustomStopLat(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Longitude *</label>
                          <input
                            type="text"
                            placeholder="GPS Longitude"
                            value={customStopLng}
                            onChange={(e) => setCustomStopLng(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                          />
                        </div>
                      </div>
                    </div>
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
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50"
                >
                  {mutating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editingStudent ? 'Save Details' : 'Onboard Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
