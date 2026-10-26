/* Local-only port of brow_classifier.py. All configurable thresholds come from thresholds.json. */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const median = a => { const b = Array.from(a).sort((x, y) => x - y); const m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : 0; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const norm = a => Math.sqrt(dot(a, a));
  const mix = (a, b, t) => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
  const linspace = (a, b, n) => Array.from({length: n}, (_, i) => i === n - 1 ? b : a + i * ((b - a) / (n - 1)));
  // CPython round(float, ndigits): round the exact binary value, ties to even.
  function pyRound(x, places) {
    if (!Number.isFinite(x) || x === 0) return x;
    const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, Math.abs(x));
    const bits = v.getBigUint64(0), exp = Number((bits >> 52n) & 2047n);
    let n = bits & ((1n << 52n) - 1n); if (exp) n |= 1n << 52n;
    let power = (exp ? exp - 1023 : -1022) - 52;
    n *= 10n ** BigInt(places);
    let d = 1n; if (power < 0) d <<= BigInt(-power); else n <<= BigInt(power);
    let q = n / d, r = n % d;
    if (2n * r > d || (2n * r === d && q % 2n)) q++;
    return Math.sign(x) * Number(q) / 10 ** places;
  }
  function interp(points, s) { return s.map(value => { const t = clamp(value * (points.length - 1), 0, points.length - 1 - 1e-6); const i = Math.trunc(t); return mix(points[i], points[i + 1], t - i); }); }
  // Reference environment: OpenCV 5.0 accurate INTER_LINEAR, float32 coordinates;
  // continuous bilinear interpolation (verified against the installed Python build).
  function sample(gray, width, height, p) {
    const xx = Math.fround(p[0]), yy = Math.fround(p[1]);
    const x = Math.floor(xx), y = Math.floor(yy), fx = xx - x, fy = yy - y;
    const at = (dx, dy) => gray[clamp(y + dy, 0, height - 1) * width + clamp(x + dx, 0, width - 1)];
    return Math.fround(at(0, 0) * (1 - fx) * (1 - fy) + at(1, 0) * fx * (1 - fy) + at(0, 1) * (1 - fx) * fy + at(1, 1) * fx * fy);
  }
  function patchMedian(gray, width, height, center, radius) {
    const x = Math.trunc(center[0]), y = Math.trunc(center[1]), r = Math.max(2, Math.trunc(radius)), values = [];
    for (let j = Math.max(0, y - r); j < Math.min(height, y + r); j++) for (let i = Math.max(0, x - r); i < Math.min(width, x + r); i++) values.push(gray[j * width + i]);
    return median(values);
  }
  function browFeatures(gray, width, height, P, side, ipd, up, cheek, TH) {
    const L = TH.landmarks, S = TH.sampling, Q = TH.quality;
    const upper = L[`brow_${side}_upper`].map(i => P[i]), lower = L[`brow_${side}_lower`].map(i => P[i]);
    const n = S.n_along, across = S.n_across, s = linspace(.02, .98, n), U = interp(upper, s), D = interp(lower, s);
    const ref = linspace(...S.skin_ref_offset_ipd, 4).flatMap(o => U.map(p => sample(gray, width, height, [p[0] + up[0] * ipd * o, p[1] + up[1] * ipd * o])));
    const forehead = median(ref); let skin = forehead, covered = false;
    if (cheek && forehead < cheek * Q.forehead_cheek_ratio) { skin = cheek * Q.cheek_skin_factor; covered = true; }
    const margin = S.band_margin_ipd * ipd;
    const top = U.map(p => [p[0] + up[0] * margin, p[1] + up[1] * margin]);
    const bot = D.map(p => [p[0] - up[0] * margin, p[1] - up[1] * margin]);
    const steps = linspace(0, 1, across), coreSteps = linspace(0, 1, Math.max(8, Math.floor(across / 2)));
    const thickness = s.map((_, i) => steps.filter(t => sample(gray, width, height, mix(top[i], bot[i], t)) < skin * S.dark_ratio).length * (norm(sub(top[i], bot[i])) / across) / ipd);
    const density = s.map((_, i) => coreSteps.filter(t => sample(gray, width, height, mix(U[i], D[i], t)) < skin * S.dark_ratio).length / coreSteps.length);
    const lid = P[L[`eye_${side}`].upper];
    const heightValues = U.map((p, i) => dot(sub(mix(p, D[i], .5), lid), up));
    const lowerValues = D.map(p => dot(sub(p, lid), up));
    const heightMean = mean(heightValues.slice(Math.floor(n / 3), Math.floor(2 * n / 3))) / ipd;
    const lowerMean = mean(lowerValues.slice(Math.floor(n / 3), Math.floor(2 * n / 3))) / ipd;
    const c5 = upper.map((p, i) => mix(p, lower[i], .5)), hy = c5.map(p => dot(sub(p, c5[0]), up));
    const pk = 1 + hy.slice(1, 4).indexOf(Math.max(...hy.slice(1, 4)));
    const v1 = sub(c5[0], c5[pk]), v2 = sub(c5[4], c5[pk]);
    const arch = 180 - Math.acos(clamp(dot(v1, v2) / (norm(v1) * norm(v2) + 1e-9), -1, 1)) * 180 / Math.PI;
    const segment = (a, lo, hi) => a.filter((_, i) => s[i] >= lo && s[i] <= hi);
    const mid = segment(thickness, .1, .9), diff = mid.slice(1).map((v, i) => v - mid[i]), diffMean = mean(diff);
    const uneven = Math.sqrt(mean(diff.map(v => (v - diffMean) ** 2))) / (mean(mid) + 1e-6);
    const [w0, w1] = TH.mark30.window;
    const smooth = density.map((v, i) => (density[i - 1] || 0) / 3 + v / 3 + (density[i + 1] || 0) / 3);
    const win = smooth.filter((_, i) => s[i] >= w0 && s[i] <= w1), positions = s.filter(v => v >= w0 && v <= w1);
    const refs = smooth.filter((_, i) => !(s[i] >= w0 && s[i] <= w1) && s[i] >= .08 && s[i] <= .9);
    return {skin_ref: pyRound(skin, 1), forehead_ref: pyRound(forehead, 1), forehead_covered: covered,
      height: pyRound(heightMean, 4), lower_height: pyRound(lowerMean, 4), arch_deg: pyRound(arch, 2),
      thickness_mean: pyRound(mean(mid), 4), thickness_inner: pyRound(mean(segment(thickness, .05, .30)), 4), thickness_outer: pyRound(mean(segment(thickness, .70, .95)), 4),
      density_mean: pyRound(mean(segment(density, .1, .9)), 4), density_inner: pyRound(mean(segment(density, .05, .35)), 4), density_outer: pyRound(mean(segment(density, .55, .95)), 4),
      uneven_cv: pyRound(uneven, 4), mark30_win_min: pyRound(Math.min(...win), 4), mark30_ref: pyRound(median(refs), 4), mark30_pos: pyRound(positions[win.indexOf(Math.min(...win))], 3)};
  }
  function classify(f, TH) {
    const R = TH.rules, scores = {};
    scores.tief = (R.height_low - f.height) / R.height_low * 4;
    scores.hoch_winkel = (f.height - R.height_high) / R.height_high * 4;
    scores.duenn = Math.max((R.thin_thickness - f.thickness_mean) / R.thin_thickness, (R.thin_density - f.density_mean) / R.thin_density) * 3;
    const ratioD = f.density_outer / (f.density_inner + 1e-6), ratioT = f.thickness_outer / (f.thickness_inner + 1e-6);
    let wechsel = Math.max((R.wechselt_outer_inner_ratio - ratioD) / R.wechselt_outer_inner_ratio * 3, (R.wechselt_thick_ratio - ratioT) / R.wechselt_thick_ratio * 3);
    if (f.density_inner < R.wechselt_min_inner_density) wechsel = Math.min(wechsel, -.01);
    scores.dichte_wechselt = wechsel;
    scores.breiter_zum_ende = (ratioT - R.breiter_outer_inner_ratio) / R.breiter_outer_inner_ratio * 4;
    if (f.thickness_inner < .02 || f.density_inner < .05) { scores.dichte_wechselt = Math.min(scores.dichte_wechselt, -.01); scores.breiter_zum_ende = Math.min(scores.breiter_zum_ende, -.01); }
    for (const key of Object.keys(scores)) scores[key] = clamp(scores[key], -3, 3);
    const firing = Object.keys(scores).filter(k => scores[k] > 0).sort((a, b) => scores[b] - scores[a] || TH.priority.indexOf(a) - TH.priority.indexOf(b));
    const form = firing[0] || 'dicht', confidence = .55 + .4 * Math.min(1, firing.length ? scores[form] : -Math.max(...Object.values(scores)));
    return {form, subtype: form === 'duenn' && f.uneven_cv > R.uneven_cv ? 'duenn_unruhig' : null, confidence: pyRound(confidence, 2), angle_sharp: f.arch_deg >= R.arch_sharp_deg,
      scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, pyRound(v, 3)])), secondary: firing.slice(1)};
  }
  function faceQuality(gray, width, height, P) {
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const x0 = Math.max(0, Math.trunc(Math.min(...xs))), y0 = Math.max(0, Math.trunc(Math.min(...ys)));
    const x1 = Math.min(width, Math.trunc(Math.max(...xs))), y1 = Math.min(height, Math.trunc(Math.max(...ys)));
    if (x1 <= x0 || y1 <= y0) return {mean: 0, lap: 0, empty: true};
    const reflect = (i, lo, hi) => hi - lo <= 1 ? lo : i < lo ? lo + 1 : i >= hi ? hi - 2 : i;
    const at = (x, y) => gray[reflect(y, y0, y1) * width + reflect(x, x0, x1)];
    let sum = 0, lapSum = 0, lapSq = 0, count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = at(x, y), lap = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * v;
      sum += v; lapSum += lap; lapSq += lap * lap; count++;
    }
    return {mean: sum / count, lap: lapSq / count - (lapSum / count) ** 2, empty: false};
  }
  function analyzeLandmarks({gray, width, height, faces}, TH) {
    const Q = TH.quality, L = TH.landmarks;
    if (!faces || !faces.length) return {ok: false, error: 'no_face'};
    const faceWidth = f => Math.max(...f.map(p => p.x)) - Math.min(...f.map(p => p.x));
    if (faces.length > Q.max_faces) {
      faces = [...faces].sort((a, b) => faceWidth(b) - faceWidth(a));
      if (faceWidth(faces[1]) > .5 * faceWidth(faces[0])) return {ok: false, error: 'multiple_faces'};
    }
    const P = faces[0].map(p => [p.x * width, p.y * height]);
    const ir = P.length > L.iris_l ? P[L.iris_r] : mix(P[L.eye_r.outer], P[L.eye_r.inner], .5);
    const il = P.length > L.iris_l ? P[L.iris_l] : mix(P[L.eye_l.outer], P[L.eye_l.inner], .5);
    const ipd = norm(sub(il, ir)); if (ipd < Q.min_ipd_px) return {ok: false, error: 'too_small'};
    const nose = P[L.nose_tip], dr = norm(sub(nose, P[L.eye_r.outer])), dl = norm(sub(nose, P[L.eye_l.outer]));
    const yaw = Math.abs(dr - dl) / (dr + dl); if (yaw > Q.max_yaw_ratio) return {ok: false, error: 'turned'};
    const quality = faceQuality(gray, width, height, P);
    if (quality.empty || quality.mean < Q.min_mean_gray || quality.lap < Q.min_laplacian_var) return {ok: false, error: 'dark'};
    const axis = sub(il, ir).map(v => v / ipd), up = [axis[1], -axis[0]];
    const cheek = median([patchMedian(gray, width, height, P[50], ipd * .08), patchMedian(gray, width, height, P[280], ipd * .08)]);
    const feats = {};
    for (const side of ['r', 'l']) {
      const f = browFeatures(gray, width, height, P, side, ipd, up, cheek, TH);
      if (f.forehead_ref < Q.min_skin_ref_gray * .6 || f.forehead_ref < cheek * Q.hidden_cheek_ratio) return {ok: false, error: 'brows_hidden'};
      feats[side] = f;
    }
    const avg = {};
    for (const k of Object.keys(feats.r)) if (typeof feats.r[k] !== 'boolean') avg[k] = pyRound((feats.r[k] + feats.l[k]) / 2, 4);
    avg.forehead_covered = feats.r.forehead_covered || feats.l.forehead_covered;
    const marks = Object.fromEntries(['r', 'l'].map(side => { const f = feats[side]; return [side, f.mark30_ref >= TH.mark30.min_ref_density && f.mark30_win_min < TH.mark30.gap_ratio * f.mark30_ref]; }));
    return {ok: true, ...classify(avg, TH), mark30_found: marks.r || marks.l, mark30_sides: marks, features: avg, features_by_side: feats, ipd_px: pyRound(ipd, 1), yaw: pyRound(yaw, 3)};
  }
  // OpenCV's 15-bit RGB -> uint8 gray coefficients (not classifier thresholds).
  function rgbaToGray(rgba) { const out = new Float32Array(rgba.length / 4); for (let i = 0; i < out.length; i++) { const j = i * 4; out[i] = (rgba[j] * 9798 + rgba[j + 1] * 19235 + rgba[j + 2] * 3735 + 16384) >> 15; } return out; }
  // Separable area averaging, matching cv2.resize INTER_AREA for shrinking images.
  function resizeAreaRGBA(source, width, height, outWidth, outHeight) {
    if (width === outWidth && height === outHeight) return source;
    // OpenCV's uint8 2x2 fast path rounds a half upward.
    if (width === outWidth * 2 && height === outHeight * 2) {
      const out = new Uint8ClampedArray(outWidth * outHeight * 4);
      for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
        const src = (2 * y * width + 2 * x) * 4, dst = (y * outWidth + x) * 4;
        for (let c = 0; c < 3; c++) out[dst + c] = (source[src + c] + source[src + 4 + c] + source[src + width * 4 + c] + source[src + width * 4 + 4 + c] + 2) >> 2;
        out[dst + 3] = 255;
      }
      return out;
    }
    const weights = (src, dst) => Array.from({length: dst}, (_, i) => {
      const start = i * src / dst, end = (i + 1) * src / dst, entries = [];
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const weight = Math.fround((Math.min(end, j + 1) - Math.max(start, j)) / (end - start));
        if (weight > 0 && j < src) entries.push([j, weight]);
      }
      return entries;
    });
    const xWeights = weights(width, outWidth), yWeights = weights(height, outHeight);
    const out = new Uint8ClampedArray(outWidth * outHeight * 4), rows = new Map();
    const horizontal = y => {
      if (rows.has(y)) return rows.get(y);
      const row = new Float32Array(outWidth * 3);
      for (let x = 0; x < outWidth; x++) for (const [sx, weight] of xWeights[x]) for (let c = 0; c < 3; c++) {
        const i = x * 3 + c; row[i] = Math.fround(row[i] + Math.fround(source[(y * width + sx) * 4 + c] * weight));
      }
      rows.set(y, row); return row;
    };
    for (let y = 0; y < outHeight; y++) {
      const sum = new Float32Array(outWidth * 3);
      for (const [sy, weight] of yWeights[y]) { const row = horizontal(sy); for (let i = 0; i < sum.length; i++) sum[i] = Math.fround(sum[i] + Math.fround(row[i] * weight)); }
      for (let x = 0; x < outWidth; x++) { for (let c = 0; c < 3; c++) out[(y * outWidth + x) * 4 + c] = sum[x * 3 + c]; out[(y * outWidth + x) * 4 + 3] = 255; }
      const keepFrom = y + 1 < outHeight ? yWeights[y + 1][0][0] : height;
      for (const [sy, row] of rows) if (sy < keepFrom) { row.fill(0); rows.delete(sy); }
      sum.fill(0);
    }
    return out;
  }
  // Zone names are copied verbatim from face_rules_de.json, moles.zones.
  // No photo, pixels, landmarks or classifier diagnostics enter the report request.
  const MOLE_ZONE_NAMES = {
    "augen": "Um die Augen",
    "nasolabial": "Nasolabialfalte (zwischen Nase und Mundwinkel)",
    "lippen": "Lippen",
    "nase": "Nase",
    "links_gesicht": "Linke Gesichtshälfte",
    "rechts_gesicht": "Rechte Gesichtshälfte",
    "hals": "Hals / Nacken",
    "brust": "Brust",
    "schultern": "Schultern / oberer Rücken",
    "bauch": "Bauch",
    "knie": "Knie",
    "haende": "Handrücken / kleiner Finger",
    "handflaeche": "Handfläche"
  };
  function setupReportForm(onBusyChange = () => {}) {
    const $ = id => document.getElementById(id), form = $('key-form');
    const fields = $('report-fields'), submit = $('report-submit'), message = $('report-status'), error = $('report-error');
    const download = $('report-download'), zoneButtons = new Map(), selected = new Map();
    const errors = {
      invalid_key: 'Dieser Schlüssel ist ungültig. Prüfe den Schlüssel aus deinem Payhip-Kauf.',
      key_used: 'Dieser Schlüssel wurde bereits verwendet.',
      invalid_request: 'Bitte prüfe deine Angaben und analysiere dein Foto bei Bedarf erneut.',
      server_error: 'Dein PDF konnte gerade nicht erstellt werden. Bitte prüfe deinen Kaufstatus oder kontaktiere den Support.',
      network: 'Keine Verbindung. Prüfe deine Internetverbindung und deinen Kaufstatus, bevor du es erneut versuchst.'
    };
    let endpoint = null, result = null, activeZone = null, revision = 0, pending = false, complete = false, pdfURL = null;
    const configured = form.dataset.workerUrl.trim();
    if (configured) {
      try {
        const url = new URL(configured, location.href);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash) {
          url.pathname = url.pathname.replace(/\/+$/, '') + '/api/report'; endpoint = url.href;
        }
      } catch (_) { /* Invalid configuration keeps paid requests disabled. */ }
    }
    const showError = text => { error.textContent = text; error.hidden = false; };
    const clearError = () => { error.textContent = ''; error.hidden = true; };
    const releasePDF = () => { if (pdfURL) URL.revokeObjectURL(pdfURL); pdfURL = null; download.removeAttribute('href'); download.hidden = true; };
    const updateBusy = () => {
      fields.disabled = pending || complete;
      submit.disabled = pending || complete || !result;
      submit.textContent = pending ? 'PDF wird erstellt …' : complete ? 'PDF erstellt' : 'PDF erstellen';
      form.setAttribute('aria-busy', String(pending));
      onBusyChange(pending);
    };
    const renderMoles = () => {
      for (const [zone, button] of zoneButtons) button.setAttribute('aria-pressed', String(zone === activeZone));
      for (const side of ['links', 'rechts']) {
        const button = $('mole-' + side);
        const fixedSide = activeZone === 'links_gesicht' ? 'links' : activeZone === 'rechts_gesicht' ? 'rechts' : null;
        button.disabled = !activeZone || (fixedSide !== null && fixedSide !== side);
        button.setAttribute('aria-pressed', String(!!activeZone && selected.has(activeZone + ':' + side)));
      }
      $('mole-none').setAttribute('aria-pressed', String(selected.size === 0));
      $('mole-count').textContent = selected.size ? selected.size + ' von 13 Angaben ausgewählt. Zum Entfernen anklicken.' : 'Keine Muttermale ausgewählt.';
      const list = $('mole-selection'); list.replaceChildren();
      for (const [key, mole] of selected) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'mole-choice mole-selected';
        button.textContent = MOLE_ZONE_NAMES[mole.zone] + ' · ' + mole.side + ' ×';
        button.setAttribute('aria-label', MOLE_ZONE_NAMES[mole.zone] + ', ' + mole.side + ': entfernen');
        button.addEventListener('click', () => { if (pending || complete) return; selected.delete(key); clearError(); renderMoles(); });
        item.append(button); list.append(item);
      }
    };
    for (const [zone, name] of Object.entries(MOLE_ZONE_NAMES)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mole-choice'; button.textContent = name;
      button.setAttribute('aria-pressed', 'false'); button.dataset.zone = zone;
      button.addEventListener('click', () => { if (pending || complete) return; activeZone = zone; clearError(); renderMoles(); });
      zoneButtons.set(zone, button); $('mole-zones').append(button);
    }
    for (const side of ['links', 'rechts']) $('mole-' + side).addEventListener('click', () => {
      if (pending || complete || !activeZone || $('mole-' + side).disabled) return;
      const key = activeZone + ':' + side;
      if (selected.has(key)) selected.delete(key);
      else if (selected.size < 13) selected.set(key, {zone: activeZone, side});
      else { showError('Du kannst höchstens 13 Angaben auswählen. Entferne zuerst eine Angabe.'); return; }
      clearError(); renderMoles();
    });
    $('mole-none').addEventListener('click', () => { if (pending || complete) return; selected.clear(); activeZone = null; clearError(); renderMoles(); });
    const paidPanel = $('paid-result'), paidContainer = $('paid-sections'), emailInput = $('report-email');
    const renderPaidSections = data => {
      if (!paidPanel || !paidContainer || !Array.isArray(data?.sections)) return;
      paidContainer.replaceChildren();
      for (const [title, body] of data.sections) {
        const h3 = document.createElement('h3');
        h3.textContent = title;
        paidContainer.append(h3);
        for (const para of String(body).split('\n\n')) {
          const p = document.createElement('p');
          p.textContent = para;
          paidContainer.append(p);
        }
      }
      if (data.disclaimer_de) {
        const disc = document.createElement('p');
        disc.className = 'note gesicht-disclaimer';
        disc.textContent = data.disclaimer_de;
        paidContainer.append(disc);
      }
      paidPanel.hidden = false;
      paidPanel.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!endpoint || !result || pending || complete) return;
      clearError();
      const licenseKey = $('license-key').value.trim(), firstName = $('report-first-name').value.trim();
      const email = emailInput ? emailInput.value.trim() : '';
      if (!licenseKey) { showError('Bitte gib deinen Schlüssel aus dem Payhip-Kauf ein.'); $('license-key').focus(); return; }
      if (Array.from(firstName).length > 30) { showError('Dein Vorname darf höchstens 30 Zeichen haben.'); $('report-first-name').focus(); return; }
      if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email))) {
        showError('Bitte gib eine gültige E-Mail-Adresse ein oder lasse das Feld frei.');
        if (emailInput) emailInput.focus();
        return;
      }
      const payload = {
        license_key: licenseKey, brow_form: result.brow_form, brow_subtype: result.brow_subtype,
        mark30_found: result.mark30_found, moles: Array.from(selected.values())
      };
      if (firstName) payload.first_name = firstName;
      if (email) payload.email = email;
      const ticket = revision;
      pending = true; releasePDF(); updateBusy(); message.textContent = 'Deine Analyse und dein PDF werden erstellt. Bitte warte einen Moment.';
      try {
        // One explicit submit makes one request. Never retry a license-consuming request automatically.
        const response = await fetch(endpoint, {
          method: 'POST', headers: {'Content-Type': 'application/json', 'Accept': 'application/json'}, credentials: 'omit',
          cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', body: JSON.stringify(payload)
        });
        if (ticket !== revision) return;
        if (!response.ok) {
          let code = 'server_error';
          try { const body = await response.json(); if (Object.hasOwn(errors, body.error) && body.error !== 'network') code = body.error; } catch (_) { /* Keep the generic server error. */ }
          if (ticket === revision) { message.textContent = ''; showError(errors[code]); }
          return;
        }
        const ct = (response.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('application/json')) {
          const data = await response.json();
          if (ticket !== revision) return;
          if (!data?.ok || !data.pdf_base64) { message.textContent = ''; showError(errors.server_error); return; }
          const bin = atob(data.pdf_base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], {type: 'application/pdf'});
          pdfURL = URL.createObjectURL(blob); download.href = pdfURL; download.hidden = false;
          complete = true; $('license-key').value = '';
          renderPaidSections(data);
          message.textContent = data.email_sent
            ? 'Deine vollständige Analyse und dein PDF sind bereit (und zusätzlich an deine E-Mail gesendet).'
            : 'Deine vollständige Analyse und dein PDF sind bereit. Falls der Download nicht startet, nutze den Link.';
          download.click();
          return;
        }
        if (!ct.startsWith('application/pdf')) { message.textContent = ''; showError(errors.server_error); return; }
        const blob = await response.blob();
        if (ticket !== revision) return;
        if (!blob.size) { message.textContent = ''; showError(errors.server_error); return; }
        pdfURL = URL.createObjectURL(blob); download.href = pdfURL; download.hidden = false;
        complete = true; $('license-key').value = ''; message.textContent = 'Dein PDF ist bereit. Falls der Download nicht startet, nutze den Link.';
        download.click();
      } catch (_) {
        if (ticket === revision) { message.textContent = ''; showError(errors.network); }
      } finally { pending = false; updateBusy(); }
    });
    renderMoles(); updateBusy();
    return {
      isPending: () => pending,
      setResult(value) {
        result = {brow_form: value.form, brow_subtype: value.subtype || null, mark30_found: !!value.mark30_found};
        form.hidden = !endpoint; updateBusy();
      },
      clear() {
        revision++; result = null; complete = false; selected.clear(); activeZone = null;
        $('license-key').value = ''; $('report-first-name').value = ''; if (emailInput) emailInput.value = '';
        if (paidContainer) paidContainer.replaceChildren(); if (paidPanel) paidPanel.hidden = true;
        message.textContent = ''; clearError(); releasePDF(); renderMoles(); form.hidden = true; updateBusy();
      }
    };
  }
  const api = {analyzeLandmarks, browFeatures, classify, rgbaToGray, resizeAreaRGBA, pyRound, sample, setupReportForm};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.GesichtClassifier = api; if (typeof document !== 'undefined') boot().catch(error => { const el = document.getElementById('analysis-status'); if (el) el.textContent = 'Das Werkzeug konnte nicht geladen werden. Bitte lade die Seite erneut.'; console.error('Gesichtlesen: initialization failed', error.name); }); }

  async function boot() {
    if (!document.querySelector('[data-gesicht-app]')) return;
    const $ = id => document.getElementById(id), base = '/assets/gesicht/';
    const json = async name => { const res = await fetch(base + name, {credentials: 'omit'}); if (!res.ok) throw new Error('Local asset unavailable'); return res.json(); };
    const [TH, rules] = await Promise.all([json('thresholds.json'), json('face_rules_free_de.json')]);
    const input = $('photo-input'), preview = $('photo-preview'), analyze = $('analyze-button'), status = $('analysis-status');
    let objectURL = null, detector = null, pendingDetector = null, generation = 0, busy = false;
    const updatePhotoControls = reportPending => {
      $('choose-photo').disabled = busy || reportPending;
      input.disabled = busy || reportPending;
      $('reset-photo').disabled = reportPending;
      analyze.disabled = busy || reportPending || !objectURL;
    };
    const report = setupReportForm(updatePhotoControls);
    const payhip = $('payhip-link'), payhipURL = payhip.dataset.payhipUrl.trim();
    if (payhipURL) { try { const u = new URL(payhipURL); if (u.protocol === 'https:') { payhip.href = u.href; payhip.hidden = false; } } catch (_) { /* Keep invalid URLs hidden. */ } }
    const clearResult = () => { report.clear(); $('analysis-result').hidden = true; $('full-analysis').hidden = true; $('photo-error').hidden = true; $('brow-name').textContent = ''; $('brow-description').textContent = ''; $('mark30-description').textContent = ''; };
    const releasePhoto = () => { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null; preview.removeAttribute('src'); preview.hidden = true; $('preview-area').hidden = true; input.value = ''; analyze.disabled = true; $('reset-photo').hidden = true; };
    const showError = key => { $('photo-error').textContent = rules.photo_errors_de[key]; $('photo-error').hidden = false; status.textContent = ''; };
    const loadDetector = async () => {
      if (detector) return detector;
      if (!pendingDetector) pendingDetector = (async () => {
        const vision = await import(base + 'vendor/vision_bundle.mjs');
        const files = await vision.FilesetResolver.forVisionTasks(base + 'vendor/wasm');
        detector = await vision.FaceLandmarker.createFromOptions(files, {baseOptions: {modelAssetPath: base + 'face_landmarker.task', delegate: 'CPU'}, runningMode: 'IMAGE', numFaces: 3, minFaceDetectionConfidence: .5});
        return detector;
      })().catch(e => { pendingDetector = null; throw e; });
      return pendingDetector;
    };
    $('choose-photo').addEventListener('click', () => { if (!busy && !report.isPending()) input.click(); });
    input.addEventListener('change', async () => {
      if (busy || report.isPending()) return;
      const file = input.files && input.files[0]; if (!file) return;
      const ticket = ++generation; clearResult(); releasePhoto();
      if (file.type && !file.type.startsWith('image/')) { showError('no_face'); return; }
      status.textContent = 'Foto wird geöffnet …';
      objectURL = URL.createObjectURL(file); preview.src = objectURL;
      try { await preview.decode(); if (ticket !== generation) return; preview.hidden = false; $('preview-area').hidden = false; $('reset-photo').hidden = false; analyze.disabled = false; status.textContent = 'Dein Foto ist bereit.'; }
      catch (_) { if (ticket === generation) { releasePhoto(); showError('no_face'); } }
    });
    $('reset-photo').addEventListener('click', () => { if (report.isPending()) return; generation++; clearResult(); releasePhoto(); status.textContent = ''; });
    analyze.addEventListener('click', async () => {
      if (busy || report.isPending() || !objectURL) return; busy = true; const ticket = generation;
      analyze.disabled = true; $('choose-photo').disabled = true; clearResult(); status.textContent = 'Analyse wird auf deinem Gerät geladen …';
      const canvas = document.createElement('canvas'); let pixels, gray;
      try {
        const model = await loadDetector(); if (ticket !== generation) return;
        status.textContent = 'Deine Augenbrauen werden analysiert …'; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const scale = Math.min(1, 1600 / Math.max(preview.naturalWidth, preview.naturalHeight));
        canvas.width = preview.naturalWidth; canvas.height = preview.naturalHeight;
        const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(preview, 0, 0);
        pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (scale < 1) {
          const w = Math.trunc(canvas.width * scale), h = Math.trunc(canvas.height * scale);
          const resized = resizeAreaRGBA(pixels.data, canvas.width, canvas.height, w, h);
          pixels.data.fill(0); canvas.width = w; canvas.height = h;
          pixels = new ImageData(resized, w, h); ctx.putImageData(pixels, 0, 0);
        }
        gray = rgbaToGray(pixels.data);
        const faces = model.detect(canvas).faceLandmarks;
        const result = analyzeLandmarks({gray, width: canvas.width, height: canvas.height, faces}, TH);
        if (ticket !== generation) return;
        if (!result.ok) { showError(result.error); return; }
        const form = rules.brows[result.form], text = result.subtype && form.subtypes ? form.subtypes[result.subtype] : form;
        $('brow-name').textContent = text.name_de; $('brow-description').textContent = text.short_de;
        $('mark30-description').textContent = rules.mark30[result.mark30_found ? 'free_found_de' : 'free_not_found_de'];
        $('telegram-unlock').href = 'https://t.me/gesicht_lesen_bot?start=web_' + encodeURIComponent(result.form);
        report.setResult(result);
        $('analysis-result').hidden = false; $('full-analysis').hidden = false; status.textContent = 'Deine Analyse ist fertig.';
        $('analysis-result').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
      } catch (error) { if (ticket === generation) { status.textContent = 'Die lokale Analyse konnte nicht gestartet werden. Bitte lade die Seite erneut oder nutze einen aktuellen Browser.'; console.error('Gesichtlesen: local analysis failed', error.name); } }
      finally { if (pixels) pixels.data.fill(0); if (gray) gray.fill(0); canvas.width = canvas.height = 0; busy = false; updatePhotoControls(report.isPending()); }
    });
    addEventListener('pagehide', () => { generation++; report.clear(); releasePhoto(); if (detector) { detector.close(); detector = null; pendingDetector = null; } });
    status.textContent = '';
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
