package com.navguard.app;

import android.content.Context;
import android.util.Log;
import org.json.JSONObject;
import java.io.InputStream;

/**
 * ServerConfigHelper
 * Dynamically resolves the backend server URL without hardcoding.
 * Priority order:
 * 1. capacitor.config.json in assets (automatically synced from root config during build)
 * 2. strings.xml (res/values/strings.xml -> server_base_url)
 * 3. Default production fallback
 */
public class ServerConfigHelper {
    private static final String TAG = "ServerConfigHelper";
    private static volatile String cachedBaseUrl = null;

    public static synchronized String getBaseServerUrl(Context context) {
        if (cachedBaseUrl != null && !cachedBaseUrl.isEmpty()) {
            return cachedBaseUrl;
        }

        // 1. Try reading from capacitor.config.json in Android assets
        if (context != null) {
            try {
                InputStream is = context.getAssets().open("capacitor.config.json");
                int size = is.available();
                byte[] buffer = new byte[size];
                is.read(buffer);
                is.close();
                String jsonStr = new String(buffer, "UTF-8");
                JSONObject config = new JSONObject(jsonStr);
                JSONObject server = config.optJSONObject("server");
                if (server != null) {
                    String url = server.optString("url", null);
                    if (url != null && !url.isEmpty() && !url.contains("localhost") && !url.contains("127.0.0.1") && !url.contains("capacitor://")) {
                        cachedBaseUrl = url.replaceAll("/+$", "");
                        Log.d(TAG, "Resolved server URL from capacitor.config.json: " + cachedBaseUrl);
                        return cachedBaseUrl;
                    }
                }
            } catch (Exception ignored) {}

            // 2. Try reading from strings.xml resource
            try {
                int resId = context.getResources().getIdentifier("server_base_url", "string", context.getPackageName());
                if (resId != 0) {
                    String stringUrl = context.getString(resId);
                    if (stringUrl != null && !stringUrl.isEmpty() && !stringUrl.contains("localhost")) {
                        cachedBaseUrl = stringUrl.replaceAll("/+$", "");
                        Log.d(TAG, "Resolved server URL from strings.xml: " + cachedBaseUrl);
                        return cachedBaseUrl;
                    }
                }
            } catch (Exception ignored) {}
        }

        // 3. Fallback default
        cachedBaseUrl = "https://navguard-eight.vercel.app";
        return cachedBaseUrl;
    }

    /**
     * Sanitizes any endpoint URL. If it contains localhost/capacitor:// loopbacks or is empty,
     * it replaces the host with the dynamic server base URL.
     */
    public static String sanitizeServerUrl(Context context, String url, String defaultEndpointPath) {
        if (url == null || url.trim().isEmpty() || url.contains("localhost") || url.contains("127.0.0.1") || url.contains("capacitor://")) {
            return getBaseServerUrl(context) + defaultEndpointPath;
        }
        return url;
    }
}
