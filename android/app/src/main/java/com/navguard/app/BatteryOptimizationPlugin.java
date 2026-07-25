package com.navguard.app;

import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    /**
     * Returns whether battery optimization is currently disabled for this app.
     * Call this first to avoid showing the dialog repeatedly.
     */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("value", ignoring);
        call.resolve(result);
    }

    /**
     * Shows a system-level popup dialog:
     *   "Allow NaviGuard to always run in the background?"
     *   [Deny]  [Allow]
     *
     * The user only needs to tap "Allow" — no settings navigation required.
     * Requires android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimization(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            String pkg = getContext().getPackageName();

            // Already granted → nothing to do
            if (pm != null && pm.isIgnoringBatteryOptimizations(pkg)) {
                JSObject result = new JSObject();
                result.put("alreadyGranted", true);
                call.resolve(result);
                return;
            }

            // Show the direct "Allow always-on background?" system dialog
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("alreadyGranted", false);
            call.resolve(result);
        } catch (Exception e) {
            // Fallback to the general battery settings page on unsupported devices
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Could not open battery settings: " + ex.getMessage());
            }
        }
    }
}

