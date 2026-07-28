'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Compass, MapPin, Navigation, AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[380px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mr-3" />
      Loading Route Map...
    </div>
  ),
});

export default function DriverRoutePage() {
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [focusedStopLocation, setFocusedStopLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [focusedStopId, setFocusedStopId] = useState<string | null>(null);

  // Fetch driver assignment details
  const { data: assignment, isLoading, error } = useQuery({
    queryKey: ['driver-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/driver/assignment');
      if (!res.ok) throw new Error('Failed to load assignment details');
      return res.json();
    },
  });

  // Attempt to fetch driver's own single GPS position once on load for marker display
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setDriverLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        },
        (err) => console.log('Driver location permission not set or deferred.', err),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Opening route maps...</p>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4 space-y-3">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h3 className="font-bold text-slate-800 text-sm">Connection Refused</h3>
        <p className="text-slate-500 text-xs">Verify your operational profile connection.</p>
      </div>
    );
  }

  const { bus, route } = assignment;

  if (!bus || !route) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6 space-y-4 max-w-sm mx-auto">
        <Compass className="w-14 h-14 text-slate-400" />
        <h3 className="font-bold text-slate-800 text-sm">No Shift Route Configured</h3>
        <p className="text-slate-500 text-xs leading-relaxed">
          Your driver account is not linked to a route. Ask transport control to assign you a bus shift.
        </p>
      </div>
    );
  }

  const stops = route.stops || [];
  
  // Combine school campus as the starting point (source) of the route sequence
  const allStops = route.school
    ? [
        {
          id: 'school',
          name: `🏫 ${route.school.name || 'School Campus'}`,
          latitude: route.school.latitude,
          longitude: route.school.longitude,
          stop_order: 0,
          address: 'Source Campus Location',
        },
        ...stops.map((s: any) => ({ ...s, stop_order: s.stop_order + 1 })),
      ]
    : stops;

  return (
    <div className="max-w-md mx-auto lg:max-w-5xl lg:mx-auto pt-2 pb-8 px-4 lg:px-0">
      {/* Title */}
      <div className="mb-6">
        <h2 className="text-xl font-black text-slate-900 tracking-tight">Assigned Route Alignment</h2>
        <p className="text-slate-500 text-xs font-semibold">
          Review stops sequence and geographic markers for <span className="font-bold text-slate-700">{route.name}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Live Map */}
        <div className="lg:col-span-7 h-[380px] lg:h-[450px] bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
          {allStops.length > 0 ? (
            <LiveMap
              busId={bus.id}
              stops={allStops}
              initialLocation={driverLocation}
              showBus={false} // don't show real-time bus marker on driver's static route map
              focusLocation={focusedStopLocation}
              highlightStopId={allStops.find((s: any) => s.id === focusedStopId)?.name}
            />
          ) : (
            <div className="w-full h-full bg-slate-100 rounded-2xl flex flex-col items-center justify-center text-slate-400 p-6 text-center border">
              <AlertTriangle className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-xs font-semibold">Route alignment has no stops configured.</p>
            </div>
          )}
        </div>

        {/* Right Column: Route Stops Sequence Info */}
        <div className="lg:col-span-5">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5.5 shadow-sm space-y-4">
            {(() => {
              const listStops = allStops.filter((stop: any) => stop.stop_order !== 0);
              return (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">
                      Transit Sequence Details
                    </h4>
                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2.5 py-0.5 font-bold rounded-full border border-slate-200">
                      {listStops.length} Stops
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                    {listStops.map((stop: any, idx: number) => {
                      const isFocused = stop.id === focusedStopId;
                      return (
                        <div
                          key={stop.id}
                          onClick={() => {
                            setFocusedStopId(stop.id);
                            setFocusedStopLocation({ latitude: stop.latitude, longitude: stop.longitude });
                          }}
                          className={`flex items-start gap-3 text-xs font-medium cursor-pointer p-3 rounded-xl border transition-all duration-200 ${
                            isFocused 
                              ? 'bg-gradient-to-r from-blue-50/70 to-indigo-50/40 border-blue-300 text-primary shadow-sm shadow-blue-500/5' 
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50/40 hover:border-slate-300'
                          }`}
                        >
                          <span className={`flex items-center justify-center w-5.5 h-5.5 rounded-full font-extrabold text-[10px] flex-shrink-0 mt-0.5 shadow-sm ${
                            isFocused ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`font-extrabold leading-none truncate ${isFocused ? 'text-primary' : 'text-slate-900'}`}>{stop.name}</p>
                              {isFocused && (
                                <span className="text-[8px] font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0">
                                  Selected
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1.5 truncate max-w-[200px]">{stop.address || 'No address details listed'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

      </div>
    </div>
  );
}
