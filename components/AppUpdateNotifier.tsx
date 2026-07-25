'use client';

import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Download } from 'lucide-react';

const BatteryOptimization = registerPlugin<any>('BatteryOptimization');

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

export default function AppUpdateNotifier() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    // Only execute on native mobile platforms
    if (!Capacitor.isNativePlatform()) return;

    // --- Auto Battery Optimization Redirect (first launch only) ---
    const BATTERY_OPT_KEY = 'naviguard_battery_opt_shown';
    const alreadyShown = localStorage.getItem(BATTERY_OPT_KEY);
    if (!alreadyShown) {
      // Small delay so app UI is ready before opening settings
      setTimeout(async () => {
        try {
          await BatteryOptimization.openBatterySettings();
          localStorage.setItem(BATTERY_OPT_KEY, 'true');
        } catch (err) {
          console.error('Failed to open battery settings on launch:', err);
        }
      }, 1500);
    }

    // --- Version Update Check ---
    const checkUpdate = async () => {
      try {
        const res = await fetch('/version.json');
        if (!res.ok) return;
        const data = await res.json();

        // Fetch local Capacitor app build info
        const info = await App.getInfo();
        const nativeVersion = info.version;
        const remoteVersion = data.version;

        setCurrentVersion(nativeVersion);
        setLatestVersion(remoteVersion);

        if (compareVersions(remoteVersion, nativeVersion) > 0) {
          setIsUpdateAvailable(true);
        }
      } catch (err) {
        console.error('Failed to run app update checking sequence:', err);
      }
    };

    checkUpdate();
  }, []);

  const handleUpdate = () => {
    // Open Vercel hosted APK directly in system browser for download/installation
    const apkUrl = `${window.location.origin}/NaviGuard.apk`;
    window.open(apkUrl, '_system');
  };

  if (!isUpdateAvailable) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />

      {/* Glassmorphic Alert Box */}
      <div className="relative bg-[#130b24]/90 border border-purple-500/20 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-5 animate-in zoom-in-95 duration-250">
        
        {/* Floating animated icon */}
        <div className="mx-auto w-14 h-14 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-center justify-center text-purple-400 relative">
          <Download className="w-6 h-6 animate-bounce" />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
          </span>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest block">new release available</span>
          <h3 className="text-lg font-black text-white leading-tight">Update NaviGuard App</h3>
          <p className="text-slate-400 text-xs leading-relaxed font-medium">
            Version <span className="text-white font-bold">{latestVersion}</span> is now available. Please update the application to ensure live telemetry, ETAs, and geofencing remain fully operational.
          </p>
        </div>

        <div className="bg-purple-950/30 border border-purple-900/30 rounded-xl p-3 text-left space-y-1 text-[10px] text-purple-200 font-semibold font-mono">
          <div className="flex justify-between">
            <span>Installed Version:</span>
            <span className="text-slate-400 font-normal">{currentVersion}</span>
          </div>
          <div className="flex justify-between">
            <span>Latest Release:</span>
            <span className="text-emerald-400 font-bold">{latestVersion}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={handleUpdate}
            className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white text-xs font-black uppercase tracking-widest rounded-xl transition shadow-lg shadow-purple-500/25 active:scale-[0.99] cursor-pointer"
          >
            Update Now
          </button>
          
          <button
            onClick={() => setIsUpdateAvailable(false)}
            className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-350 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
          >
            Remind Me Later
          </button>
        </div>
      </div>
    </div>
  );
}
