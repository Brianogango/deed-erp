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

## Small, dense labels

A 16-digit Code 128 on a small asset sticker is the hardest case. Measured
against a fixture of one:

| pixels per narrow bar | result |
|---|---|
| ~2.2 | never decodes, at any speed |
| ~3.5 | decodes in ~400 ms |

So it is arithmetic, not luck: fill the guide with the barcode, or use the zoom
button. The app helps by capturing at the highest resolution the camera offers
and, once nothing has read for 2.5 s, switching the strip to full detail
(`detail` appears in the diagnostics line) — slower per frame, but it stops
throwing away the pixels such a label needs.

The strip also alternates orientation every frame, so a barcode printed across
a label's short edge reads without turning the phone. ZXing's 1D readers only
scan horizontal lines, so before 1.7.0 a vertical code depended on the rare
full-frame rotated pass: a vertical EAN-13 now reads in ~400 ms.

## Scanning speed

Measured in Chromium against a fake camera (desktop CPU, so phones are several
times slower — the ratios are what matter):

| | before 1.4.0 | 1.4.0 |
|---|---|---|
| page load → first row, 1080p feed | 1210 ms | ~300 ms |
| guide-band attempts per second @720p | ~14 | ~24 |

What changed:

- The guide band is sized off the frame's **shorter** side, so it stays a strip
  when the phone hands over a portrait frame (720×1280 is common). Taking 60% of
  the height of a portrait frame meant decoding half a megapixel of empty table:
  508k pixels per frame, against 200k now.
- The guide band is decoded on **every** frame. The whole-frame sweeps cost about
  as much again, so they now run every fourth frame and only after 1.2 s of
  finding nothing — they exist for vertical barcodes, not for the common case.
- Capture is requested at 1280×720, not 1920×1080. Every pass downscales below
  720p anyway, so the larger frame only added scaling cost.
- Decode canvases capped at 820 px (band) and 720 px (full) rather than 1100/900.
  Decode cost scales with pixel count; 820 px across is still ~8 px per module
  on an EAN-13 filling the guide.
- Barcodes that carry their own check digit or CRC (EAN, UPC, Code 128, Code 93,
  QR, Data Matrix, Aztec, PDF417) are accepted on the first clean read. Only the
  checksum-less ones pay for the two-sighting confirmation.

If it is still slow on a particular phone, turn on diagnostics and read
`ms/frame`: much over ~120 ms means the decode itself is the bottleneck and the
caps above want lowering further.

## Scans appearing on their own

Three defences, all switchable in Settings:

- **Only accept codes inside the guide.** The decoder deliberately looks at the
  whole frame (that is how a vertical barcode is read), so without this a label
  on the next carton gets scanned while the guide points at nothing. The symbol's
  centre must fall inside the guide band for the row to count.
- **Confirm every scan twice**, within 4 s, and only for the 1D symbologies with
  no check digit (Code 39, ITF, Codabar, DataBar). 2D codes carry error
  correction, so one clean read of a QR, Micro QR, Data Matrix, Aztec or PDF417
  is trusted. The window was 1.5 s in 1.3.0–1.5.0, which on a phone spending
  146 ms per frame is only ten frames: a code that decoded once every few frames
  could never be confirmed, so nothing was ever recorded.
- **ITF / Codabar / DataBar are on**, but always need the double sighting. They
  were off in 1.3.0 and 1.4.0, which made ITF-14 cartons and DataBar labels
  unreadable while other scanner apps managed them fine — too high a price for
  phantom protection that the other two rules already provide.

With diagnostics on, every read that is *not* accepted is announced in the
status bar and in the overlay's `last` line, with the reason — so a code that
looks ignored can be told apart from a code that was never decoded at all.

Diagnostics shows a `rejected` counter — reads that were thrown out by these
rules. If it climbs while you scan normally, the guide gate is too tight for how
you are holding the phone; turn it off and tell me.

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
| *The deployment has no doPost in it* | The deployed version predates the code being pasted. Deploy → Manage deployments → ✏️ → **Version: New version** → Deploy. Editing the code does **not** change what a deployment serves. |
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
- Uploads go through Java (`Http.postText`), not `fetch`. Apps Script does not answer
  CORS preflights, and the page's origin is `file://`; going through Java sidesteps
  CORS entirely and gives real error messages.
- `Http` follows redirects itself and never uses fixed-length streaming mode. A
  successful Apps Script POST answers 302 to `script.googleusercontent.com`, and in
  streaming mode `HttpURLConnection` cannot replay the body, so it throws
  `HttpRetryException: cannot retry due to redirection` on every successful upload.
  That bug shipped in 1.0.0 and 1.1.0.
- The decoder runs four passes per cycle: two over the centre band (the common
  horizontal case), one over the whole frame rotated 90° (vertical barcodes), one
  over the whole frame. Tested against EAN-13, Code 128, QR and a vertical EAN-13.
