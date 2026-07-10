'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Edit2, Trash2, X, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { BusSchema } from '@/lib/validations';
import type { z } from 'zod';

type BusFormValues = z.infer<typeof BusSchema>;

export default function AdminBuses() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBusId, setEditingBusId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch buses list
  const { data: buses = [], isLoading, error } = useQuery({
    queryKey: ['admin-buses'],
    queryFn: async () => {
      const res = await fetch('/api/admin/buses');
      if (!res.ok) throw new Error('Failed to fetch buses');
      return res.json();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<BusFormValues>({
    resolver: zodResolver(BusSchema) as any,
    defaultValues: {
      name: '',
      registration_plate: '',
      capacity: 30,
      status: 'inactive',
    },
  });

  // Mutate create
  const createMutation = useMutation({
    mutationFn: async (values: BusFormValues) => {
      const res = await fetch('/api/admin/buses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create bus');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
      setIsModalOpen(false);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Mutate update
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<BusFormValues> }) => {
      const res = await fetch(`/api/admin/buses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update bus');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
      setIsModalOpen(false);
      setEditingBusId(null);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Mutate delete
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/buses/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete bus');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const handleOpenAddModal = () => {
    setEditingBusId(null);
    setErrorMessage(null);
    reset({
      name: '',
      registration_plate: '',
      capacity: 30,
      status: 'inactive',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (bus: any) => {
    setEditingBusId(bus.id);
    setErrorMessage(null);
    setValue('name', bus.name);
    setValue('registration_plate', bus.registration_plate);
    setValue('capacity', bus.capacity);
    setValue('status', bus.status);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to remove this bus? This action cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  const onSubmit = (values: BusFormValues) => {
    setErrorMessage(null);
    if (editingBusId) {
      updateMutation.mutate({ id: editingBusId, values });
    } else {
      createMutation.mutate(values);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Fetching fleet roster...</p>
      </div>
    );
  }

  const mutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Fleet Buses</h2>
          <p className="text-slate-500 text-sm font-medium">Configure registration plate records, student seat capacities, and maintenance status.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Bus Record
        </button>
      </div>

      {/* Grid List */}
      {buses.length === 0 ? (
        <div className="bg-white border border-slate-150 rounded-2xl p-12 text-center max-w-sm mx-auto space-y-4">
          <div className="flex items-center justify-center w-12 h-12 bg-slate-50 border border-slate-200 rounded-full mx-auto text-slate-400">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">No Fleet Buses</h4>
            <p className="text-slate-500 text-xs mt-1">Get started by creating your first school bus tracking registration.</p>
          </div>
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition"
          >
            Create Bus
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {buses.map((bus: any) => (
            <div
              key={bus.id}
              className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition duration-200"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-900 text-base">{bus.name}</h3>
                    <span className="font-mono text-xs font-bold text-slate-500 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded uppercase">
                      {bus.registration_plate}
                    </span>
                  </div>
                  <Badge status={bus.status} />
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6 text-xs border-y border-slate-100 py-4">
                  <div>
                    <span className="text-slate-400 font-bold block uppercase tracking-wider">Capacity</span>
                    <span className="text-slate-800 font-extrabold text-sm block mt-1">{bus.capacity} Seats</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold block uppercase tracking-wider">Assigned Route</span>
                    <span className="text-slate-800 font-semibold text-sm block mt-1 truncate">
                      {bus.route?.name || 'Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  <span className="text-slate-400 font-bold block text-xs uppercase tracking-wider">Active Driver</span>
                  <span className="text-slate-700 text-xs font-semibold block mt-1 truncate">
                    {bus.driver?.user?.full_name ? (
                      `${bus.driver.user.full_name} (${bus.driver.user.phone || 'No Phone'})`
                    ) : (
                      <span className="text-slate-400 italic">No driver assigned</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleOpenEditModal(bus)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold transition"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(bus.id)}
                  disabled={deleteMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-200 hover:border-red-300 hover:bg-red-50 text-red-600 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Bus Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          {/* Modal Container */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 border border-slate-100">
            {/* Title Header */}
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-800 text-base">
                {editingBusId ? 'Edit Bus Record' : 'Register New Bus'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              {errorMessage && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Bus Name / Label *</label>
                <input
                  type="text"
                  disabled={mutating}
                  placeholder="e.g. Bus 1 - Yellow Express"
                  className={`block w-full px-3.5 py-2.5 border rounded-xl text-sm transition focus:outline-none focus:ring-2 ${
                    errors.name
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-slate-200 focus:ring-primary/20 focus:border-primary'
                  }`}
                  {...register('name')}
                />
                {errors.name && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.name.message}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Registration Plate *</label>
                <input
                  type="text"
                  disabled={mutating}
                  placeholder="e.g. RJ14-AB-1234"
                  className={`block w-full px-3.5 py-2.5 border rounded-xl text-sm transition focus:outline-none focus:ring-2 ${
                    errors.registration_plate
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-slate-200 focus:ring-primary/20 focus:border-primary'
                  }`}
                  {...register('registration_plate')}
                />
                {errors.registration_plate && (
                  <p className="text-red-500 text-xs mt-1 font-semibold">{errors.registration_plate.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Passenger Capacity *</label>
                  <input
                    type="number"
                    disabled={mutating}
                    className={`block w-full px-3.5 py-2.5 border rounded-xl text-sm transition focus:outline-none focus:ring-2 ${
                      errors.capacity
                        ? 'border-red-300 focus:ring-red-200'
                        : 'border-slate-200 focus:ring-primary/20 focus:border-primary'
                    }`}
                    {...register('capacity', { valueAsNumber: true })}
                  />
                  {errors.capacity && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.capacity.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Operational Status</label>
                  <select
                    disabled={mutating}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm transition focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                    {...register('status')}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
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
                  {editingBusId ? 'Save Changes' : 'Create Bus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
