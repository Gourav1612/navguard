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

        // Wake up screen and show on lock screen for emergency safety pings
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
                android.app.KeyguardManager keyguardManager = (android.app.KeyguardManager) getSystemService(android.content.Context.KEYGUARD_SERVICE);
                if (keyguardManager != null) {
                    keyguardManager.requestDismissKeyguard(this, null);
                }
            } else {
                getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                        | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            android.util.Log.d("MainActivity", "Successfully configured screen turn-on and unlock flags");
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to configure wake/lock flags", e);
        }

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
        }

        // Overlay bubble and SYSTEM_ALERT_WINDOW permission prompts disabled
    }

    private boolean isPictureInPictureAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false;
        }
        if (!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            return false;
        }
        try {
            android.app.AppOpsManager appOps = (android.app.AppOpsManager) getSystemService(android.content.Context.APP_OPS_SERVICE);
            if (appOps == null) return true;
            int mode = appOps.checkOpNoThrow(
                android.app.AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
                android.os.Process.myUid(),
                getPackageName()
            );
            // Allow both MODE_ALLOWED (0) and MODE_DEFAULT (3)
            return mode != android.app.AppOpsManager.MODE_IGNORED && mode != android.app.AppOpsManager.MODE_ERRORED;
        } catch (Exception e) {
            return true;
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.SharedPreferences prefs = getSharedPreferences(
                    LocationForegroundService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
            );
            boolean isDriver = prefs.getBoolean("is_driver", false);
            java.io.File credsFile = new java.io.File(getFilesDir(), "tracking_credentials.json");

            if (!isDriver && !credsFile.exists()) {
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
                android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                builder.setAspectRatio(aspectRatio);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    builder.setAutoEnterEnabled(true);
                }
                setPictureInPictureParams(builder.build());
                enterPictureInPictureMode(builder.build());
                android.util.Log.d("MainActivity", "Successfully configured & entered Picture-in-Picture mode!");
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Failed to enter Picture-in-Picture mode", e);
            }
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        android.util.Log.d("MainActivity", "onNewIntent received: " + (intent != null ? intent.getAction() : "null"));

        if (intent != null && "com.navguard.app.ACTION_EXIT_PIP".equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
                finishAndRemoveTask();
            }
            return;
        }

        if (intent != null && "com.navguard.app.ACTION_ENTER_PIP".equals(intent.getAction())) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(true);
                    setTurnScreenOn(true);
                } else {
                    getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
                }
            } catch (Exception ignored) {}

            android.content.SharedPreferences prefs = getSharedPreferences(
                    LocationForegroundService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
            );
            prefs.edit().putBoolean("is_trip_active", true).apply();
        }

        checkAndEnterPipIfTripActive();
    }

    private void checkAndEnterPipIfTripActive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.SharedPreferences prefs = getSharedPreferences(
                    LocationForegroundService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
            );
            boolean isTripActive = prefs.getBoolean("is_trip_active", false);

            if (isTripActive && isPictureInPictureAllowed()) {
                android.util.Log.d("MainActivity", "checkAndEnterPipIfTripActive: Active trip running! Forcing PiP mode immediately...");
                try {
                    android.app.PictureInPictureParams.Builder pipBuilder = new android.app.PictureInPictureParams.Builder();
                    android.util.Rational aspectRatio = new android.util.Rational(3, 4);
                    pipBuilder.setAspectRatio(aspectRatio);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        pipBuilder.setAutoEnterEnabled(true);
                    }
                    setPictureInPictureParams(pipBuilder.build());

                    // Wait 250ms until Activity reaches RESUMED state before calling enterPictureInPictureMode
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        try {
                            if (!isInPictureInPictureMode() && isPictureInPictureAllowed()) {
                                boolean entered = enterPictureInPictureMode(pipBuilder.build());
                                android.util.Log.d("MainActivity", "enterPictureInPictureMode result: " + entered);
                            }
                        } catch (Exception e) {
                            android.util.Log.e("MainActivity", "Failed entering PiP in checkAndEnterPipIfTripActive", e);
                        }
                    }, 250);
                } catch (Exception e) {
                    android.util.Log.e("MainActivity", "Failed setting PiP params in checkAndEnterPipIfTripActive", e);
                }
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
            
            if (!isInPictureInPictureMode) {
                android.content.SharedPreferences prefs = getSharedPreferences(
                        LocationForegroundService.PREFS_NAME,
                        android.content.Context.MODE_PRIVATE
                );
                boolean isTripActive = prefs.getBoolean("is_trip_active", false);

                if (isTripActive) {
                    // Anti-Tamper Lockdown: Active trip in transit! Relaunch PiP immediately via ForegroundService
                    android.util.Log.w("MainActivity", "Anti-Tamper Lockdown: Active trip running! Service relaunching PiP mode...");
                    try {
                        android.content.Intent serviceIntent = new android.content.Intent(MainActivity.this, LocationForegroundService.class);
                        serviceIntent.setAction("ENFORCE_PIP_LOCKDOWN");
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(serviceIntent);
                        } else {
                            startService(serviceIntent);
                        }
                    } catch (Exception ignored) {}
                } else {
                    // Normal standby mode — show floating bubble
                    triggerBubbleShow();
                }
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
        // Floating overlay bubble triggers disabled
    }

    private void triggerBubbleShow() {
        // Floating overlay bubble triggers disabled
    }
}
