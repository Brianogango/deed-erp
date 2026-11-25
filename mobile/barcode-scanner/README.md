# Deed Scan — barcode scanner for Google Sheets

An Android app that scans barcodes with the phone camera and appends a row to a
Google Sheet for every scan. Scans taken with no signal are kept on the phone and
sent as soon as the connection is back.

- `app/src/main/assets/` — the scanner itself (HTML + JS + ZXing)
- `app/src/main/java/` — the Android shell: camera permission, beep/vibrate, storage, HTTP
- `docs/apps-script/Code.gs` — the receiver you paste into your spreadsheet
- `scripts/build.sh` — builds the APK without Gradle

## 1. Set up the sheet (once, about 3 minutes)

1. Open (or create) the Google Sheet the scans should land in.
2. **Extensions → Apps Script**. Delete the sample code, paste all of
   [`docs/apps-script/Code.gs`](docs/apps-script/Code.gs), and save.
3. Pick `setup` in the function dropdown and press **Run**. Approve the permission
   prompt (it is your own script asking to edit your own sheet). It creates a
   **Scans** tab and shows a **shared secret** — copy it.
4. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Deploy, then copy the **Web app URL** — it ends in `/exec`.

"Anyone" means anyone who knows that long URL can POST to it, which is why the
shared secret exists: requests without it are rejected. Treat the URL and the
secret like a password.

## 2. Install the app

Copy `deed-scan.apk` to the phone and open it. Android will ask you to allow
installing from this source — that prompt is normal for apps that do not come
from the Play Store. Grant the camera permission when the app first opens.

## 3. Connect the app

Open **⚙ Settings** in the app and fill in:

| Field | Value |
|---|---|
| Web app URL | the `/exec` URL from step 1 |
| Shared secret | the secret `setup` printed |
| Device / operator name | whatever should appear in the sheet, e.g. `Store counter 1` |
| Default reference | optional, e.g. a GRN or stock-take number |

Tap **Test connection** — it should say *Connected ✓* with the current row count.
Then **Save**.

## Using it

- Point the camera at a barcode. On a successful read the phone beeps, vibrates,
  and the row appears in **Recent scans**.
- **Qty** applies to the next scan and resets to 1 afterwards. **Reference** stays
  until you change it, and is written on every row.
- A green dot means the row is in the sheet, amber means it is queued, red means
  the last send failed. Everything queued is retried every 10 seconds and whenever
  you tap **Sync now**.
- **Type code** enters a barcode by hand when one is damaged or unreadable.
- The same barcode is ignored while it stays in view, and becomes scannable again
  a few seconds after it leaves the frame (adjustable in settings).
- Retries cannot create duplicate rows: every scan carries an id and the script
  skips ids it has already written.

Each row in the sheet is: logged-at, scanned-at (device clock), barcode, qty,
reference, device, barcode format, scan id.

## When the camera will not read a barcode

In order, the things that actually fix it:

1. **Tap the preview.** That forces a refocus. A barcode held closer than ~15 cm is
   usually just out of focus.
2. **Switch camera** (⇄, bottom-left of the preview, shown when the phone has more
   than one). Many phones expose an ultra-wide or depth lens alongside the main one,
   and the app cannot always tell which is which — an ultra-wide cannot focus close
   enough to read a barcode. Settings → **Camera** picks one permanently.
3. **Zoom** (the `1×` button) for small or distant codes, **torch** (💡) in poor light.
4. Hold the code so it fills most of the width of the guide, roughly square-on, and
   pause — motion blur stops more scans than anything else.
5. Settings → **Show scanner diagnostics** overlays `resolution · fps · ms/frame ·
   frames · reads`. If resolution is `0×0` the camera never started; if `reads` stays
   at 0 while fps is healthy, the frames are reaching the decoder but are too blurry
   or too small.

## Troubleshooting

| What you see | What it means |
|---|---|
| *Got a Google sign-in page* | The deployment's access is not **Anyone**. Redeploy. |
| *Google refused the request (403)* | Same as above, or the URL points at an old deployment. |
| *Secret rejected* | The secret in settings differs from `SHARED_SECRET` in Project Settings → Script properties. |
| *No internet connection — kept offline* | Nothing is lost; scans stay queued. |
| Rows stop appearing after editing the script | A new deployment gets a **new** `/exec` URL. Use *Manage deployments → Edit → New version* to keep the old URL. |

If you ever need the queued scans out of a phone that cannot reach the sheet,
Settings → **Show unsent as CSV** prints them for copy and paste.

## Rebuilding

```bash
sdkmanager "platforms;android-34" "build-tools;35.0.0"
ANDROID_HOME=~/android-sdk ./scripts/build.sh
```

The APK lands in `build/deed-scan.apk`. The first build generates a local signing
key in `keystore/`, which is deliberately **not** committed. Android refuses to
install an update signed with a different key, so keep that file if you want
in-place updates — otherwise uninstall the old app before installing a new build.
For Play Store distribution, create a proper release key instead.

Notes for whoever maintains this:

- build-tools **34.0.0 will not work** — its `d8` crashes on this code. 35.0.0+ is fine.
- Uploads go through Java (`MainActivity.Bridge.post`), not `fetch`. Apps Script does
  not answer CORS preflights, and the page's origin is `file://`; going through Java
  sidesteps CORS entirely and gives real error messages.
- The decoder runs four passes per cycle: two over the centre band (the common
  horizontal case), one over the whole frame rotated 90° (vertical barcodes), one
  over the whole frame. Tested against EAN-13, Code 128, QR and a vertical EAN-13.
