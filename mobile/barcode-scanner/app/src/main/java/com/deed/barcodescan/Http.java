package com.deed.barcodescan;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * A small HTTPS POST that follows redirects by hand.
 *
 * Two reasons it does not simply let HttpURLConnection do it:
 *
 *  - In fixed-length streaming mode HttpURLConnection cannot replay the request
 *    body, so it refuses to follow a redirect and throws HttpRetryException. A
 *    successful Apps Script POST answers 302 to script.googleusercontent.com, so
 *    streaming mode breaks every successful upload. The body is small; it is
 *    buffered instead.
 *  - Following redirects here means each hop can be checked for https, and the
 *    real status and body of the final hop reach the caller instead of a 302.
 */
final class Http {

    static final class Resp {
        final int code;
        final String text;
        Resp(int code, String text) {
            this.code = code;
            this.text = text == null ? "" : text;
        }
    }

    private Http() { }

    static Resp postText(String urlStr, String body, int connectMs, int readMs) throws Exception {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        String current = urlStr;
        boolean post = true;

        for (int hop = 0; hop < 6; hop++) {
            if (!current.toLowerCase(Locale.US).startsWith("https://")) {
                return new Resp(0, "ERR refused to follow a redirect away from https");
            }
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            try {
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(connectMs);
                c.setReadTimeout(readMs);
                c.setRequestProperty("Accept", "application/json, text/plain, */*");
                if (post) {
                    c.setRequestMethod("POST");
                    c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
                    c.setDoOutput(true);
                    OutputStream os = c.getOutputStream();
                    os.write(payload);
                    os.flush();
                    os.close();
                } else {
                    c.setRequestMethod("GET");
                }

                int code = c.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null || loc.trim().length() == 0) {
                        return new Resp(code, "ERR redirect with no Location header");
                    }
                    current = new URL(new URL(current), loc.trim()).toString();
                    post = (code == 307 || code == 308);   // 301/302/303 continue as GET
                    continue;
                }

                InputStream in = (code >= 200 && code < 300) ? c.getInputStream() : c.getErrorStream();
                return new Resp(code, read(in));
            } finally {
                c.disconnect();
            }
        }
        return new Resp(0, "ERR too many redirects");
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
