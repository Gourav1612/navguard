package com.navguard.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Session-level flags to prompt the user once per app launch session
    private static boolean notifPromptShownThisSession = false;
    private static boolean bgLocPromptShownThisSession = false;
    private static boolean batteryPromptShownThisSession = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(LocationServicePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();

        // 1. Request POST_NOTIFICATIONS runtime permission on Android 13+ (API 33+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                if (!notifPromptShownThisSession) {
                    new android.app.AlertDialog.Builder(this)
                            .setTitle("Notifications Required")
                            .setMessage("To display the background tracking status and hear alerts, please allow NaviGuard to send notifications on the next screen.")
                            .setPositiveButton("Continue", (dialog, which) -> {
                                notifPromptShownThisSession = true;
                                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
                            })
                            .setNegativeButton("Not Now", (dialog, which) -> {
                                notifPromptShownThisSession = true;
                            })
                            .setCancelable(false)
                            .show();
                    return; // Let this dialog complete first
                }
            }
        }

        // 2. Request background location permission on Android 10+ (API 29+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    if (!bgLocPromptShownThisSession) {
                        new android.app.AlertDialog.Builder(this)
                                .setTitle("Background Location Required")
                                .setMessage("To track the bus location when the app is closed or the screen is off, please change the location permission to 'Allow all the time' on the next settings screen.")
                                .setPositiveButton("Go to Settings", (dialog, which) -> {
                                    bgLocPromptShownThisSession = true;
                                    ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 102);
                                })
                                .setNegativeButton("Not Now", (dialog, which) -> {
                                    bgLocPromptShownThisSession = true;
                                })
                                .setCancelable(false)
                                .show();
                        return; // Let this dialog complete first
                    }
                }
            }
        }

        // 3. Request Battery Optimization Exemption on Android 6+ (API 23+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(android.content.Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                if (!batteryPromptShownThisSession) {
                    new android.app.AlertDialog.Builder(this)
                            .setTitle("Ignore Battery Optimizations")
                            .setMessage("To prevent the Android OS from stopping location updates when the app is swiped away or the screen is off, please select 'Allow' on the next system dialog.")
                            .setPositiveButton("Continue", (dialog, which) -> {
                                batteryPromptShownThisSession = true;
                                try {
                                    android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                                    intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                    startActivity(intent);
                                } catch (Exception e) {
                                    try {
                                        android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                                        startActivity(intent);
                                    } catch (Exception ex) {
                                        android.util.Log.e("MainActivity", "Failed to request battery ignore", ex);
                                    }
                                }
                            })
                            .setNegativeButton("Not Now", (dialog, which) -> {
                                batteryPromptShownThisSession = true;
                            })
                            .setCancelable(false)
                            .show();
            }
        }
    }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Only enter Picture-in-Picture mode if tracking is currently active (credentials file exists)
        try {
            java.io.File file = new java.io.File(getFilesDir(), "tracking_credentials.json");
            if (file.exists()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                    // Set a compact 3:4 aspect ratio for the floating window
                    android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                    builder.setAspectRatio(aspectRatio);
                    enterPictureInPictureMode(builder.build());
                }
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to enter Picture-in-Picture mode", e);
        }
    }
}
