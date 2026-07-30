package com.navguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.Context;
import android.app.AlarmManager;
import android.os.IBinder;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

public class LocationForegroundService extends Service {
    private static final String TAG = "NaviGuardLocService";
    public static final String CHANNEL_ID = "naviguard_location_channel";
    public static final String PREFS_NAME = "NaviGuardTracking";

    private FusedLocationProviderClient fusedLocationClient;
    private android.os.PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();

        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "NaviGuard::BackgroundLocationWakeLock");
                wakeLock.acquire();
                Log.d(TAG, "Successfully acquired WakeLock for background tracking");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire WakeLock", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            startForeground(1001, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(1001, buildNotification());
        }
        startLocationUpdates();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .setMaxUpdateDelayMillis(7000)
                .build();

        Intent intent = new Intent(this, LocationReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
        );

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, pendingIntent);
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            stopSelf();
        }
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
        // Release WakeLock if held
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "Successfully released WakeLock");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to release WakeLock", e);
        }

        // Only stop location updates if the credentials file has been deleted (i.e. explicit stop by the driver)
        java.io.File file = new java.io.File(getFilesDir(), "tracking_credentials.json");
        if (!file.exists()) {
            if (fusedLocationClient != null) {
                Intent intent = new Intent(this, LocationReceiver.class);
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                        this,
                        0,
                        intent,
                        PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
                );
                if (pendingIntent != null) {
                    fusedLocationClient.removeLocationUpdates(pendingIntent);
                    pendingIntent.cancel();
                }
            }
        } else {
            // INVOLUNTARY DESTROY: OS killed the service. Schedule restart in 5 seconds!
            Log.w(TAG, "LocationForegroundService destroyed involuntarily. Scheduling restart...");
            Intent restartIntent = new Intent(getApplicationContext(), this.getClass());
            restartIntent.setPackage(getPackageName());
            PendingIntent pendingIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                pendingIntent = PendingIntent.getForegroundService(
                        getApplicationContext(), 1, restartIntent,
                        PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
                );
            } else {
                pendingIntent = PendingIntent.getService(
                        getApplicationContext(), 1, restartIntent,
                        PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
                );
            }
            AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmService != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmService.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            System.currentTimeMillis() + 5000,
                            pendingIntent
                    );
                } else {
                    alarmService.setExact(
                            AlarmManager.RTC_WAKEUP,
                            System.currentTimeMillis() + 5000,
                            pendingIntent
                    );
                }
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Schedule a service restart in 1 second using AlarmManager
        Intent restartServiceIntent = new Intent(getApplicationContext(), this.getClass());
        restartServiceIntent.setPackage(getPackageName());
        PendingIntent restartServicePendingIntent;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            restartServicePendingIntent = PendingIntent.getForegroundService(
                    getApplicationContext(), 1, restartServiceIntent,
                    PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
            );
        } else {
            restartServicePendingIntent = PendingIntent.getService(
                    getApplicationContext(), 1, restartServiceIntent,
                    PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
            );
        }
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
