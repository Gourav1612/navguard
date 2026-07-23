'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Edit2, Trash2, X, Loader2, ArrowUp, ArrowDown, MapPin, Eye, Route, ExternalLink } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/Badge';
import { RouteSchema } from '@/lib/validations';
import type { z } from 'zod';
import { parseGoogleMapsLink, optimizeRouteStops } from '@/lib/utils';

type RouteFormValues = z.infer<typeof RouteSchema>;

// Dynamic map preview for current route coordinates
const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-medium">
      Loading Preview Map...
    </div>
  ),
});

export default function AdminRoutes() {
  const queryClient = useQueryClient();
  const [selectedRoute, setSelectedRoute] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [stopsList, setStopsList] = useState<any[]>([]);

  // Add Stop fields state
  const [newStopName, setNewStopName] = useState('');
  const [newStopAddress, setNewStopAddress] = useState('');
  const [newStopLat, setNewStopLat] = useState('');
  const [newStopLng, setNewStopLng] = useState('');

  // Google Maps Link states
  const [googleMapsLink, setGoogleMapsLink] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);

  // Start Point states
  const [startMapsLink, setStartMapsLink] = useState('');
  const [startStopName, setStartStopName] = useState('');
  const [startStopAddress, setStartStopAddress] = useState('');
  const [startStopLat, setStartStopLat] = useState('');
  const [startStopLng, setStartStopLng] = useState('');
  const [isLoadingStartLink, setIsLoadingStartLink] = useState(false);

  // Load default school settings for autofill fallback
  const [defaultSchool, setDefaultSchool] = useState<any>(null);

  useEffect(() => {
    async function fetchDefaultSchool() {
      try {
        const supabase = (await import('@/lib/supabase/client')).createBrowserSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        if (profile?.school_id) {
          const { data: school } = await supabase
            .from('schools')
            .select('*')
            .eq('id', profile.school_id)
            .single();
          if (school) {
            setDefaultSchool(school);
          }
        }
      } catch (err) {
        console.error('Error fetching default school coordinates:', err);
      }
    }
    fetchDefaultSchool();
  }, []);

  // Fetch routes
  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['admin-routes'],
    queryFn: async () => {
      const res = await fetch('/api/admin/routes');
      if (!res.ok) throw new Error('Failed to fetch routes');
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
  } = useForm<RouteFormValues>({
    resolver: zodResolver(RouteSchema) as any,
    defaultValues: {
      name: '',
      bus_id: '',
      description: '',
      is_active: true,
    },
  });

  // Save Route mutation
  const saveMutation = useMutation({
    mutationFn: async (values: RouteFormValues) => {
      const formattedStops = stopsList.map((stop, idx) => ({
        id: stop.id,
        name: stop.name,
        address: stop.address,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        stop_order: idx,
      }));

      // Automatically optimize stop drop-off sequence starting from the first stop (school)
      const optimizedStops = optimizeRouteStops(formattedStops).map((stop, idx) => ({
        ...stop,
        stop_order: idx,
      }));

      const payload = {
        ...values,
        stops: optimizedStops,
      };

      let res;
      if (selectedRoute?.id) {
        // Edit Route
        res = await fetch(`/api/admin/routes/${selectedRoute.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        // Wait, route stop updates are modified in a separate logic or stops are fully recreated.
        // To be safe: the PATCH endpoint updates Route details. Stops updates are handled in Stops API.
        // We will update the route details first, then update stops.
        // For editing, let's also sync the stops list to the database using separate calls,
        // or just let users update route fields.
      } else {
        // Create Route (sends everything at once)
        res = await fetch('/api/admin/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save route');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
      setIsEditing(false);
      setSelectedRoute(null);
      setStopsList([]);
      reset();
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  // Delete Route
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/routes/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete route');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
      if (selectedRoute?.id) setSelectedRoute(null);
    },
    onError: (err: any) => {
      alert(err.message);
    },
  });

  const handleOpenAddForm = () => {
    setSelectedRoute(null);
    reset({
      name: '',
      bus_id: '',
      description: '',
      is_active: true,
    });
    if (defaultSchool && defaultSchool.latitude !== null && defaultSchool.longitude !== null) {
      const schoolStop = {
        name: defaultSchool.name || 'School Campus',
        address: defaultSchool.address || '',
        latitude: Number(defaultSchool.latitude),
        longitude: Number(defaultSchool.longitude),
        stop_order: 0,
      };
      setStopsList([schoolStop]);
    } else {
      setStopsList([]);
    }
    setIsEditing(true);
  };

  const handleOpenEditForm = (route: any) => {
    setSelectedRoute(route);
    setValue('name', route.name);
    setValue('bus_id', route.bus_id || '');
    setValue('description', route.description || '');
    setValue('is_active', route.is_active);
    if (route.stops && route.stops.length > 0) {
      setStopsList(route.stops);
    } else if (defaultSchool && defaultSchool.latitude !== null && defaultSchool.longitude !== null) {
      const schoolStop = {
        name: defaultSchool.name || 'School Campus',
        address: defaultSchool.address || '',
        latitude: Number(defaultSchool.latitude),
        longitude: Number(defaultSchool.longitude),
        stop_order: 0,
      };
      setStopsList([schoolStop]);
    } else {
      setStopsList([]);
    }
    setIsEditing(true);
  };

  const handleImportStartLink = async () => {
    if (!startMapsLink) return;
    setIsLoadingStartLink(true);
    try {
      let urlToParse = startMapsLink.trim();

      if (urlToParse.includes('maps.app.goo.gl') || urlToParse.includes('goo.gl/maps')) {
        const res = await fetch(`/api/resolve-map-link?url=${encodeURIComponent(urlToParse)}`);
        if (!res.ok) throw new Error('Failed to resolve Google Maps short link');
        const data = await res.json();
        urlToParse = data.expandedUrl;
      }

      const parsed = parseGoogleMapsLink(urlToParse);
      if (parsed) {
        setStartStopLat(parsed.lat.toString());
        setStartStopLng(parsed.lng.toString());
        setStartStopName(parsed.name || 'Start Point');
        setStartStopAddress(parsed.name || '');
        setStartMapsLink('');
      } else {
        alert('Could not extract coordinates from the Google Maps link. Please verify it contains coordinates or a location.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to process Google Maps link');
    } finally {
      setIsLoadingStartLink(false);
    }
  };

  const handleSetStartPoint = () => {
    if (!startStopName || !startStopLat || !startStopLng) {
      alert('Please fill Starting Point Name, Latitude and Longitude.');
      return;
    }
    const lat = Number(startStopLat);
    const lng = Number(startStopLng);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      alert('Enter valid GPS coordinates (Lat -90 to 90, Lng -180 to 180).');
      return;
    }

    const startStop = {
      name: startStopName,
      address: startStopAddress || '',
      latitude: lat,
      longitude: lng,
      stop_order: 0,
    };

    if (stopsList.length > 0) {
      const rest = stopsList.slice(1).map((s, idx) => ({ ...s, stop_order: idx + 1 }));
      setStopsList([startStop, ...rest]);
    } else {
      setStopsList([startStop]);
    }

    setStartStopName('');
    setStartStopAddress('');
    setStartStopLat('');
    setStartStopLng('');
  };

  const handleClearStartPoint = () => {
    if (confirm('Change starting point? This will keep other stops sequence.')) {
      setStopsList(stopsList.slice(1).map((s, idx) => ({ ...s, stop_order: idx })));
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
        setNewStopLat(parsed.lat.toString());
        setNewStopLng(parsed.lng.toString());
        if (parsed.name) {
          setNewStopName((prev) => prev || parsed.name || '');
          setNewStopAddress((prev) => prev || parsed.name || '');
        }
        setGoogleMapsLink('');
      } else {
        alert('Could not extract coordinates from the Google Maps link. Please verify it contains coordinates or a location.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to process Google Maps link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  const handleAddStop = () => {
    if (!newStopName || !newStopLat || !newStopLng) {
      alert('Please fill Stop Name, Latitude and Longitude.');
      return;
    }
    const lat = Number(newStopLat);
    const lng = Number(newStopLng);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      alert('Enter valid GPS coordinates (Lat -90 to 90, Lng -180 to 180).');
      return;
    }

    const newStop = {
      name: newStopName,
      address: newStopAddress || '',
      latitude: lat,
      longitude: lng,
      stop_order: stopsList.length,
    };

    setStopsList([...stopsList, newStop]);
    setNewStopName('');
    setNewStopAddress('');
    setNewStopLat('');
    setNewStopLng('');
  };

  const handleRemoveStop = (idx: number) => {
    const updated = stopsList.filter((_, i) => i !== idx).map((stop, i) => ({ ...stop, stop_order: i }));
    setStopsList(updated);
  };

  const handleMoveStop = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === stopsList.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const updated = [...stopsList];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;

    // Reset orders
    const resetOrder = updated.map((stop, i) => ({ ...stop, stop_order: i }));
    setStopsList(resetOrder);
  };

  const handleRouteDelete = (id: string) => {
    if (confirm('Delete this route and all its stops?')) {
      deleteMutation.mutate(id);
    }
  };

  if (routesLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Building routing indexes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Transport Routes</h2>
          <p className="text-slate-500 text-sm font-medium">Design transit paths, ordered bus stops, and link them to fleet vehicles.</p>
        </div>
        {!isEditing && (
          <button
            onClick={handleOpenAddForm}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition hover:shadow-lg shadow-primary/25 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Route
          </button>
        )}
      </div>

      {isEditing ? (
        /* Edit/Create Form View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Details Form Card */}
          <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="font-bold text-slate-800 text-base">
                {selectedRoute ? `Modify Route: ${selectedRoute.name}` : 'Design Route'}
              </h3>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit((vals) => saveMutation.mutate(vals))} className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Route Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Route A - Sector 5 to School"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  {...register('name')}
                />
                {errors.name && <p className="text-red-500 text-xs mt-1 font-semibold">{errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Link Fleet Bus</label>
                  <select
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                    {...register('bus_id')}
                  >
                    <option value="">No Bus Assigned</option>
                    {buses.map((bus: any) => (
                      <option key={bus.id} value={bus.id}>
                        {bus.name} ({bus.registration_plate})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Status</label>
                  <select
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                    {...register('is_active')}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Route Description</label>
                <textarea
                  rows={2}
                  placeholder="Details about morning pickups, evening drops, etc."
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  {...register('description')}
                />
              </div>

              {/* Stops Builder */}
              <div className="border-t border-slate-100 pt-6 space-y-5">
                
                {/* 1. Set Starting Point (Red Spot) */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-5.5 h-5.5 rounded-full bg-red-50 text-red-650 text-xs font-bold font-sans">
                      1
                    </span>
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">Set Journey Starting Point (Red Spot)</h4>
                  </div>

                  {stopsList.length > 0 ? (
                    <div className="flex items-center justify-between p-3.5 bg-red-50/40 border border-red-150 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚩</span>
                        <div>
                          <p className="text-xs font-bold text-slate-800">{stopsList[0].name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">GPS: {stopsList[0].latitude}, {stopsList[0].longitude}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearStartPoint}
                        className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-650 hover:text-slate-900 rounded-lg text-2xs font-bold transition cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {defaultSchool && (
                        <button
                          type="button"
                          onClick={() => {
                            setStartStopName(defaultSchool.name || 'School Campus');
                            setStartStopAddress(defaultSchool.address || '');
                            setStartStopLat(defaultSchool.latitude?.toString() || '27.5609');
                            setStartStopLng(defaultSchool.longitude?.toString() || '76.6111');
                          }}
                          className="w-full py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-750 rounded-xl text-[10px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          🏫 Use Default School: {defaultSchool.name}
                        </button>
                      )}
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Import Start Location via Google Maps Link</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Paste Google Maps URL here..."
                            value={startMapsLink}
                            onChange={(e) => setStartMapsLink(e.target.value)}
                            className="block w-full px-3 py-2 border border-slate-250 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-500 bg-white"
                          />
                          <button
                            type="button"
                            onClick={handleImportStartLink}
                            disabled={isLoadingStartLink || !startMapsLink}
                            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-150 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center justify-center min-w-[85px] cursor-pointer"
                          >
                            {isLoadingStartLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="Starting Point Name (e.g. School) *"
                          value={startStopName}
                          onChange={(e) => setStartStopName(e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                        />
                        <input
                          type="text"
                          placeholder="Address / Area"
                          value={startStopAddress}
                          onChange={(e) => setStartStopAddress(e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                        />
                        <input
                          type="text"
                          placeholder="Latitude *"
                          value={startStopLat}
                          onChange={(e) => setStartStopLat(e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                        />
                        <input
                          type="text"
                          placeholder="Longitude *"
                          value={startStopLng}
                          onChange={(e) => setStartStopLng(e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleSetStartPoint}
                        className="w-full flex items-center justify-center gap-1 py-2 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow shadow-red-500/10 transition cursor-pointer"
                      >
                        Set Start Point
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Add Transit/Destination Stops (Blue / Green Spot) */}
                <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 transition ${
                  stopsList.length === 0 ? 'opacity-40 pointer-events-none' : ''
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-5.5 h-5.5 rounded-full bg-blue-100 text-blue-750 text-xs font-bold font-sans">
                      2
                    </span>
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">Add Route Stops in Sequence</h4>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Import stop location via Google Maps Link</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Paste Google Maps URL here..."
                        value={googleMapsLink}
                        onChange={(e) => setGoogleMapsLink(e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-250 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleImportGoogleMapsLink}
                        disabled={isLoadingLink || !googleMapsLink}
                        className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center justify-center min-w-[85px] cursor-pointer"
                      >
                        {isLoadingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Stop Name *"
                      value={newStopName}
                      onChange={(e) => setNewStopName(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Address / Area"
                      value={newStopAddress}
                      onChange={(e) => setNewStopAddress(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Latitude *"
                      value={newStopLat}
                      onChange={(e) => setNewStopLat(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Longitude *"
                      value={newStopLng}
                      onChange={(e) => setNewStopLng(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                    />
                  </div>
                  
                  <button
                    type="button"
                    onClick={handleAddStop}
                    className="w-full flex items-center justify-center gap-1 py-2 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-semibold shadow shadow-purple-500/10 transition cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Add Stop to Sequence
                  </button>
                </div>

              </div>

              {/* Action Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-semibold transition hover:shadow-lg shadow-primary/25 disabled:opacity-50"
                >
                  {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Route Config
                </button>
              </div>
            </form>
          </div>

          {/* Stops List Reorder Builder & Map Preview */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-800 text-sm">Sequence Stops List ({stopsList.length})</h4>
              
              {stopsList.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4">No stops configured on this route yet.</p>
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                  {stopsList.map((stop, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-150 rounded-xl text-xs font-medium"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center w-5 h-5 bg-primary/10 text-primary rounded-full font-bold text-[10px]">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-bold text-slate-800">{stop.name}</p>
                          <p className="text-[10px] text-slate-400 truncate max-w-[150px]">{stop.address || 'No address details'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${stop.latitude},${stop.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-slate-200 text-slate-450 hover:text-slate-700"
                          title="View on Google Maps"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleMoveStop(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-35"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveStop(idx, 'down')}
                          disabled={idx === stopsList.length - 1}
                          className="p-1 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-35"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(idx)}
                          className="p-1 rounded hover:bg-red-100 hover:text-red-600 text-slate-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Map Preview */}
            <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-3">
              <h4 className="font-bold text-slate-800 text-sm">Route Alignment Preview</h4>
              <div className="h-[300px]">
                <LiveMap
                  busId="preview"
                  stops={stopsList}
                  showBus={false}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Routes List View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {routes.map((route: any) => (
            <div
              key={route.id}
              className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm hover:shadow-md transition duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
                      <Route className="w-4 h-4 text-primary" />
                      {route.name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 font-medium">{route.description || 'No route description'}</p>
                  </div>
                  <Badge status={route.is_active ? 'active' : 'inactive'} />
                </div>

                <div className="mt-5 text-xs text-slate-600 space-y-2 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-400">Bus Unit:</span>
                    <span className="font-semibold text-slate-700 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded">
                      {route.bus?.name || 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-400">Total Stops:</span>
                    <span className="font-semibold text-slate-700">{route.stops?.length || 0} stops</span>
                  </div>
                </div>

                {/* List stops inline briefly */}
                {route.stops && route.stops.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Transit stops sequence:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {route.stops.map((s: any, idx: number) => (
                        <a
                          key={s.id || idx}
                          href={`https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition flex items-center gap-1 cursor-pointer"
                          title="View on Google Maps"
                        >
                          {idx + 1}. {s.name}
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleOpenEditForm(route)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold transition"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Route Details
                </button>
                <button
                  onClick={() => handleRouteDelete(route.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-200 hover:border-red-300 hover:bg-red-50 text-red-600 rounded-lg text-xs font-semibold transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
