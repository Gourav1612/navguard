'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Bus, MapPin, Compass, AlertCircle, CheckCircle } from 'lucide-react';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[220px] bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-medium">
      Loading Preview Map...
    </div>
  ),
});

export default function AdminAssignments() {
  const queryClient = useQueryClient();
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection states in form
  const [selectedBusId, setSelectedBusId] = useState('');
  const [selectedStopId, setSelectedStopId] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch students
  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const res = await fetch('/api/admin/students');
      if (!res.ok) throw new Error('Failed to load students roster');
      return res.json();
    },
  });

  // Fetch buses
  const { data: buses = [] } = useQuery({
    queryKey: ['admin-buses'],
    queryFn: async () => {
      const res = await fetch('/api/admin/buses');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch routes
  const { data: routes = [] } = useQuery({
    queryKey: ['admin-routes'],
    queryFn: async () => {
      const res = await fetch('/api/admin/routes');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Find route and stops linked to the selected bus
  const activeRoute = routes.find((r: any) => r.bus_id === selectedBusId);
  const stops = activeRoute?.stops || [];

  // Assignment Mutation
  const assignMutation = useMutation({
    mutationFn: async (payload: { student_id: string; bus_id: string; stop_id: string }) => {
      const res = await fetch('/api/admin/assignments/student-bus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update assignment');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setSuccessMessage('Student assignment updated successfully!');
      
      // Update local state details
      if (selectedStudent) {
        const matchingBus = buses.find((b: any) => b.id === selectedBusId);
        const matchingStop = stops.find((s: any) => s.id === selectedStopId);
        setSelectedStudent({
          ...selectedStudent,
          bus: matchingBus ? { id: matchingBus.id, name: matchingBus.name } : null,
          stop: matchingStop ? { id: matchingStop.id, name: matchingStop.name } : null,
        });
      }
      setTimeout(() => setSuccessMessage(null), 4000);
    },
    onError: (err: any) => {
      setErrorMessage(err.message);
      setTimeout(() => setErrorMessage(null), 4000);
    },
  });

  const handleSelectStudent = (student: any) => {
    setSelectedStudent(student);
    setSelectedBusId(student.bus?.id || '');
    setSelectedStopId(student.stop?.id || '');
    setSuccessMessage(null);
    setErrorMessage(null);
  };

  const handleBusChange = (busId: string) => {
    setSelectedBusId(busId);
    setSelectedStopId(''); // reset stop selection since stops list refreshes
  };

  const handleSaveAssignment = () => {
    if (!selectedStudent) return;
    setSuccessMessage(null);
    setErrorMessage(null);

    assignMutation.mutate({
      student_id: selectedStudent.id,
      bus_id: selectedBusId,
      stop_id: selectedStopId,
    });
  };

  const filteredStudents = students.filter((s: any) =>
    s.user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.roll_number?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (studentsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-medium text-sm">Mapping routes linkages...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Student-to-Bus Assignments</h2>
        <p className="text-slate-500 text-sm font-medium">Link student profiles to designated fleet vehicles and pickup stops on a route.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left student list: 5 cols */}
        <div className="lg:col-span-5 bg-white border border-slate-150 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[580px]">
          {/* Search bar */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search students by name, roll..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white font-medium text-slate-700"
              />
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredStudents.length === 0 ? (
              <p className="text-xs text-slate-400 italic p-6 text-center">No students found matching query.</p>
            ) : (
              filteredStudents.map((s: any) => {
                const isSelected = selectedStudent?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectStudent(s)}
                    className={`p-4 cursor-pointer hover:bg-slate-50/50 transition duration-150 flex flex-col gap-1.5 ${
                      isSelected ? 'bg-slate-100/60 border-l-4 border-primary' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800">{s.user?.full_name}</span>
                      <span className="font-mono text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded">
                        Grade {s.grade}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4 text-[10px] text-slate-500 mt-1">
                      <div className="flex items-center gap-1">
                        <Bus className="w-3.5 h-3.5 text-slate-400" />
                        <span className="truncate max-w-[100px]">{s.bus?.name || 'No Bus'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span className="truncate max-w-[120px]">{s.stop?.name || 'No Stop'}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right assignment editor panel: 7 cols */}
        <div className="lg:col-span-7 space-y-6">
          {selectedStudent ? (
            <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in duration-200">
              {/* Header */}
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-800">
                  Assign Transport: <span className="text-primary">{selectedStudent.user?.full_name}</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Grade {selectedStudent.grade} &middot; Roll No: {selectedStudent.roll_number}
                </p>
              </div>

              {/* Success / Error notification */}
              {successMessage && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-xs font-semibold">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}
              {errorMessage && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Form Selects */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Link Fleet Bus</label>
                  <select
                    value={selectedBusId}
                    onChange={(e) => handleBusChange(e.target.value)}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-700"
                  >
                    <option value="">No Bus Assigned</option>
                    {buses.map((bus: any) => (
                      <option key={bus.id} value={bus.id}>
                        {bus.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Designate Pickup Stop</label>
                  <select
                    value={selectedStopId}
                    onChange={(e) => setSelectedStopId(e.target.value)}
                    disabled={!selectedBusId}
                    className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white text-slate-700 disabled:opacity-50"
                  >
                    <option value="">Select Pickup Stop</option>
                    {stops.map((stop: any) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.name} (Stop {stop.stop_order})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Route Map Preview */}
              {selectedBusId ? (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Assigned Route Alignment Map:</span>
                  {stops.length > 0 ? (
                    <div className="h-[240px]">
                      <LiveMap
                        busId={selectedBusId}
                        stops={stops}
                        highlightStopId={stops.find((s: any) => s.id === selectedStopId)?.name}
                        showBus={false}
                      />
                    </div>
                  ) : (
                    <div className="h-[240px] bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                      <AlertCircle className="w-8 h-8 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold">No stops alignment found for this bus route.</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Please add stops in the Route Builder first.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-[240px] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                  <Compass className="w-10 h-10 text-slate-300 mb-2" />
                  <p className="text-xs font-semibold">Map Alignment Locked</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Select an operational bus unit to preview its geographic path.</p>
                </div>
              )}

              {/* Submit btn */}
              <div className="flex justify-end pt-4 border-t border-slate-100 mt-6">
                <button
                  onClick={handleSaveAssignment}
                  disabled={assignMutation.isPending}
                  className="flex items-center gap-1.5 px-6 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-bold transition hover:shadow-lg shadow-primary/25 cursor-pointer disabled:opacity-50"
                >
                  {assignMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Student Assignment
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-150 border-dashed rounded-2xl p-16 text-center shadow-sm flex flex-col items-center justify-center h-[320px]">
              <Compass className="w-14 h-14 text-slate-300 mb-3 animate-pulse" />
              <h3 className="text-slate-800 font-bold text-sm">Select Student</h3>
              <p className="text-slate-400 text-xs mt-1 max-w-[240px]">
                Click on a student in the left list panel to review or customize their bus mapping options.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
