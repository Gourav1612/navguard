import { Capacitor, registerPlugin } from '@capacitor/core';

// Safe singleton plugin registrations
export const LocationService = registerPlugin<any>('LocationService');
export const BatteryOptimization = registerPlugin<any>('BatteryOptimization');
export const BackgroundGeolocation = registerPlugin<any>('BackgroundGeolocation');
export const AppUpdatePlugin = registerPlugin<any>('AppUpdatePlugin');

/**
 * Safe helper to notify native LocationService only when running on Android/iOS
 */
export async function safeSetDriverStatus(isDriver: boolean): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocationService.setDriverStatus({ isDriver });
    } catch (err) {
      console.warn('Native LocationService.setDriverStatus error:', err);
    }
  }
}

export function getProductionEndpoint(path: string = '/api/worker/location'): string {
  if (
    typeof window !== 'undefined' &&
    window.location.origin &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('capacitor://') &&
    !window.location.origin.includes('127.0.0.1')
  ) {
    return `${window.location.origin}${path}`;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://navguard-eight.vercel.app';
  return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * Safe helper to persist credentials to native storage for background status polling
 */
export async function safeSaveTrackingCredentials(token: string, userId: string, serverUrl?: string, refreshToken?: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const endpoint = serverUrl || getProductionEndpoint('/api/worker/location');
      await LocationService.saveTrackingCredentials({
        token,
        refreshToken: refreshToken || '',
        userId,
        serverUrl: endpoint,
      });
    } catch (err) {
      console.warn('Native LocationService.saveTrackingCredentials error:', err);
    }
  }
}

/**
 * Safe helper to stop native Android emergency alarm and vibration
 */
export async function safeStopNativeAlarm(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocationService.stopNativeAlarm();
    } catch (err) {
      console.warn('Native LocationService.stopNativeAlarm error:', err);
    }
  }
}

