/* Telegram Mini App version of Gesichtlesen. Same local MediaPipe brow classifier and 13 mole zones, native 250 Stars unlock. */
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
  function rgbaToGray(rgba) { const out = new Float32Array(rgba.length / 4); for (let i = 0; i < out.length; i++) { const j = i * 4; out[i] = (rgba[j] * 9798 + rgba[j + 1] * 19235 + rgba[j + 2] * 3735 + 16384) >> 15; } return out; }
  function resizeAreaRGBA(source, width, height, outWidth, outHeight) {
    if (width === outWidth && height === outHeight) return source;
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

  const SUPPORTED_LANGS = new Set(['de', 'en', 'es', 'ru', 'pt', 'fr']);
  const BOTS_BY_LANG = {
    de: 'gesichtslesen_bot',
    en: 'udalyonnayarabota_bot',
    es: 'tarjetascripto_bot',
    ru: 'chtenielica_bot',
    pt: 'quemargrasa_bot',
    fr: 'kriptokartybot'
  };
  function detectLang() {
    const raw = ((typeof document !== 'undefined' && ((typeof document.querySelector === 'function' && (document.querySelector('[data-gesicht-app]')?.dataset?.lang || document.querySelector('[data-gesicht-tg-app]')?.dataset?.lang)) || document.documentElement?.lang)) || 'de').slice(0, 2).toLowerCase();
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
      sides: {links: 'links', rechts: 'rechts'},
      removeSuffix: ': entfernen',
      moleNone: 'Keine Muttermale ausgewählt.',
      moleCount: n => n + ' von 13 Angaben ausgewählt. Zum Entfernen anklicken.',
      moleMax: 'Du kannst höchstens 13 Angaben auswählen. Entferne zuerst eine Angabe.',
      submitIdle: 'Vollständige Analyse freischalten – 250 ⭐',
      submitIdleDynamic: (stars, fiat) => `Vollständige Analyse freischalten – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Freischalten · ${stars} ⭐ (${fiat})`,
      submitPending: 'Bitte warten …',
      submitDone: 'Vollständige Analyse freigeschaltet',
      missingBirth: 'Bitte wähle zuerst dein vollständiges Geburtsdatum (Tag, Monat, Jahr), damit deine Lebensjahre um 30 und deine Körperzonen exakt berechnet werden.',
      birthLabel: '1. Dein Geburtsdatum (Pflichtfeld für die Jahresberechnung)',
      birthHint: 'Wird für deine exakten Kalenderjahre (20–25 & Wende 27–30 Jahre) sowie für die Zuordnung deiner Muttermale zum Sternzeichen-Grad benötigt.',
      dayPlaceholder: 'Tag',
      monthPlaceholder: 'Monat',
      yearPlaceholder: 'Jahr',
      months: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
      nameTooLong: 'Dein Vorname darf höchstens 30 Zeichen haben.',
      invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein oder lasse das Feld frei.',
      openingInvoice: 'Rechnung wird geöffnet …',
      invoiceErrorRetry: 'Die Zahlung konnte gerade nicht vorbereitet werden. Bitte versuche es erneut.',
      invoiceError: 'Die Zahlung konnte gerade nicht vorbereitet werden.',
      paymentFailed: 'Die Zahlung wurde nicht abgeschlossen.',
      paymentSuccessCreating: 'Zahlung erfolgreich! Deine Analyse und dein PDF werden erstellt …',
      sentToChat: 'Deine Analyse wurde in den Telegram-Chat gesendet.',
      tgReadyEmail: 'Deine vollständige Analyse ist bereit (und zusätzlich als PDF im Chat sowie per E-Mail).',
      tgReadyChat: 'Deine vollständige Analyse ist bereit (und zusätzlich als PDF im Chat).',
      networkError: 'Keine Verbindung. Bitte prüfe deine Internetverbindung.',
      bootError: 'Das Werkzeug konnte nicht geladen werden. Bitte lade die Seite erneut.',
      openingPhoto: 'Foto wird geöffnet …',
      photoReady: 'Dein Foto ist bereit.',
      loadingModel: 'Analyse wird auf deinem Gerät geladen …',
      analyzingBrows: 'Deine Augenbrauen werden analysiert …',
      analysisDone: 'Deine Analyse ist fertig.',
      analysisFailed: 'Die lokale Analyse konnte nicht gestartet werden. Bitte lade die Seite erneut.'
    },
    en: {
      sides: {links: 'left', rechts: 'right'},
      removeSuffix: ': remove',
      moleNone: 'No moles selected.',
      moleCount: n => n + ' of 13 selected. Click to remove.',
      moleMax: 'You can select up to 13 items. Remove one first.',
      submitIdle: 'Unlock full reading – 250 ⭐',
      submitIdleDynamic: (stars, fiat) => `Unlock full reading – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Unlock · ${stars} ⭐ (${fiat})`,
      submitPending: 'Please wait …',
      submitDone: 'Full reading unlocked',
      missingBirth: 'Please select your full birth date (Day, Month, Year) first so we can calculate your exact age-30 turning point years and body zones.',
      birthLabel: '1. Your Date of Birth (Required for timeline calculation)',
      birthHint: 'Required to calculate your exact calendar years (ages 20–25 & 27–30 turning point) and match your moles to your birth degree.',
      dayPlaceholder: 'Day',
      monthPlaceholder: 'Month',
      yearPlaceholder: 'Year',
      months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      nameTooLong: 'Your first name may be at most 30 characters.',
      invalidEmail: 'Please enter a valid email address or leave the field blank.',
      openingInvoice: 'Opening invoice …',
      invoiceErrorRetry: 'Payment could not be prepared right now. Please try again.',
      invoiceError: 'Payment could not be prepared right now.',
      paymentFailed: 'Payment was not completed.',
      paymentSuccessCreating: 'Payment successful! Creating your reading and PDF …',
      sentToChat: 'Your reading has been sent to the Telegram chat.',
      tgReadyEmail: 'Your full reading is ready (and also sent as a PDF in chat and by email).',
      tgReadyChat: 'Your full reading is ready (and also sent as a PDF in chat).',
      networkError: 'No connection. Please check your internet connection.',
      bootError: 'The tool could not be loaded. Please reload the page.',
      openingPhoto: 'Opening photo …',
      photoReady: 'Your photo is ready.',
      loadingModel: 'Loading analysis on your device …',
      analyzingBrows: 'Analyzing your eyebrows …',
      analysisDone: 'Your reading is ready.',
      analysisFailed: 'Local analysis could not start. Please reload the page.'
    },
    es: {
      sides: {links: 'izquierda', rechts: 'derecha'},
      removeSuffix: ': quitar',
      moleNone: 'Ningún lunar seleccionado.',
      moleCount: n => n + ' de 13 seleccionados. Haz clic para quitar.',
      moleMax: 'Puedes seleccionar hasta 13 opciones. Quita una primero.',
      submitIdle: 'Desbloquear análisis completo – 75 ⭐',
      submitIdleDynamic: (stars, fiat) => `Desbloquear análisis completo – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Desbloquear · ${stars} ⭐ (${fiat})`,
      submitPending: 'Espera un momento …',
      submitDone: 'Análisis completo desbloqueado',
      missingBirth: 'Por favor, selecciona primero tu fecha de nacimiento completa (Día, Mes, Año) para calcular tus años exactos del giro de los 30 años.',
      birthLabel: '1. Tu Fecha de Nacimiento (Obligatorio para calcular tus años)',
      birthHint: 'Necesaria para calcular tus años exactos (tramo 20–25 y giro de 27–30 años) y cruzar tus lunares con tu signo y grado natal.',
      dayPlaceholder: 'Día',
      monthPlaceholder: 'Mes',
      yearPlaceholder: 'Año',
      months: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
      nameTooLong: 'Tu nombre puede tener como máximo 30 caracteres.',
      invalidEmail: 'Por favor, introduce un correo electrónico válido o deja el campo vacío.',
      openingInvoice: 'Abriendo factura …',
      invoiceErrorRetry: 'No se pudo preparar el pago en este momento. Inténtalo de nuevo.',
      invoiceError: 'No se pudo preparar el pago en este momento.',
      paymentFailed: 'El pago no se completó.',
      paymentSuccessCreating: '¡Pago completado! Creando tu análisis y tu PDF …',
      sentToChat: 'Tu análisis fue enviado al chat de Telegram.',
      tgReadyEmail: 'Tu análisis completo está listo (y también enviado en PDF al chat y por correo).',
      tgReadyChat: 'Tu análisis completo está listo (y también enviado en PDF al chat).',
      networkError: 'Sin conexión. Por favor, revisa tu conexión a internet.',
      bootError: 'No se pudo cargar la herramienta. Por favor, recarga la página.',
      openingPhoto: 'Abriendo foto …',
      photoReady: 'Tu foto está lista.',
      loadingModel: 'Cargando el análisis en tu dispositivo …',
      analyzingBrows: 'Analizando tus cejas …',
      analysisDone: 'Tu análisis está listo.',
      analysisFailed: 'No se pudo iniciar el análisis local. Por favor, recarga la página.'
    },
    ru: {
      sides: {links: 'слева', rechts: 'справа'},
      removeSuffix: ': удалить',
      moleNone: 'Родинки не выбраны.',
      moleCount: n => 'Выбрано ' + n + ' из 13. Нажми, чтобы удалить.',
      moleMax: 'Можно выбрать не более 13 зон. Сначала удали одну.',
      submitIdle: 'Открыть полный разбор – 120 ⭐',
      submitIdleDynamic: (stars, fiat) => `Открыть полный разбор – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Полный доступ · ${stars} ⭐ (${fiat})`,
      submitPending: 'Пожалуйста, подождите …',
      submitDone: 'Полный разбор открыт',
      missingBirth: 'Пожалуйста, сначала укажи полную дату рождения (День, Месяц, Год) — без неё невозможно рассчитать твои точные годы рубежа 27–30 лет и карту родинок.',
      birthLabel: '1. Твоя дата рождения (обязательно для точного расчёта)',
      birthHint: 'Нужна для расчёта твоих календарных лет (период 20–25 лет и главный рубеж 27–30 лет) и привязки родинок к градусу рождения.',
      dayPlaceholder: 'День',
      monthPlaceholder: 'Месяц',
      yearPlaceholder: 'Год',
      months: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
      nameTooLong: 'Имя не должно превышать 30 символов.',
      invalidEmail: 'Пожалуйста, введи корректный e-mail или оставь поле пустым.',
      openingInvoice: 'Открываем счёт …',
      invoiceErrorRetry: 'Не удалось подготовить оплату. Пожалуйста, попробуй ещё раз.',
      invoiceError: 'Не удалось подготовить оплату.',
      paymentFailed: 'Оплата не была завершена.',
      paymentSuccessCreating: 'Оплата прошла! Создаём твой разбор и PDF …',
      sentToChat: 'Твой разбор отправлен в чат Telegram.',
      tgReadyEmail: 'Твой полный разбор готов (и также отправлен в PDF в чат и на e-mail).',
      tgReadyChat: 'Твой полный разбор готов (и также отправлен в PDF в чат).',
      networkError: 'Нет соединения. Пожалуйста, проверь подключение к интернету.',
      bootError: 'Не удалось загрузить инструмент. Пожалуйста, обнови страницу.',
      openingPhoto: 'Открываем фото …',
      photoReady: 'Фото готово к анализу.',
      loadingModel: 'Загружаем анализ на твоём устройстве …',
      analyzingBrows: 'Анализируем твои брови …',
      analysisDone: 'Твой разбор готов.',
      analysisFailed: 'Не удалось запустить локальный анализ. Пожалуйста, обнови страницу.'
    },
    pt: {
      sides: {links: 'esquerda', rechts: 'direita'},
      removeSuffix: ': remover',
      moleNone: 'Nenhum sinal selecionado.',
      moleCount: n => n + ' de 13 selecionados. Clique para remover.',
      moleMax: 'Você pode selecionar no máximo 13 opções. Remova uma primeiro.',
      submitIdle: 'Desbloquear análise completa – 75 ⭐',
      submitIdleDynamic: (stars, fiat) => `Desbloquear análise completa – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Desbloquear · ${stars} ⭐ (${fiat})`,
      submitPending: 'Aguarde …',
      submitDone: 'Análise completa desbloqueada',
      missingBirth: 'Por favor, selecione primeiro sua data de nascimento completa (Dia, Mês, Ano) para calcularmos os anos exatos da sua virada dos 30 anos.',
      birthLabel: '1. Sua Data de Nascimento (Obrigatório para o cálculo dos anos)',
      birthHint: 'Necessária para calcular seus anos exatos (fase 20–25 e virada dos 27–30 anos) e cruzar seus sinais com o seu grau natal.',
      dayPlaceholder: 'Dia',
      monthPlaceholder: 'Mês',
      yearPlaceholder: 'Ano',
      months: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
      nameTooLong: 'Seu primeiro nome pode ter no máximo 30 caracteres.',
      invalidEmail: 'Por favor, insira um e-mail válido ou deixe o campo em branco.',
      openingInvoice: 'Abrindo fatura …',
      invoiceErrorRetry: 'Não foi possível preparar o pagamento agora. Tente novamente.',
      invoiceError: 'Não foi possível preparar o pagamento agora.',
      paymentFailed: 'O pagamento não foi concluído.',
      paymentSuccessCreating: 'Pagamento confirmado! Criando sua análise e seu PDF …',
      sentToChat: 'Sua análise foi enviada para o chat do Telegram.',
      tgReadyEmail: 'Sua análise completa está pronta (e também enviada em PDF no chat e por e-mail).',
      tgReadyChat: 'Sua análise completa está pronta (e também enviada em PDF no chat).',
      networkError: 'Sem conexão. Verifique sua conexão com a internet.',
      bootError: 'Não foi possível carregar a ferramenta. Por favor, recarregue a página.',
      openingPhoto: 'Abrindo foto …',
      photoReady: 'Sua foto está pronta.',
      loadingModel: 'Carregando análise no seu dispositivo …',
      analyzingBrows: 'Analisando suas sobrancelhas …',
      analysisDone: 'Sua análise está pronta.',
      analysisFailed: 'Não foi possível iniciar a análise local. Por favor, recarregue a página.'
    },
    fr: {
      sides: {links: 'gauche', rechts: 'droite'},
      removeSuffix: ': retirer',
      moleNone: 'Aucun grain de beauté sélectionné.',
      moleCount: n => n + ' sur 13 sélectionnés. Cliquez pour retirer.',
      moleMax: 'Vous pouvez sélectionner jusqu’à 13 zones. Retirez-en une d’abord.',
      submitIdle: 'Débloquer l’analyse complète – 250 ⭐',
      submitIdleDynamic: (stars, fiat) => `Débloquer l’analyse complète – ${stars} ⭐ (${fiat})`,
      kickerUnlockDynamic: (stars, fiat) => `Débloquer · ${stars} ⭐ (${fiat})`,
      submitPending: 'Veuillez patienter …',
      submitDone: 'Analyse complète débloquée',
      missingBirth: 'Veuillez d’abord sélectionner votre date de naissance complète (Jour, Mois, Année) afin de calculer vos années exactes du cap des 30 ans.',
      birthLabel: '1. Votre Date de Naissance (Obligatoire pour le calcul des années)',
      birthHint: 'Nécessaire pour calculer vos années exactes (période 20–25 ans et tournant 27–30 ans) et relier vos grains de beauté à votre degré natal.',
      dayPlaceholder: 'Jour',
      monthPlaceholder: 'Mois',
      yearPlaceholder: 'Année',
      months: ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
      nameTooLong: 'Votre prénom ne peut pas dépasser 30 caractères.',
      invalidEmail: 'Veuillez saisir une adresse e-mail valide ou laisser ce champ vide.',
      openingInvoice: 'Ouverture de la facture …',
      invoiceErrorRetry: 'Le paiement n’a pas pu être préparé. Veuillez réessayer.',
      invoiceError: 'Le paiement n’a pas pu être préparé.',
      paymentFailed: 'Le paiement n’a pas été finalisé.',
      paymentSuccessCreating: 'Paiement réussi ! Création de votre analyse et de votre PDF …',
      sentToChat: 'Votre analyse a été envoyée dans le chat Telegram.',
      tgReadyEmail: 'Votre analyse complète est prête (et également envoyée en PDF dans le chat et par e-mail).',
      tgReadyChat: 'Votre analyse complète est prête (et également envoyée en PDF dans le chat).',
      networkError: 'Aucune connexion. Veuillez vérifier votre connexion internet.',
      bootError: 'L’outil n’a pas pu être chargé. Veuillez recharger la page.',
      openingPhoto: 'Ouverture de la photo …',
      photoReady: 'Votre photo est prête.',
      loadingModel: 'Chargement de l’analyse sur votre appareil …',
      analyzingBrows: 'Analyse de vos sourcils …',
      analysisDone: 'Votre analyse est prête.',
      analysisFailed: 'L’analyse locale n’a pas pu démarrer. Veuillez recharger la page.'
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

  function resolveClientPricing(lang, ccOverride) {
    const cc = (ccOverride || inferClientCountry(lang)).toUpperCase();
    if (lang === 'ru') {
      if (TIER1_CC.has(cc)) return {country: cc, price_stars: 200, fiat_label: '3,99 €'};
      if (TIER2_RU_CC.has(cc) || TIER2_EU_CC.has(cc)) return {country: cc, price_stars: 120, fiat_label: '240 ₽ (~2,39 €)'};
      if (TIER4_POOR_CC.has(cc)) return {country: cc, price_stars: 45, fiat_label: '0,89 $'};
      return {country: cc, price_stars: 75, fiat_label: '1,49 $'};
    }
    if (TIER4_POOR_CC.has(cc)) return {country: cc, price_stars: 45, fiat_label: '0,89 €'};
    if (TIER3_EMERGING_CC.has(cc)) return {country: cc, price_stars: 75, fiat_label: '1,49 €'};
    if (TIER2_EU_CC.has(cc) || TIER2_RU_CC.has(cc)) return {country: cc, price_stars: 150, fiat_label: '2,99 €'};
    return {country: cc, price_stars: 250, fiat_label: '4,99 €'};
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

  function setupTelegramPaidForm(onBusyChange = () => {}) {
    const lang = detectLang(), ui = UI_BY_LANG[lang] || UI_BY_LANG.de;
    const MOLE_ZONE_NAMES = MOLE_ZONE_NAMES_BY_LANG[lang] || MOLE_ZONE_NAMES_BY_LANG.de;
    const $ = id => document.getElementById(id), form = $('tg-form');
    const fields = $('report-fields'), submit = $('report-submit'), message = $('report-status'), error = $('report-error');
    const download = $('report-download'), paidPanel = $('paid-result'), paidContainer = $('paid-sections');
    const zoneButtons = new Map(), selected = new Map();
    const tg = root.Telegram && root.Telegram.WebApp ? root.Telegram.WebApp : null;
    if (tg) {
      try { tg.ready(); tg.expand(); } catch (_) {}
      const tgFirstName = tg.initDataUnsafe?.user?.first_name;
      if (tgFirstName && !$('report-first-name').value) $('report-first-name').value = tgFirstName.slice(0, 30);
    }
    const botParam = new URLSearchParams(location.search).get('bot') || (lang === 'de' ? 'gesichtslesen_bot' : (BOTS_BY_LANG[lang] || 'gesichtslesen_bot'));
    const workerBase = (form.dataset.workerUrl || '').trim().replace(/\/+$/, '');
    let result = null, activeZone = null, revision = 0, pending = false, complete = false, pdfURL = null;

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
      for (const side of ['links', 'rechts']) {
        const button = $('mole-' + side);
        if (lang !== 'de') button.textContent = ui.sides[side];
        const fixedSide = activeZone === 'links_gesicht' ? 'links' : activeZone === 'rechts_gesicht' ? 'rechts' : null;
        button.disabled = !activeZone || (fixedSide !== null && fixedSide !== side);
        button.setAttribute('aria-pressed', String(!!activeZone && selected.has(activeZone + ':' + side)));
      }
      $('mole-none').setAttribute('aria-pressed', String(selected.size === 0));
      $('mole-count').textContent = selected.size ? ui.moleCount(selected.size) : ui.moleNone;
      const list = $('mole-selection'); list.replaceChildren();
      for (const [key, mole] of selected) {
        const item = document.createElement('li'), button = document.createElement('button');
        const sideLabel = lang === 'de' ? mole.side : (ui.sides[mole.side] || mole.side);
        button.type = 'button'; button.className = 'mole-choice mole-selected';
        button.textContent = MOLE_ZONE_NAMES[mole.zone] + ' · ' + sideLabel + ' ×';
        button.setAttribute('aria-label', MOLE_ZONE_NAMES[mole.zone] + ', ' + sideLabel + ui.removeSuffix);
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
      else { showError(ui.moleMax); return; }
      clearError(); renderMoles();
    });
    $('mole-none').addEventListener('click', () => { if (pending || complete) return; selected.clear(); activeZone = null; clearError(); renderMoles(); });

    const renderPaidReport = data => {
      paidContainer.replaceChildren();
      for (const [title, body] of data.sections || []) {
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
      if (data.pdf_base64) {
        const bin = atob(data.pdf_base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], {type: 'application/pdf'});
        pdfURL = URL.createObjectURL(blob);
        download.href = pdfURL;
        download.hidden = false;
      }
      paidPanel.hidden = false;
      paidPanel.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    };

    const emailInput = $('report-email');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!workerBase || !result || pending || complete) return;
      clearError();
      const firstName = $('report-first-name').value.trim();
      const email = emailInput ? emailInput.value.trim() : '';
      if (Array.from(firstName).length > 30) { showError(ui.nameTooLong); $('report-first-name').focus(); return; }
      if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email))) {
        showError(ui.invalidEmail);
        if (emailInput) emailInput.focus();
        return;
      }
      const payload = {
        bot_username: botParam,
        brow_form: result.brow_form,
        brow_subtype: result.brow_subtype,
        mark30_found: result.mark30_found,
        moles: Array.from(selected.values()),
      };
      if (result.birth_date) payload.birth_date = result.birth_date;
      if (result.country) payload.country = result.country;
      if (result.tz) payload.tz = result.tz;
      if (firstName) payload.first_name = firstName;
      if (email) payload.email = email;
      if (tg?.initData) payload.init_data = tg.initData;
      if (lang !== 'de') payload.lang = lang;

      const ticket = revision;
      pending = true; releasePDF(); updateBusy();
      message.textContent = ui.openingInvoice;

      try {
        const invRes = await fetch(workerBase + '/api/tg/invoice', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
          cache: 'no-store', body: JSON.stringify(payload),
        });
        if (ticket !== revision) return;
        if (!invRes.ok) { message.textContent = ''; showError(ui.invoiceErrorRetry); return; }
        const invData = await invRes.json();
        if (!invData?.ok || !invData.invoice_url) { message.textContent = ''; showError(ui.invoiceError); return; }

        if (tg && typeof tg.openInvoice === 'function') {
          const status = await new Promise(resolve => tg.openInvoice(invData.invoice_url, resolve));
          if (ticket !== revision) return;
          if (status !== 'paid') {
            message.textContent = '';
            if (status === 'failed') showError(ui.paymentFailed);
            return;
          }
          message.textContent = ui.paymentSuccessCreating;
          const repRes = await fetch(workerBase + '/api/tg/report', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
            cache: 'no-store', body: JSON.stringify(payload),
          });
          if (ticket !== revision) return;
          if (!repRes.ok) {
            message.textContent = ui.sentToChat;
            complete = true;
            return;
          }
          const repData = await repRes.json();
          complete = true;
          renderPaidReport(repData);
          message.textContent = repData.email_sent
            ? ui.tgReadyEmail
            : ui.tgReadyChat;
        } else {
          location.href = invData.invoice_url;
        }
      } catch (_) {
        if (ticket === revision) { message.textContent = ''; showError(ui.networkError); }
      } finally {
        pending = false;
        updateBusy();
      }
    });

    renderMoles(); updateBusy();
    return {
      isPending: () => pending,
      setResult(value) {
        result = {brow_form: value.form, brow_subtype: value.subtype || null, mark30_found: !!value.mark30_found, birth_date: value.birth_date || null, country: value.country || null, tz: value.tz || null};
        updateBusy();
      },
      clear() {
        revision++; result = null; complete = false; selected.clear(); activeZone = null;
        if (emailInput) emailInput.value = '';
        message.textContent = ''; clearError(); releasePDF(); renderMoles();
        paidContainer.replaceChildren(); paidPanel.hidden = true; updateBusy();
      }
    };
  }

  async function boot() {
    if (!document.querySelector('[data-gesicht-tg-app]') && !document.querySelector('[data-gesicht-app]')) return;
    const lang = detectLang(), ui = UI_BY_LANG[lang] || UI_BY_LANG.de;
    const $ = id => document.getElementById(id), base = '/assets/gesicht/';
    const json = async name => { const res = await fetch(base + name, {credentials: 'omit'}); if (!res.ok) throw new Error('Local asset unavailable'); return res.json(); };
    const rulesFile = lang === 'de' ? 'face_rules_free_de.json' : `face_rules_free_${lang}.json`;
    const [TH, rules] = await Promise.all([json('thresholds.json'), json(rulesFile)]);
    const input = $('photo-input'), preview = $('photo-preview'), analyze = $('analyze-button'), status = $('analysis-status');
    let objectURL = null, detector = null, pendingDetector = null, generation = 0, busy = false;

    // 1. Inject or bind mandatory Birth Date selector (Day · Month · Year)
    let birthDay = $('birth-day'), birthMonth = $('birth-month'), birthYear = $('birth-year');
    if (!birthDay || !birthMonth || !birthYear) {
      const photoControls = document.querySelector('.photo-controls');
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

    // 2. Dynamic Regional Pricing (Client timezone/locale + Cloudflare Worker geo confirmation)
    let clientTz = '';
    try { clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    let currentPricing = resolveClientPricing(lang);
    const applyPricingUI = pricing => {
      if (!pricing) return;
      currentPricing = pricing;
      if (typeof ui.submitIdleDynamic === 'function') {
        ui.submitIdle = ui.submitIdleDynamic(pricing.price_stars, pricing.fiat_label);
      }
      const subBtn = $('report-submit');
      if (subBtn && !report.isPending()) {
        subBtn.textContent = ui.submitIdle;
      }
      const kickerEl = document.querySelector('#full-analysis > .kicker');
      if (kickerEl && typeof ui.kickerUnlockDynamic === 'function') {
        kickerEl.textContent = ui.kickerUnlockDynamic(pricing.price_stars, pricing.fiat_label);
      }
    };

    const updatePhotoControls = reportPending => {
      $('choose-photo').disabled = busy || reportPending;
      input.disabled = busy || reportPending;
      $('reset-photo').disabled = reportPending;
      analyze.disabled = busy || reportPending || !objectURL;
    };
    const report = setupTelegramPaidForm(updatePhotoControls);
    applyPricingUI(currentPricing);

    const tgFormEl = $('tg-form');
    const workerBaseUrl = tgFormEl?.dataset?.workerUrl?.trim().replace(/\/+$/, '');
    if (workerBaseUrl && /^https:\/\//i.test(workerBaseUrl)) {
      fetch(workerBaseUrl + '/api/pricing', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
        body: JSON.stringify({lang, tz: clientTz, country: currentPricing.country})
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d?.ok && d.price_stars) applyPricingUI(d);
      }).catch(() => {});
    }

    const clearResult = () => {
      report.clear();
      $('analysis-result').hidden = true;
      $('full-analysis').hidden = true;
      $('photo-error').hidden = true;
      $('brow-name').textContent = '';
      $('brow-intro').textContent = '';
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
        if (getValidBirthDate() && !$('photo-error').hidden && $('photo-error').textContent === ui.missingBirth) {
          $('photo-error').hidden = true;
        }
      });
    });
    $('choose-photo').addEventListener('click', () => {
      if (busy || report.isPending()) return;
      if (!getValidBirthDate()) {
        showCustomError(ui.missingBirth);
        if (birthDay && !birthDay.value) birthDay.focus();
        else if (birthMonth && !birthMonth.value) birthMonth.focus();
        else if (birthYear && !birthYear.value) birthYear.focus();
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
        showCustomError(ui.missingBirth);
        if (birthDay && !birthDay.value) birthDay.focus();
        else if (birthMonth && !birthMonth.value) birthMonth.focus();
        else if (birthYear && !birthYear.value) birthYear.focus();
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
        result.country = currentPricing.country;
        result.tz = clientTz;
        const form = rules.brows[result.form], text = result.subtype && form.subtypes ? form.subtypes[result.subtype] : form;
        $('brow-name').textContent = text.name_de || text['name_' + lang] || '';
        $('brow-intro').textContent = rules.brows_intro_de || rules['brows_intro_' + lang] || '';
        $('brow-description').textContent = text.short_de || text['short_' + lang] || '';
        const mKey = result.mark30_found ? 'free_found' : 'free_not_found';
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
        applyPricingUI(currentPricing);
        report.setResult(result);
        $('analysis-result').hidden = false; $('full-analysis').hidden = false; status.textContent = ui.analysisDone;
        $('analysis-result').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
      } catch (error) { if (ticket === generation) { status.textContent = ui.analysisFailed; console.error('Gesichtlesen TG: local analysis failed', error.name); } }
      finally { if (pixels) pixels.data.fill(0); if (gray) gray.fill(0); canvas.width = canvas.height = 0; busy = false; updatePhotoControls(report.isPending()); }
    });
    addEventListener('pagehide', () => { generation++; report.clear(); releasePhoto(); if (detector) { detector.close(); detector = null; pendingDetector = null; } });
    status.textContent = '';
  }

  if (typeof document !== 'undefined') boot().catch(error => {
    const ui = UI_BY_LANG[detectLang()] || UI_BY_LANG.de;
    const el = document.getElementById('analysis-status');
    if (el) el.textContent = ui.bootError;
    console.error('Gesichtlesen TG: initialization failed', error.name);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
