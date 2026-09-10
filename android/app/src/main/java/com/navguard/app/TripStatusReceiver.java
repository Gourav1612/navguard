package com.navguard.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * TripStatusReceiver
 *
 * Fires on a repeating AlarmManager schedule (~every 30s) to poll the server
 * for the driver's current trip state. This keeps the native service up-to-date
 * even when the app is killed from recent apps.
 *
 * When admin STARTS a trip  → update trip_id in credentials + show notification
 * When admin ENDS  a trip   → clear trip_id in credentials + show notification
 */
public class TripStatusReceiver extends BroadcastReceiver {

    public static final String ACTION_POLL_TRIP = "com.navguard.app.ACTION_POLL_TRIP";
    public static final String CHANNEL_ID_TRIP   = "naviguard_trip_status_channel";
    private static final String TAG = "NaviGuardTripPoll";
    private static final int POLL_INTERVAL_MS    = 12_000; // 12 seconds
    public  static final int POLL_REQUEST_CODE   = 9002;
    private static final int NOTIF_TRIP_START    = 2001;
    private static final int NOTIF_TRIP_END      = 2002;

    // In-memory last-known trip_id to detect changes (survives across onReceive calls in same process)
    private static volatile String lastKnownTripId = null;

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        // Only process our own poll action (and boot/restart broadcasts)
        String action = intent.getAction();
        if (action == null) return;

        boolean isValidAction = ACTION_POLL_TRIP.equals(action)
                || Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.MY_PACKAGE_REPLACED".equals(action);

        if (!isValidAction) return;

        Log.d(TAG, "TripStatusReceiver triggered: " + action);

        // Read credentials from disk — if no file, driver is not logged in, stop
        final java.io.File credsFile = new java.io.File(context.getFilesDir(), "tracking_credentials.json");
        if (!credsFile.exists()) {
            Log.d(TAG, "No tracking_credentials.json — driver not active, skipping poll");
            return;
        }

        final PendingResult pendingResult = goAsync();

        executor.execute(() -> {
            try {
                // Read current credentials
                BufferedReader reader = new BufferedReader(new FileReader(credsFile));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();

                JSONObject creds = new JSONObject(sb.toString());
                String token        = creds.optString("auth_token", null);
                String refreshToken = creds.optString("refresh_token", null);
                String busId        = creds.optString("bus_id", null);
                String serverUrl    = creds.optString("server_url", null);

                if (token == null || busId == null || serverUrl == null) {
                    Log.w(TAG, "Incomplete credentials, skipping poll");
                    return;
                }

                // Dynamically sanitize serverUrl using ServerConfigHelper (resolves from config/strings/env)
                serverUrl = ServerConfigHelper.sanitizeServerUrl(context, serverUrl, "/api/worker/location");

                // Derive the workforce assignment URL from serverUrl
                String baseUrl = serverUrl.replaceAll("/api/.*$", "");
                if (baseUrl.isEmpty() || baseUrl.contains("localhost") || baseUrl.contains("127.0.0.1")) {
                    baseUrl = ServerConfigHelper.getBaseServerUrl(context);
                }
                String assignmentUrl = baseUrl + "/api/worker/assignment";

                // 1. ALWAYS Check active background SOS alerts FIRST (Crucial for Admins, Managers, and Supervisors)
                try {
                    String sosBaseUrl = baseUrl;
                    URL sosUrl = new URL(sosBaseUrl + "/api/sos/active");

                    HttpURLConnection sosConn = (HttpURLConnection) sosUrl.openConnection();
                    sosConn.setRequestMethod("GET");
                    sosConn.setRequestProperty("Authorization", "Bearer " + token);
                    sosConn.setConnectTimeout(5000);
                    sosConn.setReadTimeout(5000);

                    int sosResponseCode = sosConn.getResponseCode();
                    if (sosResponseCode == 401 && refreshToken != null && !refreshToken.isEmpty()) {
                        Log.w(TAG, "SOS check got 401 — attempting background token refresh...");
                        String newToken = refreshAuthToken(context, baseUrl, refreshToken, busId, serverUrl);
                        if (newToken != null) {
                            token = newToken;
                            sosConn.disconnect();
                            sosConn = (HttpURLConnection) sosUrl.openConnection();
                            sosConn.setRequestMethod("GET");
                            sosConn.setRequestProperty("Authorization", "Bearer " + token);
                            sosConn.setConnectTimeout(5000);
                            sosConn.setReadTimeout(5000);
                            sosResponseCode = sosConn.getResponseCode();
                        }
                    }

                    if (sosResponseCode == 200) {
                        BufferedReader sosReader = new BufferedReader(new java.io.InputStreamReader(sosConn.getInputStream()));
                        StringBuilder sosSb = new StringBuilder();
                        String l;
                        while ((l = sosReader.readLine()) != null) {
                            sosSb.append(l);
                        }
                        sosReader.close();

                        JSONObject sosJson = new JSONObject(sosSb.toString());
                        org.json.JSONArray alertsArray = sosJson.optJSONArray("alerts");

                        if (alertsArray != null && alertsArray.length() > 0) {
                            JSONObject topAlert = alertsArray.getJSONObject(0);
                            String alertId = topAlert.optString("id", "");
                            String senderName = topAlert.optString("sender_name", "Personnel");
                            String senderRole = topAlert.optString("sender_role", "staff");
                            String plantName = topAlert.optString("plant_name", "Plant Facility");

                            Log.d(TAG, "TripStatusReceiver: Found ACTIVE SOS ALERT " + alertId + " from " + senderName);
                            LocationForegroundService.triggerEmergencyAlarm(context, alertId, senderName, senderRole, plantName);
                        } else {
                            LocationForegroundService.stopEmergencyAlarm(context);
                        }
                    }
                    sosConn.disconnect();
                } catch (Exception e) {
                    Log.d(TAG, "TripStatusReceiver SOS check: " + e.getMessage());
                }

                // 2. Poll workforce telemetry assignment endpoint (for field tracking)
                HttpURLConnection conn = null;
                String responseBody = null;
                try {
                    URL url = new URL(assignmentUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);

                    int code = conn.getResponseCode();
                    if (code == 401 && refreshToken != null && !refreshToken.isEmpty()) {
                        Log.w(TAG, "Assignment poll got 401 — attempting background token refresh...");
                        String newToken = refreshAuthToken(context, baseUrl, refreshToken, busId, serverUrl);
                        if (newToken != null) {
                            token = newToken;
                            conn.disconnect();
                            conn = (HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("GET");
                            conn.setRequestProperty("Authorization", "Bearer " + token);
                            conn.setRequestProperty("Content-Type", "application/json");
                            conn.setConnectTimeout(8000);
                            conn.setReadTimeout(8000);
                            code = conn.getResponseCode();
                        }
                    }

                    if (code == 200) {
                        Scanner scanner = new Scanner(conn.getInputStream(), "UTF-8");
                        StringBuilder respSb = new StringBuilder();
                        while (scanner.hasNextLine()) respSb.append(scanner.nextLine());
                        scanner.close();
                        responseBody = respSb.toString();
                    } else {
                        Log.d(TAG, "Poll: assignment status " + code);
                    }
                } catch (Exception e) {
                    Log.d(TAG, "Poll assignment error: " + e.getMessage());
                } finally {
                    if (conn != null) conn.disconnect();
                }

                if (responseBody != null) {
                    JSONObject assignment = new JSONObject(responseBody);
                    JSONObject worker = assignment.optJSONObject("worker");
                    boolean isActive = worker != null && worker.optBoolean("is_active", false);

                    // Fetch SharedPreferences to check native state
                    android.content.SharedPreferences prefs = context.getSharedPreferences(
                            LocationForegroundService.PREFS_NAME,
                            Context.MODE_PRIVATE
                    );

                    boolean isServiceRunning = LocationForegroundService.isServiceRunning;

                    if (isActive && !isServiceRunning) {
                        Log.d(TAG, "Poll: Admin enabled streaming (is_active=true)! Starting LocationForegroundService...");
                        prefs.edit().putBoolean("is_trip_active", true).apply();

                        try {
                            Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent);
                            } else {
                                context.startService(serviceIntent);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Failed startForegroundService, fallback to startService", e);
                            try {
                                Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                                context.startService(serviceIntent);
                            } catch (Exception ignored) {}
                        }

                        showTripNotification(context,
                                "Workforce Telemetry Active",
                                "Command Center has enabled live workforce telemetry streaming.",
                                NOTIF_TRIP_START);
                    } else if (!isActive && isServiceRunning) {
                        Log.d(TAG, "Poll: Admin paused streaming (is_active=false)! Stopping LocationForegroundService...");
                        prefs.edit().putBoolean("is_trip_active", false).apply();

                        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                        context.stopService(serviceIntent);
                    }
                }

            } catch (Exception e) {
                Log.e(TAG, "Poll failed: " + e.getMessage(), e);
            } finally {
                pendingResult.finish();
                // Always re-schedule next poll
                scheduleNextPoll(context);
            }
        });
    }

    /** Helper to refresh Supabase JWT session in background using refresh_token */
    public static String refreshAuthToken(Context context, String baseUrl, String refreshToken, String busId, String serverUrl) {
        if (refreshToken == null || refreshToken.isEmpty()) return null;
        try {
            URL url = new URL(baseUrl + "/api/auth/token/refresh");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("refresh_token", refreshToken);
            byte[] body = payload.toString().getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(body.length);
            java.io.OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            if (code == 200) {
                BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();

                JSONObject resp = new JSONObject(sb.toString());
                String newAccess = resp.optString("access_token", null);
                String newRefresh = resp.optString("refresh_token", refreshToken);

                if (newAccess != null && !newAccess.isEmpty()) {
                    // Save new tokens to disk
                    JSONObject newCreds = new JSONObject();
                    newCreds.put("auth_token", newAccess);
                    newCreds.put("refresh_token", newRefresh);
                    newCreds.put("bus_id", busId);
                    newCreds.put("server_url", serverUrl);

                    java.io.File file = new java.io.File(context.getFilesDir(), "tracking_credentials.json");
                    java.io.FileWriter writer = new java.io.FileWriter(file);
                    writer.write(newCreds.toString());
                    writer.flush();
                    writer.close();
                    Log.d(TAG, "Successfully refreshed Supabase JWT token in background!");
                    return newAccess;
                }
            }
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Failed background token refresh: " + e.getMessage());
        }
        return null;
    }

    /** Schedule the next poll in POLL_INTERVAL_MS using AlarmManager with Doze Mode exact wakeups. */
    public static void scheduleNextPoll(Context context) {
        try {
            Intent intent = new Intent(context, TripStatusReceiver.class);
            intent.setAction(ACTION_POLL_TRIP);
            PendingIntent pi = PendingIntent.getBroadcast(
                    context,
                    POLL_REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long triggerAt = System.currentTimeMillis() + POLL_INTERVAL_MS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            Log.d(TAG, "Next workforce poll scheduled in " + (POLL_INTERVAL_MS / 1000) + "s");
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule next poll", e);
        }
    }

    /** Cancel any scheduled polls. */
    public static void cancelPolling(Context context) {
        try {
            Intent intent = new Intent(context, TripStatusReceiver.class);
            intent.setAction(ACTION_POLL_TRIP);
            PendingIntent pi = PendingIntent.getBroadcast(
                    context,
                    POLL_REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            );
            if (pi != null) {
                AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (am != null) am.cancel(pi);
                pi.cancel();
                Log.d(TAG, "Workforce polling cancelled");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel workforce polling", e);
        }
    }

    private void showTripNotification(Context context, String title, String message, int notifId) {
        try {
            NotificationManager manager = (NotificationManager)
                    context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID_TRIP,
                        "NaviGuard Workforce Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Alerts workforce when Command Center activates or pauses telemetry.");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 300, 100, 300});
                manager.createNotificationChannel(channel);
            }

            Intent tapIntent = new Intent(context, MainActivity.class);
            tapIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tapPi = PendingIntent.getActivity(
                    context, notifId, tapIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            androidx.core.app.NotificationCompat.Builder builder =
                    new androidx.core.app.NotificationCompat.Builder(context, CHANNEL_ID_TRIP)
                            .setContentTitle(title)
                            .setContentText(message)
                            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                            .setContentIntent(tapPi)
                            .setAutoCancel(true)
                            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MAX)
                            .setDefaults(androidx.core.app.NotificationCompat.DEFAULT_SOUND
                                    | androidx.core.app.NotificationCompat.DEFAULT_VIBRATE);

            manager.notify(notifId, builder.build());
            Log.d(TAG, "Workforce notification shown: " + title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show workforce notification", e);
        }
    }

    private static void startActivityWithBackgroundPrivileges(Context context, Intent intent) {
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
                    context.startActivity(intent, options.toBundle());
                    return;
                } catch (Throwable ignored) {}
            }
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e("TripStatusReceiver", "Failed to launch activity with background privileges", e);
        }
    }
}
