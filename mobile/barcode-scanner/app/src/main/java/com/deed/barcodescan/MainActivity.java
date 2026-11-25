package com.deed.barcodescan;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Single-activity shell. The scanner UI lives in assets/ (HTML + ZXing JS);
 * this class owns the camera permission handshake, feedback (beep/vibrate),
 * persistent storage and all outbound HTTP.
 *
 * HTTP is deliberately done here rather than with fetch() in the WebView:
 * the page's origin is file://, and a Google Apps Script web app does not
 * answer CORS preflights, so a JS POST would be blocked. From Java there is
 * no CORS, and redirects (script.google.com -> googleusercontent.com) and
 * real error messages come through intact.
 */
public class MainActivity extends Activity {

    private static final int REQ_CAMERA = 4201;
    private static final String PREFS = "deedscan";
    private static final String KEY_STATE = "state";

    WebView web;
    private PermissionRequest pendingWebRequest;
    ToneGenerator tones;
    final Handler main = new Handler(Looper.getMainLooper());
    final ExecutorService net = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setBackgroundColor(0xFF0B0F14);
        if (Build.VERSION.SDK_INT >= 19) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                main.post(new Runnable() {
                    @Override public void run() { handleWebPermission(request); }
                });
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("DeedScan", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(this), "Native");
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl("file:///android_asset/index.html");
    }

    // ---------------------------------------------------------------- camera

    private void handleWebPermission(PermissionRequest request) {
        boolean wantsVideo = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        }
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (hasCamera()) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingWebRequest = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    boolean hasCamera() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_CAMERA) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingWebRequest != null) {
            if (granted) {
                pendingWebRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingWebRequest.deny();
            }
            pendingWebRequest = null;
        }
        jsEval("window.__onCameraPermission && window.__onCameraPermission(" + granted + ")");
    }

    // ------------------------------------------------------------- lifecycle

    @Override protected void onPause() {
        jsEval("window.__onPause && window.__onPause()");
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        jsEval("window.__onResume && window.__onResume()");
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(window.__onBack && window.__onBack()) === true",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String handled) {
                        if (!"true".equals(handled)) finish();
                    }
                });
    }

    @Override protected void onDestroy() {
        net.shutdownNow();
        if (tones != null) { tones.release(); tones = null; }
        super.onDestroy();
    }

    void jsEval(final String script) {
        main.post(new Runnable() {
            @Override public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    // ---------------------------------------------------------------- bridge

    /** Public + static on purpose: WebView reflects over this class, and a
     *  private inner class makes javac emit a synthetic constructor that
     *  build-tools 34's d8 cannot dex. */
    public static final class Bridge {

        private final MainActivity act;

        Bridge(MainActivity act) {
            this.act = act;
        }

        @JavascriptInterface
        public String loadState() {
            return act.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATE, "");
        }

        @JavascriptInterface
        public void saveState(String json) {
            SharedPreferences.Editor e = act.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            e.putString(KEY_STATE, json);
            e.apply();
        }

        @JavascriptInterface
        public String deviceName() {
            String n = Build.MODEL == null ? "Android" : Build.MODEL;
            return n.trim().isEmpty() ? "Android" : n;
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        @JavascriptInterface
        public boolean cameraGranted() {
            return act.hasCamera();
        }

        @JavascriptInterface
        public void requestCamera() {
            act.main.post(new Runnable() {
                @Override public void run() {
                    if (!act.hasCamera()) {
                        act.requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    } else {
                        act.jsEval("window.__onCameraPermission && window.__onCameraPermission(true)");
                    }
                }
            });
        }

        @JavascriptInterface
        public void vibrate(final int ms) {
            try {
                Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            } catch (Exception ignored) { }
        }

        /** kind: 0 = scan accepted, 1 = error/rejected */
        @JavascriptInterface
        public void beep(final int kind) {
            try {
                if (act.tones == null) act.tones = new ToneGenerator(AudioManager.STREAM_MUSIC, 90);
                if (kind == 0) {
                    act.tones.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
                } else {
                    act.tones.startTone(ToneGenerator.TONE_PROP_NACK, 240);
                }
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void toast(final String msg) {
            act.main.post(new Runnable() {
                @Override public void run() {
                    Toast.makeText(act, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        /**
         * POST a text/plain body (JSON inside) and hand the raw result back to JS.
         * text/plain keeps Apps Script happy; the payload is still parsed as JSON there.
         */
        @JavascriptInterface
        public void post(final String reqId, final String url, final String body) {
            if (url == null || !url.startsWith("https://")) {
                act.deliver(reqId, 0, "ERR The Web app URL must start with https://");
                return;
            }
            act.net.execute(new Runnable() {
                @Override public void run() {
                    try {
                        Http.Resp r = Http.postText(url, body, 15000, 45000);
                        act.deliver(reqId, r.code, r.text);
                    } catch (Exception e) {
                        act.deliver(reqId, 0, "ERR " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    }
                }
            });
        }
    }

    /** Google's error pages put the useful sentence in the last 100 bytes of a
     *  5 KB page, so a body that has to be shortened keeps both ends. */
    private static final int MAX_BODY = 20000;

    void deliver(String reqId, int status, String text) {
        if (text == null) text = "";
        if (text.length() > MAX_BODY) {
            int half = MAX_BODY / 2;
            text = text.substring(0, half) + "\n...\n" + text.substring(text.length() - half);
        }
        jsEval("window.__httpResult && window.__httpResult("
                + JSONObject.quote(reqId) + "," + status + "," + JSONObject.quote(text) + ")");
    }

}
