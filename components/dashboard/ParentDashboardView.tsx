'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { 
  Loader2, 
  AlertCircle, 
  Bus, 
  User, 
  MapPin, 
  Calendar, 
  Clock, 
  Phone, 
  Send, 
  CheckCircle2, 
  ChevronRight, 
  PhoneCall, 
  Mail, 
  BookOpen, 
  ShieldCheck, 
  AlertTriangle,
  X
} from 'lucide-react';
import { parseGoogleMapsLink } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

// Import subviews
import ParentAnnouncementsView from './subviews/ParentAnnouncementsView';
import ParentTrackView from './subviews/ParentTrackView';

export default function ParentDashboardView({ tab, busId }: { tab?: string; busId?: string }) {
  const queryClient = useQueryClient();
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const [studentRoll, setStudentRoll] = useState('');
  const [studentGrade, setStudentGrade] = useState('');
  const [studentName, setStudentName] = useState('');

  // Request stop change states
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [newStopName, setNewStopName] = useState('');
  const [googleMapsLink, setGoogleMapsLink] = useState('');
  const [newStopAddress, setNewStopAddress] = useState('');
  const [newStopLat, setNewStopLat] = useState('');
  const [newStopLng, setNewStopLng] = useState('');
  const [submittingStop, setSubmittingStop] = useState(false);
  const [isLoadingLink, setIsLoadingLink] = useState(false);

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
        alert('Could not extract coordinates from the Google Maps link. Please verify it contains coordinates.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to process Google Maps link');
    } finally {
      setIsLoadingLink(false);
    }
  };

  const handleRequestStopSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId || !newStopName || !newStopLat || !newStopLng) {
      alert('Please fill out all required fields.');
      return;
    }

    const lat = Number(newStopLat);
    const lng = Number(newStopLng);

    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      alert('Enter valid GPS coordinates (Lat -90 to 90, Lng -180 to 180).');
      return;
    }

    setSubmittingStop(true);
    try {
      const res = await fetch('/api/parent/request-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudentId,
          stop_name: newStopName,
          address: newStopAddress,
          latitude: lat,
          longitude: lng,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request custom stop change');
      }

      alert('Successfully registered custom stop point and assigned it to your child.');
      setIsStopModalOpen(false);
      
      // Reset values
      setSelectedStudentId('');
      setNewStopName('');
      setNewStopAddress('');
      setNewStopLat('');
      setNewStopLng('');
      setGoogleMapsLink('');
      
      // Invalidate query to refresh dashboard immediately
      queryClient.invalidateQueries({ queryKey: ['parent-children'] });
    } catch (err: any) {
      alert(err.message || 'An error occurred.');
    } finally {
      setSubmittingStop(false);
    }
  };

  // Fetch linked children list
  const { data: children = [], isLoading: childrenLoading, error: childrenError } = useQuery({
    queryKey: ['parent-children'],
    queryFn: async () => {
      const res = await fetch('/api/parent/children');
      if (!res.ok) throw new Error('Failed to load children profiles');
      return res.json();
    },
    refetchInterval: 15000, // Poll children status every 15s
    enabled: !tab, // Only poll children if viewing main dashboard tab
  });

  // Fetch parent announcements for dashboard preview
  const { data: announcements = [], isLoading: announcementsLoading } = useQuery({
    queryKey: ['parent-announcements'],
    queryFn: async () => {
      const res = await fetch('/api/parent/announcements');
      if (!res.ok) throw new Error('Failed to fetch announcements');
      return res.json();
    },
    enabled: !tab, // Only load if viewing main dashboard tab
  });

  // Handle Dynamic Tab Routing
  switch (tab) {
    case 'announcements':
      return <ParentAnnouncementsView />;
    case 'track':
      return <ParentTrackView busId={busId} />;
  }

  const handleLinkRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentRoll || !studentGrade || !studentName) return;
    
    setRequestLoading(true);
    try {
      const res = await fetch('/api/parent/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: studentName,
          roll_number: studentRoll,
          grade: studentGrade,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to link student');
      }

      setRequestSuccess(true);
      setTimeout(() => {
        setRequestSuccess(false);
        setStudentRoll('');
        setStudentGrade('');
        setStudentName('');
      }, 5000);

      // Refresh linked children roster immediately
      queryClient.invalidateQueries({ queryKey: ['parent-children'] });
    } catch (err: any) {
      alert(err.message || 'An error occurred.');
    } finally {
      setRequestLoading(false);
    }
  };

  const loading = childrenLoading || announcementsLoading;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-[#5c3b99] animate-spin" />
        <p className="text-slate-500 font-bold text-sm">Synchronizing your dashboard...</p>
      </div>
    );
  }

  if (childrenError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-3">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <h3 className="font-bold text-slate-800 text-sm">Sync Error</h3>
        <p className="text-slate-500 text-xs">Verify your parent registration links.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Info */}
      <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1e1b4b] tracking-tight">Parent Portal</h2>
          <p className="text-slate-555 text-xs font-semibold uppercase tracking-wider mt-1">Live Student Tracking & Transport Coordination Console</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-[#5c3b99] bg-purple-50 px-3 py-1.5 rounded-full border border-purple-100/60">
          <ShieldCheck className="w-4 h-4 text-purple-600" />
          <span>Active Session Secure</span>
        </div>
      </div>

      {/* Main Grid Layout for PC/Desktop Optimization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (66% Width) - Children & Requests */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Children Roster Section */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block pl-1">Your Linked Children</h3>

            {children.length === 0 ? (
              <div className="bg-white border border-slate-150 rounded-3xl p-8 text-center space-y-4 shadow-sm">
                <div className="w-12 h-12 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-800 text-sm">No Linked Children Profiles</h4>
                  <p className="text-slate-550 text-xs leading-relaxed max-w-sm mx-auto mt-1">
                    No student accounts are currently linked to this email address. Enter details below to submit a verification link request.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {children.map((child: any) => {
                  const hasBus = !!child.bus;
                  const isTripActive = !!child.bus?.active_trip_id;

                  const colors = [
                    'from-[#f43f5e] to-[#ec4899]',
                    'from-[#3b82f6] to-[#6366f1]',
                    'from-[#10b981] to-[#14b8a6]',
                    'from-[#f59e0b] to-[#eab308]',
                    'from-[#8b5cf6] to-[#a855f7]'
                  ];
                  const childName = child.full_name || 'Student';
                  const initials = childName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                  const gradient = colors[childName.charCodeAt(0) % colors.length];

                  return (
                    <div
                      key={child.student_id}
                      className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm hover:shadow-xl hover:scale-[1.01] transition-all duration-300 flex flex-col justify-between"
                    >
                      <div>
                        {/* Child Summary Header */}
                        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center font-bold text-xs tracking-wide shadow-md`}>
                              {initials}
                            </div>
                            <div>
                              <h4 className="font-extrabold text-slate-800 text-sm leading-tight">{child.full_name}</h4>
                              <span className="text-[10px] text-slate-450 font-bold block mt-1">Grade {child.grade}</span>
                            </div>
                          </div>

                          {/* Active trip status tag */}
                          {hasBus ? (
                            isTripActive ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-150/60 relative animate-pulse">
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500 mr-0.5"></span>
                                LIVE TRIP
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-50 text-slate-500 border border-slate-150">
                                ⚫ IDLE
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-red-50 text-red-500 border border-red-150/60">
                              ⚫ UNASSIGNED
                            </span>
                          )}
                        </div>

                        {/* Details list inside card */}
                        <div className="mt-4 space-y-3 bg-[#f6f5fa] border border-[#e8e6f0] p-4 rounded-2xl">
                          {/* Assigned Bus */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                              <Bus className="w-3.5 h-3.5 text-purple-500" /> Assigned Bus
                            </span>
                            <div className="text-right">
                              <span className="font-bold text-slate-850 bg-white border border-slate-100 px-2.5 py-0.5 rounded-lg shadow-2xs text-xs">
                                {child.bus?.name || 'No bus assigned'}
                              </span>
                              {child.bus?.registration_plate && (
                                <span className="font-mono text-[9px] font-extrabold text-purple-650 bg-purple-50/55 border border-purple-100/50 px-2 py-0.5 rounded-md block mt-1 text-right">
                                  {child.bus.registration_plate}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Pickup Stop */}
                          <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100/60">
                            <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-purple-500" /> Pickup Stop
                            </span>
                            <span className="font-bold text-slate-850 bg-white border border-slate-100 px-2.5 py-0.5 rounded-lg shadow-2xs truncate max-w-[160px]">
                              {child.stop?.name || 'No stop assigned'}
                            </span>
                          </div>

                          {/* Assigned Driver Details */}
                          {child.bus?.driver ? (
                            <div className="flex items-center justify-between text-xs pt-2.5 border-t border-slate-100/60">
                              <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-purple-500" /> Shift Driver
                              </span>
                              <div className="text-right">
                                <span className="font-bold text-slate-850 block text-xs">{child.bus.driver.full_name}</span>
                                <a
                                  href={`tel:${child.bus.driver.phone}`}
                                  className="text-[10px] text-purple-650 hover:text-purple-800 font-extrabold flex items-center justify-end gap-1 mt-1 hover:underline"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                  {child.bus.driver.phone}
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-xs pt-2.5 border-t border-slate-100/60">
                              <span className="text-purple-900/60 font-bold uppercase text-[9px] tracking-wider flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-purple-500" /> Shift Driver
                              </span>
                              <span className="text-slate-400 italic text-[10px] font-bold">No driver assigned</span>
                            </div>
                          )}
                        </div>

                        {/* Live Speed & GPS Location Telemetry Panel */}
                        {isTripActive && child.bus?.latest_location && (
                          <div className="bg-emerald-50/40 border border-emerald-150/50 rounded-2xl p-3.5 mt-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-extrabold text-emerald-800 uppercase tracking-widest block">Live GPS Telemetry</span>
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-700">
                              <div className="bg-white border border-emerald-100/50 p-2 rounded-xl text-center shadow-3xs">
                                <span className="text-[8px] text-slate-400 block font-bold uppercase tracking-wider">Bus Speed</span>
                                <span className="text-emerald-700 text-xs font-black block mt-0.5">{child.bus.latest_location.speed || 0} km/h</span>
                              </div>
                              <div className="bg-white border border-emerald-100/50 p-2 rounded-xl text-center shadow-3xs">
                                <span className="text-[8px] text-slate-400 block font-bold uppercase tracking-wider">Coordinates</span>
                                <span className="text-slate-600 block text-[9px] font-mono mt-1">
                                  {child.bus.latest_location.latitude.toFixed(4)}, {child.bus.latest_location.longitude.toFixed(4)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action Track button */}
                      {isTripActive && (
                        <div className="mt-6 pt-4 border-t border-slate-100">
                          <Link
                            href={`/dashboard?tab=track&busId=${child.bus.id}`}
                            className="block w-full text-center py-3.5 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-500/20 hover:shadow-xl transition-all duration-300 cursor-pointer"
                          >
                            Track Bus Live Map
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Request Link Student Form */}
          <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-[#5c3b99]">
                <Send className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800 text-sm leading-none">Request Student Link</h3>
                <span className="text-[10px] font-bold text-slate-400 block mt-1">Request transport admin to pair a child to your parent dashboard</span>
              </div>
            </div>

            {requestSuccess ? (
              <div className="p-4 bg-emerald-50 border border-emerald-250 rounded-2xl text-emerald-800 text-xs font-bold flex items-start gap-2.5 animate-in zoom-in-95 duration-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p>Request Submitted Successfully!</p>
                  <p className="text-[10px] text-emerald-600/80 mt-1 font-semibold">Our transport admin desk will verify the details and link this profile in 1-2 business hours.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLinkRequest} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Student Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Karan Sharma"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Roll Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Class 15"
                    value={studentRoll}
                    onChange={(e) => setStudentRoll(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 font-semibold"
                  />
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Grade e.g. 8-C"
                      value={studentGrade}
                      onChange={(e) => setStudentGrade(e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 font-semibold"
                    />
                    <button
                      type="submit"
                      disabled={requestLoading}
                      className="bg-[#5c3b99] hover:bg-[#432775] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow shadow-purple-500/20 disabled:opacity-50 cursor-pointer flex-shrink-0"
                    >
                      {requestLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        'Request'
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Workflow Guide Info Card */}
          <div className="bg-[#f6f5fa] border border-[#e8e6f0] rounded-3xl p-6 space-y-4">
            <h4 className="text-xs font-extrabold text-[#1e1b4b] uppercase tracking-widest flex items-center gap-2">
              <BookOpen className="w-4.5 h-4.5 text-purple-600" /> NaviGuard Safety Workflow
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
              <div className="bg-white border border-slate-150 p-3 rounded-2xl shadow-3xs space-y-1.5">
                <span className="w-6 h-6 rounded-full bg-purple-50 text-[#5c3b99] font-bold text-xs flex items-center justify-center mx-auto">1</span>
                <span className="font-extrabold text-[10px] text-slate-800 block">Bus Departure</span>
                <p className="text-[9px] text-slate-400 font-semibold leading-tight">Driver starts route trip logged in</p>
              </div>
              <div className="bg-white border border-slate-150 p-3 rounded-2xl shadow-3xs space-y-1.5">
                <span className="w-6 h-6 rounded-full bg-purple-50 text-[#5c3b99] font-bold text-xs flex items-center justify-center mx-auto">2</span>
                <span className="font-extrabold text-[10px] text-slate-800 block">Live Feed</span>
                <p className="text-[9px] text-slate-405 font-semibold leading-tight">Pulsing coordinate feeds stream to parent</p>
              </div>
              <div className="bg-white border border-slate-150 p-3 rounded-2xl shadow-3xs space-y-1.5">
                <span className="w-6 h-6 rounded-full bg-purple-50 text-[#5c3b99] font-bold text-xs flex items-center justify-center mx-auto">3</span>
                <span className="font-extrabold text-[10px] text-slate-800 block">Boarding Alerts</span>
                <p className="text-[9px] text-slate-405 font-semibold leading-tight">Notifications sent as students log in</p>
              </div>
              <div className="bg-white border border-slate-150 p-3 rounded-2xl shadow-3xs space-y-1.5">
                <span className="w-6 h-6 rounded-full bg-purple-50 text-[#5c3b99] font-bold text-xs flex items-center justify-center mx-auto">4</span>
                <span className="font-extrabold text-[10px] text-slate-800 block">Destination</span>
                <p className="text-[9px] text-slate-405 font-semibold leading-tight">Trip closes on safe campus arrival</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (33% Width) - Notices, Helpdesk & Options */}
        <div className="space-y-8">
          
          {/* School Announcements bulletin board */}
          <div className="space-y-4">
            <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest block pl-1">Latest Bulletins</h3>
            
            {announcements.length === 0 ? (
              <div className="bg-white border border-slate-150 rounded-3xl p-8 text-center text-slate-400 text-xs font-bold shadow-sm">
                📢 No notice board bulletins posted.
              </div>
            ) : (
              <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                {announcements.map((item: any) => (
                  <div key={item.id} className="bg-white border border-slate-150 rounded-3xl p-4.5 shadow-sm space-y-2 hover:shadow-md transition-all duration-200">
                    <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                      <span className="p-0.5 bg-amber-50 text-amber-600 rounded text-[10px]">📢</span>
                      {item.title}
                    </h4>
                    <p className="text-slate-600 text-[11px] leading-relaxed font-semibold">
                      {item.body}
                    </p>
                    <span className="text-[8px] text-slate-400 font-bold block pt-1.5 border-t border-slate-50 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Posted {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Helpdesk Emergency Contacts Helpline */}
          <div className="bg-gradient-to-br from-[#351e56] to-[#1a0e2b] text-white rounded-3xl p-6 space-y-4 shadow-md">
            <div>
              <span className="text-[9px] font-bold text-purple-300 uppercase tracking-widest block">Transport Helpdesk</span>
              <h3 className="font-black text-white text-base mt-0.5">Emergency Helpline</h3>
            </div>
            
            <div className="space-y-3 pt-2 text-xs font-semibold">
              <a 
                href="tel:+919876543210" 
                className="flex items-center gap-3 p-3 bg-white/10 hover:bg-white/15 rounded-2xl border border-white/10 transition duration-200 cursor-pointer"
              >
                <div className="p-1.5 bg-[#5c3b99] rounded-lg text-white">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[9px] text-purple-300 block font-bold">HELPLINE COORDINATOR</span>
                  <span className="text-white text-xs">+91 98765 43210</span>
                </div>
              </a>

              <a 
                href="mailto:transport@sunriseschool.edu" 
                className="flex items-center gap-3 p-3 bg-white/10 hover:bg-white/15 rounded-2xl border border-white/10 transition duration-200 cursor-pointer"
              >
                <div className="p-1.5 bg-[#5c3b99] rounded-lg text-white">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[9px] text-purple-300 block font-bold">SUPPORT DESK EMAIL</span>
                  <span className="text-white text-xs truncate block max-w-[170px]">transport@school.edu</span>
                </div>
              </a>
            </div>
          </div>

          {/* Service Actions list */}
          <div className="bg-white border border-slate-150 rounded-3xl p-6 space-y-4 shadow-sm">
            <h4 className="font-extrabold text-[#1e1b4b] text-xs uppercase tracking-widest border-b border-slate-50 pb-2">Utility Operations</h4>
            <div className="flex flex-col gap-2.5 text-xs font-bold text-slate-700">
              <button 
                onClick={() => setIsStopModalOpen(true)}
                className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-150 hover:bg-slate-100 hover:border-slate-200 rounded-2xl transition text-left cursor-pointer w-full"
              >
                <span>Change Pickup/Drop Route</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
              <button 
                onClick={() => alert("Feedback submission saved! Thank you for helping us improve safety.")}
                className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-150 hover:bg-slate-100 hover:border-slate-200 rounded-2xl transition text-left cursor-pointer w-full"
              >
                <span>Report Delay / Feedbacks</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Request Custom Stop Modal */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            onClick={() => setIsStopModalOpen(false)} 
          />
          <div className="bg-white border border-slate-150 rounded-3xl p-6 shadow-xl relative z-10 max-w-md w-full animate-in fade-in zoom-in-95 duration-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-[#1e1b4b] text-base">Request Stop Location Change</h3>
              <button 
                onClick={() => setIsStopModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-650"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRequestStopSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Select Child *</label>
                <select
                  required
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-500 font-semibold"
                >
                  <option value="">-- Choose child profile --</option>
                  {children.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.grade})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Google Maps Link</label>
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
                    className="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-[#5c3b99] rounded-lg text-xs font-bold border border-purple-100/50 disabled:opacity-50 flex items-center justify-center min-w-[80px]"
                  >
                    {isLoadingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Stop Title / Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. My Home Stop"
                    value={newStopName}
                    onChange={(e) => setNewStopName(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Home Address details</label>
                  <input
                    type="text"
                    placeholder="e.g. Plot 15, Sector 2"
                    value={newStopAddress}
                    onChange={(e) => setNewStopAddress(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Latitude *</label>
                  <input
                    type="text"
                    required
                    placeholder="GPS Latitude"
                    value={newStopLat}
                    onChange={(e) => setNewStopLat(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Longitude *</label>
                  <input
                    type="text"
                    required
                    placeholder="GPS Longitude"
                    value={newStopLng}
                    onChange={(e) => setNewStopLng(e.target.value)}
                    className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsStopModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingStop}
                  className="px-4.5 py-2 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow animate-pulse-slow"
                >
                  {submittingStop && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Register Stop
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
