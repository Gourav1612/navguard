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

        // Persist credentials to SharedPreferences
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
            try {
                android.widget.Toast.makeText(getContext(), "Service Launch Failed: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
            } catch (Exception ex) {}
        }

        // Enable Auto-PiP on Android 12+ dynamically when tracking starts
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                builder.setAutoEnterEnabled(true);
                android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                builder.setAspectRatio(aspectRatio);
                getActivity().setPictureInPictureParams(builder.build());
                Log.d("LocationServicePlugin", "Enabled Auto-PiP dynamically");
            } catch (Exception e) {
                Log.e("LocationServicePlugin", "Failed to set Auto-PiP params", e);
            }
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

        // Clear stored credentials in SharedPreferences
        SharedPreferences prefs = getContext().getSharedPreferences(
                LocationForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        prefs.edit().clear().apply();

        // Also delete the credentials file
        try {
            File file = new File(getContext().getFilesDir(), "tracking_credentials.json");
            if (file.exists()) {
                file.delete();
            }
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "Failed to delete tracking_credentials.json", e);
        }

        // Disable Auto-PiP on Android 12+ dynamically when tracking stops
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                builder.setAutoEnterEnabled(false);
                getActivity().setPictureInPictureParams(builder.build());
                Log.d("LocationServicePlugin", "Disabled Auto-PiP dynamically");
            } catch (Exception e) {
                Log.e("LocationServicePlugin", "Failed to clear Auto-PiP params", e);
            }
        }

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

        // Automatically start or stop the foreground tracking service based on driver status
        try {
            Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
            if (isDriver) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }
                Log.d("LocationServicePlugin", "setDriverStatus: Automatically started LocationForegroundService for driver");
            } else {
                getContext().stopService(serviceIntent);
                Log.d("LocationServicePlugin", "setDriverStatus: Automatically stopped LocationForegroundService for non-driver");
            }
        } catch (Exception e) {
            Log.e("LocationServicePlugin", "setDriverStatus: Failed to automatically control LocationForegroundService", e);
        }

        // Dynamically enable/disable Auto-PiP parameters on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
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
        }

        // Prompt overlay permission directly on UI thread if driver is active and does not have it enabled
        if (isDriver && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getActivity().runOnUiThread(() -> {
                try {
                    if (!android.provider.Settings.canDrawOverlays(getContext())) {
                        new android.app.AlertDialog.Builder(getActivity())
                                .setTitle("Display Over Other Apps Required")
                                .setMessage("To display a floating shortcut bubble and keep tracking active when you swipe the app away, please enable 'Allow display over other apps' on the next settings screen.")
                                .setPositiveButton("Go to Settings", (dialog, which) -> {
                                    try {
                                        Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                                android.net.Uri.parse("package:" + getContext().getPackageName()));
                                        getActivity().startActivity(intent);
                                    } catch (Exception e) {
                                        Log.e("LocationServicePlugin", "Failed to open overlay settings", e);
                                    }
                                })
                                .setNegativeButton("Not Now", null)
                                .setCancelable(false)
                                .show();
                    }
                } catch (Exception e) {
                    Log.e("LocationServicePlugin", "Failed to show overlay permission dialog", e);
                }
            });
        }

        call.resolve();
    }
}
