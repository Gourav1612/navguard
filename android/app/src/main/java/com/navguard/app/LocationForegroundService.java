package com.navguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.Context;
import android.app.AlarmManager;
import android.location.Location;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationForegroundService extends Service {
    private static final String TAG = "NaviGuardLocService";
    public static final String CHANNEL_ID = "naviguard_location_channel";
    public static final String PREFS_NAME = "NaviGuardTracking";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ExecutorService executor;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            startForeground(1001, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(1001, buildNotification());
        }
        startLocationUpdates();
        return START_STICKY; // Android restarts the service if killed
    }

    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .setMaxUpdateDelayMillis(7000)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    postLocationToServer(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            stopSelf();
        }
    }

    private void postLocationToServer(Location location) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString("auth_token", null);
        String busId = prefs.getString("bus_id", null);
        String tripId = prefs.getString("trip_id", null);
        String serverUrl = prefs.getString("server_url", null);

        if (token == null || busId == null || serverUrl == null) {
            Log.w(TAG, "Missing tracking credentials, skipping location post");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject json = new JSONObject();
                json.put("bus_id", busId);
                json.put("latitude", location.getLatitude());
                json.put("longitude", location.getLongitude());
                // Convert m/s → km/h; default 0
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
                Log.d(TAG, "Location posted, response: " + responseCode);

                // 401 = token expired → stop service (JS layer will restart with fresh token)
                if (responseCode == 401) {
                    Log.w(TAG, "Auth token expired. Stopping native location service.");
                    stopSelf();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to post location to server", e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("NaviGuard — Live Tracking")
                .setContentText("Bus location is being sent to the admin panel.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
                .build();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "NaviGuard Location Tracking",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Keeps bus location tracking active during a school trip.");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{100, 200, 300, 400, 500});
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        if (executor != null && !executor.isShutdown()) {
            executor.shutdown();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Not a bound service
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Schedule a service restart in 1 second using AlarmManager
        Intent restartServiceIntent = new Intent(getApplicationContext(), this.getClass());
        restartServiceIntent.setPackage(getPackageName());
        PendingIntent restartServicePendingIntent = PendingIntent.getService(
                getApplicationContext(), 1, restartServiceIntent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
        if (alarmService != null) {
            alarmService.set(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 1000,
                    restartServicePendingIntent
            );
        }
        super.onTaskRemoved(rootIntent);
    }
}
