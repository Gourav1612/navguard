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
    private static boolean overlayPromptShownThisSession = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BatteryOptimizationPlugin.class);
        registerPlugin(LocationServicePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // Disable WebView caching to ensure immediate updates from Vercel
        try {
            getBridge().getWebView().getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            android.util.Log.d("MainActivity", "WebView cache disabled successfully");
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to disable WebView cache", e);
        }
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

        // 4. Request SYSTEM_ALERT_WINDOW ("Display over other apps") permission — needed for floating bubble
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!android.provider.Settings.canDrawOverlays(this)) {
                if (!overlayPromptShownThisSession) {
                    overlayPromptShownThisSession = true;

                    String message;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        message = "NaviGuard needs 'Display Over Apps' permission for the floating tracking bubble.\n\n"
                                + "⚠️ IF SETTING IS GREYED OUT (Restricted Setting):\n"
                                + "1. Tap 'Open App Info' below\n"
                                + "2. Tap top-right 3 dots (⋮)\n"
                                + "3. Tap 'Allow restricted settings'\n"
                                + "4. Go to 'Display over other apps' and turn ON!";
                    } else {
                        message = "NaviGuard needs to show a floating GPS tracking bubble when you switch away from the app.\n\n"
                                + "Tap 'Allow' to enable this permission — it keeps tracking visible at all times.";
                    }

                    new android.app.AlertDialog.Builder(this)
                            .setTitle("Display Over Other Apps")
                            .setMessage(message)
                            .setPositiveButton(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "Open App Info" : "Allow", (dialog, which) -> {
                                try {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                        // Open App Info directly so 3 dots menu (Allow restricted settings) is visible
                                        android.content.Intent intent = new android.content.Intent(
                                                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                                android.net.Uri.parse("package:" + getPackageName())
                                        );
                                        startActivity(intent);
                                    } else {
                                        android.content.Intent intent = new android.content.Intent(
                                                android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                                android.net.Uri.parse("package:" + getPackageName())
                                        );
                                        startActivity(intent);
                                    }
                                } catch (Exception e) {
                                    android.util.Log.e("MainActivity", "Failed to open overlay settings", e);
                                }
                            })
                            .setNegativeButton("Not Now", (dialog, which) -> {
                                android.util.Log.d("MainActivity", "User dismissed Display Over Apps permission prompt");
                            })
                            .setCancelable(false)
                            .show();
                }
            }
        }
    }

        // Configure Auto Picture-in-Picture conditionally on resume (Android 12+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                if (isPictureInPictureAllowed()) {
                    // Driver is active if tracking_credentials.json exists
                    java.io.File credsFile = new java.io.File(getFilesDir(), "tracking_credentials.json");
                    boolean isDriver = credsFile.exists();

                    android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                    // Always enable Auto-PiP for active drivers (regardless of trip status)
                    builder.setAutoEnterEnabled(isDriver);
                    if (isDriver) {
                        android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                        builder.setAspectRatio(aspectRatio);
                    }
                    setPictureInPictureParams(builder.build());
                    android.util.Log.d("MainActivity", "Configured Auto-PiP: isDriver=" + isDriver);
                }
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to configure Auto-PiP parameters", e);
            }
        }

        // Hide floating bubble overlay when app returns to foreground
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(
                    LocationForegroundService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
            );
            boolean isDriver = prefs.getBoolean("is_driver", false);
            if (isDriver && LocationForegroundService.isServiceRunning) {
                android.content.Intent serviceIntent = new android.content.Intent(this, LocationForegroundService.class);
                serviceIntent.setAction("HIDE_BUBBLE");
                try {
                    startService(serviceIntent);
                } catch (Exception se) {
                    android.util.Log.e("MainActivity", "Failed to startService for HIDE_BUBBLE in onResume", se);
                }
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to send HIDE_BUBBLE intent", e);
        }
    }

    private boolean isPictureInPictureAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        try {
            android.app.AppOpsManager appOps = (android.app.AppOpsManager) getSystemService(android.content.Context.APP_OPS_SERVICE);
            if (appOps == null) return false;
            int mode = appOps.checkOpNoThrow(
                android.app.AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
                android.os.Process.myUid(),
                getPackageName()
            );
            return mode == android.app.AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Trigger PiP for ANY active driver (credentials file presence = driver is logged in)
            java.io.File credsFile = new java.io.File(getFilesDir(), "tracking_credentials.json");
            if (!credsFile.exists()) {
                android.util.Log.d("MainActivity", "No active driver session, skipping PiP mode");
                return;
            }

            // Check if PiP permission is granted in Android settings
            if (!isPictureInPictureAllowed()) {
                try {
                    android.widget.Toast.makeText(this, "Please enable Picture-in-Picture permission in App Info settings!", android.widget.Toast.LENGTH_LONG).show();
                } catch (Exception t) {}
                android.util.Log.w("MainActivity", "PiP Mode requested but permission is not allowed");
                return;
            }

            try {
                android.app.PictureInPictureParams.Builder builder = new android.app.PictureInPictureParams.Builder();
                // Set a compact 3:4 aspect ratio for the floating window
                android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                builder.setAspectRatio(aspectRatio);
                enterPictureInPictureMode(builder.build());
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to enter Picture-in-Picture mode", e);
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        try {
            // Dispatch a JS event to the WebView to change UI dynamically
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('pipModeChanged', { detail: { isPip: " + isInPictureInPictureMode + " } }));",
                    null
                );
            });
            android.util.Log.d("MainActivity", "Dispatched pipModeChanged JS event: isPip=" + isInPictureInPictureMode);
            
            // If user closed or exited PiP window, trigger floating bubble show
            if (!isInPictureInPictureMode) {
                triggerBubbleShow();
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to dispatch JS event pipModeChanged", e);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        checkAndTriggerBubble();
    }

    @Override
    public void onStop() {
        super.onStop();
        checkAndTriggerBubble();
    }

    private void checkAndTriggerBubble() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
            return; // In PiP mode — PiP handles background presentation
        }
        // Show bubble whenever driver is actively tracked (credentials file exists)
        java.io.File credsFile = new java.io.File(getFilesDir(), "tracking_credentials.json");
        if (credsFile.exists()) {
            triggerBubbleShow();
        }
    }

    private void triggerBubbleShow() {
        try {
            // Do NOT attempt overlay action if overlay permission is not granted
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(this)) {
                return;
            }

            android.content.SharedPreferences prefs = getSharedPreferences(
                    LocationForegroundService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
            );
            boolean isDriver = prefs.getBoolean("is_driver", false);
            java.io.File credsFile = new java.io.File(getFilesDir(), "tracking_credentials.json");

            if (isDriver || credsFile.exists()) {
                android.content.Intent serviceIntent = new android.content.Intent(this, LocationForegroundService.class);
                serviceIntent.setAction("SHOW_BUBBLE");
                try {
                    startService(serviceIntent);
                } catch (Exception se) {
                    android.util.Log.e("MainActivity", "Failed to send SHOW_BUBBLE intent", se);
                }
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to send SHOW_BUBBLE intent", e);
        }
    }
}
