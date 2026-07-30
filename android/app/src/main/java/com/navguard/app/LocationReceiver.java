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
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .build();

        manager.notify(1001, notification);
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

        // Deduplication: skip if the foreground service already posted very recently
        long now = System.currentTimeMillis();
        if (now - LocationForegroundService.lastPostedTimeMs < 2500) {
            Log.d(TAG, "Receiver: skipping duplicate post (service posted recently)");
            return;
        }
        LocationForegroundService.lastPostedTimeMs = now;

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
        } catch (Exception e) {
            Log.e(TAG, "Failed to post location to server", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
