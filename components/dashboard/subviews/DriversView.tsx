'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Edit2, Trash2, X, Loader2, AlertCircle, ShieldCheck, Mail, Phone, Calendar, Bus, MapPin } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { CreateDriverSchema } from '@/lib/validations';
import type { z } from 'zod';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[350px] bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />
      Loading tracking map...
    </div>
  ),
});

type DriverFormValues = z.infer<typeof CreateDriverSchema>;

export default function AdminDrivers() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live Tracking Modal states
  const [trackingDriver, setTrackingDriver] = useState<any | null>(null);
  const [trackingBusId, setTrackingBusId] = useState<string | null>(null);
  const [trackingLocation, setTrackingLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);

  const handleTrackDriver = async (driver: any) => {
    if (!driver.bus?.id) {
      alert('This driver does not have a shift vehicle/bus assigned for tracking.');
      return;
    }
    
    setTrackingDriver(driver);
    setTrackingBusId(driver.bus.id);
    setLoadingLocation(true);
    setTrackingLocation(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase
        .from('bus_locations')
        .select('latitude, longitude')
        .eq('bus_id', driver.bus.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setTrackingLocation({
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
        });
      }
    } catch (err) {
      console.error('Failed to fetch initial bus location:', err);
    } finally {
      setLoadingLocation(false);
    }
  };

  // Fetch drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery({
    queryKey: ['admin-drivers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/drivers');
      if (!res.ok) throw new Error('Failed to fetch drivers');
      return res.json();
    },
  });

  // Fetch buses for assignment dropdown
  const { data: buses = [] } = useQuery({
    queryKey: ['admin-buses'],
    queryFn: async () => {
      const res = await fetch('/api/admin/buses');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(CreateDriverSchema),
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      password: '',
      license_number: '',
      license_expiry: '',
      bus_id: '',
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (values: DriverFormValues) => {
      const res = await fetch('/api/admin/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create driver');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
      setIsModalOpen(false);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<DriverFormValues> }) => {
      // For updates, the password is not required. Zod schema can be partial.
      const res = await fetch(`/api/admin/drivers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update driver');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
      setIsModalOpen(false);
      setEditingDriver(null);
      reset();
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/drivers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete driver');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin-buses'] });
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const handleOpenAddModal = () => {
    setEditingDriver(null);
    setErrorMessage(null);
    reset({
      full_name: '',
      email: '',
      phone: '',
      password: '',
      license_number: '',
      license_expiry: '',
      bus_id: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (driver: any) => {
    setEditingDriver(driver);
    setErrorMessage(null);
    reset({
      full_name: driver.user?.full_name || '',
      email: driver.user?.email || '',
      phone: driver.user?.phone || '',
      password: 'PlaceholderPassword123!', // ignored by backend unless sent
      license_number: driver.license_number,
      license_expiry: driver.license_expiry || '',
      bus_id: driver.bus?.id || '',
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this driver account? All historical trip attachments will remain, but the driver profile will be wiped.')) {
      deleteMutation.mutate(id);
    }
  };

  const onSubmit = (values: DriverFormValues) => {
    setErrorMessage(null);
    if (editingDriver) {
      // Exclude password on update
      const { password, ...updateValues } = values;
      const payload: any = { ...updateValues, is_active: editingDriver.is_active };
      updateMutation.mutate({ id: editingDriver.id, values: payload });
    } else {
      createMutation.mutate(values);
    }
  };

  const toggleActiveState = (driver: any) => {
    updateMutation.mutate({
      id: driver.id,
      values: { is_active: !driver.is_active } as any,
    });
  };

  if (driversLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Reviewing licenses...</p>
      </div>
    );
  }

  const mutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Drivers Log</h2>
          <p className="text-slate-500 text-sm font-medium">Provision driver authentication access keys, document vehicle license numbers, and manage shift links.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Driver Record
        </button>
      </div>

      {/* Grid view */}
      {drivers.length === 0 ? (
        <div className="bg-white border border-slate-150 rounded-2xl p-12 text-center max-w-sm mx-auto space-y-4">
          <div className="flex items-center justify-center w-12 h-12 bg-slate-50 border border-slate-200 rounded-full mx-auto text-slate-400">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800">No Shift Drivers</h4>
            <p className="text-slate-500 text-xs mt-1">Get started by onboarding your first route driver registration.</p>
          </div>
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition"
          >
            Add Driver
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {drivers.map((driver: any) => (
            <div
              key={driver.id}
              className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm hover:shadow-md transition duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{driver.user?.full_name}</h3>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                      <Mail className="w-3.5 h-3.5" />
                      {driver.user?.email}
                    </p>
                  </div>
                  <button 
                    onClick={() => toggleActiveState(driver)}
                    className="focus:outline-none"
                  >
                    <Badge status={driver.is_active ? 'active' : 'inactive'} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6 border-y border-slate-100 py-4 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-slate-400 font-bold block uppercase tracking-wider">License Number</span>
                    <span className="text-slate-700 font-mono font-bold">{driver.license_number}</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-slate-400 font-bold block uppercase tracking-wider">License Expiration</span>
                    <span className="text-slate-700 font-semibold flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {driver.license_expiry || 'No date set'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-4 text-xs">
                  <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-150 p-2.5 rounded-xl">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-slate-400 font-bold block uppercase text-[9px] tracking-wider">Contact Phone</span>
                      <span className="text-slate-700 font-semibold block">{driver.user?.phone || '—'}</span>
                    </div>
                  </div>
                  <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-150 p-2.5 rounded-xl">
                    <Bus className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-slate-400 font-bold block uppercase text-[9px] tracking-wider">Shift Bus</span>
                      <span className="text-slate-700 font-semibold block truncate">
                        {driver.bus?.name || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleTrackDriver(driver)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-purple-250 hover:border-purple-350 hover:bg-purple-50 text-purple-650 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-purple-500" />
                  Track Location
                </button>
                <button
                  onClick={() => handleOpenEditModal(driver)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold transition"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit details
                </button>
                <button
                  onClick={() => handleDelete(driver.id)}
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

      {/* Onboard / Edit Driver Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />

          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 border border-slate-100">
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-bold text-slate-800 text-base">
                {editingDriver ? 'Edit Driver Record' : 'Onboard Shift Driver'}
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
                    placeholder="+919876543210"
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
                  disabled={mutating || !!editingDriver}
                  placeholder="ramesh@school.edu"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                  {...register('email')}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.email.message}</p>}
              </div>

              {!editingDriver && (
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
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">License Number *</label>
                  <input
                    type="text"
                    disabled={mutating}
                    placeholder="DL-042019..."
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    {...register('license_number')}
                  />
                  {errors.license_number && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.license_number.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">License Expiration</label>
                  <input
                    type="date"
                    disabled={mutating}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-600"
                    {...register('license_expiry')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assign Initial Bus Shift</label>
                <select
                  disabled={mutating}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                  {...register('bus_id')}
                >
                  <option value="">No Shift Bus Link</option>
                  {buses.map((bus: any) => (
                    <option key={bus.id} value={bus.id}>
                      {bus.name} ({bus.registration_plate})
                    </option>
                  ))}
                </select>
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
                  {editingDriver ? 'Save Details' : 'Onboard Driver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Tracking Modal */}
      {trackingDriver && trackingBusId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-150 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                  <span className="text-xl">📍</span> Live Tracking: {trackingDriver.user?.full_name}
                </h3>
                <span className="text-[10px] text-slate-400 font-bold block mt-1 uppercase tracking-wider">
                  Vehicle: {trackingDriver.bus?.name || 'Unassigned'}
                </span>
              </div>
              <button
                onClick={() => {
                  setTrackingDriver(null);
                  setTrackingBusId(null);
                  setTrackingLocation(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {loadingLocation ? (
                <div className="h-[350px] bg-slate-50 border border-slate-150 rounded-xl flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-xs text-slate-500 font-medium">Connecting to vehicle telemetry...</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="h-[350px] rounded-xl overflow-hidden border border-slate-200 shadow-inner">
                    <LiveMap
                      busId={trackingBusId}
                      initialLocation={trackingLocation}
                      stops={[]}
                      showBus={true}
                    />
                  </div>
                  {!trackingLocation && (
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] rounded-xl flex items-center justify-center p-4">
                      <div className="bg-white/95 border border-slate-150 p-5 rounded-2xl max-w-xs shadow-xl text-center space-y-2">
                        <p className="text-xs text-slate-800 font-extrabold flex items-center justify-center gap-1.5">
                          📶 Telemetry Offline
                        </p>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                          This vehicle is not actively transmitting GPS data. The driver may be offline, outside shift hours, or stationary.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
