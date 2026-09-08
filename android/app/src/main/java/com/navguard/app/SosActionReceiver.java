package com.navguard.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * SosActionReceiver
 * Receives one-tap actions from the Android SOS Emergency Notification Banner / Lockscreen.
 * Actions:
 * - ACTION_DISMISS_SOS_ALARM: Immediately silences the alarm sound, stops vibration, and cancels the notification.
 */
public class SosActionReceiver extends BroadcastReceiver {
    private static final String TAG = "SosActionReceiver";
    public static final String ACTION_DISMISS_SOS_ALARM = "com.navguard.app.ACTION_DISMISS_SOS_ALARM";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Log.d(TAG, "SosActionReceiver received action: " + action);

        if (ACTION_DISMISS_SOS_ALARM.equals(action) || "android.intent.action.DELETE".equals(action)) {
            Log.d(TAG, "Silencing and dismissing SOS emergency alarm via notification action / swipe");
            LocationForegroundService.stopEmergencyAlarm(context);
        }
    }
}
