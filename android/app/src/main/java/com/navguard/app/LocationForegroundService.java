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
import android.view.WindowManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.MotionEvent;
import android.widget.ImageView;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Color;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

public class LocationForegroundService extends Service {
    private static final String TAG = "NaviGuardLocService";
    public static final String CHANNEL_ID = "naviguard_location_channel";
    public static final String PREFS_NAME = "NaviGuardTracking";

    public static boolean isServiceRunning = false;
    private WindowManager windowManager;
    private View floatingView;

    private FusedLocationProviderClient fusedLocationClient;
    private android.os.PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        isServiceRunning = true;
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

        // Handle Floating Bubble overlay actions
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if ("SHOW_BUBBLE".equals(action)) {
                showFloatingBubble();
            } else if ("HIDE_BUBBLE".equals(action)) {
                hideFloatingBubble();
            }
        } else {
            // Intent is null (e.g. sticky OS recovery restart) - trigger bubble showing
            showFloatingBubble();
        }

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
        isServiceRunning = false;
        hideFloatingBubble();

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

    private void showFloatingBubble() {
        if (floatingView != null) return; // Already showing
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Cannot show overlay: overlay permission not granted");
            return; // No permission
        }

        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windowManager == null) return;

            // Create circular imageView programmatically
            ImageView imageView = new ImageView(this);
            imageView.setImageResource(android.R.drawable.ic_menu_mylocation);
            
            // Set circle background
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(Color.parseColor("#5c3b99")); // Purple theme
            circle.setStroke(4, Color.WHITE);
            imageView.setBackground(circle);
            
            // Convert dp to px for size
            int size = (int) (56 * getResources().getDisplayMetrics().density);
            int padding = (int) (14 * getResources().getDisplayMetrics().density);
            imageView.setPadding(padding, padding, padding, padding);

            floatingView = imageView;

            int layoutFlag;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
            } else {
                layoutFlag = WindowManager.LayoutParams.TYPE_PHONE;
            }

            final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    size,
                    size,
                    layoutFlag,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.TRANSLUCENT
            );

            // Gravity near the right middle edge of screen (standard stashed window spot)
            params.gravity = Gravity.TOP | Gravity.START;
            params.x = getResources().getDisplayMetrics().widthPixels - size - 20;
            params.y = getResources().getDisplayMetrics().heightPixels / 2 - size / 2;

            floatingView.setOnTouchListener(new View.OnTouchListener() {
                private int lastAction;
                private int initialX;
                private int initialY;
                private float initialTouchX;
                private float initialTouchY;

                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    switch (event.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            initialX = params.x;
                            initialY = params.y;
                            initialTouchX = event.getRawX();
                            initialTouchY = event.getRawY();
                            lastAction = event.getAction();
                            return true;
                        case MotionEvent.ACTION_UP:
                            if (lastAction == MotionEvent.ACTION_DOWN) {
                                // Tap triggers app restoration
                                Intent launchIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(launchIntent);
                            }
                            lastAction = event.getAction();
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            params.x = initialX + (int) (event.getRawX() - initialTouchX);
                            params.y = initialY + (int) (event.getRawY() - initialTouchY);
                            // Prevent dragging completely off screen bounds
                            if (params.x < 0) params.x = 0;
                            if (params.y < 0) params.y = 0;
                            windowManager.updateViewLayout(floatingView, params);
                            lastAction = event.getAction();
                            return true;
                    }
                    return false;
                }
            });

            windowManager.addView(floatingView, params);
            Log.d(TAG, "Floating tracking bubble added successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to show floating tracking bubble", e);
        }
    }

    private void hideFloatingBubble() {
        if (floatingView != null) {
            try {
                if (windowManager != null) {
                    windowManager.removeView(floatingView);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to remove floating tracking bubble", e);
            } finally {
                floatingView = null;
                windowManager = null;
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        showFloatingBubble();
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
