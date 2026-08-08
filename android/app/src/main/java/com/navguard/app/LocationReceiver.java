package com.navguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.LocationResult;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationReceiver extends BroadcastReceiver {
    private static final String TAG = "NaviGuardLocReceiver";
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        if (LocationResult.hasResult(intent)) {
            LocationResult locationResult = LocationResult.extractResult(intent);
            if (locationResult != null) {
                // Ensure our notification remains visible
                showTrackingNotification(context);

                final PendingResult pendingResult = goAsync();

                executor.execute(() -> {
                    try {
                        for (Location location : locationResult.getLocations()) {
                            postLocationToServerSync(context, location);
                        }
                    } finally {
                        pendingResult.finish();
                    }
                });
            }
        }
    }

    private void showTrackingNotification(Context context) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        LocationForegroundService.CHANNEL_ID,
                        "NaviGuard Location Tracking",
                        NotificationManager.IMPORTANCE_DEFAULT
                  );
                channel.setDescription("Keeps bus location tracking active during a school trip.");
                manager.createNotificationChannel(channel);
            }

            Intent notificationIntent = new Intent(context, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context, 0, notificationIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification notification = new NotificationCompat.Builder(context, LocationForegroundService.CHANNEL_ID)
                    .setContentTitle("NaviGuard — Live Tracking")
                    .setContentText("Bus location is being sent to the admin panel.")
                    .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                    .setContentIntent(pendingIntent)
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build();

            manager.notify(1001, notification);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show tracking notification in LocationReceiver", e);
        }
    }

    private void postLocationToServerSync(Context context, Location location) {
        String token = null;
        String busId = null;
        String tripId = null;
        String serverUrl = null;

        try {
            java.io.File file = new java.io.File(context.getFilesDir(), "tracking_credentials.json");
            if (file.exists()) {
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(file));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                JSONObject json = new JSONObject(sb.toString());
                token = json.optString("auth_token", null);
                busId = json.optString("bus_id", null);
                tripId = json.optString("trip_id", null);
                serverUrl = json.optString("server_url", null);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to read credentials file", e);
        }

        if (token == null || busId == null || serverUrl == null) {
            Log.w(TAG, "Missing tracking credentials, skipping location post");
            return;
        }

        // Deduplication and Jitter filter
        long now = System.currentTimeMillis();
        if (now - LocationForegroundService.lastPostedTimeMs < 2500) {
            Log.d(TAG, "Receiver: skipping duplicate post (service posted recently)");
            return;
        }
        if (LocationForegroundService.lastPostedLocation != null) {
            float distance = location.distanceTo(LocationForegroundService.lastPostedLocation);
            long timeSinceLastPost = now - LocationForegroundService.lastPostedTimeMs;
            if (distance < 3.0f && timeSinceLastPost < 30000) {
                Log.d(TAG, "Receiver: skipping post (bus stationary, moved " + distance + "m)");
                return;
            }
        }
        LocationForegroundService.lastPostedTimeMs = now;
        LocationForegroundService.lastPostedLocation = location;

        HttpURLConnection conn = null;
        try {
            JSONObject json = new JSONObject();
            json.put("bus_id", busId);
            json.put("latitude", location.getLatitude());
            json.put("longitude", location.getLongitude());
            double speedKmh = location.hasSpeed() ? location.getSpeed() * 3.6 : 0;
            json.put("speed", speedKmh);
            json.put("heading", location.hasBearing() ? location.getBearing() : 0);
            if (tripId != null && !tripId.isEmpty()) json.put("trip_id", tripId);

            URL url = new URL(serverUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Connection", "Keep-Alive");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            byte[] body = json.toString().getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();

            int responseCode = conn.getResponseCode();
            Log.d(TAG, "Location posted to server. Response: " + responseCode);
            if (responseCode == 200 || responseCode == 201) {
                try {
                    java.io.BufferedReader inReader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                    StringBuilder respBuilder = new StringBuilder();
                    String lineStr;
                    while ((lineStr = inReader.readLine()) != null) {
                        respBuilder.append(lineStr);
                    }
                    inReader.close();
                    JSONObject respJson = new JSONObject(respBuilder.toString());
                    
                    // Handle admin remote open app trigger
                    boolean openAppRequested = respJson.optBoolean("open_app_requested", false);
                    if (openAppRequested) {
                        Log.d(TAG, "Receiver: Admin requested app open via telemetry! Launching MainActivity...");
                        try {
                            Intent launchIntent = new Intent(context, MainActivity.class);
                            launchIntent.setAction("com.navguard.app.ACTION_ENTER_PIP");
                            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            context.startActivity(launchIntent);
                        } catch (Exception e) {
                            Log.e(TAG, "Failed to launch MainActivity on admin telemetry request", e);
                        }
                    }

                    boolean isTripActiveServer = respJson.optBoolean("is_trip_active", false);

                    android.content.SharedPreferences prefs = context.getSharedPreferences(LocationForegroundService.PREFS_NAME, Context.MODE_PRIVATE);
                    boolean wasTripActive = prefs.getBoolean("is_trip_active", false);

                    if (isTripActiveServer != wasTripActive) {
                        prefs.edit().putBoolean("is_trip_active", isTripActiveServer).apply();
                        Log.d(TAG, "LocationReceiver: synced is_trip_active to " + isTripActiveServer);
                        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                        serviceIntent.setAction(isTripActiveServer ? "START_TRIP_PIP" : "STOP_TRIP_PIP");
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            context.startForegroundService(serviceIntent);
                        } else {
                            context.startService(serviceIntent);
                        }
                    }
                } catch (Exception err) {
                    Log.e(TAG, "Error in LocationReceiver response handling", err);
                }
            }

            // Always read error stream to release network resource for reuse
            java.io.InputStream es = conn.getErrorStream();
            if (es != null) {
                byte[] buf = new byte[1024];
                while (es.read(buf) > 0) {}
                es.close();
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to post location to server", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
