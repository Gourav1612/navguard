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
    public static final String CHANNEL_ID = "naviguard_location_channel_v2";
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
    // Native SOS Emergency Alarm & Vibration Management
    public static final String EMERGENCY_CHANNEL_ID = "naviguard_emergency_channel";
    public static final int EMERGENCY_NOTIFICATION_ID = 9999;
    private static android.media.Ringtone currentRingtone = null;
    private static android.os.Vibrator currentVibrator = null;
    public static volatile boolean isAlarmRinging = false;
    private static volatile String activeAlertId = null;

    private static final int HEARTBEAT_REQUEST_CODE = 9001;
    private static final long HEARTBEAT_INTERVAL_MS = 60000;
    private long lastGeocodeTimeMs = 0;
    private volatile String lastResolvedLocationName = null;

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

            // Dynamically sanitize serverUrl using ServerConfigHelper (resolves from config/strings/env)
            serverUrl = ServerConfigHelper.sanitizeServerUrl(this, serverUrl, "/api/worker/location");

            long nowTime = System.currentTimeMillis();
            if (nowTime - lastGeocodeTimeMs >= 60000) {
                lastGeocodeTimeMs = nowTime;
                final double lat = location.getLatitude();
                final double lng = location.getLongitude();
                new Thread(() -> {
                    try {
                        android.location.Geocoder geocoder = new android.location.Geocoder(LocationForegroundService.this, java.util.Locale.getDefault());
                        java.util.List<android.location.Address> addresses = geocoder.getFromLocation(lat, lng, 1);
                        if (addresses != null && !addresses.isEmpty()) {
                            android.location.Address addr = addresses.get(0);
                            String place = addr.getFeatureName();
                            if (place == null || place.isEmpty()) {
                                place = addr.getThoroughfare();
                            }
                            if (place != null && !place.isEmpty()) {
                                lastResolvedLocationName = place;
                                Log.d(TAG, "Resolved location name asynchronously: " + place);
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Failed async reverse geocoding", e);
                    }
                }).start();
            }
            String locationName = lastResolvedLocationName;

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

                    // Check for active background SOS alerts to sound native alarm if app is closed
                    checkActiveSosAlerts(serverUrl, token);

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

    private void checkActiveSosAlerts(String serverUrl, String token) {
        if (serverUrl == null || token == null) return;
        try {
            URL rawUrl = new URL(serverUrl);
            String baseUrl = rawUrl.getProtocol() + "://" + rawUrl.getHost() + (rawUrl.getPort() != -1 ? ":" + rawUrl.getPort() : "");
            URL sosUrl = new URL(baseUrl + "/api/sos/active");

            HttpURLConnection sosConn = (HttpURLConnection) sosUrl.openConnection();
            sosConn.setRequestMethod("GET");
            sosConn.setRequestProperty("Authorization", "Bearer " + token);
            sosConn.setConnectTimeout(4000);
            sosConn.setReadTimeout(4000);

            int sosCode = sosConn.getResponseCode();
            if (sosCode == 200) {
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(sosConn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String l;
                while ((l = reader.readLine()) != null) {
                    sb.append(l);
                }
                reader.close();

                JSONObject sosJson = new JSONObject(sb.toString());
                org.json.JSONArray alertsArray = sosJson.optJSONArray("alerts");

                if (alertsArray != null && alertsArray.length() > 0) {
                    JSONObject topAlert = alertsArray.getJSONObject(0);
                    String alertId = topAlert.optString("id", "");
                    String senderName = topAlert.optString("sender_name", "Personnel");
                    String senderRole = topAlert.optString("sender_role", "staff");
                    String plantName = topAlert.optString("plant_name", "Plant Facility");

                    triggerEmergencyAlarm(getApplicationContext(), alertId, senderName, senderRole, plantName);
                } else {
                    stopEmergencyAlarm(getApplicationContext());
                }
            }
            sosConn.disconnect();
        } catch (Exception e) {
            Log.d(TAG, "Background SOS check poll: " + e.getMessage());
        }
    }

    public static synchronized void triggerEmergencyAlarm(Context context, String alertId, String senderName, String senderRole, String plantName) {
        if (isAlarmRinging) return;
        isAlarmRinging = true;
        activeAlertId = alertId;

        try {
            // 1. Play Native Audio Chime / Alarm
            android.net.Uri alertUri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM);
            if (alertUri == null) {
                alertUri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);
            }
            if (alertUri != null) {
                currentRingtone = android.media.RingtoneManager.getRingtone(context.getApplicationContext(), alertUri);
                if (currentRingtone != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        currentRingtone.setAudioAttributes(
                            new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build()
                        );
                    }
                    currentRingtone.play();
                }
            }

            // 2. Start Continuous Native SOS Vibration Pattern
            currentVibrator = (android.os.Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (currentVibrator != null && currentVibrator.hasVibrator()) {
                long[] pattern = { 0, 450, 200, 450, 200, 450, 700 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    currentVibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0)); // 0 = loop
                } else {
                    currentVibrator.vibrate(pattern, 0);
                }
            }

            // 3. Post High-Priority Heads-Up Emergency Notification
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                Intent launchIntent = new Intent(context, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    EMERGENCY_NOTIFICATION_ID,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                NotificationCompat.Builder builder = new NotificationCompat.Builder(context, EMERGENCY_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_alert)
                    .setContentTitle("🚨 CRITICAL SOS: " + senderName + " (" + senderRole.toUpperCase() + ")")
                    .setContentText("Site: " + plantName + " • Tap to respond immediately")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .setOngoing(true);

                notificationManager.notify(EMERGENCY_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to trigger native emergency alarm", e);
        }
    }

    public static void stopEmergencyAlarm(Context context) {
        isAlarmRinging = false;
        activeAlertId = null;
        if (context == null) return;
        final Context appContext = context.getApplicationContext();
        new Thread(() -> {
            try {
                if (currentRingtone != null) {
                    try {
                        currentRingtone.stop();
                    } catch (Exception ignored) {}
                    currentRingtone = null;
                }
                if (currentVibrator != null) {
                    try {
                        currentVibrator.cancel();
                    } catch (Exception ignored) {}
                    currentVibrator = null;
                }
                if (appContext != null) {
                    NotificationManager notificationManager = (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (notificationManager != null) {
                        notificationManager.cancel(EMERGENCY_NOTIFICATION_ID);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to stop native emergency alarm", e);
            }
        }).start();
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
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                // Tracking Channel
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "NaviGuard Location Tracking",
                        NotificationManager.IMPORTANCE_MIN
                );
                channel.setDescription("Keeps bus location tracking active silently during a school trip.");
                channel.enableVibration(false);
                channel.setVibrationPattern(null);
                channel.setSound(null, null);
                manager.createNotificationChannel(channel);

                // Critical Emergency SOS Channel
                NotificationChannel emergencyChannel = new NotificationChannel(
                        EMERGENCY_CHANNEL_ID,
                        "NaviGuard Critical Emergency Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                );
                emergencyChannel.setDescription("Critical worker distress and safety SOS alarms");
                emergencyChannel.enableVibration(true);
                emergencyChannel.setVibrationPattern(new long[]{ 0, 450, 200, 450 });
                emergencyChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                emergencyChannel.setBypassDnd(true);
                manager.createNotificationChannel(emergencyChannel);
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
        // Floating window overlay disabled (background telemetry streaming runs via ForegroundService)
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

    private void startActivityWithBackgroundPrivileges(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                    try {
                        java.lang.reflect.Method method = options.getClass().getMethod("setPendingIntentBackgroundActivityStartMode", int.class);
                        method.invoke(options, 1);
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
