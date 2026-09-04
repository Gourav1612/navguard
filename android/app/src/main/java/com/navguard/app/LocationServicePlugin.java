package com.navguard.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import org.json.JSONObject;
import java.io.File;
import java.io.FileWriter;
import java.io.FileReader;

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

        boolean isTripActive = call.getBoolean("isTripActive", tripId != null && !tripId.isEmpty());

        // Persist credentials to SharedPreferences
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit()
                .putBoolean("is_driver", true)
                .putBoolean("is_trip_active", isTripActive)
                .putString("auth_token", token)
                .putString("bus_id", busId)
                .putString("trip_id", tripId)
                .putString("server_url", serverUrl)
                .apply();

        // Also persist credentials to a process-safe JSON file on disk
        try {
            JSONObject json = new JSONObject();
            json.put("auth_token", token);
            json.put("bus_id", busId);
            json.put("trip_id", tripId);
            json.put("server_url", serverUrl);

            File file = new File(getContext().getFilesDir(), "tracking_credentials.json");
            FileWriter writer = new FileWriter(file);
            writer.write(json.toString());
            writer.flush();
            writer.close();
            Log.d("LocationServicePlugin", "Successfully wrote tracking_credentials.json to internal files");
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to write tracking_credentials.json", e);
        }

        // Start the foreground service with robust try-catch logging
        try {
            Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
            Log.d("LocationServicePlugin", "Successfully called startForegroundService");
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to start foreground service", e);
        }

        // Start polling for admin trip status changes every 30s
        TripStatusReceiver.scheduleNextPoll(getContext());
        Log.d("LocationServicePlugin", "Started trip status polling");

        // Overlay bubble and PiP triggers disabled (background location service runs independently via ForegroundService)
        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
        result.put("overlayPermissionNeeded", false);
        call.resolve(result);
    }

    /**
     * Called from JavaScript when the driver ends a trip.
     * Stops the native service and clears stored credentials.
     */
    @PluginMethod
    public void stopTracking(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
        getContext().stopService(serviceIntent);

        // Clear stored credentials in SharedPreferences
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().clear().apply();

        // Cancel trip status polling
        TripStatusReceiver.cancelPolling(getContext());
        Log.d("LocationServicePlugin", "Stopped trip status polling");

        // Also delete the credentials file
        try {
            File file = new File(getContext().getFilesDir(), "tracking_credentials.json");
            if (file.exists()) {
                file.delete();
            }
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to delete tracking_credentials.json", e);
        }

        // Disable Auto-PiP on Android 12+ dynamically when tracking stops (must run on UI thread)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getActivity() != null) {
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

        // Also update the token in the process-safe JSON file
        try {
            File file = new File(getContext().getFilesDir(), "tracking_credentials.json");
            JSONObject json;
            if (file.exists()) {
                FileReader reader = new FileReader(file);
                char[] chars = new char[(int) file.length()];
                reader.read(chars);
                reader.close();
                json = new JSONObject(new String(chars));
            } else {
                json = new JSONObject();
            }
            json.put("auth_token", token);

            FileWriter writer = new FileWriter(file);
            writer.write(json.toString());
            writer.flush();
            writer.close();
            Log.d("LocationServicePlugin", "Successfully updated token in tracking_credentials.json");
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to update token in tracking_credentials.json", e);
        }

        call.resolve();
    }

    /**
     * Set driver login/dashboard status so PiP triggers are conditionally configured.
     */
    @PluginMethod
    public void setDriverStatus(PluginCall call) {
        boolean isDriver = call.getBoolean("isDriver", false);

        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().putBoolean("is_driver", isDriver).apply();

        // Stop service if isDriver is set to false (logout)
        try {
            if (!isDriver) {
                Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
                getContext().stopService(serviceIntent);
                Log.d("LocationServicePlugin", "setDriverStatus: Stopped LocationForegroundService for non-driver");
            }
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "setDriverStatus: Failed to stop service", e);
        }

        boolean isTripActive = prefs.getBoolean("is_trip_active", false);

        // Dynamically enable/disable Auto-PiP parameters on Android 12+ (must run on UI thread)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                    builder.setAutoEnterEnabled(isDriver);

                    if (isDriver) {
                        android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                        builder.setAspectRatio(aspectRatio);
                    }

                    getActivity().setPictureInPictureParams(builder.build());
                    Log.d("LocationServicePlugin", "setDriverStatus: Configured Auto-PiP dynamically to " + isDriver);
                } catch (Exception e) {
                    Log.e("LocationServicePlugin", "Failed to configure Auto-PiP in setDriverStatus", e);
                }
            });
        }

        call.resolve();
    }

    /**
     * Explicitly set trip active status from JavaScript when driver starts or ends a trip transit.
     */
    @PluginMethod
    public void setTripStatus(PluginCall call) {
        boolean isTripActive = call.getBoolean("isTripActive", false);
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().putBoolean("is_trip_active", isTripActive).apply();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                    builder.setAutoEnterEnabled(true);
                    android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                    builder.setAspectRatio(aspectRatio);
                    getActivity().setPictureInPictureParams(builder.build());
                    Log.d("LocationServicePlugin", "setTripStatus: Configured Auto-PiP to true");
                } catch (Exception e) {
                    Log.e("LocationServicePlugin", "Failed to configure Auto-PiP in setTripStatus", e);
                }
            });
        }
        call.resolve();
    }

    /**
     * Check if device GPS / Location Provider is enabled.
     */
    @PluginMethod
    public void isGpsEnabled(PluginCall call) {
        boolean gpsEnabled = false;
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                boolean gps = lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER);
                boolean network = lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER);
                gpsEnabled = gps || network;
            }
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Error checking GPS status", e);
        }

        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
        result.put("enabled", gpsEnabled);
        call.resolve(result);
    }

    /**
     * Opens Android System Location / GPS settings screen so user can turn on Location.
     */
    @PluginMethod
    public void openGpsSettings(PluginCall call) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to open GPS settings", e);
            call.reject("Failed to open location settings");
        }
    }
}
