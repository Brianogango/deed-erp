/**
 * Deed Scan - Google Sheets receiver.
 *
 * Paste this into Extensions > Apps Script in the spreadsheet you want the
 * scans to land in, run setup() once, then Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone) and paste the /exec URL
 * into the Android app.
 *
 * The app sends JSON as text/plain on purpose: Apps Script does not answer
 * CORS preflights, and text/plain avoids one. The body is still JSON.
 */

const SHEET_NAME = 'Scans';
const HEADERS = ['Logged at', 'Scanned at (device)', 'Barcode', 'Qty', 'Reference', 'Device', 'Format', 'Scan ID'];
const ID_COL = 8;          // 'Scan ID'
const DEDUPE_LOOKBACK = 2000;

/** POST from the app: either {ping:true} or {rows:[...]}. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty_request' });
    }
    const body = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (expected && String(body.token || '') !== expected) {
      return json({ ok: false, error: 'bad_token' });
    }

    const sh = sheet();

    if (body.ping) {
      return json({ ok: true, pong: true, sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow() - 1) });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ ok: true, saved: [], skipped: [] });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return json({ ok: false, error: 'busy_try_again' });
    try {
      const seen = recentIds(sh);
      const device = String(body.device || '');
      const now = new Date();
      const append = [], saved = [], skipped = [];

      rows.forEach(function (r) {
        const id = String(r.id || '');
        if (!id) return;
        if (seen[id]) { skipped.push(id); return; }
        seen[id] = true;
        const qty = Number(r.qty);
        append.push([
          now,
          String(r.at || ''),
          String(r.code == null ? '' : r.code),
          isFinite(qty) && qty > 0 ? qty : 1,
          String(r.ref || ''),
          device,
          String(r.fmt || ''),
          id
        ]);
        saved.push(id);
      });

      if (append.length) {
        sh.getRange(sh.getLastRow() + 1, 1, append.length, HEADERS.length).setValues(append);
      }
      return json({ ok: true, saved: saved, skipped: skipped });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Opening the /exec URL in a browser should say something useful. */
function doGet() {
  const sh = sheet();
  return json({ ok: true, service: 'Deed Scan receiver', sheet: SHEET_NAME, rows: Math.max(0, sh.getLastRow() - 1) });
}

/** Run once from the editor: creates the tab, the header row and a secret. */
function setup() {
  const sh = sheet();
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SHARED_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('SHARED_SECRET', secret);
  }
  const msg = 'Sheet tab "' + SHEET_NAME + '" is ready.\n\nShared secret (paste into the app):\n' + secret;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (ignored) { }
  return secret;
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 3, sh.getMaxRows(), 1).setNumberFormat('@');   // keep leading zeros on barcodes
    sh.getRange(1, ID_COL, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 190);
  }
  return sh;
}

/** Scan IDs already in the sheet, so a retried batch cannot double-post. */
function recentIds(sh) {
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  const n = Math.min(DEDUPE_LOOKBACK, last - 1);
  const values = sh.getRange(last - n + 1, ID_COL, n, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const v = String(values[i][0] || '');
    if (v) out[v] = true;
  }
  return out;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
