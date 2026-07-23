'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Loader2, Settings, MapPin, Globe, Save, Info, CheckCircle2, AlertTriangle, Link2 } from 'lucide-react';
import dynamic from 'next/dynamic';

const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[280px] bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 font-medium">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin mr-2" />
      Loading Map view...
    </div>
  ),
});

export default function SettingsView() {
  const supabase = createBrowserSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [schoolAddress, setSchoolAddress] = useState('');
  const [latitude, setLatitude] = useState<number>(27.5609);
  const [longitude, setLongitude] = useState<number>(76.6111);

  // Link parsing states
  const [inputMode, setInputMode] = useState<'link' | 'manual'>('link');
  const [mapsLink, setMapsLink] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadSchoolData() {
      try {
        // Fetch current user details
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();

        if (profile?.school_id) {
          setSchoolId(profile.school_id);
          
          // Fetch school details
          const { data: school } = await supabase
            .from('schools')
            .select('*')
            .eq('id', profile.school_id)
            .single();

          if (school) {
            setSchoolName(school.name || '');
            setSchoolAddress(school.address || '');
            if (school.latitude !== undefined && school.latitude !== null) {
              setLatitude(Number(school.latitude));
            }
            if (school.longitude !== undefined && school.longitude !== null) {
              setLongitude(Number(school.longitude));
            }
          }
        }
      } catch (err) {
        console.error('Failed to load settings data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSchoolData();
  }, [supabase]);

  function parseCoordinates(url: string): { latitude: number; longitude: number } | null {
    // 1. Check for @lat,lng format
    const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      return {
        latitude: parseFloat(atMatch[1]),
        longitude: parseFloat(atMatch[2]),
      };
    }

    // 2. Check for query parameter format (e.g. query=lat,lng or q=lat,lng)
    const qMatch = url.match(/[?&](query|q)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) {
      return {
        latitude: parseFloat(qMatch[2]),
        longitude: parseFloat(qMatch[3]),
      };
    }

    return null;
  }

  const handleResolveLink = async () => {
    if (!mapsLink.trim()) return;
    setErrorMsg(null);
    setResolvingLink(true);

    try {
      // 1. Call API to follow redirects and get expanded URL
      const res = await fetch(`/api/resolve-map-link?url=${encodeURIComponent(mapsLink.trim())}`);
      const data = await res.json();
      
      if (!res.ok || !data.expandedUrl) {
        throw new Error(data.error || 'Failed to expand link');
      }

      // 2. Parse coordinates from the expanded URL
      const coords = parseCoordinates(data.expandedUrl);
      if (!coords) {
        throw new Error('Could not extract coordinates from the Google Maps link. Please enter them manually.');
      }

      setLatitude(coords.latitude);
      setLongitude(coords.longitude);
      setSuccessMsg('Coordinates successfully extracted from Google Maps link!');
      
      // Auto clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resolve link.');
    } finally {
      setResolvingLink(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId) return;

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const { error } = await supabase
        .from('schools')
        .update({
          name: schoolName,
          address: schoolAddress,
          latitude,
          longitude,
        })
        .eq('id', schoolId);

      if (error) throw error;

      setSuccessMsg('School profile and location settings updated successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-slate-500 font-semibold text-sm">Loading settings panels...</p>
      </div>
    );
  }

  const mapStops = [
    {
      id: 'school',
      name: `🏫 ${schoolName || 'School'}`,
      latitude,
      longitude,
      stop_order: 0,
      address: schoolAddress,
    }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
      <div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" /> System Settings
        </h2>
        <p className="text-slate-500 text-sm font-medium">
          Configure school identity, geo-campus coordinates, and client routing defaults.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left column: Form */}
        <form onSubmit={handleSaveSettings} className="lg:col-span-3 space-y-6 bg-white border border-slate-150 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 border-b pb-3 border-slate-100 flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-500" /> School Campus Profile
          </h3>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-250 rounded-xl text-emerald-800 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">School Name</label>
              <input
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Enter official school name"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Campus Address</label>
              <input
                type="text"
                required
                value={schoolAddress}
                onChange={(e) => setSchoolAddress(e.target.value)}
                placeholder="Enter campus address"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
              />
            </div>

            {/* Coordinates Input Tab selection */}
            <div className="border-t border-slate-100 pt-4 mt-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Campus Coordinates</label>
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit mb-4">
                <button
                  type="button"
                  onClick={() => setInputMode('link')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    inputMode === 'link' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Google Maps Link
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    inputMode === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Manual Input
                </button>
              </div>

              {inputMode === 'link' ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="url"
                        value={mapsLink}
                        onChange={(e) => setMapsLink(e.target.value)}
                        placeholder="Paste Google Maps share link (e.g. https://maps.app.goo.gl/...)"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                      />
                      <Link2 className="w-4 h-4 text-slate-400 absolute left-4.5 top-1/2 -translate-y-1/2" />
                    </div>
                    <button
                      type="button"
                      disabled={resolvingLink || !mapsLink.trim()}
                      onClick={handleResolveLink}
                      className="px-4 py-3 bg-[#5c3b99] hover:bg-[#432775] text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm shadow-purple-500/10 cursor-pointer disabled:opacity-50"
                    >
                      {resolvingLink ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Extract'
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                    Open Google Maps, search for your school, click Share, copy the link, and paste it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={latitude}
                      onChange={(e) => setLatitude(Number(e.target.value))}
                      placeholder="e.g. 27.5609"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={longitude}
                      onChange={(e) => setLongitude(Number(e.target.value))}
                      placeholder="e.g. 76.6111"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-purple-500 rounded-xl text-sm font-medium focus:outline-none transition"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Configuration
            </button>
          </div>
        </form>

        {/* Right column: Map preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <MapPin className="w-4.5 h-4.5 text-red-500" /> Geographic Location Preview
            </h3>
            <div className="h-[280px] rounded-xl overflow-hidden border border-slate-150">
              <LiveMap
                busId="dummy"
                stops={mapStops}
                initialLocation={{ latitude, longitude }}
                showBus={false}
                focusLocation={{ latitude, longitude }}
              />
            </div>
            <div className="text-[10px] text-slate-400 font-medium leading-relaxed flex items-start gap-1 p-2 bg-slate-50 rounded-xl">
              <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>Current coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
