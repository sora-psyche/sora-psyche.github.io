#!/usr/bin/env python3
"""
Verification script for YouTube Watch Pages and 5-Language Course Hubs on sorainfo.de (Z15 + K01).
"""
import os
import sys
import re
import json
import subprocess
import xml.etree.ElementTree as ET

REPO_DIR = os.path.expanduser("~/sorainfo-blog-deploy")
INVENTORY_PATH = os.path.expanduser("~/Claude outputs/site_video/inventory.json")
COURSE_SRC_PATH = os.path.expanduser("~/Antigravity/07_Совет_Каналы/data/course_240_watch_source.json")

PILOT_PAGES = [
    ("artikel/muede-trotz-schlaf.html", "gAnvfIiSFgk", "preserved", "DE"),
    ("handlesen/teil-01.html", "H7wPio23qZ4", "new", "DE"),
    ("sternenpsychologie/venus-im-skorpion-merkur-ruecklaeufig-oktober-2026.html", "-MCD8B2cjns", "new", "DE"),
]

LANG_DIRS = {
    "DE": ("sternenpsychologie", "lektion"),
    "EN": ("en/horoscope", "lesson"),
    "ES": ("es/horoscopo", "leccion"),
    "PT": ("pt/horoscopo", "licao"),
    "JA": ("ja/horoscope", "lesson"),
}

HUB_SPECS = [
    ("sternenpsychologie/index.html", "https://sorainfo.de/sternenpsychologie/", "https://t.me/astrologie_lernen"),
    ("en/horoscope/index.html", "https://sorainfo.de/en/horoscope/", "https://t.me/learntraditionalastrology"),
    ("es/horoscopo/index.html", "https://sorainfo.de/es/horoscopo/", "https://t.me/aprende_astrologia"),
    ("pt/horoscopo/index.html", "https://sorainfo.de/pt/horoscopo/", "https://t.me/astrologiatradicional_br"),
    ("ja/horoscope/index.html", "https://sorainfo.de/ja/horoscope/", "https://t.me/koten_senseijutsu"),
]


def get_image_dimensions(path: str):
    out = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
        capture_output=True, text=True
    ).stdout
    w_m = re.search(r"pixelWidth:\s*(\d+)", out)
    h_m = re.search(r"pixelHeight:\s*(\d+)", out)
    return (int(w_m.group(1)) if w_m else 0, int(h_m.group(1)) if h_m else 0)


def extract_video_object(ld_blocks: list):
    for b in ld_blocks:
        if isinstance(b, dict) and b.get("@type") == "VideoObject":
            return b
        if isinstance(b, list):
            res = extract_video_object(b)
            if res:
                return res
    return None


def main():
    with open(INVENTORY_PATH, "r", encoding="utf-8") as fp:
        inv = json.load(fp)
    with open(COURSE_SRC_PATH, "r", encoding="utf-8") as fp:
        course_src = json.load(fp)

    dur_map = {}
    for cat in ("site_videos", "sternenpsychologie_de_videos", "handlesen_series_videos"):
        for v in inv.get(cat, []):
            if v.get("duration_seconds"):
                dur_map[v["video_id"]] = int(v["duration_seconds"])
    for entry in course_src:
        for lc, d in entry["langs"].items():
            dur_map[d["video_id"]] = int(d["duration_s"])

    pages_to_check = list(PILOT_PAGES)
    for entry in course_src[:2]:
        slug_num = entry["slug_num"]
        for lc, (ldir, sprefix) in LANG_DIRS.items():
            rel_p = f"{ldir}/{sprefix}-{slug_num}.html"
            pages_to_check.append((rel_p, entry["langs"][lc]["video_id"], "new", lc))

    all_ok = True

    for rel_path, expected_vid, mode, lc in pages_to_check:
        full_path = os.path.join(REPO_DIR, rel_path)
        errors = []
        if not os.path.exists(full_path):
            print(f"[FAIL] {rel_path}: file does not exist")
            all_ok = False
            continue

        with open(full_path, "r", encoding="utf-8") as fp:
            html = fp.read()

        iframes = list(re.finditer(r"<iframe\b[^>]*>", html, re.I))
        if len(iframes) != 1:
            errors.append(f"Expected 1 iframe, found {len(iframes)}")
        else:
            iframe_tag = iframes[0].group(0)
            expected_src = f"https://www.youtube-nocookie.com/embed/{expected_vid}"
            if expected_src not in iframe_tag:
                errors.append(f"iframe src does not contain {expected_src}")

            first_h2 = re.search(r"<h2\b", html, re.I)
            if first_h2 and iframes[0].start() > first_h2.start():
                errors.append(f"iframe (pos {iframes[0].start()}) is after first <h2> (pos {first_h2.start()})")

        if "video-facade" in html:
            errors.append("Found .video-facade dummy on watch page")

        if not re.search(r'<meta\s+name="robots"\s+content="max-image-preview:large"\s*>', html, re.I):
            errors.append('Missing <meta name="robots" content="max-image-preview:large">')

        ld_scripts = re.findall(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', html, re.S)
        parsed_lds = []
        for idx, raw in enumerate(ld_scripts):
            try:
                parsed_lds.append(json.loads(raw))
            except Exception as e:
                errors.append(f"JSON-LD block #{idx+1} parse error: {e}")

        vo = extract_video_object(parsed_lds)
        if not vo:
            errors.append("No VideoObject found in JSON-LD")
        else:
            req_fields = ["name", "description", "thumbnailUrl", "uploadDate", "duration", "embedUrl", "contentUrl", "hasPart"]
            for rf in req_fields:
                if not vo.get(rf):
                    errors.append(f"VideoObject missing required field: {rf}")
            if not str(vo.get("duration", "")).startswith("PT"):
                errors.append(f"Invalid ISO 8601 duration: {vo.get('duration')}")

            t_urls = vo.get("thumbnailUrl")
            t_url = t_urls[0] if isinstance(t_urls, list) and t_urls else t_urls
            if not isinstance(t_url, str) or not t_url.startswith("https://sorainfo.de/"):
                errors.append(f"thumbnailUrl not on sorainfo.de domain: {t_url}")
            else:
                t_rel = t_url.replace("https://sorainfo.de/", "")
                t_local = os.path.join(REPO_DIR, t_rel)
                if not os.path.exists(t_local):
                    errors.append(f"Thumbnail file missing locally: {t_rel}")
                else:
                    w, h = get_image_dimensions(t_local)
                    if w < 1200:
                        errors.append(f"Thumbnail width {w}px < 1200px")

            dur = dur_map.get(expected_vid, 0)
            clips = vo.get("hasPart") or []
            if not clips:
                errors.append("VideoObject.hasPart (Clip list) is empty")
            for c in clips:
                if c.get("@type") != "Clip":
                    errors.append(f"hasPart item is not Clip: {c}")
                st = c.get("startOffset")
                et = c.get("endOffset")
                if st is None or et is None or st < 0 or et <= st or et > dur:
                    errors.append(f"Invalid Clip offsets start={st}, end={et} (duration={dur}s)")
                if "?t=" not in str(c.get("url", "")):
                    errors.append(f"Clip url missing ?t=: {c.get('url')}")

            html_ts = [int(x) for x in re.findall(r"[?&]t=(\d+)s?", html)]
            for t_val in html_ts:
                if t_val < 0 or t_val > dur:
                    errors.append(f"HTML ?t={t_val} exceeds video duration {dur}s")

        m_art = re.search(r"<article[^>]*>(.*?)</article>", html, re.S)
        art_html = m_art.group(1) if m_art else html
        prose_only = re.sub(r'<div class="lang-bar".*?</div>', " ", art_html, flags=re.S)
        prose_only = re.sub(r"<header.*?</header>", " ", prose_only, flags=re.S)
        prose_only = re.sub(r'<div class="top-funnel".*?</div>\s*</div>', " ", prose_only, flags=re.S)
        if "<!-- PROSE_END -->" in prose_only:
            prose_only = prose_only.split("<!-- PROSE_END -->")[0]
        else:
            prose_only = re.sub(r"<h2>Kapitel &amp; Zeitmarken im Video</h2>.*", " ", prose_only, flags=re.S)

        clean_text = re.sub(r"<[^>]+>", " ", prose_only)
        prose_words = len(clean_text.split())
        prose_chars = len(re.sub(r"\s+", "", clean_text))
        if mode == "new":
            if lc == "JA":
                if not (700 <= prose_chars <= 2600):
                    errors.append(f"JA core prose char count {prose_chars} not in 700..2600 range")
            else:
                if not (400 <= prose_words <= 600):
                    errors.append(f"New page core prose word count {prose_words} not in 400..600 range")

        status = "PASS" if not errors else "FAIL"
        if errors:
            all_ok = False
        metric_str = f"chars={prose_chars}" if lc == "JA" else f"words={prose_words}"
        print(f"[{status}] {rel_path} | video={expected_vid} | clips={len(vo.get('hasPart', [])) if vo else 0} | {metric_str} | errors={errors}")

    # Check all 5 language hubs
    for rel_hub, exp_canon, exp_tg in HUB_SPECS:
        hp = os.path.join(REPO_DIR, rel_hub)
        herrs = []
        if not os.path.exists(hp):
            herrs.append("Missing hub file")
        else:
            hhtml = open(hp, encoding="utf-8").read()
            if f'<link rel="canonical" href="{exp_canon}">' not in hhtml:
                herrs.append(f"Missing self-referencing canonical {exp_canon}")
            for hlang in ("de", "en", "es", "pt", "ja"):
                if f'hreflang="{hlang}"' not in hhtml:
                    herrs.append(f"Missing hreflang={hlang}")
            if exp_tg not in hhtml:
                herrs.append(f"Missing Telegram course channel link {exp_tg}")
            if 'id="course-48"' not in hhtml:
                herrs.append("Missing #course-48 section")
        st = "PASS" if not herrs else "FAIL"
        if herrs:
            all_ok = False
        print(f"[{st}] HUB {rel_hub} | canonical={exp_canon} | tg={exp_tg} | errors={herrs}")

    for sm_name in ("sitemap.xml", "video-sitemap.xml"):
        sm_path = os.path.join(REPO_DIR, sm_name)
        try:
            tree = ET.parse(sm_path)
            root = tree.getroot()
            print(f"[PASS] {sm_name}: valid XML ({len(root)} <url> entries)")
        except Exception as e:
            print(f"[FAIL] {sm_name}: XML error: {e}")
            all_ok = False

    if not all_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
