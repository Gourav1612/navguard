'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Loader2, Bus, Map, Play, ArrowRight, AlertCircle, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

// Import subviews
import DriverRouteView from './subviews/DriverRouteView';
import DriverTripView from './subviews/DriverTripView';

export default function DriverDashboardView({ tab }: { tab?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch driver assignment details
  const { data: assignment, isLoading, error } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/driver/assignment');
      if (!res.ok) throw new Error('Failed to load shift assignments');
      return res.json();
    },
    enabled: !tab, // Only load details if viewing main dashboard tab
  });

  // Start Trip mutation
  const startTripMutation = useMutation({
    mutationFn: async (payload: { bus_id: string; route_id: string }) => {
      const res = await fetch('/api/driver/trip/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start trip log');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['driver-assignment'] });
      // Redirect to the active trip console
      router.push('/dashboard?tab=trip');
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
    },
  });

  // Handle Dynamic Tab Routing
  switch (tab) {
    case 'route':
      return <DriverRouteView />;
    case 'trip':
      return <DriverTripView />;
  }

  const handleStartTrip = () => {
    if (!assignment?.bus?.id || !assignment?.route?.id) return;
    setErrorMessage(null);
    startTripMutation.mutate({
      bus_id: assignment.bus.id,
      route_id: assignment.route.id,
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Accessing driver assignments...</p>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-3">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Shift Link Missing</h3>
        <p className="text-slate-555 text-xs leading-relaxed font-semibold">
          We failed to retrieve a shift profile. Ensure your driver account profile is active.
        </p>
      </div>
    );
  }

  const { bus, route, active_trip } = assignment;
  const isTripActive = !!active_trip;

  return (
    <div className="space-y-6 max-w-md md:max-w-2xl mx-auto pt-2 animate-in fade-in duration-200">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1e1b4b] tracking-tight">Driver Portal</h2>
          <p className="text-slate-555 text-xs font-semibold uppercase tracking-wider mt-1">Welcome back! Ensure GPS permissions are allowed</p>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Assigned Fleet Bus Card */}
      {bus ? (
        <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all duration-300 space-y-4">
          <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
            <div className="p-3 bg-purple-50 border border-purple-100 rounded-2xl text-[#5c3b99]">
              <Bus className="w-5.5 h-5.5" />
            </div>
            <div>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Shift Bus Vehicle</span>
              <h4 className="font-extrabold text-slate-800 text-sm leading-tight mt-0.5">{bus.name}</h4>
              <span className="font-mono text-[10px] font-extrabold text-purple-650 uppercase block mt-1">{bus.registration_plate}</span>
            </div>
          </div>

          {route ? (
            <div className="pt-2 flex items-center gap-3.5">
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600">
                <Map className="w-5.5 h-5.5" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Assigned Transit Route</span>
                <h4 className="font-extrabold text-slate-800 text-sm leading-tight mt-0.5">{route.name}</h4>
                <span className="text-[10px] text-slate-500 font-semibold block mt-1">{route.stops?.length || 0} stops configured</span>
              </div>
            </div>
          ) : (
            <div className="pt-2 flex items-center gap-2.5 text-amber-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-xs font-semibold">No operational route linked to this bus unit.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-150 rounded-3xl p-8 text-center space-y-4 shadow-sm max-w-sm mx-auto">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <div>
            <h4 className="font-extrabold text-slate-855 text-sm">Shift Vehicle Missing</h4>
            <p className="text-slate-555 text-xs leading-relaxed mt-1">
              You do not have a bus unit assigned for this shift. Contact transport control.
            </p>
          </div>
        </div>
      )}

      {/* Operational State Button */}
      {bus && route && (
        <div className="pt-2">
          {isTripActive ? (
            <button
              onClick={() => router.push('/dashboard?tab=trip')}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#10b981] hover:bg-[#059669] text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 transition-all duration-300 cursor-pointer"
            >
              Resume Active Trip
              <ArrowRight className="w-4.5 h-4.5" />
            </button>
          ) : (
            <button
              onClick={handleStartTrip}
              disabled={startTripMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-4 bg-[#5c3b99] hover:bg-[#432775] text-white rounded-2xl font-bold shadow-lg shadow-purple-500/20 transition-all duration-300 cursor-pointer disabled:opacity-50"
            >
              {startTripMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-1" />
                  Initiating Trip...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current mr-1" />
                  Start Transit Trip
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
