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
    private static final int POLL_INTERVAL_MS    = 30_000; // 30 seconds
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
                String token     = creds.optString("auth_token", null);
                String busId     = creds.optString("bus_id", null);
                String serverUrl = creds.optString("server_url", null);

                if (token == null || busId == null || serverUrl == null) {
                    Log.w(TAG, "Incomplete credentials, skipping poll");
                    return;
                }

                // Derive the assignment URL from the serverUrl (strip path, add /api/driver/assignment)
                String baseUrl = serverUrl.replaceAll("/api/.*$", "");
                String assignmentUrl = baseUrl + "/api/driver/assignment";

                // Poll the assignment endpoint
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
                    if (code == 200) {
                        Scanner scanner = new Scanner(conn.getInputStream(), "UTF-8");
                        StringBuilder respSb = new StringBuilder();
                        while (scanner.hasNextLine()) respSb.append(scanner.nextLine());
                        scanner.close();
                        responseBody = respSb.toString();
                    } else if (code == 401) {
                        Log.w(TAG, "Poll: 401 Unauthorized — token may have expired");
                        return;
                    } else {
                        Log.w(TAG, "Poll: unexpected status " + code);
                        return;
                    }
                } finally {
                    if (conn != null) conn.disconnect();
                }

                if (responseBody == null) return;

                JSONObject assignment = new JSONObject(responseBody);
                JSONObject activeTrip = assignment.optJSONObject("active_trip");
                String newTripId = (activeTrip != null) ? activeTrip.optString("trip_id", null) : null;
                // Normalize empty string → null
                if (newTripId != null && newTripId.isEmpty()) newTripId = null;

                String prevTripId = lastKnownTripId;

                // Also read from file in case process was restarted
                String fileTripId = creds.optString("trip_id", "");
                if (fileTripId.isEmpty()) fileTripId = null;

                boolean tripStarted = (prevTripId == null && fileTripId == null) && newTripId != null;
                boolean tripEnded   = (prevTripId != null || fileTripId != null) && newTripId == null;

                // Fetch SharedPreferences to sync native is_trip_active flag
                android.content.SharedPreferences prefs = context.getSharedPreferences(
                        LocationForegroundService.PREFS_NAME,
                        Context.MODE_PRIVATE
                );

                // If trip_id changed, update the credentials file
                if (newTripId != null && !newTripId.equals(fileTripId)) {
                    // Trip started or trip_id changed
                    creds.put("trip_id", newTripId);
                    FileWriter writer = new FileWriter(credsFile);
                    writer.write(creds.toString());
                    writer.flush();
                    writer.close();
                    lastKnownTripId = newTripId;
                    prefs.edit().putBoolean("is_trip_active", true).apply();
                    Log.d(TAG, "Poll: trip_id updated to " + newTripId + " (is_trip_active=true)");

                    if (tripStarted || prevTripId == null) {
                        showTripNotification(context,
                                "🚌 Trip Started by Admin",
                                "Live transit trip initiated. Tracking & PiP Mode active.",
                                NOTIF_TRIP_START);

                        // Notify LocationForegroundService to trigger Auto-PiP via ForegroundService
                        try {
                            Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                            serviceIntent.setAction("START_TRIP_PIP");
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent);
                            } else {
                                context.startService(serviceIntent);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Failed sending START_TRIP_PIP to LocationForegroundService", e);
                        }
                    }
                } else if (newTripId == null && fileTripId != null) {
                    // Trip ended — clear trip_id from credentials
                    creds.put("trip_id", "");
                    FileWriter writer = new FileWriter(credsFile);
                    writer.write(creds.toString());
                    writer.flush();
                    writer.close();
                    lastKnownTripId = null;
                    prefs.edit().putBoolean("is_trip_active", false).apply();
                    Log.d(TAG, "Poll: trip ended, cleared trip_id (is_trip_active=false)");

                    // Send STOP_TRIP_PIP to LocationForegroundService to hide bubble and exit PiP
                    try {
                        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                        serviceIntent.setAction("STOP_TRIP_PIP");
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            context.startForegroundService(serviceIntent);
                        } else {
                            context.startService(serviceIntent);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Failed sending STOP_TRIP_PIP to LocationForegroundService", e);
                    }

                    showTripNotification(context,
                            "🏁 Trip Completed by Admin",
                            "Admin has completed live transit trip.",
                            NOTIF_TRIP_END);
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

    /** Schedule the next poll in POLL_INTERVAL_MS using AlarmManager. */
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
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            Log.d(TAG, "Next trip poll scheduled in " + (POLL_INTERVAL_MS / 1000) + "s");
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
                Log.d(TAG, "Trip polling cancelled");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel trip polling", e);
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
                        "NaviGuard Trip Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Alerts driver when admin starts or ends a trip.");
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

            // On trip start, set fullScreenIntent to force-launch Activity into PiP even when app is closed/background
            if (notifId == NOTIF_TRIP_START) {
                builder.setFullScreenIntent(tapPi, true);
                builder.setCategory(androidx.core.app.NotificationCompat.CATEGORY_CALL);
            }

            manager.notify(notifId, builder.build());
            Log.d(TAG, "Trip notification shown: " + title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show trip notification", e);
        }
    }
}
