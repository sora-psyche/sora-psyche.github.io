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
  function computeLrAsymmetry(r, l) {
    const hDiff = Math.abs(r.height - l.height) / Math.max(0.15, (r.height + l.height) / 2);
    const dDiff = Math.abs(r.density_mean - l.density_mean) / Math.max(0.25, (r.density_mean + l.density_mean) / 2);
    const tDiff = Math.abs(r.thickness_mean - l.thickness_mean) / Math.max(0.04, (r.thickness_mean + l.thickness_mean) / 2);
    return pyRound(Math.max(hDiff, dDiff * 0.75, tDiff * 0.75), 4);
  }
  function classify(f, TH, featsBySide = null) {
    const R = TH.rules, scores = {};
    const cNon = TH.confidence?.non_dicht || {min_winner_score: 0.18, min_top2_margin: 0.12, max_lr_brow_asymmetry: 0.35};
    const cDicht = TH.confidence?.dicht || {max_other_score: -0.15, min_density_mean: 0.52, min_thickness_mean: 0.072, max_lr_brow_asymmetry: 0.35};
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
    const roundedScores = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, pyRound(v, 3)]));
    const lrAsym = (featsBySide && featsBySide.r && featsBySide.l) ? computeLrAsymmetry(featsBySide.r, featsBySide.l) : (f.lr_asymmetry || 0);
    const firing = Object.keys(scores).filter(k => scores[k] > 0).sort((a, b) => scores[b] - scores[a] || TH.priority.indexOf(a) - TH.priority.indexOf(b));
    let form = null;
    if (firing.length > 0) {
      const topScore = scores[firing[0]];
      const secondScore = firing.length > 1 ? scores[firing[1]] : 0;
      const margin = topScore - secondScore;
      if (topScore < cNon.min_winner_score || (firing.length > 1 && margin < cNon.min_top2_margin) || lrAsym > cNon.max_lr_brow_asymmetry) {
        return {ok_conf: false, confident: false, form: null, subtype: null, angle_state: 'unknown', angle_sharp: false, scores: roundedScores, secondary: [], candidate_forms: firing.slice(0, 2)};
      }
      form = firing[0];
    } else {
      const maxOther = Math.max(...Object.values(scores));
      if (maxOther > cDicht.max_other_score || f.density_mean < cDicht.min_density_mean || f.thickness_mean < cDicht.min_thickness_mean || lrAsym > cDicht.max_lr_brow_asymmetry) {
        const nearForms = Object.keys(scores).sort((a, b) => scores[b] - scores[a]).slice(0, 1);
        return {ok_conf: false, confident: false, form: null, subtype: null, angle_state: 'unknown', angle_sharp: false, scores: roundedScores, secondary: [], candidate_forms: ['dicht', ...nearForms]};
      }
      form = 'dicht';
    }
    const [ambLo, ambHi] = R.arch_ambiguous_range || [34.0, 41.0];
    const maxLrArch = R.max_lr_arch_diff_deg || 8.0;
    const lrArchDiff = (featsBySide && featsBySide.r && featsBySide.l) ? Math.abs(featsBySide.r.arch_deg - featsBySide.l.arch_deg) : 0;
    let angleState = 'smooth';
    if ((f.arch_deg >= ambLo && f.arch_deg <= ambHi) || lrArchDiff > maxLrArch) angleState = 'unknown';
    else if (f.arch_deg >= R.arch_sharp_deg) angleState = 'sharp';
    let subtype = null;
    if (form === 'duenn' && f.uneven_cv > R.uneven_cv) subtype = 'duenn_unruhig';
    else if (form === 'hoch_winkel') {
      if (angleState === 'sharp') subtype = 'hoch_winkel_scharf';
      else if (angleState === 'smooth') subtype = 'hoch_winkel_sanft';
    }
    return {ok_conf: true, confident: true, form, subtype, angle_state: angleState, angle_sharp: angleState === 'sharp', scores: roundedScores, secondary: firing.slice(1), candidate_forms: [form]};
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
    avg.lr_asymmetry = computeLrAsymmetry(feats.r, feats.l);
    const cls = classify(avg, TH, feats);
    if (!cls.ok_conf || !cls.form) {
      return {ok: false, error: 'low_confidence_brow', form: null, candidate_forms: cls.candidate_forms, scores: cls.scores, features: avg};
    }
    const refValidR = feats.r.mark30_ref >= TH.mark30.min_ref_density;
    const refValidL = feats.l.mark30_ref >= TH.mark30.min_ref_density;
    const marks = {
      r: refValidR && feats.r.mark30_win_min < TH.mark30.gap_ratio * feats.r.mark30_ref,
      l: refValidL && feats.l.mark30_win_min < TH.mark30.gap_ratio * feats.l.mark30_ref
    };
    const mark30State = (avg.forehead_covered || (!refValidR && !refValidL)) ? 'unknown' : ((marks.r || marks.l) ? 'found' : 'not_found');
    return {ok: true, ...cls, mark30_state: mark30State, mark30_found: mark30State === 'found', mark30_sides: marks, features: avg, features_by_side: feats, ipd_px: pyRound(ipd, 1), yaw: pyRound(yaw, 3)};
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
  const SUPPORTED_LANGS = new Set(['de', 'en', 'es', 'ru', 'pt', 'fr']);
  const BOTS_BY_LANG = {
    de: 'gesichtslesen_bot',
    en: 'facereading_en_bot',
    es: 'lecturafacial_bot',
    ru: 'chtenielica_bot',
    pt: 'leiturafacial_pt_bot',
    fr: 'lecture_du_visage_bot'
  };
  function detectLang() {
    const raw = ((typeof document !== 'undefined' && ((typeof document.querySelector === 'function' && document.querySelector('[data-gesicht-app]')?.dataset?.lang) || document.documentElement?.lang)) || 'de').slice(0, 2).toLowerCase();
    return SUPPORTED_LANGS.has(raw) ? raw : 'de';
  }
  const MOLE_ZONE_NAMES_BY_LANG = {
    de: {
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
    },
    en: {
      "augen": "Around the eyes",
      "nasolabial": "Nasolabial fold (nose to mouth corner)",
      "lippen": "Lips",
      "nase": "Nose",
      "links_gesicht": "Left side of the face",
      "rechts_gesicht": "Right side of the face",
      "hals": "Neck / nape",
      "brust": "Chest",
      "schultern": "Shoulders / upper back",
      "bauch": "Belly / abdomen",
      "knie": "Knees",
      "haende": "Back of hand / little finger",
      "handflaeche": "Palm"
    },
    es: {
      "augen": "Alrededor de los ojos",
      "nasolabial": "Surco nasolabial (entre nariz y comisura)",
      "lippen": "Labios",
      "nase": "Nariz",
      "links_gesicht": "Lado izquierdo del rostro",
      "rechts_gesicht": "Lado derecho del rostro",
      "hals": "Cuello / nuca",
      "brust": "Pecho",
      "schultern": "Hombros / espalda alta",
      "bauch": "Vientre / abdomen",
      "knie": "Rodillas",
      "haende": "Dorso de la mano / meñique",
      "handflaeche": "Palma de la mano"
    },
    ru: {
      "augen": "Вокруг глаз",
      "nasolabial": "Носогубная складка",
      "lippen": "Губы",
      "nase": "Нос",
      "links_gesicht": "Левая сторона лица",
      "rechts_gesicht": "Правая сторона лица",
      "hals": "Шея / затылок",
      "brust": "Грудь",
      "schultern": "Плечи / верх спины",
      "bauch": "Живот",
      "knie": "Колени",
      "haende": "Тыльная сторона кисти / мизинец",
      "handflaeche": "Ладонь"
    },
    pt: {
      "augen": "Ao redor dos olhos",
      "nasolabial": "Sulco nasolabial (entre nariz e canto da boca)",
      "lippen": "Lábios",
      "nase": "Nariz",
      "links_gesicht": "Lado esquerdo do rosto",
      "rechts_gesicht": "Lado direito do rosto",
      "hals": "Pescoço / nuca",
      "brust": "Peito",
      "schultern": "Ombros / parte superior das costas",
      "bauch": "Barriga / abdômen",
      "knie": "Joelhos",
      "haende": "Dorso da mão / dedo mínimo",
      "handflaeche": "Palma da mão"
    },
    fr: {
      "augen": "Autour des yeux",
      "nasolabial": "Sillon nasogénien (entre le nez et la bouche)",
      "lippen": "Lèvres",
      "nase": "Nez",
      "links_gesicht": "Côté gauche du visage",
      "rechts_gesicht": "Côté droit du visage",
      "hals": "Cou / nuque",
      "brust": "Poitrine",
      "schultern": "Épaules / haut du dos",
      "bauch": "Ventre / abdomen",
      "knie": "Genoux",
      "haende": "Dos de la main / auriculaire",
      "handflaeche": "Paume de la main"
    }
  };
  const UI_BY_LANG = {
    de: {
      sides: {links: 'links', rechts: 'rechts', mitte: 'Mitte'},
      removeSuffix: ': entfernen',
      moleNone: 'Keine Muttermale ausgewählt.',
      moleCount: n => n + ' von 13 Angaben ausgewählt. Zum Entfernen anklicken.',
      moleMax: 'Du kannst höchstens 13 Angaben auswählen. Entferne zuerst eine Angabe.',
      submitIdle: 'PDF erstellen',
      submitPending: 'PDF wird erstellt …',
      submitDone: 'PDF erstellt',
      missingKey: 'Bitte gib deinen Schlüssel aus dem Payhip-Kauf ein.',
      missingBirth: 'Bitte wähle zuerst dein vollständiges Geburtsdatum (Tag, Monat, Jahr), damit deine Lebensjahre um 30 und deine Körperzonen exakt berechnet werden.',
      invalidCalendarDate: 'Ungültiges Kalenderdatum (z. B. der 31.02. existiert nicht). Bitte wähle ein reales Datum.',
      birthLabel: '1. Dein Geburtsdatum (Pflichtfeld für die Jahresberechnung)',
      birthHint: 'Wird für deine exakten Kalenderjahre (20–25 & Wende 27–30 Jahre) sowie für die Zuordnung deiner Muttermale zum Sternzeichen-Grad benötigt.',
      photoChecklist: ['1. Frontaler Blick direkt in die Kamera', '2. Gleichmäßiges Tageslicht ohne harte Schatten', '3. Augenbrauen frei sichtbar (ohne Pony oder Brille)'],
      emailOptInLabel: 'Ja, ich möchte meinen Bericht zusätzlich per E-Mail erhalten (optional)',
      otpPrompt: 'Zur Sicherheitsprüfung auf diesem Gerät: Bitte sende einen 6-stelligen Einmalcode an deine Kauf-E-Mail von Payhip.',
      otpSendBtn: '6-stelligen Code an Kauf-E-Mail senden',
      otpPlaceholder: '6-stelliger Code',
      otpSentMsg: 'Ein 6-stelliger Code wurde an deine Payhip-Kauf-E-Mail gesendet. Bitte gib ihn oben ein und klicke erneut auf „PDF erstellen“.',
      dayPlaceholder: 'Tag',
      monthPlaceholder: 'Monat',
      yearPlaceholder: 'Jahr',
      months: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
      tgUnlockBtn: (stars, fiat) => `Im Telegram freischalten – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Persönliche Analyse – ${label} (Payhip)`,
      nameTooLong: 'Dein Vorname darf höchstens 30 Zeichen haben.',
      invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein oder lasse das Feld frei.',
      creatingReport: 'Deine Analyse und dein PDF werden erstellt. Bitte warte einen Moment.',
      reportReadyEmail: 'Deine vollständige Analyse und dein PDF sind bereit (und zusätzlich an deine E-Mail gesendet).',
      reportReadyDownload: 'Deine vollständige Analyse und dein PDF sind bereit. Falls der Download nicht startet, nutze den Link.',
      pdfReadyDownload: 'Dein PDF ist bereit. Falls der Download nicht startet, nutze den Link.',
      errors: {
        invalid_key: 'Dieser Schlüssel ist ungültig. Prüfe den Schlüssel aus deinem Payhip-Kauf.',
        key_used: 'Dieser Schlüssel wurde bereits verwendet.',
        owner_verification_required: 'Sicherheitsprüfung erforderlich: Bitte bestätige den Zugriff mit dem 6-stelligen Code an deine Kauf-E-Mail.',
        invalid_otp: 'Der eingegebene 6-stellige Code ist ungültig.',
        otp_locked: 'Zu viele Fehlversuche. Bitte warte 30 Minuten.',
        key_revoked: 'Dieser Schlüssel wurde nach einer Erstattung deaktiviert.',
        invalid_request: 'Bitte prüfe deine Angaben und analysiere dein Foto bei Bedarf erneut.',
        server_error: 'Dein PDF konnte gerade nicht erstellt werden. Bitte prüfe deinen Kaufstatus oder kontaktiere den Support.',
        network: 'Keine Verbindung. Prüfe deine Internetverbindung und deinen Kaufstatus, bevor du es erneut versuchst.'
      },
      bootError: 'Das Werkzeug konnte nicht geladen werden. Bitte lade die Seite erneut.',
      openingPhoto: 'Foto wird geöffnet …',
      photoReady: 'Dein Foto ist bereit.',
      loadingModel: 'Analyse wird auf deinem Gerät geladen …',
      analyzingBrows: 'Deine Augenbrauen werden analysiert …',
      analysisDone: 'Deine Analyse ist fertig.',
      analysisFailed: 'Die lokale Analyse konnte nicht gestartet werden. Bitte lade die Seite erneut oder nutze einen aktuellen Browser.'
    },
    en: {
      sides: {links: 'left', rechts: 'right', mitte: 'center'},
      removeSuffix: ': remove',
      moleNone: 'No moles selected.',
      moleCount: n => n + ' of 13 selected. Click to remove.',
      moleMax: 'You can select up to 13 items. Remove one first.',
      submitIdle: 'Create analysis & PDF',
      submitPending: 'Creating PDF …',
      submitDone: 'PDF created',
      missingKey: 'Please enter the license key from your Payhip purchase.',
      missingBirth: 'Please select your full birth date (Day, Month, Year) first so we can calculate your exact age-30 turning point years and body zones.',
      invalidCalendarDate: 'Invalid calendar date (e.g., Feb 31 does not exist). Please select a real calendar date.',
      birthLabel: '1. Your Date of Birth (Required for timeline calculation)',
      birthHint: 'Required to calculate your exact calendar years (ages 20–25 & 27–30 turning point) and match your moles to your birth degree.',
      photoChecklist: ['1. Look straight into the camera (frontal)', '2. Even daylight without harsh shadows', '3. Eyebrows clearly visible (no bangs or glasses frames)'],
      emailOptInLabel: 'Yes, also send a copy of my report by email (optional)',
      otpPrompt: 'To verify ownership on this device, send a one-time 6-digit code to your Payhip purchase email.',
      otpSendBtn: 'Send 6-digit code to purchase email',
      otpPlaceholder: '6-digit code',
      otpSentMsg: 'A 6-digit code has been sent to your Payhip purchase email. Enter it above and click “Create analysis & PDF”.',
      dayPlaceholder: 'Day',
      monthPlaceholder: 'Month',
      yearPlaceholder: 'Year',
      months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      tgUnlockBtn: (stars, fiat) => `Unlock in Telegram – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Personal Reading – ${label} (Payhip)`,
      nameTooLong: 'Your first name may be at most 30 characters.',
      invalidEmail: 'Please enter a valid email address or leave the field blank.',
      creatingReport: 'Your full reading and PDF are being created. Please wait a moment.',
      reportReadyEmail: 'Your full reading and PDF are ready (and also sent to your email).',
      reportReadyDownload: 'Your full reading and PDF are ready. If the download does not start, use the link below.',
      pdfReadyDownload: 'Your PDF is ready. If the download does not start, use the link below.',
      errors: {
        invalid_key: 'This key is invalid. Please check the license key from your Payhip purchase.',
        key_used: 'This license key has already been used.',
        owner_verification_required: 'Ownership verification required: please confirm with the 6-digit code sent to your purchase email.',
        invalid_otp: 'The 6-digit verification code is invalid.',
        otp_locked: 'Too many failed attempts. Please wait 30 minutes.',
        key_revoked: 'This license key was deactivated after a refund.',
        invalid_request: 'Please check your input and re-analyze your photo if needed.',
        server_error: 'Your PDF could not be created right now. Please check your purchase status or contact support.',
        network: 'No connection. Please check your internet connection and try again.'
      },
      bootError: 'The tool could not be loaded. Please reload the page.',
      openingPhoto: 'Opening photo …',
      photoReady: 'Your photo is ready.',
      loadingModel: 'Loading analysis on your device …',
      analyzingBrows: 'Analyzing your eyebrows …',
      analysisDone: 'Your reading is ready.',
      analysisFailed: 'Local analysis could not start. Please reload the page or use a modern browser.'
    },
    es: {
      sides: {links: 'izquierda', rechts: 'derecha', mitte: 'centro'},
      removeSuffix: ': quitar',
      moleNone: 'Ningún lunar seleccionado.',
      moleCount: n => n + ' de 13 seleccionados. Haz clic para quitar.',
      moleMax: 'Puedes seleccionar hasta 13 opciones. Quita una primero.',
      submitIdle: 'Crear análisis y PDF',
      submitPending: 'Creando PDF …',
      submitDone: 'PDF creado',
      missingKey: 'Por favor, introduce la clave de tu compra en Payhip.',
      missingBirth: 'Por favor, selecciona primero tu fecha de nacimiento completa (Día, Mes, Año) para calcular tus años exactos del giro de los 30 años.',
      invalidCalendarDate: 'Fecha de calendario no válida (por ejemplo, el 31 de febrero no existe). Selecciona una fecha real.',
      birthLabel: '1. Tu Fecha de Nacimiento (Obligatorio para calcular tus años)',
      birthHint: 'Necesaria para calcular tus años exactos (tramo 20–25 y giro de 27–30 años) y cruzar tus lunares con tu signo y grado natal.',
      photoChecklist: ['1. Mirada frontal directa a la cámara', '2. Luz uniforme sin sombras fuertes', '3. Cejas despejadas (sin flequillo ni montura de gafas)'],
      emailOptInLabel: 'Sí, deseo recibir también una copia de mi informe por correo electrónico (opcional)',
      otpPrompt: 'Para verificar la titularidad en este dispositivo, envía un código único de 6 dígitos al correo de tu compra en Payhip.',
      otpSendBtn: 'Enviar código de 6 dígitos al correo de compra',
      otpPlaceholder: 'Código de 6 dígitos',
      otpSentMsg: 'Se ha enviado un código de 6 dígitos al correo de tu compra en Payhip. Introdúcelo arriba y pulsa «Crear análisis y PDF».',
      dayPlaceholder: 'Día',
      monthPlaceholder: 'Mes',
      yearPlaceholder: 'Año',
      months: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
      tgUnlockBtn: (stars, fiat) => `Desbloquear en Telegram – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Análisis Personal – ${label} (Payhip)`,
      nameTooLong: 'Tu nombre puede tener como máximo 30 caracteres.',
      invalidEmail: 'Por favor, introduce un correo electrónico válido o deja el campo vacío.',
      creatingReport: 'Se están creando tu análisis y tu PDF. Espera un momento.',
      reportReadyEmail: 'Tu análisis completo y tu PDF están listos (y también enviados a tu correo).',
      reportReadyDownload: 'Tu análisis completo y tu PDF están listos. Si la descarga no comienza, usa el enlace.',
      pdfReadyDownload: 'Tu PDF está listo. Si la descarga no comienza, usa el enlace.',
      errors: {
        invalid_key: 'Esta clave no es válida. Revisa la clave de tu compra en Payhip.',
        key_used: 'Esta clave ya ha sido utilizada.',
        owner_verification_required: 'Verificación requerida: confirma con el código de 6 dígitos enviado al correo de tu compra.',
        invalid_otp: 'El código de 6 dígitos no es válido.',
        otp_locked: 'Demasiados intentos fallidos. Espera 30 minutos.',
        key_revoked: 'Esta clave ha sido desactivada tras un reembolso.',
        invalid_request: 'Por favor, revisa tus datos y vuelve a analizar tu foto si es necesario.',
        server_error: 'No se pudo crear tu PDF en este momento. Revisa tu compra o contacta con soporte.',
        network: 'Sin conexión. Revisa tu conexión a internet antes de intentarlo de nuevo.'
      },
      bootError: 'No se pudo cargar la herramienta. Por favor, recarga la página.',
      openingPhoto: 'Abriendo foto …',
      photoReady: 'Tu foto está lista.',
      loadingModel: 'Cargando el análisis en tu dispositivo …',
      analyzingBrows: 'Analizando tus cejas …',
      analysisDone: 'Tu análisis está listo.',
      analysisFailed: 'No se pudo iniciar el análisis local. Recarga la página o usa un navegador actualizado.'
    },
    ru: {
      sides: {links: 'слева', rechts: 'справа', mitte: 'по центру'},
      removeSuffix: ': удалить',
      moleNone: 'Родинки не выбраны.',
      moleCount: n => 'Выбрано ' + n + ' из 13. Нажми, чтобы удалить.',
      moleMax: 'Можно выбрать не более 13 зон. Сначала удали одну.',
      submitIdle: 'Создать разбор и PDF',
      submitPending: 'Создаём PDF …',
      submitDone: 'PDF готов',
      missingKey: 'Пожалуйста, введи лицензионный ключ из покупки Payhip.',
      missingBirth: 'Пожалуйста, сначала укажи полную дату рождения (День, Месяц, Год) — без неё невозможно рассчитать твои точные годы рубежа 27–30 лет и карту родинок.',
      invalidCalendarDate: 'Несуществующая календарная дата (например, 31 февраля не бывает). Пожалуйста, выбери реальную дату.',
      birthLabel: '1. Твоя дата рождения (обязательно для точного расчёта)',
      birthHint: 'Нужна для расчёта твоих календарных лет (период 20–25 лет и главный рубеж 27–30 лет) и привязки родинок к градусу рождения.',
      photoChecklist: ['1. Прямой взгляд анфас в камеру', '2. Ровный дневной свет без резких теней', '3. Открытые брови (без чёлки и оправы очков)'],
      emailOptInLabel: 'Да, отправить копию отчёта также на мой e-mail (необязательно)',
      otpPrompt: 'Для подтверждения доступа на новом устройстве отправь одноразовый 6-значный код на почту покупки Payhip.',
      otpSendBtn: 'Отправить 6-значный код на почту покупки',
      otpPlaceholder: '6-значный код',
      otpSentMsg: '6-значный код отправлен на почту покупки Payhip. Введи его выше и нажми «Создать разбор и PDF».',
      dayPlaceholder: 'День',
      monthPlaceholder: 'Месяц',
      yearPlaceholder: 'Год',
      months: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
      tgUnlockBtn: (stars, fiat) => `Открыть в Telegram – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Личный разбор – ${label} (Payhip)`,
      nameTooLong: 'Имя не должно превышать 30 символов.',
      invalidEmail: 'Пожалуйста, введи корректный e-mail или оставь поле пустым.',
      creatingReport: 'Твой полный разбор и PDF создаются. Подожди секунду.',
      reportReadyEmail: 'Твой полный разбор и PDF готовы (и дополнительно отправлены на твой e-mail).',
      reportReadyDownload: 'Твой полный разбор и PDF готовы. Если скачивание не началось, нажми на ссылку.',
      pdfReadyDownload: 'Твой PDF готов. Если скачивание не началось, нажми на ссылку.',
      errors: {
        invalid_key: 'Этот ключ недействителен. Проверь ключ из покупки Payhip.',
        key_used: 'Этот ключ уже был использован.',
        owner_verification_required: 'Требуется подтверждение владельца: введи 6-значный код с почты покупки.',
        invalid_otp: 'Неверный 6-значный код подтверждения.',
        otp_locked: 'Слишком много неверных попыток. Подожди 30 минут.',
        key_revoked: 'Этот ключ был аннулирован после возврата средств.',
        invalid_request: 'Пожалуйста, проверь введённые данные и при необходимости заново проанализируй фото.',
        server_error: 'Не удалось создать PDF прямо сейчас. Проверь статус покупки или напиши в поддержку.',
        network: 'Нет соединения. Проверь подключение к интернету и попробуй снова.'
      },
      bootError: 'Не удалось загрузить инструмент. Пожалуйста, обнови страницу.',
      openingPhoto: 'Открываем фото …',
      photoReady: 'Фото готово к анализу.',
      loadingModel: 'Загружаем анализ на твоём устройстве …',
      analyzingBrows: 'Анализируем твои брови …',
      analysisDone: 'Твой разбор готов.',
      analysisFailed: 'Не удалось запустить локальный анализ. Обнови страницу или используй современный браузер.'
    },
    pt: {
      sides: {links: 'esquerda', rechts: 'direita', mitte: 'centro'},
      removeSuffix: ': remover',
      moleNone: 'Nenhum sinal selecionado.',
      moleCount: n => n + ' de 13 selecionados. Clique para remover.',
      moleMax: 'Você pode selecionar no máximo 13 opções. Remova uma primeiro.',
      submitIdle: 'Criar análise e PDF',
      submitPending: 'Criando PDF …',
      submitDone: 'PDF criado',
      missingKey: 'Por favor, insira a chave da sua compra no Payhip.',
      missingBirth: 'Por favor, selecione primeiro sua data de nascimento completa (Dia, Mês, Ano) para calcularmos os anos exatos da sua virada dos 30 anos.',
      invalidCalendarDate: 'Data de calendário inválida (por exemplo, 31 de fevereiro não existe). Por favor, selecione uma data real.',
      birthLabel: '1. Sua Data de Nascimento (Obrigatório para o cálculo dos anos)',
      birthHint: 'Necessária para calcular seus anos exatos (fase 20–25 e virada dos 27–30 anos) e cruzar seus sinais com o seu grau natal.',
      photoChecklist: ['1. Olhar frontal direto para a câmara', '2. Luz natural uniforme sem sombras fortes', '3. Sobrancelhas visíveis (sem franja ou armação de óculos)'],
      emailOptInLabel: 'Sim, desejo receber também uma cópia do meu relatório por e-mail (opcional)',
      otpPrompt: 'Para verificar a titularidade neste dispositivo, envie um código único de 6 dígitos para o e-mail da sua compra no Payhip.',
      otpSendBtn: 'Enviar código de 6 dígitos para o e-mail de compra',
      otpPlaceholder: 'Código de 6 dígitos',
      otpSentMsg: 'Um código de 6 dígitos foi enviado para o e-mail da sua compra no Payhip. Insira-o acima e clique em «Criar análise e PDF».',
      dayPlaceholder: 'Dia',
      monthPlaceholder: 'Mês',
      yearPlaceholder: 'Ano',
      months: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
      tgUnlockBtn: (stars, fiat) => `Desbloquear no Telegram – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Análise Pessoal – ${label} (Payhip)`,
      nameTooLong: 'Seu primeiro nome pode ter no máximo 30 caracteres.',
      invalidEmail: 'Por favor, insira um e-mail válido ou deixe o campo em branco.',
      creatingReport: 'Sua análise completa e seu PDF estão sendo criados. Aguarde um momento.',
      reportReadyEmail: 'Sua análise completa e seu PDF estão prontos (e também foram enviados para o seu e-mail).',
      reportReadyDownload: 'Sua análise completa e seu PDF estão prontos. Se o download não iniciar, use o link.',
      pdfReadyDownload: 'Seu PDF está pronto. Se o download não iniciar, use o link.',
      errors: {
        invalid_key: 'Esta chave é inválida. Verifique a chave da sua compra no Payhip.',
        key_used: 'Esta chave já foi utilizada.',
        owner_verification_required: 'Verificação necessária: confirme com o código de 6 dígitos enviado para o e-mail da sua compra.',
        invalid_otp: 'O código de 6 dígitos é inválido.',
        otp_locked: 'Muitas tentativas incorretas. Aguarde 30 minutos.',
        key_revoked: 'Esta chave foi desativada após um reembolso.',
        invalid_request: 'Verifique seus dados e analise sua foto novamente se necessário.',
        server_error: 'Não foi possível criar seu PDF agora. Verifique sua compra ou entre em contato com o suporte.',
        network: 'Sem conexão. Verifique sua conexão com a internet antes de tentar novamente.'
      },
      bootError: 'Não foi possível carregar a ferramenta. Por favor, recarregue a página.',
      openingPhoto: 'Abrindo foto …',
      photoReady: 'Sua foto está pronta.',
      loadingModel: 'Carregando análise no seu dispositivo …',
      analyzingBrows: 'Analisando suas sobrancelhas …',
      analysisDone: 'Sua análise está pronta.',
      analysisFailed: 'Não foi possível iniciar a análise local. Recarregue a página ou use um navegador atualizado.'
    },
    fr: {
      sides: {links: 'gauche', rechts: 'droite', mitte: 'centre'},
      removeSuffix: ': retirer',
      moleNone: 'Aucun grain de beauté sélectionné.',
      moleCount: n => n + ' sur 13 sélectionnés. Cliquez pour retirer.',
      moleMax: 'Vous pouvez sélectionner jusqu’à 13 zones. Retirez-en une d’abord.',
      submitIdle: 'Créer l’analyse et le PDF',
      submitPending: 'Création du PDF …',
      submitDone: 'PDF créé',
      missingKey: 'Veuillez saisir la clé reçue lors de votre achat Payhip.',
      missingBirth: 'Veuillez d’abord sélectionner votre date de naissance complète (Jour, Mois, Année) afin de calculer vos années exactes du cap des 30 ans.',
      invalidCalendarDate: 'Date de calendrier invalide (par ex. le 31 février n’existe pas). Veuillez choisir une date réelle.',
      birthLabel: '1. Votre Date de Naissance (Obligatoire pour le calcul des années)',
      birthHint: 'Nécessaire pour calculer vos années exactes (période 20–25 ans et tournant 27–30 ans) et relier vos grains de beauté à votre degré natal.',
      photoChecklist: ['1. Regard frontal face à la caméra', '2. Lumière du jour uniforme sans ombres marquées', '3. Sourcils bien dégagés (sans frange ni monture de lunettes)'],
      emailOptInLabel: 'Oui, je souhaite également recevoir une copie de mon rapport par e-mail (optionnel)',
      otpPrompt: 'Pour vérifier votre achat sur cet appareil, envoyez un code unique à 6 chiffres à votre adresse e-mail d’achat Payhip.',
      otpSendBtn: 'Envoyer le code à 6 chiffres par e-mail',
      otpPlaceholder: 'Code à 6 chiffres',
      otpSentMsg: 'Un code à 6 chiffres a été envoyé à votre e-mail d’achat Payhip. Saisissez-le ci-dessus et cliquez sur « Créer l’analyse et le PDF ».',
      dayPlaceholder: 'Jour',
      monthPlaceholder: 'Mois',
      yearPlaceholder: 'Année',
      months: ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
      tgUnlockBtn: (stars, fiat) => `Débloquer sur Telegram – ${stars} ⭐ (${fiat})`,
      payhipBtn: label => `Analyse Personnelle – ${label} (Payhip)`,
      nameTooLong: 'Votre prénom ne peut pas dépasser 30 caractères.',
      invalidEmail: 'Veuillez saisir une adresse e-mail valide ou laisser ce champ vide.',
      creatingReport: 'Votre analyse complète et votre PDF sont en cours de création. Veuillez patienter.',
      reportReadyEmail: 'Votre analyse complète et votre PDF sont prêts (et également envoyés par e-mail).',
      reportReadyDownload: 'Votre analyse complète et votre PDF sont prêts. Si le téléchargement ne démarre pas, utilisez le lien.',
      pdfReadyDownload: 'Votre PDF est prêt. Si le téléchargement ne démarre pas, utilisez le lien.',
      errors: {
        invalid_key: 'Cette clé est invalide. Vérifiez la clé de votre achat Payhip.',
        key_used: 'Cette clé a déjà été utilisée.',
        owner_verification_required: 'Vérification requise : confirmez avec le code à 6 chiffres envoyé à votre e-mail d’achat.',
        invalid_otp: 'Le code à 6 chiffres est invalide.',
        otp_locked: 'Trop de tentatives erronées. Veuillez patienter 30 minutes.',
        key_revoked: 'Cette clé a été désactivée suite à un remboursement.',
        invalid_request: 'Veuillez vérifier vos informations et réanalyser votre photo si nécessaire.',
        server_error: 'Votre PDF n’a pas pu être créé pour le moment. Vérifiez votre achat ou contactez le support.',
        network: 'Aucune connexion. Vérifiez votre connexion internet avant de réessayer.'
      },
      bootError: 'L’outil n’a pas pu être chargé. Veuillez recharger la page.',
      openingPhoto: 'Ouverture de la photo …',
      photoReady: 'Votre photo est prête.',
      loadingModel: 'Chargement de l’analyse sur votre appareil …',
      analyzingBrows: 'Analyse de vos sourcils …',
      analysisDone: 'Votre analyse est prête.',
      analysisFailed: 'L’analyse locale n’a pas pu démarrer. Rechargez la page ou utilisez un navigateur récent.'
    }
  };

  const TIER1_CC = new Set(['DE','AT','CH','LI','LU','US','GB','UK','CA','AU','NZ','IE','FR','BE','NL','MC','SE','NO','DK','FI','IS','SG','JP','KR','AE','QA','KW','IL']);
  const TIER2_EU_CC = new Set(['ES','PT','IT','GR','CY','MT','SI','EE','LV','LT','CZ','SK','PL','HU','HR','RO','BG']);
  const TIER2_RU_CC = new Set(['RU','KZ','BY']);
  const TIER4_POOR_CC = new Set(['SN','CI','CM','CD','CG','ML','BF','NE','GN','BJ','TG','GA','TD','CF','RW','BI','DJ','KM','MG','MR','HT','AO','MZ','GW','CV','ST','GQ','NG','KE','GH','UG','TZ','ZM','ZW','MW','ET','SD','SS','SL','LR','GM','ER','SO','IN','PK','BD','LK','NP','MM','KH','LA','AF','PH','VN','ID','EG','YE','SY','VE','BO','CU','NI','HN','SV','TJ','KG']);
  const TIER3_EMERGING_CC = new Set(['MX','CO','AR','CL','PE','EC','UY','PY','CR','PA','DO','GT','PR','BR','MA','DZ','TN','LY','UA','UZ','AM','GE','AZ','MD','TR','RS','BA','ME','MK','AL','ZA','MY','TH']);

  function inferClientCountry(lang) {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    if (tz) {
      if (/^Europe\/(Madrid|Ceuta)|^Atlantic\/Canary/i.test(tz)) return 'ES';
      if (/^Europe\/Lisbon|^Atlantic\/(Madeira|Azores)/i.test(tz)) return 'PT';
      if (/^Europe\/(Paris|Brussels|Luxembourg|Monaco)/i.test(tz)) return 'FR';
      if (/^Europe\/(Berlin|Vienna|Zurich|Vaduz)/i.test(tz)) return 'DE';
      if (/^Europe\/(London|Dublin)/i.test(tz)) return 'GB';
      if (/^Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Kirov|Astrakhan|Ulyanovsk)|^Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Vladivostok|Magadan|Sakhalin|Kamchatka)/i.test(tz)) return 'RU';
      if (/^Asia\/(Almaty|Qyzylorda|Qostanay|Aqtobe|Aqtau|Atyrau|Oral)/i.test(tz)) return 'KZ';
      if (/^Europe\/Minsk/i.test(tz)) return 'BY';
      if (/^Europe\/(Kyiv|Kiev|Uzhgorod|Zaporozhye)/i.test(tz)) return 'UA';
      if (/^Asia\/(Tashkent|Samarkand)/i.test(tz)) return 'UZ';
      if (/^Asia\/(Dushanbe|Bishkek)/i.test(tz)) return 'TJ';
      if (/^America\/(Sao_Paulo|Fortaleza|Recife|Salvador|Bahia|Belem|Manaus|Cuiaba|Porto_Velho|Boa_Vista|Rio_Branco|Maceio|Araguaina|Noronha)/i.test(tz)) return 'BR';
      if (/^America\/(Caracas|La_Paz|Havana|Managua|Tegucigalpa|El_Salvador|Port-au-Prince)/i.test(tz)) return 'VE';
      if (/^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax)/i.test(tz)) return 'CA';
      if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Detroit|Anchorage|Honolulu)/i.test(tz)) return lang === 'es' ? 'MX' : 'US';
      if (/^America\//i.test(tz)) return lang === 'pt' ? 'BR' : 'MX';
      if (/^Africa\/(Casablanca|Algiers|Tunis)/i.test(tz)) return 'MA';
      if (/^Africa\/(Luanda|Maputo|Bissau)/i.test(tz)) return 'AO';
      if (/^Africa\/|^Indian\/(Antananarivo|Comoro|Mayotte)/i.test(tz)) return lang === 'pt' ? 'AO' : lang === 'en' ? 'NG' : 'SN';
      if (/^Asia\/(Kolkata|Calcutta|Karachi|Dhaka|Colombo|Kathmandu|Manila|Jakarta|Ho_Chi_Minh)/i.test(tz)) return 'IN';
    }
    try {
      const langs = navigator.languages || [navigator.language || ''];
      for (const loc of langs) {
        const m = /-([A-Za-z]{2})\b/.exec(loc);
        if (m) return m[1].toUpperCase();
      }
    } catch (_) {}
    return {de:'DE',en:'US',es:'MX',pt:'BR',fr:'FR',ru:'RU'}[lang] || 'DE';
  }

  function inferClientCountry(_lang) {
    return 'UNKNOWN';
  }

  function resolveClientPricing(_lang, ccOverride) {
    // B8 & B7: Strict IP-country pricing from Cloudflare Worker (/api/pricing). No language discount for lang=ru and no client locale/tz override.
    const cc = (ccOverride || 'UNKNOWN').toUpperCase();
    if (TIER4_POOR_CC.has(cc)) return {country: cc, tier: 'tier4_social', price_stars: 45, fiat_label: '0,89 €', payhip_tier: 'tier3', payhip_label: '4,99 €'};
    if (TIER3_EMERGING_CC.has(cc)) return {country: cc, tier: 'tier3_emerging', price_stars: 75, fiat_label: '1,49 €', payhip_tier: 'tier3', payhip_label: '4,99 €'};
    if (TIER2_EU_CC.has(cc) || TIER2_RU_CC.has(cc)) return {country: cc, price_stars: 150, fiat_label: '2,99 €', payhip_tier: 'tier2', payhip_label: '6,99 €'};
    return {country: cc, tier: cc === 'UNKNOWN' ? 'tier1_default' : 'tier1_high', price_stars: 250, fiat_label: '4,99 €', payhip_tier: 'tier1', payhip_label: '9,99 €'};
  }

  function buildFreeBirthSummary(birthDateStr, lang) {
    if (!birthDateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateStr);
    if (!m) return '';
    const by = Number(m[1]), bm = Number(m[2]), bd = Number(m[3]);
    const now = new Date();
    let age = now.getFullYear() - by;
    if (now.getMonth() + 1 < bm || (now.getMonth() + 1 === bm && now.getDate() < bd)) age--;
    age = Math.max(0, age);
    const fmt = `${String(bd).padStart(2,'0')}.${String(bm).padStart(2,'0')}.${by}`;
    const y20_25 = `${by + 20}–${by + 25}`;
    const y27_30 = `${by + 27}–${by + 30}`;
    if (lang === 'de') {
      const p = age > 30 ? `liegt deine 27–30-Jahre-Wende im Zeitraum ${y27_30} bereits hinter dir` : age >= 27 ? `befindest du dich genau jetzt (${y27_30}) mitten in deiner 27–30-Jahre-Wende` : `steht dir deine große 27–30-Jahre-Wende in den Jahren ${y27_30} bevor`;
      return `📅 Deine persönliche Zeitachse (${fmt}, ${age} J.): Durch dein Geburtsdatum ${p}. Der Brauenabschnitt für 20–25 Jahre (Geschwister & früher Aufbruch) entspricht bei dir exakt den Jahren ${y20_25}.`;
    }
    if (lang === 'en') {
      const p = age > 30 ? `your 27–30 turning point took place in ${y27_30}` : age >= 27 ? `you are in the middle of your 27–30 turning point right now (${y27_30})` : `your major 27–30 turning point will take place in ${y27_30}`;
      return `📅 Your Personal Timeline (${fmt}, age ${age}): Based on your birth date, ${p}. The 20–25 eyebrow segment (siblings & early momentum) corresponds to ${y20_25}.`;
    }
    if (lang === 'es') {
      const p = age > 30 ? `tu giro de los 27–30 años tuvo lugar entre ${y27_30}` : age >= 27 ? `estás viviendo ahora mismo (${y27_30}) tu giro de los 27–30 años` : `tu gran giro de los 27–30 años llegará entre ${y27_30}`;
      return `📅 Tu Línea de Tiempo Personal (${fmt}, ${age} años): Según tu fecha de nacimiento, ${p}. El tramo de los 20–25 años (hermanos e impulso juvenil) corresponde exactamente a ${y20_25}.`;
    }
    if (lang === 'ru') {
      const p = age > 30 ? `твой рубеж середины брови (27–30 лет) пришёлся на ${y27_30} гг.` : age >= 27 ? `ты прямо сейчас (${y27_30} гг.) проходишь главный рубеж 27–30 лет` : `главный разворот середины брови (27–30 лет) ждёт тебя в ${y27_30} гг.`;
      return `📅 Твой личный расчёт по дате рождения (${fmt}, ${age} л.): По твоей дате рождения ${p} А участок 20–25 лет (братья/сёстры и ранний разгон) соответствует ${y20_25} гг.`;
    }
    if (lang === 'pt') {
      const p = age > 30 ? `a sua virada dos 27–30 anos ocorreu entre ${y27_30}` : age >= 27 ? `você está vivendo agora mesmo (${y27_30}) a virada dos 27–30 anos` : `a sua grande virada dos 27–30 anos acontecerá entre ${y27_30}`;
      return `📅 Sua Linha do Tempo Pessoal (${fmt}, ${age} anos): Pela sua data de nascimento, ${p}. O trecho dos 20–25 anos (irmãos e impulso inicial) corresponde a ${y20_25}.`;
    }
    const p = age > 30 ? `ton tournant des 27–30 ans a eu lieu entre ${y27_30}` : age >= 27 ? `tu traverses en ce moment (${y27_30}) ton tournant des 27–30 ans` : `ton grand tournant des 27–30 ans aura lieu entre ${y27_30}`;
    return `📅 Ta Chronologie Personnelle (${fmt}, ${age} ans) : Selon ta date de naissance, ${p}. Le segment 20–25 ans (fratrie et élan) correspond aux années ${y20_25}.`;
  }
  function getOrCreateClaimToken() {
    const key = 'sora_client_claim_token';
    try {
      const existing = localStorage.getItem(key);
      if (existing && existing.length >= 24) return existing;
    } catch (_) {}
    const bytes = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const token = 'clm_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(key, token); } catch (_) {}
    return token;
  }

  function setupReportForm(onBusyChange = () => {}, onMolesChange = () => {}) {
    const lang = detectLang(), ui = UI_BY_LANG[lang] || UI_BY_LANG.de;
    const MOLE_ZONE_NAMES = MOLE_ZONE_NAMES_BY_LANG[lang] || MOLE_ZONE_NAMES_BY_LANG.de;
    const $ = id => document.getElementById(id), form = $('key-form');
    const fields = $('report-fields'), submit = $('report-submit'), message = $('report-status'), error = $('report-error');
    const download = $('report-download'), zoneButtons = new Map(), selected = new Map();
    const errors = ui.errors;
    let endpoint = null, baseEndpoint = null, result = null, activeZone = null, revision = 0, pending = false, complete = false, pdfURL = null;
    const configured = form.dataset.workerUrl.trim();
    if (configured) {
      try {
        const url = new URL(configured, location.href);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash) {
          baseEndpoint = url.href.replace(/\/+$/, '');
          url.pathname = url.pathname.replace(/\/+$/, '') + '/api/report'; endpoint = url.href;
        }
      } catch (_) { /* Invalid configuration keeps paid requests disabled. */ }
    }
    if (!$('mole-mitte') && $('mole-links') && $('mole-rechts') && $('mole-links').parentNode) {
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.id = 'mole-mitte';
      mBtn.className = $('mole-links').className || 'mole-choice';
      mBtn.setAttribute('aria-pressed', 'false');
      mBtn.disabled = true;
      mBtn.textContent = ui.sides.mitte || 'Mitte';
      $('mole-links').parentNode.insertBefore(mBtn, $('mole-rechts'));
    }
    const emailInput = $('report-email');
    let emailOptIn = $('email-opt-in');
    if (!emailOptIn && emailInput && emailInput.parentNode) {
      const optWrap = document.createElement('label');
      optWrap.className = 'email-opt-in-label';
      emailOptIn = document.createElement('input');
      emailOptIn.type = 'checkbox';
      emailOptIn.id = 'email-opt-in';
      const optSpan = document.createElement('span');
      optSpan.textContent = ' ' + (ui.emailOptInLabel || '');
      optWrap.append(emailOptIn, optSpan);
      emailInput.parentNode.append(optWrap);
    }
    let otpBox = $('otp-recovery-box'), otpInput = $('recovery-otp-input'), otpReqBtn = $('request-otp-btn');
    if (!otpBox && fields) {
      otpBox = document.createElement('div');
      otpBox.id = 'otp-recovery-box';
      otpBox.className = 'otp-recovery-box';
      otpBox.hidden = true;
      const otpHint = document.createElement('p');
      otpHint.className = 'note';
      otpHint.id = 'otp-recovery-hint';
      otpHint.textContent = errors.owner_verification_required || '';
      otpReqBtn = document.createElement('button');
      otpReqBtn.type = 'button';
      otpReqBtn.id = 'request-otp-btn';
      otpReqBtn.className = 'button secondary';
      otpReqBtn.textContent = '6-stelligen Code an Payhip-Kauf-E-Mail senden';
      otpInput = document.createElement('input');
      otpInput.type = 'text';
      otpInput.id = 'recovery-otp-input';
      otpInput.inputMode = 'numeric';
      otpInput.maxLength = 6;
      otpInput.placeholder = '6-stelliger Code';
      otpBox.append(otpHint, otpReqBtn, otpInput);
      fields.append(otpBox);
    }
    const showError = text => { error.textContent = text; error.hidden = false; };
    const clearError = () => { error.textContent = ''; error.hidden = true; };
    const releasePDF = () => { if (pdfURL) URL.revokeObjectURL(pdfURL); pdfURL = null; download.removeAttribute('href'); download.hidden = true; };
    const updateBusy = () => {
      fields.disabled = pending || complete;
      submit.disabled = pending || complete || !result;
      submit.textContent = pending ? ui.submitPending : complete ? ui.submitDone : ui.submitIdle;
      form.setAttribute('aria-busy', String(pending));
      onBusyChange(pending);
    };
    const renderMoles = () => {
      for (const [zone, button] of zoneButtons) button.setAttribute('aria-pressed', String(zone === activeZone));
      for (const side of ['links', 'mitte', 'rechts']) {
        const button = $('mole-' + side);
        if (!button) continue;
        button.textContent = ui.sides[side] || side;
        const fixedSide = activeZone === 'links_gesicht' ? 'links' : activeZone === 'rechts_gesicht' ? 'rechts' : null;
        button.disabled = !activeZone || (fixedSide !== null && fixedSide !== side);
        button.setAttribute('aria-pressed', String(!!activeZone && selected.has(activeZone + ':' + side)));
      }
      $('mole-none').setAttribute('aria-pressed', String(selected.size === 0));
      $('mole-count').textContent = selected.size ? ui.moleCount(selected.size) : ui.moleNone;
      const list = $('mole-selection'); list.replaceChildren();
      for (const [key, mole] of selected) {
        const item = document.createElement('li'), button = document.createElement('button');
        const sideLabel = ui.sides[mole.side] || mole.side;
        button.type = 'button'; button.className = 'mole-choice mole-selected';
        button.textContent = MOLE_ZONE_NAMES[mole.zone] + ' · ' + sideLabel + ' ×';
        button.setAttribute('aria-label', MOLE_ZONE_NAMES[mole.zone] + ', ' + sideLabel + ui.removeSuffix);
        button.addEventListener('click', () => { if (pending || complete) return; selected.delete(key); clearError(); renderMoles(); onMolesChange(Array.from(selected.values())); });
        item.append(button); list.append(item);
      }
    };
    for (const [zone, name] of Object.entries(MOLE_ZONE_NAMES)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mole-choice'; button.textContent = name;
      button.setAttribute('aria-pressed', 'false'); button.dataset.zone = zone;
      button.addEventListener('click', () => { if (pending || complete) return; activeZone = zone; clearError(); renderMoles(); });
      zoneButtons.set(zone, button); $('mole-zones').append(button);
    }
    for (const side of ['links', 'mitte', 'rechts']) {
      const btn = $('mole-' + side);
      if (!btn) continue;
      btn.addEventListener('click', () => {
        if (pending || complete || !activeZone || btn.disabled) return;
        const key = activeZone + ':' + side;
        if (selected.has(key)) selected.delete(key);
        else if (selected.size < 13) selected.set(key, {zone: activeZone, side});
        else { showError(ui.moleMax); return; }
        clearError(); renderMoles(); onMolesChange(Array.from(selected.values()));
      });
    }
    $('mole-none').addEventListener('click', () => { if (pending || complete) return; selected.clear(); activeZone = null; clearError(); renderMoles(); onMolesChange([]); });
    if (otpReqBtn) {
      otpReqBtn.addEventListener('click', async () => {
        if (!endpoint || !result || pending || complete) return;
        const licenseKey = $('license-key').value.trim();
        if (!licenseKey) { showError(ui.missingKey); return; }
        clearError();
        try {
          const res = await fetch(endpoint, {
            method: 'POST', headers: {'Content-Type': 'application/json', 'Accept': 'application/json'}, credentials: 'omit',
            cache: 'no-store', body: JSON.stringify({
              license_key: licenseKey, brow_form: result.brow_form, brow_subtype: result.brow_subtype,
              mark30_found: result.mark30_found, mark30_state: result.mark30_state, angle_state: result.angle_state,
              moles: Array.from(selected.values()), birth_date: result.birth_date, request_recovery_otp: true
            })
          });
          const data = await res.json().catch(() => ({}));
          if (data?.otp_sent) {
            message.textContent = `Code gesendet an ${data.masked_email || 'deine Kauf-E-Mail'}.`;
          } else {
            showError(errors[data?.error] || errors.server_error);
          }
        } catch (_) {
          showError(errors.network);
        }
      });
    }
    const paidPanel = $('paid-result'), paidContainer = $('paid-sections');
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
      const optInChecked = Boolean(emailOptIn && emailOptIn.checked);
      if (!licenseKey) { showError(ui.missingKey); $('license-key').focus(); return; }
      if (Array.from(firstName).length > 30) { showError(ui.nameTooLong); $('report-first-name').focus(); return; }
      if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email))) {
        showError(ui.invalidEmail);
        if (emailInput) emailInput.focus();
        return;
      }
      const payload = {
        license_key: licenseKey, brow_form: result.brow_form, brow_subtype: result.brow_subtype,
        mark30_found: result.mark30_found, mark30_state: result.mark30_state || (result.mark30_found ? 'found' : 'not_found'),
        angle_state: result.angle_state || 'rund',
        moles: Array.from(selected.values()),
        client_claim_token: getOrCreateClaimToken(),
        email_opt_in: optInChecked,
        source_channel: 'web'
      };
      if (otpInput && otpInput.value.trim()) payload.recovery_otp = otpInput.value.trim();
      if (result.birth_date) payload.birth_date = result.birth_date;
      if (typeof result.birth_tz_offset_min === 'number') payload.birth_tz_offset_min = result.birth_tz_offset_min;
      if (result.country) payload.country = result.country;
      if (result.tz) payload.tz = result.tz;
      if (firstName) payload.first_name = firstName;
      if (email && optInChecked) payload.email = email;
      if (lang !== 'de') payload.lang = lang;
      const ticket = revision;
      pending = true; releasePDF(); updateBusy(); message.textContent = ui.creatingReport;
      try {
        // One explicit submit makes one request. Never retry a license-consuming request automatically.
        const response = await fetch(endpoint, {
          method: 'POST', headers: {'Content-Type': 'application/json', 'Accept': 'application/json'}, credentials: 'omit',
          cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', body: JSON.stringify(payload)
        });
        if (ticket !== revision) return;
        if (!response.ok) {
          let code = 'server_error';
          try {
            const body = await response.json();
            if (Object.hasOwn(errors, body.error) && body.error !== 'network') code = body.error;
            if (body.error === 'owner_verification_required' && otpBox) otpBox.hidden = false;
          } catch (_) { /* Keep the generic server error. */ }
          if (ticket === revision) { message.textContent = ''; showError(errors[code] || errors.server_error); }
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
          if (otpBox) otpBox.hidden = true;
          renderPaidSections(data);
          message.textContent = data.email_sent
            ? ui.reportReadyEmail
            : ui.reportReadyDownload;
          download.click();
          return;
        }
        if (!ct.startsWith('application/pdf')) { message.textContent = ''; showError(errors.server_error); return; }
        const blob = await response.blob();
        if (ticket !== revision) return;
        if (!blob.size) { message.textContent = ''; showError(errors.server_error); return; }
        pdfURL = URL.createObjectURL(blob); download.href = pdfURL; download.hidden = false;
        complete = true; $('license-key').value = ''; message.textContent = ui.pdfReadyDownload;
        download.click();
      } catch (_) {
        if (ticket === revision) { message.textContent = ''; showError(errors.network); }
      } finally { pending = false; updateBusy(); }
    });
    renderMoles(); updateBusy();
    return {
      isPending: () => pending,
      getMoles: () => Array.from(selected.values()),
      getBaseEndpoint: () => baseEndpoint,
      setResult(value) {
        result = {
          brow_form: value.form, brow_subtype: value.subtype || null,
          mark30_found: !!value.mark30_found, mark30_state: value.mark30_state || (value.mark30_found ? 'found' : 'not_found'),
          angle_state: value.angle_state || (value.angle_sharp ? 'scharf' : 'rund'),
          birth_date: value.birth_date || null, birth_tz_offset_min: value.birth_tz_offset_min ?? null,
          country: value.country || null, tz: value.tz || null
        };
        form.hidden = !endpoint; updateBusy();
      },
      clear() {
        revision++; result = null; complete = false; selected.clear(); activeZone = null;
        $('license-key').value = ''; $('report-first-name').value = ''; if (emailInput) emailInput.value = '';
        if (emailOptIn) emailOptIn.checked = false;
        if (otpInput) otpInput.value = '';
        if (otpBox) otpBox.hidden = true;
        if (paidContainer) paidContainer.replaceChildren(); if (paidPanel) paidPanel.hidden = true;
        message.textContent = ''; clearError(); releasePDF(); renderMoles(); form.hidden = true; updateBusy();
      }
    };
  }
  const api = {analyzeLandmarks, browFeatures, classify, rgbaToGray, resizeAreaRGBA, pyRound, sample, setupReportForm};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.GesichtClassifier = api; if (typeof document !== 'undefined') boot().catch(error => { const ui = UI_BY_LANG[detectLang()] || UI_BY_LANG.de; const el = document.getElementById('analysis-status'); if (el) el.textContent = ui.bootError; console.error('Gesichtlesen: initialization failed', error.name); }); }

  async function boot() {
    if (!document.querySelector('[data-gesicht-app]')) return;
    const lang = detectLang(), ui = UI_BY_LANG[lang] || UI_BY_LANG.de;
    const $ = id => document.getElementById(id), base = '/assets/gesicht/';
    const json = async name => { const res = await fetch(base + name, {credentials: 'omit'}); if (!res.ok) throw new Error('Local asset unavailable'); return res.json(); };
    const rulesFile = lang === 'de' ? 'face_rules_free_de.json' : `face_rules_free_${lang}.json`;
    const [TH, rules] = await Promise.all([json('thresholds.json'), json(rulesFile)]);
    const input = $('photo-input'), preview = $('photo-preview'), analyze = $('analyze-button'), status = $('analysis-status');
    let objectURL = null, detector = null, pendingDetector = null, generation = 0, busy = false, lastAnalysisResult = null;

    // 1. Inject or bind mandatory Birth Date selector (Day · Month · Year) and Photo Checklist (V6)
    let birthDay = $('birth-day'), birthMonth = $('birth-month'), birthYear = $('birth-year');
    const photoControls = document.querySelector('.photo-controls');
    if (!birthDay || !birthMonth || !birthYear) {
      if (photoControls && photoControls.parentNode) {
        const wrap = document.createElement('div');
        wrap.className = 'birth-field';
        wrap.id = 'birth-field';
        const lbl = document.createElement('label');
        lbl.setAttribute('for', 'birth-day');
        lbl.textContent = ui.birthLabel || '1. Dein Geburtsdatum';
        const req = document.createElement('span');
        req.className = 'birth-req';
        req.textContent = '*';
        lbl.append(req);
        const grid = document.createElement('div');
        grid.className = 'birth-selects';
        birthDay = document.createElement('select'); birthDay.id = 'birth-day'; birthDay.setAttribute('aria-label', ui.dayPlaceholder);
        birthMonth = document.createElement('select'); birthMonth.id = 'birth-month'; birthMonth.setAttribute('aria-label', ui.monthPlaceholder);
        birthYear = document.createElement('select'); birthYear.id = 'birth-year'; birthYear.setAttribute('aria-label', ui.yearPlaceholder);
        grid.append(birthDay, birthMonth, birthYear);
        const hint = document.createElement('p');
        hint.className = 'birth-hint';
        hint.textContent = ui.birthHint || '';
        wrap.append(lbl, grid, hint);
        photoControls.parentNode.insertBefore(wrap, photoControls);
      }
    }
    if (!document.querySelector('.photo-checklist') && photoControls && photoControls.parentNode && Array.isArray(ui.photoChecklist)) {
      const cl = document.createElement('ul');
      cl.className = 'photo-checklist';
      for (const itemText of ui.photoChecklist) {
        const li = document.createElement('li');
        li.textContent = itemText;
        cl.append(li);
      }
      photoControls.parentNode.insertBefore(cl, photoControls);
    }
    const populateBirthSelects = () => {
      if (!birthDay || !birthMonth || !birthYear) return;
      if (birthDay.options.length <= 1) {
        birthDay.replaceChildren();
        const d0 = document.createElement('option'); d0.value = ''; d0.textContent = ui.dayPlaceholder; birthDay.append(d0);
        for (let d = 1; d <= 31; d++) {
          const o = document.createElement('option'); o.value = String(d).padStart(2, '0'); o.textContent = String(d); birthDay.append(o);
        }
      }
      if (birthMonth.options.length <= 1) {
        birthMonth.replaceChildren();
        const m0 = document.createElement('option'); m0.value = ''; m0.textContent = ui.monthPlaceholder; birthMonth.append(m0);
        (ui.months || []).forEach((name, idx) => {
          const o = document.createElement('option'); o.value = String(idx + 1).padStart(2, '0'); o.textContent = `${String(idx + 1).padStart(2, '0')} – ${name}`; birthMonth.append(o);
        });
      }
      if (birthYear.options.length <= 1) {
        birthYear.replaceChildren();
        const y0 = document.createElement('option'); y0.value = ''; y0.textContent = ui.yearPlaceholder; birthYear.append(y0);
        const maxY = new Date().getFullYear() - 5;
        for (let y = maxY; y >= 1925; y--) {
          const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); birthYear.append(o);
        }
      }
      try {
        const saved = localStorage.getItem('sora_birth_date');
        if (saved && /^(\d{4})-(\d{2})-(\d{2})$/.test(saved)) {
          const [, sy, sm, sd] = saved.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          birthYear.value = sy; birthMonth.value = sm; birthDay.value = sd;
        }
      } catch (_) {}
    };
    populateBirthSelects();

    const isCompleteBirthSelection = () => Boolean(birthDay && birthMonth && birthYear && birthDay.value && birthMonth.value && birthYear.value);
    const getValidBirthDate = () => {
      if (!birthDay || !birthMonth || !birthYear) return null;
      const d = Number(birthDay.value), m = Number(birthMonth.value), y = Number(birthYear.value);
      if (!d || !m || !y) return null;
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
      const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      try { localStorage.setItem('sora_birth_date', iso); } catch (_) {}
      return iso;
    };

    // 2. Dynamic Regional Pricing (Strict Cloudflare Worker IP-country confirmation)
    let clientTz = '';
    try { clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    // Critique #4: Do NOT substitute current viewer timezone offset for birthplace timezone offset!
    // When birth time/place is unknown, birth_tz_offset_min MUST remain null so the server computes the full 50h (-12:00..+14:00) window.
    const birthTzOffsetMin = null;
    let currentPricing = resolveClientPricing(lang);
    const applyPricingUI = pricing => {
      if (!pricing) return;
      currentPricing = pricing;
      const tgBtn = $('telegram-unlock');
      if (tgBtn && typeof ui.tgUnlockBtn === 'function') {
        tgBtn.textContent = ui.tgUnlockBtn(pricing.price_stars, pricing.fiat_label);
      }
      const phBtn = $('payhip-link');
      if (phBtn) {
        if (typeof ui.payhipBtn === 'function') {
          phBtn.textContent = ui.payhipBtn(pricing.payhip_label || '9,99 €');
        }
        const tierKey = pricing.payhip_tier || (pricing.payhip_label === '4,99 €' ? 'tier3' : pricing.payhip_label === '6,99 €' ? 'tier2' : 'tier1');
        const tierUrl = (tierKey === 'tier3' && phBtn.dataset.payhipUrlTier3)
          || (tierKey === 'tier2' && phBtn.dataset.payhipUrlTier2)
          || (tierKey === 'tier1' && phBtn.dataset.payhipUrlTier1)
          || phBtn.dataset.payhipUrl
          || '';
        if (tierUrl) {
          try {
            const u = new URL(tierUrl.trim());
            if (u.protocol === 'https:') { phBtn.href = u.href; phBtn.hidden = false; }
          } catch (_) {}
        }
      }
    };
    applyPricingUI(currentPricing);

    const keyFormEl = $('key-form');
    const workerBaseUrl = keyFormEl?.dataset?.workerUrl?.trim().replace(/\/+$/, '');
    if (workerBaseUrl && /^https:\/\//i.test(workerBaseUrl)) {
      fetch(workerBaseUrl + '/api/pricing', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
        body: JSON.stringify({lang, tz: clientTz, country: currentPricing.country})
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d?.ok && d.price_stars) applyPricingUI(d);
      }).catch(() => {});
    }

    const updatePhotoControls = reportPending => {
      $('choose-photo').disabled = busy || reportPending;
      input.disabled = busy || reportPending;
      $('reset-photo').disabled = reportPending;
      analyze.disabled = busy || reportPending || !objectURL;
    };
    const syncWebDraftToTelegramLink = async (analysisRes, molesList) => {
      if (!analysisRes) return;
      const botName = BOTS_BY_LANG[lang] || BOTS_BY_LANG.de;
      const compactDate = (analysisRes.birth_date || '').replace(/-/g, '');
      const fallbackHref = 'https://t.me/' + botName + '?start=web_' + encodeURIComponent(analysisRes.form) + '_' + compactDate + '_' + encodeURIComponent(currentPricing.country || '');
      const tgEl = $('telegram-unlock');
      if (tgEl) tgEl.href = fallbackHref;
      if (!workerBaseUrl) return;
      try {
        const res = await fetch(workerBaseUrl + '/api/draft', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
          body: JSON.stringify({
            brow_form: analysisRes.form, brow_subtype: analysisRes.subtype || null,
            mark30_found: !!analysisRes.mark30_found, mark30_state: analysisRes.mark30_state || (analysisRes.mark30_found ? 'found' : 'not_found'),
            angle_state: analysisRes.angle_state || (analysisRes.angle_sharp ? 'scharf' : 'rund'),
            moles: molesList || [], birth_date: analysisRes.birth_date,
            birth_tz_offset_min: birthTzOffsetMin, country: currentPricing.country, tz: clientTz, lang, source_channel: 'web'
          })
        });
        const data = await res.json().catch(() => null);
        if (data?.ok && data.draft_id && tgEl) {
          tgEl.href = 'https://t.me/' + botName + '?start=' + encodeURIComponent(data.draft_id);
        }
      } catch (_) {}
    };
    const report = setupReportForm(updatePhotoControls, molesList => {
      if (lastAnalysisResult) syncWebDraftToTelegramLink(lastAnalysisResult, molesList);
    });
    const payhip = $('payhip-link'), payhipURL = payhip.dataset.payhipUrl.trim();
    if (payhipURL) { try { const u = new URL(payhipURL); if (u.protocol === 'https:') { payhip.href = u.href; payhip.hidden = false; } } catch (_) { /* Keep invalid URLs hidden. */ } }
    const clearResult = () => {
      lastAnalysisResult = null;
      report.clear();
      $('analysis-result').hidden = true;
      $('full-analysis').hidden = true;
      $('photo-error').hidden = true;
      $('brow-name').textContent = '';
      $('brow-description').textContent = '';
      $('mark30-description').textContent = '';
      const pb = $('birth-personal-box');
      if (pb) pb.remove();
    };
    const releasePhoto = () => { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null; preview.removeAttribute('src'); preview.hidden = true; $('preview-area').hidden = true; input.value = ''; analyze.disabled = true; $('reset-photo').hidden = true; };
    const showError = key => { const errMap = rules.photo_errors_de || rules['photo_errors_' + lang] || {}; $('photo-error').textContent = errMap[key] || ''; $('photo-error').hidden = false; status.textContent = ''; };
    const showCustomError = msg => { $('photo-error').textContent = msg; $('photo-error').hidden = false; status.textContent = ''; };
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
    [birthDay, birthMonth, birthYear].forEach(sel => {
      if (sel) sel.addEventListener('change', () => {
        const valid = getValidBirthDate();
        if (valid) {
          if (!$('photo-error').hidden && ($('photo-error').textContent === ui.missingBirth || $('photo-error').textContent === ui.invalidCalendarDate)) {
            $('photo-error').hidden = true;
          }
        } else if (isCompleteBirthSelection()) {
          showCustomError(ui.invalidCalendarDate || ui.missingBirth);
        }
      });
    });
    $('choose-photo').addEventListener('click', () => {
      if (busy || report.isPending()) return;
      if (!getValidBirthDate()) {
        showCustomError(isCompleteBirthSelection() ? (ui.invalidCalendarDate || ui.missingBirth) : ui.missingBirth);
        if (birthDay && !birthDay.value) birthDay.focus();
        else if (birthMonth && !birthMonth.value) birthMonth.focus();
        else if (birthYear && !birthYear.value) birthYear.focus();
        else if (birthDay) birthDay.focus();
        return;
      }
      input.click();
    });
    input.addEventListener('change', async () => {
      if (busy || report.isPending()) return;
      const file = input.files && input.files[0]; if (!file) return;
      const ticket = ++generation; clearResult(); releasePhoto();
      if (file.type && !file.type.startsWith('image/')) { showError('no_face'); return; }
      status.textContent = ui.openingPhoto;
      objectURL = URL.createObjectURL(file); preview.src = objectURL;
      try { await preview.decode(); if (ticket !== generation) return; preview.hidden = false; $('preview-area').hidden = false; $('reset-photo').hidden = false; analyze.disabled = false; status.textContent = ui.photoReady; }
      catch (_) { if (ticket === generation) { releasePhoto(); showError('no_face'); } }
    });
    $('reset-photo').addEventListener('click', () => { if (report.isPending()) return; generation++; clearResult(); releasePhoto(); status.textContent = ''; });
    analyze.addEventListener('click', async () => {
      if (busy || report.isPending() || !objectURL) return;
      const birthDate = getValidBirthDate();
      if (!birthDate) {
        showCustomError(isCompleteBirthSelection() ? (ui.invalidCalendarDate || ui.missingBirth) : ui.missingBirth);
        if (birthDay && !birthDay.value) birthDay.focus();
        else if (birthMonth && !birthMonth.value) birthMonth.focus();
        else if (birthYear && !birthYear.value) birthYear.focus();
        else if (birthDay) birthDay.focus();
        return;
      }
      busy = true; const ticket = generation;
      analyze.disabled = true; $('choose-photo').disabled = true; clearResult(); status.textContent = ui.loadingModel;
      const canvas = document.createElement('canvas'); let pixels, gray;
      try {
        const model = await loadDetector(); if (ticket !== generation) return;
        status.textContent = ui.analyzingBrows; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
        result.birth_date = birthDate;
        result.birth_tz_offset_min = birthTzOffsetMin;
        result.country = currentPricing.country;
        result.tz = clientTz;
        lastAnalysisResult = result;
        const form = rules.brows[result.form], text = result.subtype && form.subtypes ? form.subtypes[result.subtype] : form;
        $('brow-name').textContent = text.name_de || text['name_' + lang] || ''; $('brow-description').textContent = text.short_de || text['short_' + lang] || '';
        const mKey = result.mark30_state === 'unknown' ? 'free_unknown' : (result.mark30_found ? 'free_found' : 'free_not_found');
        $('mark30-description').textContent = rules.mark30[mKey + '_de'] || rules.mark30[mKey + '_' + lang] || '';
        const personalLine = buildFreeBirthSummary(birthDate, lang);
        if (personalLine && $('mark30-description')?.parentNode) {
          let pb = $('birth-personal-box');
          if (!pb) {
            pb = document.createElement('p');
            pb.id = 'birth-personal-box';
            pb.className = 'birth-personal-box';
            $('mark30-description').parentNode.append(pb);
          }
          pb.textContent = personalLine;
        }
        syncWebDraftToTelegramLink(result, report.getMoles());
        applyPricingUI(currentPricing);
        report.setResult(result);
        $('analysis-result').hidden = false; $('full-analysis').hidden = false; status.textContent = ui.analysisDone;
        $('analysis-result').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
      } catch (error) { if (ticket === generation) { status.textContent = ui.analysisFailed; console.error('Gesichtlesen: local analysis failed', error.name); } }
      finally { if (pixels) pixels.data.fill(0); if (gray) gray.fill(0); canvas.width = canvas.height = 0; busy = false; updatePhotoControls(report.isPending()); }
    });
    addEventListener('pagehide', () => { generation++; report.clear(); releasePhoto(); if (detector) { detector.close(); detector = null; pendingDetector = null; } });
    status.textContent = '';
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
