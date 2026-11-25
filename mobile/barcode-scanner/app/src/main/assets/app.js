/* Deed Scan - barcode -> Google Sheet
 * Camera + decoding happen here; storage, feedback and HTTP go through the
 * Native bridge when running inside the APK. In a plain browser it falls back
 * to localStorage + fetch so the same page can be tested on a desktop.
 * Kept to ES2015-era syntax (no async/await, no optional chaining) so older
 * Android WebViews can still run it.
 */
(function () {
  'use strict';

  var Z = window.ZXing;
  var N = window.Native || null;

  var SCAN_INTERVAL_MS = 110;
  var RETRY_MS = 10000;
  var BATCH = 40;
  var SAVED_KEEP = 60;

  // ---------------------------------------------------------------- elements
  function $(id) { return document.getElementById(id); }
  var video = $('video'), statusEl = $('status'), listEl = $('list'), pill = $('pill');
  var camMsg = $('camMsg'), camMsgText = $('camMsgText');
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
         || canvas.getContext('2d');

  // ------------------------------------------------------------------- state
  var DEFAULTS = {
    url: '', secret: '', device: '', ref: '',
    dupMs: 3000, beep: true, vib: true, auto: true, read2d: true
  };
  var S = { settings: copy(DEFAULTS), log: [] };
  var qty = 1, sending = false, lastSend = '', scanning = false;
  var stream = null, track = null, timer = null, frames = 0;
  var lastScan = { code: '', at: 0 };
  var reader = new Z.MultiFormatReader();
  var FORMAT_NAMES = buildFormatNames();

  function copy(o) { var r = {}; for (var k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ------------------------------------------------------------------- host
  var reqSeq = 0, waiting = {};
  window.__httpResult = function (id, status, text) {
    var cb = waiting[id];
    if (!cb) return;
    delete waiting[id];
    cb({ status: status, text: text || '' });
  };

  var host = {
    loadState: function () {
      try { return (N ? N.loadState() : localStorage.getItem('deedscan')) || ''; }
      catch (e) { return ''; }
    },
    saveState: function (json) {
      try { if (N) { N.saveState(json); } else { localStorage.setItem('deedscan', json); } }
      catch (e) { /* storage full or unavailable - keep running */ }
    },
    deviceName: function () {
      try { return N ? N.deviceName() : 'Browser'; } catch (e) { return 'Android'; }
    },
    version: function () {
      try { return N ? N.appVersion() : 'web'; } catch (e) { return '?'; }
    },
    beep: function (kind) {
      if (!S.settings.beep) return;
      try { if (N) { N.beep(kind); return; } } catch (e) { }
      webBeep(kind);
    },
    vibrate: function (ms) {
      if (!S.settings.vib) return;
      try {
        if (N) { N.vibrate(ms); }
        else if (navigator.vibrate) { navigator.vibrate(ms); }
      } catch (e) { }
    },
    post: function (url, body) {
      if (N) {
        return new Promise(function (resolve) {
          var id = 'r' + (++reqSeq);
          var done = false;
          waiting[id] = function (res) { done = true; resolve(res); };
          setTimeout(function () {
            if (!done && waiting[id]) { delete waiting[id]; resolve({ status: 0, text: 'ERR Timed out' }); }
          }, 60000);
          try { N.post(id, url, body); }
          catch (e) { delete waiting[id]; resolve({ status: 0, text: 'ERR ' + e.message }); }
        });
      }
      return fetch(url, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
        .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
        .catch(function (e) { return { status: 0, text: 'ERR ' + e.message }; });
    }
  };

  var audioCtx = null;
  function webBeep(kind) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = kind === 0 ? 1180 : 300;
      g.gain.value = 0.07;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (kind === 0 ? 0.09 : 0.22));
    } catch (e) { }
  }

  // ------------------------------------------------------------ persistence
  function load() {
    var raw = host.loadState();
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && p.settings) for (var k in DEFAULTS) {
        if (p.settings[k] !== undefined && p.settings[k] !== null) S.settings[k] = p.settings[k];
      }
      if (p && Array.isArray(p.log)) S.log = p.log;
    } catch (e) { /* corrupt state - start clean rather than crash */ }
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    saveTimer = null;
    prune();
    try { host.saveState(JSON.stringify({ settings: S.settings, log: S.log })); } catch (e) { }
  }
  /** Never drop unsent rows; only trim the tail of already-saved ones. */
  function prune() {
    var kept = [], savedSeen = 0;
    for (var i = 0; i < S.log.length; i++) {
      var it = S.log[i];
      if (it.status === 'saved') {
        if (savedSeen >= SAVED_KEEP) continue;
        savedSeen++;
      }
      kept.push(it);
    }
    S.log = kept;
  }
  function pending() {
    return S.log.filter(function (i) { return i.status !== 'saved'; });
  }

  // --------------------------------------------------------------- scanning
  function buildFormatNames() {
    var m = {};
    try {
      for (var k in Z.BarcodeFormat) {
        if (typeof Z.BarcodeFormat[k] === 'number') m[Z.BarcodeFormat[k]] = k.replace(/_/g, '-');
      }
    } catch (e) { }
    return m;
  }

  function applyHints() {
    var F = Z.BarcodeFormat;
    var formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93,
                   F.ITF, F.CODABAR, F.RSS_14];
    if (S.settings.read2d) formats = formats.concat([F.QR_CODE, F.DATA_MATRIX, F.AZTEC, F.PDF_417]);
    var hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats.filter(function (f) { return f !== undefined; }));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    try { reader.setHints(hints); } catch (e) { }
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCamMsg('This device’s WebView has no camera support. You can still type codes in by hand.');
      return;
    }
    stopCamera();
    showCamMsg('Starting camera…', true);
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (st) {
      stream = st;
      video.srcObject = st;
      var p = video.play();
      if (p && p.catch) p.catch(function () { });
      track = st.getVideoTracks()[0] || null;
      setupTorch();
      hideCamMsg();
      scanning = true;
      frames = 0;
      if (timer) clearTimeout(timer);
      tick();
      setStatus('Point the camera at a barcode');
    }).catch(function (err) {
      var name = (err && err.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        showCamMsg('Camera permission was denied. Allow it to scan.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        showCamMsg('No usable camera was found on this device.');
      } else if (name === 'NotReadableError') {
        showCamMsg('The camera is busy — close other camera apps and try again.');
      } else {
        showCamMsg('Camera error: ' + (name || (err && err.message) || 'unknown'));
      }
    });
  }

  function stopCamera() {
    scanning = false;
    if (timer) { clearTimeout(timer); timer = null; }
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
    stream = null; track = null;
    try { video.srcObject = null; } catch (e) { }
    $('btnTorch').classList.add('hidden');
  }

  function setupTorch() {
    var btn = $('btnTorch');
    var ok = false;
    try {
      var caps = track && track.getCapabilities ? track.getCapabilities() : null;
      ok = !!(caps && caps.torch);
    } catch (e) { ok = false; }
    btn.classList.toggle('hidden', !ok);
    btn.dataset.on = '0';
  }

  function toggleTorch() {
    if (!track) return;
    var btn = $('btnTorch');
    var on = btn.dataset.on !== '1';
    track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
      btn.dataset.on = on ? '1' : '0';
      btn.style.background = on ? 'var(--accent)' : 'rgba(17,24,35,.82)';
    }).catch(function () { setStatus('Torch is not available on this camera'); });
  }

  function tick() {
    if (!scanning) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        frames++;
        // Most barcodes are held horizontally across the guide, so two of every
        // four frames decode just that band (fast). The other two look at the
        // whole frame, one of them rotated, which is what catches a barcode
        // printed vertically or sitting outside the guide.
        var phase = frames & 3;
        if (phase === 2) decodeFrame('full', true);
        else if (phase === 3) decodeFrame('full', false);
        else decodeFrame('band', false);
      }
    } catch (e) { }
    timer = setTimeout(tick, SCAN_INTERVAL_MS);
  }

  function decodeFrame(mode, rotated) {
    var vw = video.videoWidth, vh = video.videoHeight;
    var srcW, srcH, maxW;
    if (mode === 'band') {
      srcW = Math.round(vw * 0.90); srcH = Math.round(vh * 0.55); maxW = 1100;
    } else {
      srcW = vw; srcH = vh; maxW = 900;
    }
    var outW = srcW, outH = srcH;
    if (outW > maxW) { var k = maxW / outW; outW = Math.round(outW * k); outH = Math.round(outH * k); }
    var sx = Math.round((vw - srcW) / 2), sy = Math.round((vh - srcH) / 2);

    // The rotation is done while drawing rather than on the decoded bitmap:
    // ZXing's canvas luminance source does not always support rotation, and
    // drawImage is hardware-accelerated anyway.
    if (rotated) {
      if (canvas.width !== outH || canvas.height !== outW) { canvas.width = outH; canvas.height = outW; }
      ctx.save();
      ctx.translate(outH / 2, outW / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(video, sx, sy, srcW, srcH, -outW / 2, -outH / 2, outW, outH);
      ctx.restore();
    } else {
      if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; }
      ctx.drawImage(video, sx, sy, srcW, srcH, 0, 0, outW, outH);
    }

    var bmp;
    try {
      var src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
    } catch (e) { return; }

    try {
      var result = reader.decode(bmp);
      if (result) onDecode(result.getText(), FORMAT_NAMES[result.getBarcodeFormat()] || '');
    } catch (e) {
      /* NotFoundException on most frames - that is the normal case */
    } finally {
      try { reader.reset(); } catch (e) { }
    }
  }

  // ------------------------------------------------------------------ scans
  function onDecode(text, format) {
    var code = String(text == null ? '' : text).trim();
    if (!code) return;
    var now = Date.now();
    if (code === lastScan.code && (now - lastScan.at) < Number(S.settings.dupMs || 0)) {
      lastScan.at = now;
      return;
    }
    lastScan = { code: code, at: now };
    addScan(code, format);
  }

  function addScan(code, format) {
    var item = {
      id: uid(), code: code, qty: qty, ref: ($('refField').value || '').trim(),
      at: new Date().toISOString(), fmt: format || 'manual',
      status: 'pending', tries: 0, err: ''
    };
    S.log.unshift(item);
    host.beep(0);
    host.vibrate(45);
    flash(code + (item.qty > 1 ? '  ×' + item.qty : ''));
    setQty(1);
    save();
    render();
    if (S.settings.auto) flush(false);
  }

  // ------------------------------------------------------------- networking
  function rowOf(i) {
    return { id: i.id, code: i.code, qty: i.qty, ref: i.ref, at: i.at, fmt: i.fmt };
  }

  function flush(manual) {
    var items = pending();
    if (sending) { if (manual) setStatus('Already sending…'); return; }
    if (!items.length) { if (manual) setStatus('Everything is already in the sheet'); render(); return; }
    if (!S.settings.url) {
      if (manual) setStatus('Add the web app URL in Settings first', 'err');
      render(); return;
    }
    sending = true;
    render();
    var batch = items.slice(0, BATCH);
    var body = JSON.stringify({
      token: S.settings.secret || '',
      device: deviceLabel(),
      rows: batch.map(rowOf)
    });
    host.post(S.settings.url, body).then(function (res) {
      sending = false;
      var more = applyResult(res, batch, manual);
      saveNow();
      render();
      if (more && pending().length) setTimeout(function () { flush(false); }, 400);
    });
  }

  /** returns true when the batch went through and draining should continue */
  function applyResult(res, batch, manual) {
    var parsed = null;
    if (res.status >= 200 && res.status < 300 && res.text) {
      try { parsed = JSON.parse(res.text); } catch (e) { parsed = null; }
    }
    if (parsed && parsed.ok) {
      var done = {};
      (parsed.saved || []).forEach(function (id) { done[id] = 'saved'; });
      (parsed.skipped || []).forEach(function (id) { done[id] = 'saved'; });
      batch.forEach(function (i) {
        if (done[i.id]) { i.status = 'saved'; i.err = ''; }
      });
      lastSend = '';
      var n = (parsed.saved || []).length;
      setStatus(n ? ('Saved ' + n + ' to the sheet') : 'Sheet already had those rows');
      return true;
    }
    var msg = explain(res, parsed);
    lastSend = msg;
    batch.forEach(function (i) { i.status = 'failed'; i.tries = (i.tries || 0) + 1; i.err = msg; });
    setStatus(msg, 'err');
    if (manual) host.beep(1);
    return false;
  }

  function explain(res, parsed) {
    if (parsed && parsed.error === 'bad_token') return 'Secret rejected — it must match the script';
    if (parsed && parsed.error) return 'Script error: ' + parsed.error;
    if (res.status === 0) {
      var t = String(res.text || '');
      if (/UnknownHost|Unable to resolve/i.test(t)) return 'No internet connection — kept offline';
      if (/timed? out/i.test(t)) return 'Connection timed out — will retry';
      return (t.replace(/^ERR\s*/, '') || 'Network error') + ' — will retry';
    }
    if (res.status === 401 || res.status === 403) {
      return 'Google refused the request (403) — redeploy with access set to "Anyone"';
    }
    if (res.status === 404) return 'URL not found (404) — check the /exec link';
    if (/<html|<!DOCTYPE/i.test(res.text || '')) {
      return 'Got a Google sign-in page — redeploy with access set to "Anyone"';
    }
    if (res.status >= 500) return 'Google script error (' + res.status + ') — will retry';
    return 'Unexpected reply (' + res.status + ') — will retry';
  }

  function deviceLabel() {
    return (S.settings.device || '').trim() || host.deviceName();
  }

  // --------------------------------------------------------------------- UI
  var idleText = 'Point the camera at a barcode';
  var flashTimer = null;

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (kind === 'err' ? ' err' : '');
  }
  function flash(msg) {
    statusEl.textContent = '✓  ' + msg;
    statusEl.className = 'status flash';
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      if (statusEl.className.indexOf('flash') >= 0) setStatus(idleText);
    }, 1100);
  }
  function showCamMsg(text, quiet) {
    camMsgText.textContent = text;
    camMsg.classList.remove('hidden');
    $('btnCamRetry').classList.toggle('hidden', !!quiet);
  }
  function hideCamMsg() { camMsg.classList.add('hidden'); }

  function setQty(v) {
    qty = Math.max(1, Math.min(9999, v | 0));
    $('qtyVal').textContent = qty;
  }

  function render() {
    var p = pending(), saved = S.log.length - p.length;
    if (!S.settings.url) { pill.textContent = 'setup'; pill.className = 'pill'; }
    else if (sending) { pill.textContent = 'sending…'; pill.className = 'pill pend'; }
    else if (p.length) {
      pill.textContent = p.length + ' unsent';
      pill.className = 'pill ' + (lastSend ? 'bad' : 'pend');
    } else { pill.textContent = 'synced'; pill.className = 'pill ok'; }

    $('counts').textContent = S.log.length
      ? (saved + ' saved' + (p.length ? ' · ' + p.length + ' waiting' : ''))
      : '';

    var html = '';
    for (var i = 0; i < Math.min(S.log.length, 80); i++) {
      var it = S.log[i];
      html += '<li><span class="dot ' + it.status + '"></span>'
            + '<span class="code">' + esc(it.code) + (it.qty > 1 ? ' <span class="small">×' + it.qty + '</span>' : '') + '</span>'
            + '<span class="meta">' + time(it.at) + (it.ref ? '<br>' + esc(it.ref) : '') + '</span></li>';
    }
    listEl.innerHTML = html || '<li class="empty">Nothing scanned yet.</li>';
    $('queueInfo').textContent = p.length
      ? p.length + ' scan' + (p.length === 1 ? '' : 's') + ' not in the sheet yet.'
      : 'All scans have reached the sheet.';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function time(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // --------------------------------------------------------------- settings
  function openSettings() {
    $('setUrl').value = S.settings.url;
    $('setSecret').value = S.settings.secret;
    $('setDevice').value = S.settings.device;
    $('setRef').value = S.settings.ref;
    $('setDup').value = (Number(S.settings.dupMs) || 0) / 1000;
    $('setBeep').checked = !!S.settings.beep;
    $('setVib').checked = !!S.settings.vib;
    $('setAuto').checked = !!S.settings.auto;
    $('set2d').checked = !!S.settings.read2d;
    $('verPill').textContent = 'v' + host.version();
    $('testOut').classList.add('hidden');
    $('exportBox').classList.add('hidden');
    render();
    $('settings').classList.remove('hidden');
  }
  function closeSettings() { $('settings').classList.add('hidden'); }

  function saveSettings() {
    S.settings.url = $('setUrl').value.trim();
    S.settings.secret = $('setSecret').value;
    S.settings.device = $('setDevice').value.trim();
    S.settings.ref = $('setRef').value.trim();
    var dup = parseFloat($('setDup').value);
    S.settings.dupMs = isNaN(dup) ? 3000 : Math.max(0, Math.min(60, dup)) * 1000;
    S.settings.beep = $('setBeep').checked;
    S.settings.vib = $('setVib').checked;
    S.settings.auto = $('setAuto').checked;
    S.settings.read2d = $('set2d').checked;
    if (S.settings.url && S.settings.url.indexOf('https://') !== 0) {
      out('The URL has to start with https://', false);
      return;
    }
    applyHints();
    if (!$('refField').value) $('refField').value = S.settings.ref;
    saveNow();
    closeSettings();
    render();
    setStatus('Settings saved');
    if (S.settings.auto) flush(false);
  }

  function out(msg, ok) {
    var el = $('testOut');
    el.textContent = msg;
    el.className = 'testOut' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
    el.classList.remove('hidden');
  }

  function testConnection() {
    var url = $('setUrl').value.trim();
    if (!url) { out('Paste the web app URL first.', false); return; }
    if (url.indexOf('https://') !== 0) { out('The URL has to start with https://', false); return; }
    if (!/\/exec\/?$/.test(url)) {
      out('Heads up: the URL normally ends in /exec — trying anyway…');
    } else {
      out('Contacting the sheet…');
    }
    host.post(url, JSON.stringify({ token: $('setSecret').value, ping: true, device: deviceLabel() }))
      .then(function (res) {
        var p = null;
        try { p = JSON.parse(res.text); } catch (e) { }
        if (p && p.ok) {
          out('Connected ✓\nSheet tab: ' + (p.sheet || '?') + '\nRows already there: ' + (p.rows == null ? '?' : p.rows), true);
        } else {
          out(explain(res, p) + '\n\n' + String(res.text || '').slice(0, 220), false);
        }
      });
  }

  function exportCsv() {
    var p = pending(), box = $('exportBox');
    var lines = ['scanned_at,barcode,qty,reference,device'];
    p.forEach(function (i) {
      lines.push([i.at, i.code, i.qty, i.ref || '', deviceLabel()].map(function (v) {
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    box.value = p.length ? lines.join('\n') : 'Nothing unsent.';
    box.classList.remove('hidden');
    box.focus();
    box.select();
  }

  // ------------------------------------------------------------------ wiring
  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('btnTest').addEventListener('click', testConnection);
  $('btnExport').addEventListener('click', exportCsv);
  $('btnTorch').addEventListener('click', toggleTorch);
  $('btnSync').addEventListener('click', function () { flush(true); });
  $('btnCamRetry').addEventListener('click', function () {
    try { if (N) N.requestCamera(); } catch (e) { }
    startCamera();
  });
  $('qtyPlus').addEventListener('click', function () { setQty(qty + 1); });
  $('qtyMinus').addEventListener('click', function () { setQty(qty - 1); });
  $('refField').addEventListener('change', function () {
    S.settings.ref = $('refField').value.trim();
    save();
  });

  var manual = $('manualWrap');
  $('btnManual').addEventListener('click', function () {
    manual.classList.remove('hidden');
    $('manualInput').value = '';
    $('manualInput').focus();
  });
  $('btnManualCancel').addEventListener('click', function () { manual.classList.add('hidden'); });
  $('btnManualAdd').addEventListener('click', addManual);
  $('manualInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addManual(); }
  });
  function addManual() {
    var v = $('manualInput').value.trim();
    if (!v) { manual.classList.add('hidden'); return; }
    manual.classList.add('hidden');
    lastScan = { code: '', at: 0 };
    addScan(v, 'manual');
  }

  window.__onBack = function () {
    if (!$('settings').classList.contains('hidden')) { closeSettings(); return true; }
    if (!manual.classList.contains('hidden')) { manual.classList.add('hidden'); return true; }
    return false;
  };
  window.__onPause = function () { stopCamera(); saveNow(); };
  window.__onResume = function () { if (!stream) startCamera(); };
  window.__onCameraPermission = function (granted) {
    if (granted) startCamera();
    else showCamMsg('Camera permission is off. Turn it on in Android settings, or type codes in by hand.');
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopCamera(); saveNow(); }
    else if (!stream) startCamera();
  });

  setInterval(function () {
    if (S.settings.auto && S.settings.url && !sending && pending().length) flush(false);
  }, RETRY_MS);

  // -------------------------------------------------------------------- boot
  load();
  applyHints();
  setQty(1);
  $('refField').value = S.settings.ref || '';
  render();
  if (!S.settings.url) {
    setStatus('Open settings (⚙) to connect your sheet');
    idleText = 'Scans are stored on the phone until the sheet is connected';
  }
  startCamera();
  window.__deedscan = { state: function () { return S; }, flush: flush, add: addScan };
})();
