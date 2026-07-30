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
import android.location.Location;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationResult;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

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
    // Used for cross-path deduplication (service callback + BroadcastReceiver run in parallel)
    public static volatile long lastPostedTimeMs = 0;
    private static final long MIN_POST_INTERVAL_MS = 3000; // 3s minimum between posts
    private WindowManager windowManager;
    private View floatingView;

    private FusedLocationProviderClient fusedLocationClient;
    private android.os.PowerManager.WakeLock wakeLock;
    private LocationCallback locationCallback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

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
        }
        // NOTE: do NOT auto-show bubble on null intent (initial start / sticky restart)
        // Bubble is only shown when SHOW_BUBBLE is explicitly requested
        // (triggered from onStop/onTaskRemoved)

        return START_STICKY;
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
                    Log.d(TAG, "LocationCallback: received location - " + location.getLatitude() + ", " + location.getLongitude());
                    postLocationToServer(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, android.os.Looper.getMainLooper());
            Log.d(TAG, "Successfully requested location updates via LocationCallback");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for LocationCallback", e);
        }

        // Fail-safe: Register a PendingIntent targeting the BroadcastReceiver (LocationReceiver)
        // This persists when the app is swiped away from recent tasks or the service process is killed.
        try {
            Intent intent = new Intent(this, LocationReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );
            fusedLocationClient.requestLocationUpdates(locationRequest, pendingIntent);
            Log.d(TAG, "Successfully registered BroadcastReceiver PendingIntent fallback");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for BroadcastReceiver PendingIntent", e);
        }
    }

    private void postLocationToServer(Location location) {
        // Deduplication: skip if another path just posted within the interval
        long now = System.currentTimeMillis();
        if (now - lastPostedTimeMs < MIN_POST_INTERVAL_MS) {
            Log.d(TAG, "Service: skipping duplicate post (receiver already posted recently)");
            return;
        }
        lastPostedTimeMs = now;

        executor.execute(() -> {
            String token = null;
            String busId = null;
            String tripId = null;
            String serverUrl = null;

            try {
                java.io.File file = new java.io.File(getFilesDir(), "tracking_credentials.json");
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
                Log.e(TAG, "Failed to read credentials file in service", e);
            }

            if (token == null || busId == null || serverUrl == null) {
                Log.w(TAG, "Missing tracking credentials in service, skipping location post");
                return;
            }

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
                if (responseCode == 401) {
                    Log.e(TAG, "Service: AUTH FAILED (401) — token may be expired, need refresh");
                } else {
                    Log.d(TAG, "Service: location posted to server. Response: " + responseCode);
                }
            } catch (Exception e) {
                Log.e(TAG, "Service: failed to post location to server", e);
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
        isServiceRunning = false;
        // NOTE: Do NOT hide the bubble here — if this is an involuntary OS kill
        // the bubble should stay visible to reassure the driver tracking is alive.

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
            // VOLUNTARY STOP: driver explicitly logged out
            hideFloatingBubble();
            if (fusedLocationClient != null) {
                if (locationCallback != null) {
                    try {
                        fusedLocationClient.removeLocationUpdates(locationCallback);
                        Log.d(TAG, "Successfully removed location updates callback on destroy");
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to remove location updates callback", e);
                    }
                }
                try {
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
                        Log.d(TAG, "Successfully removed LocationReceiver PendingIntent updates on destroy");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to remove BroadcastReceiver PendingIntent updates", e);
                }
            }
        } else {
            // INVOLUNTARY DESTROY: OS killed the service (swipe from recents / OEM kill)
            // Schedule restart in 3 seconds and show bubble to indicate tracking is recovering
            Log.w(TAG, "LocationForegroundService destroyed involuntarily. Scheduling restart...");
            Intent restartIntent = new Intent(getApplicationContext(), this.getClass());
            restartIntent.setPackage(getPackageName());
            restartIntent.setAction("SHOW_BUBBLE"); // Re-show bubble on restart too
            PendingIntent pendingIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                pendingIntent = PendingIntent.getForegroundService(
                        getApplicationContext(), 1, restartIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
            } else {
                pendingIntent = PendingIntent.getService(
                        getApplicationContext(), 1, restartIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
            }
            AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmService != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmService.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            System.currentTimeMillis() + 3000, // faster 3s restart
                            pendingIntent
                    );
                } else {
                    alarmService.setExact(
                            AlarmManager.RTC_WAKEUP,
                            System.currentTimeMillis() + 3000,
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
            return;
        }

        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windowManager == null) return;

            final int screenW = getResources().getDisplayMetrics().widthPixels;
            final int screenH = getResources().getDisplayMetrics().heightPixels;
            final float density = getResources().getDisplayMetrics().density;
            final int size = (int) (52 * density);
            final int padding = (int) (12 * density);
            // How far the bubble hides behind the edge in peek/arrow mode
            final int peekOffset = (int) (36 * density);
            final long PEEK_DELAY_MS = 3000; // auto-collapse after 3s of inactivity

            // Build the bubble view
            ImageView imageView = new ImageView(this);
            imageView.setImageResource(android.R.drawable.ic_menu_mylocation);
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(Color.parseColor("#5c3b99"));
            circle.setStroke(3, Color.WHITE);
            imageView.setBackground(circle);
            imageView.setPadding(padding, padding, padding, padding);
            floatingView = imageView;

            int layoutFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;

            final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    size, size, layoutFlag,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.START;
            // Start on right edge, vertically centered
            params.x = screenW - size - (int)(8 * density);
            params.y = screenH / 2 - size / 2;

            // Track which edge (0 = left, 1 = right)
            final int[] snapEdge = {1};
            final boolean[] isPeeked = {false};

            final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
            final Runnable peekRunnable = new Runnable() {
                @Override
                public void run() {
                    if (floatingView == null || windowManager == null) return;
                    try {
                        isPeeked[0] = true;
                        // Slide bubble partially off screen (peek / arrow mode)
                        if (snapEdge[0] == 1) {
                            params.x = screenW - size + peekOffset;
                        } else {
                            params.x = -peekOffset;
                        }
                        windowManager.updateViewLayout(floatingView, params);
                    } catch (Exception ignored) {}
                }
            };

            final Runnable[] expandRunnable = {null};
            expandRunnable[0] = () -> {
                if (floatingView == null || windowManager == null) return;
                try {
                    isPeeked[0] = false;
                    // Bring back fully into view
                    if (snapEdge[0] == 1) {
                        params.x = screenW - size - (int)(8 * density);
                    } else {
                        params.x = (int)(8 * density);
                    }
                    windowManager.updateViewLayout(floatingView, params);
                    // Schedule next auto-peek
                    handler.removeCallbacks(peekRunnable);
                    handler.postDelayed(peekRunnable, PEEK_DELAY_MS);
                } catch (Exception ignored) {}
            };

            // Schedule first auto-peek
            handler.postDelayed(peekRunnable, PEEK_DELAY_MS);

            floatingView.setOnTouchListener(new View.OnTouchListener() {
                private int lastAction;
                private int initialX, initialY;
                private float initialTouchX, initialTouchY;
                private long downTime;
                private final long LONG_PRESS_MS = 700;
                private boolean longPressFired = false;

                private final Runnable longPressRunnable = () -> {
                    longPressFired = true;
                    handler.removeCallbacks(peekRunnable);
                    hideFloatingBubble();
                    Log.d(TAG, "Bubble dismissed by long-press");
                };

                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    switch (event.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            longPressFired = false;
                            initialX = params.x;
                            initialY = params.y;
                            initialTouchX = event.getRawX();
                            initialTouchY = event.getRawY();
                            downTime = System.currentTimeMillis();
                            lastAction = event.getAction();
                            // Expand if peeked
                            if (isPeeked[0]) {
                                handler.post(expandRunnable[0]);
                            } else {
                                handler.removeCallbacks(peekRunnable);
                            }
                            // Schedule long-press
                            handler.postDelayed(longPressRunnable, LONG_PRESS_MS);
                            return true;

                        case MotionEvent.ACTION_UP:
                            handler.removeCallbacks(longPressRunnable);
                            if (!longPressFired) {
                                long elapsed = System.currentTimeMillis() - downTime;
                                float dx = Math.abs(event.getRawX() - initialTouchX);
                                float dy = Math.abs(event.getRawY() - initialTouchY);
                                if (elapsed < LONG_PRESS_MS && dx < (int)(8 * density) && dy < (int)(8 * density)) {
                                    // It's a tap — launch app
                                    Intent launchIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                    startActivity(launchIntent);
                                } else if (!longPressFired) {
                                    // Released after drag — snap to nearest edge
                                    int midScreen = screenW / 2;
                                    if (params.x + size / 2 < midScreen) {
                                        snapEdge[0] = 0;
                                        params.x = (int)(8 * density);
                                    } else {
                                        snapEdge[0] = 1;
                                        params.x = screenW - size - (int)(8 * density);
                                    }
                                    // Clamp Y within screen
                                    if (params.y < 0) params.y = (int)(16 * density);
                                    if (params.y > screenH - size) params.y = screenH - size - (int)(16 * density);
                                    try {
                                        windowManager.updateViewLayout(floatingView, params);
                                    } catch (Exception ignored) {}
                                    // Re-schedule auto-peek
                                    handler.removeCallbacks(peekRunnable);
                                    handler.postDelayed(peekRunnable, PEEK_DELAY_MS);
                                }
                            }
                            lastAction = event.getAction();
                            return true;

                        case MotionEvent.ACTION_MOVE:
                            handler.removeCallbacks(longPressRunnable);
                            float newX = event.getRawX() - initialTouchX;
                            float newY = event.getRawY() - initialTouchY;
                            if (Math.abs(newX) > (int)(4 * density) || Math.abs(newY) > (int)(4 * density)) {
                                params.x = initialX + (int) newX;
                                params.y = initialY + (int) newY;
                                if (params.x < -(size / 2)) params.x = -(size / 2);
                                if (params.x > screenW - size / 2) params.x = screenW - size / 2;
                                if (params.y < 0) params.y = 0;
                                if (params.y > screenH - size) params.y = screenH - size;
                                try {
                                    windowManager.updateViewLayout(floatingView, params);
                                } catch (Exception ignored) {}
                                lastAction = event.getAction();
                            }
                            return true;

                        case MotionEvent.ACTION_CANCEL:
                            handler.removeCallbacks(longPressRunnable);
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
        super.onTaskRemoved(rootIntent);
    }
}
