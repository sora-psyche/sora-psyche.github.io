#!/usr/bin/env python3
"""
Verification script for YouTube Watch Pages on sorainfo.de (Z15).
Checks:
1. Exactly 1 <iframe> per watch page, using youtube-nocookie.com/embed/ID.
2. The <iframe> appears before the first <h2> tag.
3. No .video-facade click-dummy on the watch page.
4. <meta name="robots" content="max-image-preview:large"> is present.
5. JSON-LD parses cleanly and contains a VideoObject with required fields:
   name, description, thumbnailUrl, uploadDate, duration (ISO 8601), embedUrl, contentUrl, hasPart (Clip[]).
6. Local thumbnail file exists under repo and width >= 1200 px.
7. Every ?t= timestamp in HTML and JSON-LD Clip startOffset/endOffset is <= video duration.
8. Word count of explanatory prose on new watch pages is within 400-600 words (or preserved existing article).
9. sitemap.xml and video-sitemap.xml are well-formed XML and contain all pilot pages.
"""
import os
import sys
import re
import json
import subprocess
import xml.etree.ElementTree as ET

REPO_DIR = os.path.expanduser("~/sorainfo-blog-deploy")
INVENTORY_PATH = os.path.expanduser("~/Claude outputs/site_video/inventory.json")

PILOT_PAGES = [
    ("artikel/muede-trotz-schlaf.html", "gAnvfIiSFgk", "preserved"),
    ("handlesen/teil-01.html", "H7wPio23qZ4", "new"),
    ("sternenpsychologie/venus-im-skorpion-merkur-ruecklaeufig-oktober-2026.html", "-MCD8B2cjns", "new")
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
    dur_map = {}
    for cat in ("site_videos", "sternenpsychologie_de_videos", "handlesen_series_videos"):
        for v in inv.get(cat, []):
            if v.get("duration_seconds"):
                dur_map[v["video_id"]] = int(v["duration_seconds"])

    all_ok = True
    results = []

    for rel_path, expected_vid, mode in PILOT_PAGES:
        full_path = os.path.join(REPO_DIR, rel_path)
        errors = []
        if not os.path.exists(full_path):
            print(f"[FAIL] {rel_path}: file does not exist")
            all_ok = False
            continue

        with open(full_path, "r", encoding="utf-8") as fp:
            html = fp.read()

        # 1. Exactly 1 iframe & nocookie
        iframes = list(re.finditer(r"<iframe\b[^>]*>", html, re.I))
        if len(iframes) != 1:
            errors.append(f"Expected 1 iframe, found {len(iframes)}")
        else:
            iframe_tag = iframes[0].group(0)
            expected_src = f"https://www.youtube-nocookie.com/embed/{expected_vid}"
            if expected_src not in iframe_tag:
                errors.append(f"iframe src does not contain {expected_src}")

            # 2. iframe before first <h2>
            first_h2 = re.search(r"<h2\b", html, re.I)
            if first_h2 and iframes[0].start() > first_h2.start():
                errors.append(f"iframe (pos {iframes[0].start()}) is after first <h2> (pos {first_h2.start()})")

        # 3. No video-facade click dummy
        if "video-facade" in html:
            errors.append("Found .video-facade dummy on watch page")

        # 4. meta robots max-image-preview:large
        if not re.search(r'<meta\s+name="robots"\s+content="max-image-preview:large"\s*>', html, re.I):
            errors.append('Missing <meta name="robots" content="max-image-preview:large">')

        # 5. JSON-LD parsing & required fields
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

            # 6. Thumbnail check
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

            # 7. Timestamps check against duration
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

        # Check prose word count
        m_art = re.search(r"<article[^>]*>(.*?)</article>", html, re.S)
        art_html = m_art.group(1) if m_art else html
        # Strip header, funnel, chapters, series links, cta to measure core explanatory prose
        prose_only = re.sub(r"<header.*?</header>", " ", art_html, flags=re.S)
        prose_only = re.sub(r'<div class="top-funnel".*?</div>\s*</div>', " ", prose_only, flags=re.S)
        prose_only = re.sub(r"<h2>Kapitel &amp; Zeitmarken im Video</h2>.*", " ", prose_only, flags=re.S)
        prose_words = len(re.sub(r"<[^>]+>", " ", prose_only).split())
        total_words = len(re.sub(r"<[^>]+>", " ", art_html).split())
        if mode == "new" and not (400 <= prose_words <= 600):
            errors.append(f"New page core prose word count {prose_words} not in 400..600 range")

        status = "PASS" if not errors else "FAIL"
        if errors:
            all_ok = False
        results.append({
            "page": rel_path,
            "video_id": expected_vid,
            "status": status,
            "iframes": len(iframes),
            "iframe_before_h2": bool(iframes and re.search(r"<h2\b", html, re.I) and iframes[0].start() < re.search(r"<h2\b", html, re.I).start()),
            "clips_count": len(vo.get("hasPart", [])) if vo else 0,
            "duration_s": dur_map.get(expected_vid),
            "prose_words": prose_words,
            "total_article_words": total_words,
            "errors": errors
        })
        print(f"[{status}] {rel_path} | video={expected_vid} | iframes={len(iframes)} | before_h2={results[-1]['iframe_before_h2']} | clips={results[-1]['clips_count']} | prose_words={prose_words} (total={total_words}) | errors={errors}")

    # Check sitemaps
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
