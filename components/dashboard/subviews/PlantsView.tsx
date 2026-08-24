'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlantSchema } from '@/lib/validations';
import { deletePlantAction } from '@/app/actions/admin-pagination';
import { 
  Loader2, 
  Plus, 
  MapPin, 
  Trash2, 
  Edit2, 
  X, 
  Building, 
  AlertCircle,
  Search
} from 'lucide-react';
import { z } from 'zod';

type PlantFormValues = z.infer<typeof PlantSchema>;

export default function PlantsView() {
  const [editingPlant, setEditingPlant] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch Plants
  const { data: plants = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-plants'],
    queryFn: async () => {
      const res = await fetch('/api/admin/plants');
      if (!res.ok) throw new Error('Failed to load plants');
      return res.json();
    },
  });

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<PlantFormValues>({
    resolver: zodResolver(PlantSchema) as any,
    defaultValues: {
      name: '',
      code: '',
      address: '',
      latitude: 26.9124,
      longitude: 75.7873,
      radius_meters: 100,
    }
  });

  const handleOpenCreate = () => {
    setEditingPlant(null);
    setFormError(null);
    reset({
      name: '',
      code: '',
      address: '',
      latitude: 26.9124,
      longitude: 75.7873,
      radius_meters: 100,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (plant: any) => {
    setEditingPlant(plant);
    setFormError(null);
    reset({
      name: plant.name,
      code: plant.code,
      address: plant.address || '',
      latitude: Number(plant.latitude),
      longitude: Number(plant.longitude),
      radius_meters: Number(plant.radius_meters),
    });
    setShowModal(true);
  };

  const onSubmit = async (values: PlantFormValues) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const url = editingPlant ? `/api/admin/plants/${editingPlant.id}` : '/api/admin/plants';
      const method = editingPlant ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save plant');
      }

      setShowModal(false);
      refetch();
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while saving the plant.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (plantId: string) => {
    if (!confirm('Are you sure you want to delete this plant? This will nullify plant assignments for all managers, supervisors, and workers under it.')) {
      return;
    }
    try {
      const res = await deletePlantAction(plantId);
      if (!res.success) {
        alert(res.error || 'Failed to delete plant');
      } else {
        refetch();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete plant');
    }
  };

  const filteredPlants = plants.filter((plant: any) => 
    plant.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    plant.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Plant Management</h2>
          <p className="text-slate-500 text-xs font-medium">
            Manage your industrial plant locations, coordinates, and geofence boundary safety thresholds.
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-extrabold rounded-xl transition shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add New Plant
        </button>
      </div>

      {/* Roster Controls */}
      <div className="flex items-center bg-white border border-slate-150 rounded-xl px-3.5 py-1 max-w-md">
        <Search className="w-4.5 h-4.5 text-slate-400 mr-2" />
        <input
          type="text"
          placeholder="Filter by name or code..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full text-xs font-medium bg-transparent text-slate-800 focus:outline-none py-2.5"
        />
      </div>

      {/* Content Grid */}
      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        </div>
      ) : filteredPlants.length === 0 ? (
        <div className="bg-white border border-slate-150 rounded-2xl p-12 text-center text-slate-400 font-medium">
          No plants found. Click 'Add New Plant' to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPlants.map((plant: any) => (
            <div key={plant.id} className="bg-white border border-slate-150 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden">
              <div className="p-5 space-y-4">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-600">
                      <Building className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-slate-900 text-sm leading-tight">{plant.name}</h4>
                      <span className="px-2 py-0.5 mt-1 inline-block bg-slate-100 text-slate-600 text-[9px] font-bold rounded-lg uppercase">
                        Code: {plant.code}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(plant)}
                      className="p-1.5 text-slate-500 hover:bg-slate-50 rounded-lg border border-slate-200 transition"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(plant.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg border border-red-100 transition"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                  {plant.address || 'No address specified'}
                </p>

                <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs font-semibold">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Coordinates</span>
                    <span className="text-slate-700 font-mono block mt-0.5">
                      {Number(plant.latitude).toFixed(4)}, {Number(plant.longitude).toFixed(4)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Safety Geofence</span>
                    <span className="text-slate-700 block mt-0.5">
                      {plant.radius_meters} meters
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Onboarding Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white border border-slate-150 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl relative animate-in zoom-in-95 duration-250">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-650 p-1.5 rounded-lg transition"
            >
              <X className="w-4.5 h-4.5" />
            </button>

            <div className="space-y-1">
              <h3 className="font-black text-slate-900 text-base">
                {editingPlant ? 'Edit Plant Details' : 'Onboard New Plant'}
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                Set coordinates and geofence radius for automated check-ins and personnel mapping.
              </p>
            </div>

            {formError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[10px] font-bold">
                <AlertCircle className="w-4 h-4 mt-0.5 text-red-650 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Plant Name</label>
                  <input
                    type="text"
                    {...register('name')}
                    placeholder="e.g. Indiawalls"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  {errors.name && <p className="text-red-500 text-[9px] font-bold">{errors.name.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Site Code</label>
                  <input
                    type="text"
                    {...register('code')}
                    placeholder="e.g. IW-01"
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  {errors.code && <p className="text-red-500 text-[9px] font-bold">{errors.code.message}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Address</label>
                <textarea
                  {...register('address')}
                  placeholder="e.g. Plot No. 12, Industrial Area, Sector 5..."
                  rows={2}
                  className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    {...register('latitude')}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none font-mono"
                  />
                  {errors.latitude && <p className="text-red-500 text-[9px] font-bold">{errors.latitude.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    {...register('longitude')}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none font-mono"
                  />
                  {errors.longitude && <p className="text-red-500 text-[9px] font-bold">{errors.longitude.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Radius (m)</label>
                  <input
                    type="number"
                    {...register('radius_meters')}
                    className="block w-full py-2.5 px-3 bg-slate-50 border border-slate-200 focus:border-[#5c3b99] rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                  {errors.radius_meters && <p className="text-red-500 text-[9px] font-bold">{errors.radius_meters.message}</p>}
                </div>
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
                  className="flex-1 py-3 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-extrabold rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Save Site Details'
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
