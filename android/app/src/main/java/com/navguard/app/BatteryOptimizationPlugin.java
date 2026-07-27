package com.navguard.app;

import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationCompat;

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

    /**
     * Opens a URL directly in the Android system web browser.
     * This is useful for trigger file downloads (like APKs) which are blocked inside standard WebViews.
     */
    @PluginMethod
    public void openSystemBrowser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing parameter: url");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open system browser: " + e.getMessage());
        }
    }

    /**
     * Triggers a native system local notification.
     * Useful for showing alerts on modern Android versions inside WebViews.
     */
    @PluginMethod
    public void showLocalNotification(PluginCall call) {
        String title = call.getString("title");
        String message = call.getString("message");
        if (title == null || message == null) {
            call.reject("Missing title or message");
            return;
        }

        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            String channelId = "admin_alerts_channel";

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        channelId,
                        "Admin Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("System notifications for admin portal alerts");
                if (manager != null) {
                    manager.createNotificationChannel(channel);
                }
            }

            Intent intent = new Intent(getContext(), MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    getContext(), 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channelId)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH);

            if (manager != null) {
                int id = (title + message).hashCode();
                manager.notify(id, builder.build());
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to show local notification: " + e.getMessage());
        }
    }
}

