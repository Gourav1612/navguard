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

/**
 * Safe helper to check battery optimization only on native platforms
 */
export async function safeCheckBatteryOptimization(): Promise<any> {
  if (Capacitor.isNativePlatform()) {
    try {
      return await BatteryOptimization.check();
    } catch (err) {
      console.warn('Native BatteryOptimization.check error:', err);
      return null;
    }
  }
  return null;
}
