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
    public static final String CHANNEL_ID = "naviguard_location_channel_silent";
    public static final String PREFS_NAME = "NaviGuardTracking";

    public static boolean isServiceRunning = false;
    // Used for cross-path deduplication (service callback + BroadcastReceiver run in parallel)
    public static volatile long lastPostedTimeMs = 0;
    public static volatile Location lastPostedLocation = null;
    private static final long MIN_POST_INTERVAL_MS = 3000; // 3s minimum between posts
    private WindowManager windowManager;
    private View floatingView;

    private FusedLocationProviderClient fusedLocationClient;
    private android.os.PowerManager.WakeLock wakeLock;
    private android.net.wifi.WifiManager.WifiLock wifiLock;
    private LocationCallback locationCallback;
    // Dedicated background thread for location callbacks — never throttled by Android main looper
    private android.os.HandlerThread locationHandlerThread;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // Heartbeat: re-registers location updates every 60s to survive OEM throttling
    private static final int HEARTBEAT_REQUEST_CODE = 9001;
    private static final long HEARTBEAT_INTERVAL_MS = 60000;
    private long lastGeocodeTimeMs = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        isServiceRunning = true;
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();

        // Start dedicated HandlerThread for location callbacks (isolated from main looper throttling)
        locationHandlerThread = new android.os.HandlerThread("NaviGuardLocationThread");
        locationHandlerThread.start();

        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "NaviGuard::BackgroundLocationWakeLock");
                wakeLock.acquire(12 * 60 * 60 * 1000L); // 12 hour max — prevents indefinite hold
                Log.d(TAG, "Successfully acquired WakeLock for background tracking");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire WakeLock", e);
        }

        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "NaviGuard::WifiLock");
                wifiLock.acquire();
                Log.d(TAG, "Successfully acquired WifiLock for background tracking");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire WifiLock", e);
        }
    }



    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                startForeground(1001, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(1001, buildNotification());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed startForeground with location type, trying fallback", e);
            try {
                startForeground(1001, buildNotification());
            } catch (Exception ex) {
                Log.e(TAG, "Failed startForeground fallback", ex);
            }
        }

        // Ensure location updates are active
        startLocationUpdates();

        // Handle Floating Bubble overlay actions and heartbeat
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            if ("SHOW_BUBBLE".equals(action)) {
                showFloatingBubble();
            } else if ("HIDE_BUBBLE".equals(action)) {
                hideFloatingBubble();
            } else if ("START_TRIP_PIP".equals(action) || "ENFORCE_PIP_LOCKDOWN".equals(action)) {
                Log.d(TAG, "LocationForegroundService: Relaunching MainActivity into PiP (ENFORCE_PIP_LOCKDOWN)");
                try {
                    Intent pipIntent = new Intent(this, MainActivity.class);
                    pipIntent.setAction("com.navguard.app.ACTION_ENTER_PIP");
                    pipIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                    startActivityWithBackgroundPrivileges(pipIntent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed launching MainActivity for PiP", e);
                }
            } else if ("STOP_TRIP_PIP".equals(action)) {
                Log.d(TAG, "LocationForegroundService: STOP_TRIP_PIP received — hiding bubble and closing PiP");
                hideFloatingBubble();
                try {
                    Intent exitIntent = new Intent(this, MainActivity.class);
                    exitIntent.setAction("com.navguard.app.ACTION_EXIT_PIP");
                    exitIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    startActivityWithBackgroundPrivileges(exitIntent);
                } catch (Exception ignored) {}
            } else if ("HEARTBEAT_REREGISTER".equals(action)) {
                Log.d(TAG, "Heartbeat received — re-registering location updates");
                reRegisterLocationUpdates();
            }
        } else {
            // Intent is null (e.g. sticky OS recovery restart after swipe from recent apps!)
            showFloatingBubble();
        }

        return START_STICKY;
    }

    private boolean locationUpdatesStarted = false;

    private void startLocationUpdates() {
        if (locationUpdatesStarted) {
            Log.d(TAG, "Location updates already registered, skipping duplicate call");
            scheduleHeartbeat(); // keep heartbeat fresh
            return;
        }
        registerLocationUpdates();
    }

    /** Called by heartbeat — removes old callback first to safely re-register */
    private void reRegisterLocationUpdates() {
        locationUpdatesStarted = false;
        if (fusedLocationClient != null && locationCallback != null) {
            try {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            } catch (Exception ignored) {}
        }
        registerLocationUpdates();
    }

    private void registerLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .setMaxUpdateDelayMillis(8000)
                .setWaitForAccurateLocation(false)
                .build();

        // Use dedicated HandlerThread looper — main looper is throttled by Android in background
        android.os.Looper callbackLooper = (locationHandlerThread != null && locationHandlerThread.isAlive())
                ? locationHandlerThread.getLooper()
                : android.os.Looper.getMainLooper();

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
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, callbackLooper);
            locationUpdatesStarted = true;
            Log.d(TAG, "Successfully requested location updates via LocationCallback (HandlerThread)");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for LocationCallback", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to register location callback", e);
        }

        // Also register with LocationReceiver via PendingIntent to survive process kill / background swipe
        try {
            Intent intent = new Intent(this, LocationReceiver.class);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );
            fusedLocationClient.requestLocationUpdates(locationRequest, pendingIntent);
            Log.d(TAG, "Successfully requested location updates via BroadcastReceiver PendingIntent");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for BroadcastReceiver PendingIntent", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to register BroadcastReceiver PendingIntent", e);
        }

        // Start continuous 3-second background timer loop on HandlerThread
        startBackgroundTimerLoop();

        // Schedule heartbeat: re-register location updates every 60s to survive OEM throttling
        scheduleHeartbeat();
    }

    private android.os.Handler timerHandler;
    private Runnable timerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isServiceRunning) return;
            try {
                if (fusedLocationClient != null) {
                    fusedLocationClient.getLastLocation().addOnSuccessListener(location -> {
                        if (location != null) {
                            postLocationToServer(location);
                        }
                    });
                }
            } catch (SecurityException e) {
                Log.e(TAG, "Timer loop location permission error", e);
            } catch (Exception e) {
                Log.e(TAG, "Timer loop error", e);
            } finally {
                if (timerHandler != null && isServiceRunning) {
                    timerHandler.postDelayed(this, 3000);
                }
            }
        }
    };

    private void startBackgroundTimerLoop() {
        if (timerHandler == null && locationHandlerThread != null && locationHandlerThread.isAlive()) {
            timerHandler = new android.os.Handler(locationHandlerThread.getLooper());
            timerHandler.postDelayed(timerRunnable, 1000);
            Log.d(TAG, "Started continuous 3-second background location timer loop");
        }
    }

    private void scheduleHeartbeat() {
        try {
            Intent heartbeatIntent = new Intent(this, LocationForegroundService.class);
            heartbeatIntent.setAction("HEARTBEAT_REREGISTER");
            heartbeatIntent.setPackage(getPackageName());
            // Use getService to avoid background ForegroundServiceStartNotAllowedException crash
            PendingIntent pi = PendingIntent.getService(this, HEARTBEAT_REQUEST_CODE, heartbeatIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
                                System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS, pi);
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP,
                                System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS, pi);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to set heartbeat alarm", e);
                }
                Log.d(TAG, "Heartbeat scheduled in " + (HEARTBEAT_INTERVAL_MS / 1000) + "s");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule heartbeat", e);
        }
    }

    private void postLocationToServer(Location location) {
        // Deduplication and Jitter filter
        long now = System.currentTimeMillis();
        if (now - lastPostedTimeMs < MIN_POST_INTERVAL_MS) {
            Log.d(TAG, "Service: skipping duplicate post (receiver already posted recently)");
            return;
        }
        if (lastPostedLocation != null) {
            float distance = location.distanceTo(lastPostedLocation);
            long timeSinceLastPost = now - lastPostedTimeMs;
            if (distance < 3.0f && timeSinceLastPost < 30000) {
                Log.d(TAG, "Service: skipping post (bus stationary, moved " + distance + "m)");
                return;
            }
        }
        lastPostedTimeMs = now;
        lastPostedLocation = location;

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

            String locationName = null;
            long nowTime = System.currentTimeMillis();
            if (nowTime - lastGeocodeTimeMs >= 60000) {
                try {
                    android.location.Geocoder geocoder = new android.location.Geocoder(LocationForegroundService.this, java.util.Locale.getDefault());
                    java.util.List<android.location.Address> addresses = geocoder.getFromLocation(location.getLatitude(), location.getLongitude(), 1);
                    if (addresses != null && !addresses.isEmpty()) {
                        android.location.Address addr = addresses.get(0);
                        // Construct a place name (e.g. "Green Park" or "New Link Road")
                        String place = addr.getFeatureName();
                        if (place == null || place.isEmpty()) {
                            place = addr.getThoroughfare();
                        }
                        if (place != null && !place.isEmpty()) {
                            locationName = place;
                            lastGeocodeTimeMs = nowTime; // Update timestamp on successful geocode
                            Log.d(TAG, "Resolved location name: " + locationName);
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to reverse geocode location", e);
                }
            }

            int attempt = 0;
            boolean success = false;
            while (attempt < 3 && !success) {
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
                    if (locationName != null) json.put("location_name", locationName);

                    URL url = new URL(serverUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    conn.setRequestProperty("Connection", "Keep-Alive");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);

                    byte[] body = json.toString().getBytes("UTF-8");
                    conn.setFixedLengthStreamingMode(body.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(body);
                    os.flush();
                    os.close();

                    int responseCode = conn.getResponseCode();
                    if (responseCode == 401) {
                        Log.e(TAG, "Service: AUTH FAILED (401) — token may be expired, need refresh");
                        success = true; // Auth failed, no point in retrying
                    } else if (responseCode == 200 || responseCode == 201) {
                        Log.d(TAG, "Service: location posted to server on attempt " + (attempt + 1) + ". Response: " + responseCode);
                        success = true;
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
                                Log.d(TAG, "Service: Admin requested app open via telemetry! Launching MainActivity...");
                                try {
                                    Intent launchIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                    launchIntent.setAction("com.navguard.app.ACTION_ENTER_PIP");
                                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                    startActivityWithBackgroundPrivileges(launchIntent);
                                } catch (Exception e) {
                                    Log.e(TAG, "Failed to launch MainActivity on admin telemetry request", e);
                                }
                            }

                            boolean isTripActiveServer = respJson.optBoolean("is_trip_active", false);

                            android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
                            boolean wasTripActive = prefs.getBoolean("is_trip_active", false);

                            if (isTripActiveServer != wasTripActive) {
                                prefs.edit().putBoolean("is_trip_active", isTripActiveServer).apply();
                                Log.d(TAG, "Service: synced is_trip_active from server to " + isTripActiveServer);
                                if (isTripActiveServer) {
                                    // Admin initiated trip! Launch MainActivity into PiP automatically
                                    Intent pipIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                    pipIntent.setAction("com.navguard.app.ACTION_ENTER_PIP");
                                    pipIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                                    startActivityWithBackgroundPrivileges(pipIntent);
                                } else {
                                    // Admin completed trip! Hide floating bubble & close PiP
                                    hideFloatingBubble();
                                    Intent exitIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                    exitIntent.setAction("com.navguard.app.ACTION_EXIT_PIP");
                                    exitIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                    startActivityWithBackgroundPrivileges(exitIntent);
                                }
                            }
                        } catch (Exception err) {
                            Log.e(TAG, "Error processing server telemetry response", err);
                        }
                    } else {
                        Log.w(TAG, "Service: Server returned non-ok status: " + responseCode);
                    }

                    // Always read error stream to release network resource for reuse
                    java.io.InputStream es = conn.getErrorStream();
                    if (es != null) {
                        byte[] buf = new byte[1024];
                        while (es.read(buf) > 0) {}
                        es.close();
                    }
                } catch (Exception e) {
                    attempt++;
                    Log.e(TAG, "Service: failed to post location on attempt " + attempt + " (" + e.getMessage() + ")");
                    if (attempt < 3) {
                        try {
                            Thread.sleep(500); // Wait 500ms before retrying to let network radio wake up
                        } catch (InterruptedException ignored) {}
                    }
                } finally {
                    if (conn != null) conn.disconnect();
                }
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
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "NaviGuard Location Tracking",
                    NotificationManager.IMPORTANCE_MIN
            );
            channel.setDescription("Keeps bus location tracking active silently during a school trip.");
            channel.enableVibration(false);
            channel.setVibrationPattern(null);
            channel.setSound(null, null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
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

        // Release WifiLock if held
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
                Log.d(TAG, "Successfully released WifiLock");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to release WifiLock", e);
        }

        // Only stop location updates if the credentials file has been deleted (i.e. explicit stop by the driver)
        java.io.File file = new java.io.File(getFilesDir(), "tracking_credentials.json");
        if (!file.exists()) {
            // VOLUNTARY STOP: driver explicitly logged out
            hideFloatingBubble();
            // Stop heartbeat alarms
            try {
                Intent hbIntent = new Intent(this, LocationForegroundService.class);
                hbIntent.setAction("HEARTBEAT_REREGISTER");
                PendingIntent hbPi;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    hbPi = PendingIntent.getForegroundService(this, HEARTBEAT_REQUEST_CODE, hbIntent,
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                } else {
                    hbPi = PendingIntent.getService(this, HEARTBEAT_REQUEST_CODE, hbIntent,
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                }
                if (hbPi != null) {
                    AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                    if (am != null) am.cancel(hbPi);
                }
            } catch (Exception ignored) {}
            // Stop HandlerThread
            if (locationHandlerThread != null) {
                locationHandlerThread.quitSafely();
                locationHandlerThread = null;
            }
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
            // Use getService to avoid background ForegroundServiceStartNotAllowedException crash
            PendingIntent pendingIntent = PendingIntent.getService(
                    getApplicationContext(), 1, restartIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            AlarmManager alarmService = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
            if (alarmService != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmService.setAndAllowWhileIdle(
                                AlarmManager.RTC_WAKEUP,
                                System.currentTimeMillis() + 3000,
                                pendingIntent
                        );
                    } else {
                        alarmService.set(
                                AlarmManager.RTC_WAKEUP,
                                System.currentTimeMillis() + 3000,
                                pendingIntent
                        );
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to schedule restart alarm on destroy", e);
                }
            }
        }
    }

    private void showFloatingBubble() {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
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
                final int bubbleSize  = (int) (52 * density);  // full circle diameter
                final int arrowW      = (int) (18 * density);  // arrow tab width (visible peeking part)
                final int arrowH      = (int) (36 * density);  // arrow tab height
                final int bubblePad   = (int) (12 * density);
                final long PEEK_DELAY_MS = 10_000L; // 10 seconds of inactivity → collapse to arrow

                // Track which edge (0=left, 1=right) and peek state
                final int[]     snapEdge  = {1};    // default right edge
                final boolean[] isPeeked  = {false};

                // ── Build the bubble view (purple circle with location icon) ──────────────
                final android.widget.FrameLayout container = new android.widget.FrameLayout(this);

                // Circle background layer
                final android.view.View circleView = new android.view.View(this) {
                    @Override
                    protected void onDraw(android.graphics.Canvas canvas) {
                        android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                        p.setColor(Color.parseColor("#5c3b99"));
                        float r = Math.min(getWidth(), getHeight()) / 2f;
                        canvas.drawCircle(r, r, r, p);
                        // White ring
                        p.setStyle(android.graphics.Paint.Style.STROKE);
                        p.setStrokeWidth(3 * density);
                        p.setColor(Color.WHITE);
                        canvas.drawCircle(r, r, r - 2 * density, p);
                    }
                };
                circleView.setWillNotDraw(false);

                // GPS icon on top
                ImageView iconView = new ImageView(this);
                iconView.setImageResource(android.R.drawable.ic_menu_mylocation);
                iconView.setPadding(bubblePad, bubblePad, bubblePad, bubblePad);
                iconView.setColorFilter(Color.WHITE, android.graphics.PorterDuff.Mode.SRC_IN);

                android.widget.FrameLayout.LayoutParams fillLp =
                        new android.widget.FrameLayout.LayoutParams(bubbleSize, bubbleSize);
                container.addView(circleView, fillLp);
                container.addView(iconView, fillLp);

                floatingView = container;

                int layoutFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE;

                final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        bubbleSize, bubbleSize, layoutFlag,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                        PixelFormat.TRANSLUCENT
                );
                params.gravity = Gravity.TOP | Gravity.START;
                params.x = screenW - bubbleSize - (int)(8 * density);
                params.y = screenH / 2 - bubbleSize / 2;

                final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

                // ── PEEK (collapse to arrow tab) ────────────────────────────────────────
                final Runnable peekRunnable = new Runnable() {
                    @Override
                    public void run() {
                        if (floatingView == null || windowManager == null) return;
                        try {
                            isPeeked[0] = true;
                            // Resize window to arrow tab size; slide to screen edge
                            if (snapEdge[0] == 1) {
                                params.width  = arrowW;
                                params.height = arrowH;
                                params.x      = screenW - arrowW;
                            } else {
                                params.width  = arrowW;
                                params.height = arrowH;
                                params.x      = 0;
                            }
                            params.y = screenH / 2 - arrowH / 2;

                            // Redraw container as a semi-transparent arrow tab
                            final boolean isRight = (snapEdge[0] == 1);
                            android.view.View arrowTab = new android.view.View(LocationForegroundService.this) {
                                @Override
                                protected void onDraw(android.graphics.Canvas canvas) {
                                    android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                                    p.setColor(Color.parseColor("#995c3b99")); // 60% opaque purple
                                    int w = getWidth(), h = getHeight();
                                    android.graphics.Path path = new android.graphics.Path();
                                    if (isRight) {
                                        // Tab on right edge: rectangle with left-pointing chevron
                                        path.moveTo(0, 0);
                                        path.lineTo(w, 0);
                                        path.lineTo(w, h);
                                        path.lineTo(0, h);
                                        path.lineTo(w * 0.4f, h / 2f);
                                        path.close();
                                    } else {
                                        // Tab on left edge: rectangle with right-pointing chevron
                                        path.moveTo(w, 0);
                                        path.lineTo(0, 0);
                                        path.lineTo(0, h);
                                        path.lineTo(w, h);
                                        path.lineTo(w * 0.6f, h / 2f);
                                        path.close();
                                    }
                                    canvas.drawPath(path, p);
                                }
                            };
                            arrowTab.setWillNotDraw(false);

                            // Swap container children for the arrow tab view
                            android.widget.FrameLayout fc = (android.widget.FrameLayout) floatingView;
                            fc.removeAllViews();
                            fc.addView(arrowTab, new android.widget.FrameLayout.LayoutParams(
                                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT));

                            windowManager.updateViewLayout(floatingView, params);
                        } catch (Exception ignored) {}
                    }
                };

                // ── EXPAND (restore to full circle bubble) ──────────────────────────────
                final Runnable[] expandRunnable = {null};
                expandRunnable[0] = () -> {
                    if (floatingView == null || windowManager == null) return;
                    try {
                        isPeeked[0] = false;
                        params.width  = bubbleSize;
                        params.height = bubbleSize;

                        if (snapEdge[0] == 1) {
                            params.x = screenW - bubbleSize - (int)(8 * density);
                        } else {
                            params.x = (int)(8 * density);
                        }

                        // Restore circle children
                        android.widget.FrameLayout fc = (android.widget.FrameLayout) floatingView;
                        fc.removeAllViews();
                        android.widget.FrameLayout.LayoutParams fillLp2 =
                                new android.widget.FrameLayout.LayoutParams(bubbleSize, bubbleSize);

                        android.view.View cv2 = new android.view.View(LocationForegroundService.this) {
                            @Override
                            protected void onDraw(android.graphics.Canvas canvas) {
                                android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
                                p.setColor(Color.parseColor("#5c3b99"));
                                float r = Math.min(getWidth(), getHeight()) / 2f;
                                canvas.drawCircle(r, r, r, p);
                                p.setStyle(android.graphics.Paint.Style.STROKE);
                                p.setStrokeWidth(3 * density);
                                p.setColor(Color.WHITE);
                                canvas.drawCircle(r, r, r - 2 * density, p);
                            }
                        };
                        cv2.setWillNotDraw(false);

                        ImageView iv2 = new ImageView(LocationForegroundService.this);
                        iv2.setImageResource(android.R.drawable.ic_menu_mylocation);
                        iv2.setPadding(bubblePad, bubblePad, bubblePad, bubblePad);
                        iv2.setColorFilter(Color.WHITE, android.graphics.PorterDuff.Mode.SRC_IN);

                        fc.addView(cv2, fillLp2);
                        fc.addView(iv2, fillLp2);

                        windowManager.updateViewLayout(floatingView, params);

                        // Schedule next auto-peek after 10s
                        handler.removeCallbacks(peekRunnable);
                        handler.postDelayed(peekRunnable, PEEK_DELAY_MS);
                    } catch (Exception ignored) {}
                };

                // Schedule first auto-peek after 10 seconds
                handler.postDelayed(peekRunnable, PEEK_DELAY_MS);

                // ── Touch listener ──────────────────────────────────────────────────────
                floatingView.setOnTouchListener(new View.OnTouchListener() {
                    private int lastAction;
                    private int initialX, initialY;
                    private float initialTouchX, initialTouchY;
                    private long downTime;
                    private final long LONG_PRESS_MS = 700;
                    private boolean longPressFired = false;

                    private final Runnable longPressRunnable = () -> {
                        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
                        boolean isTripActive = prefs.getBoolean("is_trip_active", false);

                        if (isTripActive) {
                            Log.d(TAG, "Trip active — ignoring long press bubble dismissal request");
                            return; // UN-DISMISSABLE DURING ACTIVE TRIP
                        }
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
                                if (isPeeked[0]) {
                                    // Expand immediately on any touch
                                    handler.post(expandRunnable[0]);
                                } else {
                                    handler.removeCallbacks(peekRunnable);
                                }
                                handler.postDelayed(longPressRunnable, LONG_PRESS_MS);
                                return true;

                            case MotionEvent.ACTION_UP:
                                handler.removeCallbacks(longPressRunnable);
                                if (!longPressFired) {
                                    long elapsed = System.currentTimeMillis() - downTime;
                                    float dx = Math.abs(event.getRawX() - initialTouchX);
                                    float dy = Math.abs(event.getRawY() - initialTouchY);
                                    if (elapsed < LONG_PRESS_MS && dx < (int)(8 * density) && dy < (int)(8 * density)) {
                                        // Tap — launch app
                                        Intent launchIntent = new Intent(LocationForegroundService.this, MainActivity.class);
                                        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                        startActivity(launchIntent);
                                    } else if (!longPressFired) {
                                        // Drag ended — snap to nearest edge
                                        int midScreen = screenW / 2;
                                        if (params.x + bubbleSize / 2 < midScreen) {
                                            snapEdge[0] = 0;
                                            params.x = (int)(8 * density);
                                        } else {
                                            snapEdge[0] = 1;
                                            params.x = screenW - bubbleSize - (int)(8 * density);
                                        }
                                        if (params.y < 0) params.y = (int)(16 * density);
                                        if (params.y > screenH - bubbleSize) params.y = screenH - bubbleSize - (int)(16 * density);
                                        try { windowManager.updateViewLayout(floatingView, params); } catch (Exception ignored) {}
                                        // Re-schedule auto-peek
                                        handler.removeCallbacks(peekRunnable);
                                        handler.postDelayed(peekRunnable, PEEK_DELAY_MS);
                                    }
                                }
                                lastAction = event.getAction();
                                return true;

                            case MotionEvent.ACTION_MOVE:
                                handler.removeCallbacks(longPressRunnable);
                                if (!isPeeked[0]) {
                                    float newX = event.getRawX() - initialTouchX;
                                    float newY = event.getRawY() - initialTouchY;
                                    if (Math.abs(newX) > (int)(4 * density) || Math.abs(newY) > (int)(4 * density)) {
                                        params.x = initialX + (int) newX;
                                        params.y = initialY + (int) newY;
                                        if (params.x < -(bubbleSize / 2)) params.x = -(bubbleSize / 2);
                                        if (params.x > screenW - bubbleSize / 2) params.x = screenW - bubbleSize / 2;
                                        if (params.y < 0) params.y = 0;
                                        if (params.y > screenH - bubbleSize) params.y = screenH - bubbleSize;
                                        try { windowManager.updateViewLayout(floatingView, params); } catch (Exception ignored) {}
                                        lastAction = event.getAction();
                                    }
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
        });
    }



    private void startActivityWithBackgroundPrivileges(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 34) { // Android 14, 15, 16
                try {
                    android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                    try {
                        java.lang.reflect.Method method = options.getClass().getMethod("setPendingIntentBackgroundActivityStartMode", int.class);
                        method.invoke(options, 1); // 1 = MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    } catch (Throwable t) {
                        try {
                            java.lang.reflect.Method m2 = options.getClass().getMethod("setPendingIntentCreatorBackgroundActivityStartMode", int.class);
                            m2.invoke(options, 1);
                        } catch (Throwable ignored) {}
                    }
                    startActivity(intent, options.toBundle());
                    return;
                } catch (Throwable ignored) {}
            }
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Failed startActivityWithBackgroundPrivileges", e);
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
