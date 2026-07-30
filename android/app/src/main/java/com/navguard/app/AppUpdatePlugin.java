package com.navguard.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdatePlugin")
public class AppUpdatePlugin extends Plugin {
    private static final String TAG = "AppUpdatePlugin";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ret.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            ret.put("allowed", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to open install settings screen", e);
                call.reject("Could not open settings: " + e.getMessage());
            }
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String apkUrl = call.getString("url");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("URL parameter is missing");
            return;
        }

        executor.execute(() -> {
            try {
                URL url = new URL(apkUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.connect();

                int fileLength = conn.getContentLength();
                InputStream is = conn.getInputStream();
                
                File cacheDir = getContext().getCacheDir();
                File apkFile = new File(cacheDir, "update.apk");
                
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                FileOutputStream fos = new FileOutputStream(apkFile);
                byte[] buffer = new byte[4096];
                int len;
                int downloaded = 0;

                while ((len = is.read(buffer)) != -1) {
                    fos.write(buffer, 0, len);
                    downloaded += len;
                    
                    if (fileLength > 0) {
                        float progress = (float) downloaded / fileLength;
                        JSObject progressObj = new JSObject();
                        progressObj.put("progress", progress);
                        notifyListeners("downloadProgress", progressObj);
                    }
                }

                fos.flush();
                fos.close();
                is.close();
                conn.disconnect();

                Log.d(TAG, "APK download completed: " + apkFile.getAbsolutePath());
                triggerInstall(apkFile, call);

            } catch (Exception e) {
                Log.e(TAG, "Failed to download update APK", e);
                call.reject("Download failed: " + e.getMessage());
            }
        });
    }

    private void triggerInstall(File apkFile, PluginCall call) {
        try {
            Context context = getContext();
            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to trigger package installer", e);
            call.reject("Installation failed: " + e.getMessage());
        }
    }
}
