'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Download, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { BatteryOptimization, AppUpdatePlugin } from '@/lib/capacitor-plugins';

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

  // Native update states
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [needsInstallPermission, setNeedsInstallPermission] = useState(false);

  useEffect(() => {
    // Only execute on native mobile platforms
    if (!Capacitor.isNativePlatform()) return;

    // --- Auto Battery Optimization Redirect (first launch only) ---
    const BATTERY_OPT_KEY = 'naviguard_battery_opt_shown';
    const alreadyShown = localStorage.getItem(BATTERY_OPT_KEY);
    if (!alreadyShown) {
      setTimeout(async () => {
        try {
          const statusResult = await BatteryOptimization.isIgnoringBatteryOptimizations();
          if (!statusResult?.value) {
            await BatteryOptimization.requestIgnoreBatteryOptimization();
          }
          localStorage.setItem(BATTERY_OPT_KEY, 'true');
        } catch (err) {
          console.error('Failed to request battery optimization on launch:', err);
        }
      }, 1500);
    }

    // --- Version Update Check ---
    const checkUpdate = async () => {
      try {
        const res = await fetch('/version.json');
        if (!res.ok) return;
        const data = await res.json();

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

  const handleUpdate = async () => {
    try {
      setDownloadError(null);
      
      // 1. Check for Unknown Sources Package Install permission on Android 8+
      const { allowed } = await AppUpdatePlugin.canRequestPackageInstalls();
      if (!allowed) {
        setNeedsInstallPermission(true);
        return;
      }

      // 2. Trigger Download
      setIsDownloading(true);
      setDownloadProgress(0);

      // Listen to progress events from native side
      const progressListener = await AppUpdatePlugin.addListener('downloadProgress', (data: { progress: number }) => {
        setDownloadProgress(Math.round(data.progress * 100));
      });

      const apkUrl = `${window.location.origin}/NaviGuard.apk`;
      
      try {
        await AppUpdatePlugin.downloadAndInstallApk({ url: apkUrl });
      } catch (err: any) {
        throw new Error(err.message || 'Failed to download and execute update APK installer.');
      } finally {
        progressListener.remove();
      }

    } catch (err: any) {
      console.error('Failed to run update process:', err);
      setDownloadError(err.message || 'Failed to complete update download.');
      setIsDownloading(false);
    }
  };

  const handleOpenSettings = async () => {
    try {
      await AppUpdatePlugin.openInstallSettings();
      setNeedsInstallPermission(false);
      // Let user click Update again after enabling
    } catch (err) {
      console.error('Failed to open settings:', err);
    }
  };

  if (!isUpdateAvailable) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />

      {/* Glassmorphic Alert Box */}
      <div className="relative bg-[#130b24]/90 border border-purple-500/20 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-5 animate-in zoom-in-95 duration-250">
        
        {needsInstallPermission ? (
          // Install permission prompt UI
          <>
            <div className="mx-auto w-14 h-14 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-400">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest block">permission required</span>
              <h3 className="text-lg font-black text-white leading-tight">Allow App Installation</h3>
              <p className="text-slate-400 text-xs leading-relaxed font-medium">
                To perform updates directly within the application, please enable the **"Allow unknown app installs"** permission for NaviGuard.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleOpenSettings}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-95 text-white text-xs font-black uppercase tracking-widest rounded-xl transition shadow-lg shadow-amber-500/25 active:scale-[0.99] cursor-pointer"
              >
                Open Settings
              </button>
              
              <button
                onClick={() => setNeedsInstallPermission(false)}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-350 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
              >
                Go Back
              </button>
            </div>
          </>
        ) : isDownloading ? (
          // Downloading Progress UI
          <>
            <div className="mx-auto w-14 h-14 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-center justify-center text-purple-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest block">downloading update</span>
              <h3 className="text-lg font-black text-white leading-tight">Downloading Files...</h3>
              <p className="text-slate-400 text-xs leading-relaxed font-medium">
                Downloading latest release package. Please do not close the app.
              </p>
            </div>

            {/* Premium Progress Bar */}
            <div className="space-y-2">
              <div className="w-full h-2.5 bg-purple-950/40 border border-purple-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-purple-300 font-bold">
                <span>PROGRESS</span>
                <span>{downloadProgress}%</span>
              </div>
            </div>
          </>
        ) : (
          // Standard Update Alert UI
          <>
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

            {downloadError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center space-y-1 text-[10px] text-red-300 font-bold flex flex-col items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>{downloadError}</span>
              </div>
            )}

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
          </>
        )}
      </div>
    </div>
  );
}
