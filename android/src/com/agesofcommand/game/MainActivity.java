package com.agesofcommand.game;

import android.app.Activity;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Ages of Command for Android: the same game files as the desktop and browser versions, shipped
 * in the APK's assets/game folder and shown full screen in the system WebView. Pages are served
 * from https://appassets.androidplatform.net/ (a host reserved for app assets, so the game's
 * ES modules and fetch() calls work as on a web server). Saves and settings are files in the
 * app's private storage, reached by the page through the AOCNative bridge (src/ui/storage.js).
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/index.html";
    static final Charset UTF8 = Charset.forName("UTF-8");

    WebView web;
    long lastBack;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100); // the game has its own interface scale setting
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(this, new File(getFilesDir(), "store")), "AOCNative");
        web.setWebViewClient(new Assets(getAssets()));
        setContentView(web);
        immersive();
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(START);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) immersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Back closes the open dialog or selection (Escape in the game); twice quickly leaves. */
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 1500) {
            super.onBackPressed();
            return;
        }
        lastBack = now;
        web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))", null);
        Toast.makeText(this, "Press back again to leave the game", Toast.LENGTH_SHORT).show();
    }

    @SuppressWarnings("deprecation")
    void immersive() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    /** Serves assets/game/... for the app host; everything else (the internet) is refused. */
    static class Assets extends WebViewClient {
        final AssetManager am;
        static final Map<String, String> TYPES = new HashMap<String, String>();
        static {
            TYPES.put("html", "text/html");
            TYPES.put("js", "text/javascript");
            TYPES.put("mjs", "text/javascript");
            TYPES.put("css", "text/css");
            TYPES.put("json", "application/json");
            TYPES.put("png", "image/png");
            TYPES.put("svg", "image/svg+xml");
            TYPES.put("md", "text/markdown");
            TYPES.put("txt", "text/plain");
        }

        Assets(AssetManager am) { this.am = am; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            if (!HOST.equals(req.getUrl().getHost())) return status(403, "Forbidden");
            String path = req.getUrl().getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return status(403, "Forbidden");
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
            String type = TYPES.get(ext);
            if (type == null) type = "application/octet-stream";
            try {
                InputStream in = am.open("game" + path);
                WebResourceResponse r = new WebResourceResponse(type, "utf-8", in);
                Map<String, String> h = new HashMap<String, String>();
                h.put("Cache-Control", "no-cache");
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return status(404, "Not Found");
            }
        }

        @Override
        @SuppressWarnings("deprecation") // the request variant is API 24; the SDK used to build is API 23
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !HOST.equals(android.net.Uri.parse(url).getHost()); // never navigate away from the game
        }

        static WebResourceResponse status(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<String, String>(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    /**
     * The page's file store: one file per key in the app's private folder, written to a
     * temporary file and renamed so a crash never leaves half a save. Methods run on a WebView
     * thread, so they are synchronized.
     */
    static class Bridge {
        final Activity activity;
        final File dir;

        Bridge(Activity activity, File dir) {
            this.activity = activity;
            this.dir = dir;
            dir.mkdirs();
        }

        /** The main menu's Exit button. */
        @JavascriptInterface
        public void exit() {
            activity.runOnUiThread(new Runnable() {
                public void run() { activity.finishAndRemoveTask(); }
            });
        }

        @JavascriptInterface
        public String info() {
            try {
                JSONObject o = new JSONObject();
                o.put("app", "ages-of-command");
                o.put("platform", "android");
                o.put("version", BuildConfig.VERSION);
                o.put("dataDir", dir.getAbsolutePath());
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public synchronized String all() {
            JSONObject o = new JSONObject();
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    String n = f.getName();
                    if (!n.endsWith(".dat")) continue;
                    try {
                        o.put(unescape(n.substring(0, n.length() - 4)), read(f));
                    } catch (Exception e) {
                        // skip an unreadable file rather than lose every other save
                    }
                }
            }
            return o.toString();
        }

        @JavascriptInterface
        public synchronized boolean put(String key, String value) {
            File f = new File(dir, escape(key) + ".dat"), tmp = new File(dir, escape(key) + ".tmp");
            try {
                FileOutputStream out = new FileOutputStream(tmp);
                try {
                    out.write(value.getBytes(UTF8));
                    out.getFD().sync();
                } finally {
                    out.close();
                }
                return tmp.renameTo(f);
            } catch (IOException e) {
                tmp.delete();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void remove(String key) {
            new File(dir, escape(key) + ".dat").delete();
        }

        static String read(File f) throws IOException {
            FileInputStream in = new FileInputStream(f);
            try {
                ByteArrayOutputStream b = new ByteArrayOutputStream((int) f.length());
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
                return new String(b.toByteArray(), UTF8);
            } finally {
                in.close();
            }
        }

        /** Same escaping as the desktop launcher: characters outside A-Z a-z 0-9 . _ - become ~xx. */
        static String escape(String key) {
            StringBuilder sb = new StringBuilder();
            for (byte c : key.getBytes(UTF8)) {
                int b = c & 0xff;
                if ((b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || (b == '.' && sb.length() > 0) || b == '_' || b == '-') sb.append((char) b);
                else sb.append(String.format(Locale.ROOT, "~%02x", b));
            }
            return sb.toString();
        }

        static String unescape(String name) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            for (int i = 0; i < name.length(); i++) {
                char c = name.charAt(i);
                if (c == '~' && i + 2 < name.length()) {
                    b.write(Integer.parseInt(name.substring(i + 1, i + 3), 16));
                    i += 2;
                } else b.write(c);
            }
            return new String(b.toByteArray(), UTF8);
        }
    }
}
