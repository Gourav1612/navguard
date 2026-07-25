package com.navguard.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocationService")
public class LocationServicePlugin extends Plugin {

    /**
     * Called from JavaScript when the driver starts a trip.
     * Stores credentials in SharedPreferences so the native service
     * can access them even after the WebView is killed.
     */
    @PluginMethod
    public void startTracking(PluginCall call) {
        String token = call.getString("token");
        String busId = call.getString("busId");
        String tripId = call.getString("tripId", "");
        String serverUrl = call.getString("serverUrl");

        if (token == null || token.isEmpty()) {
            call.reject("Missing required parameter: token");
            return;
        }
        if (busId == null || busId.isEmpty()) {
            call.reject("Missing required parameter: busId");
            return;
        }
        if (serverUrl == null || serverUrl.isEmpty()) {
            call.reject("Missing required parameter: serverUrl");
            return;
        }

        // Persist credentials so the foreground service can read them
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit()
                .putString("auth_token", token)
                .putString("bus_id", busId)
                .putString("trip_id", tripId)
                .putString("server_url", serverUrl)
                .apply();

        // Start the foreground service
        Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }

        call.resolve();
    }

    /**
     * Called from JavaScript when the driver ends a trip.
     * Stops the native service and clears stored credentials.
     */
    @PluginMethod
    public void stopTracking(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
        getContext().stopService(serviceIntent);

        // Clear stored credentials
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().clear().apply();

        call.resolve();
    }

    /**
     * Called from JavaScript when the Supabase JWT is refreshed (~every 45 min).
     * Updates the token in SharedPreferences so the running service uses the new one.
     */
    @PluginMethod
    public void updateToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("Missing required parameter: token");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().putString("auth_token", token).apply();
        call.resolve();
    }
}
