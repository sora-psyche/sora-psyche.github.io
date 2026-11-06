#!/usr/bin/env python3
"""
Generator for dedicated YouTube Watch Pages on sorainfo.de (Z15).
Reads ~/Claude outputs/site_video/inventory.json and templates/watch.html,
builds the 3 pilot watch pages (or all configured pages), updateshandlesen/index.html,
updates sitemap.xml, and writes video-sitemap.xml.
"""
import os
import re
import json
import urllib.request
from xml.sax.saxutils import escape as xml_escape

REPO_DIR = os.path.expanduser("~/sorainfo-blog-deploy")
INVENTORY_PATH = os.path.expanduser("~/Claude outputs/site_video/inventory.json")
TEMPLATE_PATH = os.path.join(REPO_DIR, "templates/watch.html")


def ensure_thumbnail(vid: str) -> str:
    vdir = os.path.join(REPO_DIR, "assets/video")
    os.makedirs(vdir, exist_ok=True)
    out_path = os.path.join(vdir, f"{vid}.jpg")
    if not os.path.exists(out_path) or os.path.getsize(out_path) < 10000:
        url = f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg"
        urllib.request.urlretrieve(url, out_path)
    return f"https://sorainfo.de/assets/video/{vid}.jpg"


def fmt_mmss(sec: int) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def build_video_jsonld(
    *,
    name: str,
    description: str,
    thumbnail_url: str,
    upload_date: str,
    duration_iso: str,
    video_id: str,
    canonical_url: str,
    clips: list,
    is_short: bool = False
) -> dict:
    embed_url = f"https://www.youtube-nocookie.com/embed/{video_id}"
    content_url = f"https://www.youtube.com/shorts/{video_id}" if is_short else f"https://www.youtube.com/watch?v={video_id}"
    has_part = []
    for c in clips:
        has_part.append({
            "@type": "Clip",
            "name": c["name"],
            "startOffset": int(c["start"]),
            "endOffset": int(c["end"]),
            "url": f"{canonical_url}?t={int(c['start'])}"
        })
    return {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": name,
        "description": description,
        "thumbnailUrl": [thumbnail_url],
        "uploadDate": f"{upload_date}T16:00:00+02:00" if "T" not in upload_date else upload_date,
        "duration": duration_iso,
        "embedUrl": embed_url,
        "contentUrl": content_url,
        "inLanguage": "de",
        "isFamilyFriendly": True,
        "publisher": {
            "@type": "Organization",
            "name": "Sora+ Psyche",
            "url": "https://sorainfo.de/"
        },
        "hasPart": has_part
    }


def update_muede_trotz_schlaf(inv: dict):
    vid = "gAnvfIiSFgk"
    thumb_url = ensure_thumbnail(vid)
    vmeta = next(v for v in inv["site_videos"] if v["video_id"] == vid)
    canonical = "https://sorainfo.de/artikel/muede-trotz-schlaf.html"
    clips = [
        {"start": ch["start_time"], "end": ch["end_time"], "name": ch["title"]}
        for ch in vmeta["chapters"]
    ]
    video_ld = build_video_jsonld(
        name="Ich schlafe — und erhole mich nicht | Müde trotz Schlaf (Sora+ Psyche)",
        description="Du schläfst sieben oder acht Stunden, wachst aber trotzdem erschöpft auf. Warum nicht die Schlafdauer allein entscheidet, sondern ob dein Nervensystem nachts wirklich aus der Bereitschaft kommt.",
        thumbnail_url=thumb_url,
        upload_date=vmeta["upload_date"],
        duration_iso=vmeta["duration_iso8601"],
        video_id=vid,
        canonical_url=canonical,
        clips=clips,
        is_short=False
    )

    page_path = os.path.join(REPO_DIR, "artikel/muede-trotz-schlaf.html")
    with open(page_path, "r", encoding="utf-8") as fp:
        html = fp.read()

    # 1. Ensure meta robots max-image-preview:large
    if 'name="robots"' not in html:
        html = html.replace(
            '<link rel="canonical" href="https://sorainfo.de/artikel/muede-trotz-schlaf.html">',
            '<meta name="robots" content="max-image-preview:large">\n<link rel="canonical" href="https://sorainfo.de/artikel/muede-trotz-schlaf.html">'
        )

    # 2. Ensure og:image points to 1280x720 video thumbnail or keep + add og:video
    if 'property="og:video"' not in html:
        html = html.replace(
            '<meta property="og:site_name" content="Sora+ Psyche · Psychologie">',
            '<meta property="og:site_name" content="Sora+ Psyche · Psychologie">\n'
            f'<meta property="og:video" content="https://www.youtube-nocookie.com/embed/{vid}">\n'
            f'<meta property="og:video:secure_url" content="https://www.youtube-nocookie.com/embed/{vid}">\n'
            '<meta property="og:video:type" content="text/html">\n'
            '<meta property="og:video:width" content="1280">\n'
            '<meta property="og:video:height" content="720">'
        )

    # 3. Replace the first JSON-LD block (Article / VideoObject) with separate top-level VideoObject + Article
    article_ld = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "Müde trotz Schlaf: Was dein Körper vor dir weiß",
        "description": "Du schläfst, aber dein Körper reagiert schon vor dem Wachwerden. Was in dir früher anspringt als dein Gedanke.",
        "image": thumb_url,
        "datePublished": "2026-09-20",
        "dateModified": "2026-11-06",
        "inLanguage": "de",
        "author": {"@type": "Organization", "name": "Sora+ Psyche"},
        "publisher": {
            "@type": "Organization",
            "name": "Sora+ Psyche",
            "@id": "https://sorainfo.de/#organization",
            "logo": {
                "@type": "ImageObject",
                "url": "https://sorainfo.de/icon-512.png",
                "width": 512,
                "height": 512,
                "caption": "Sora+ Psyche"
            }
        },
        "mainEntityOfPage": canonical
    }
    new_ld_script = (
        "<script type=\"application/ld+json\">\n"
        + json.dumps(video_ld, ensure_ascii=False, indent=2)
        + "\n</script>\n<script type=\"application/ld+json\">\n"
        + json.dumps(article_ld, ensure_ascii=False, indent=2)
        + "\n</script>"
    )
    html = re.sub(
        r'<script type="application/ld\+json">\s*[\[\{]\s*(?:\{\s*)?"@context":\s*"https://schema\.org",\s*"@type":\s*"(?:VideoObject|Article)".*?</script>(?:\s*<script type="application/ld\+json">\s*\{\s*"@context":\s*"https://schema\.org",\s*"@type":\s*"Article".*?</script>)?',
        new_ld_script,
        html,
        count=1,
        flags=re.S
    )

    # 4. Put player on the first screen immediately after </header>, before <p class="lede">, and add top-funnel right below player
    # First remove old .video-facade block and any previously injected player+funnel
    html = re.sub(
        r'\s*<a class="video-embed video-facade"[^>]*>.*?</a>',
        '',
        html,
        flags=re.S
    )
    html = re.sub(
        r'\s*<!-- WATCH_HERO_START -->.*?<!-- WATCH_HERO_END -->',
        '',
        html,
        flags=re.S
    )

    hero_block = f"""
  <!-- WATCH_HERO_START -->
  <div class="video-embed" style="margin:1rem 0 1.25rem;">
    <iframe src="https://www.youtube-nocookie.com/embed/{vid}" title="Ich schlafe — und erhole mich nicht | Sora+ Psyche" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
  </div>

  <div class="top-funnel" aria-label="Schnelleinstieg zum Mitmachen" style="margin:0 0 1.75rem;">
    <p><strong>Direkt starten (begleitend zur Folge):</strong> Hol dir den kostenlosen Psychologie-Spickzettel Nr. 6 („Innere Ruhe ist keine Belohnung“), prüfe dein Geburtsdatum oder deine Handlinien im Telegram-Bot oder höre zum Abschalten 1 Stunde ruhige Tiefschlafmusik.</p>
    <div class="top-funnel-btns">
      <a class="btn" style="padding:0.55rem 0.95rem;font-size:0.9rem;" href="https://payhip.com/b/YDC0X?utm_source=blog&amp;utm_medium=article&amp;utm_campaign=payhip&amp;utm_content=muede-trotz-schlaf" target="_blank" rel="noopener">📄 Gratis PDF-Spickzettel Nr. 6 (Payhip)</a>
      <a class="btn-teal" href="https://t.me/handlinien_bot?start=hand" target="_blank" rel="noopener">✋ Gratis 6-Seiten-PDF Handlesen (Bot)</a>
      <a class="btn-outline" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Gratis Geburtsdatum-Check (Bot)</a>
      <a class="btn-outline" href="/schlafmusik/">🌙 1 Stunde Tiefschlaf- &amp; Seelenmusik</a>
      <a class="btn-outline" href="/shop.html">📖 Alle Arbeitsbücher &amp; Leitfäden</a>
    </div>
  </div>
  <!-- WATCH_HERO_END -->"""

    html = html.replace(
        '  </header>\n\n  <p class="lede">',
        f'  </header>{hero_block}\n\n  <p class="lede">'
    )

    # Also expand chapters list to include all 14 chapters with valid ?t= links
    chapters_items = "\n".join(
        f'    <li><a href="https://www.youtube.com/watch?v={vid}&amp;t={c["start"]}s">{fmt_mmss(c["start"])} · {c["name"]}</a></li>'
        for c in clips
    )
    html = re.sub(
        r'<ul class="chapters">.*?</ul>',
        f'<ul class="chapters">\n{chapters_items}\n  </ul>',
        html,
        flags=re.S
    )

    with open(page_path, "w", encoding="utf-8") as fp:
        fp.write(html)
    return {
        "page": "artikel/muede-trotz-schlaf.html",
        "loc": canonical,
        "video_id": vid,
        "title": "Ich schlafe — und erhole mich nicht | Müde trotz Schlaf (Sora+ Psyche)",
        "description": video_ld["description"],
        "thumbnail_loc": thumb_url,
        "player_loc": f"https://www.youtube-nocookie.com/embed/{vid}",
        "content_loc": f"https://www.youtube.com/watch?v={vid}",
        "duration": vmeta["duration_seconds"],
        "publication_date": vmeta["upload_date"],
        "clips": clips
    }


def build_handlesen_teil_01(inv: dict, template: str):
    vid = "H7wPio23qZ4"
    thumb_url = ensure_thumbnail(vid)
    vmeta = next(v for v in inv["site_videos"] if v["video_id"] == vid)
    canonical = "https://sorainfo.de/handlesen/teil-01.html"
    clips = [
        {"start": 0, "end": 8, "name": "Einführung: Welche Hand erzählt dein Leben?"},
        {"start": 8, "end": 15, "name": "Linke Hand: Was in dir angelegt ist"},
        {"start": 15, "end": 26, "name": "Rechte Hand: Gelebtes Leben & eigene Entscheidungen"},
        {"start": 26, "end": 29, "name": "Was für Linkshänder gilt"},
        {"start": 29, "end": 40, "name": "Praxis-Trick: Die arbeitende Hand über vergangene Ereignisse finden"},
        {"start": 40, "end": 52, "name": "Grundregel: Warnzeichen heißt Aufmerksamkeit, nicht Angst"},
        {"start": 52, "end": 59, "name": "Ausblick auf Teil 2: Die 4 Hauptlinien und die Handform"}
    ]
    video_ld = build_video_jsonld(
        name="Handlesen lernen – Teil 1: Links geplant, rechts gelebt (Welche Hand liest man?)",
        description="Handlesen lernen Schritt für Schritt, Teil 1: Welche Hand musst du lesen – links oder rechts? In der Tradition zeigt die linke Hand, was angelegt ist, und die rechte, wie du wirklich lebst. Mit dem Trick für die arbeitende Hand.",
        thumbnail_url=thumb_url,
        upload_date=vmeta["upload_date"],
        duration_iso=vmeta["duration_iso8601"],
        video_id=vid,
        canonical_url=canonical,
        clips=clips,
        is_short=True
    )
    breadcrumb_ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Startseite", "item": "https://sorainfo.de/"},
            {"@type": "ListItem", "position": 2, "name": "Handlesen lernen", "item": "https://sorainfo.de/handlesen/"},
            {"@type": "ListItem", "position": 3, "name": "Teil 1: Links geplant, rechts gelebt", "item": canonical}
        ]
    }

    article_body = """
  <p class="lede">Wenn du zum ersten Mal auf deine Handlinien schaust, steht sofort eine praktische Frage im Raum: Welche Hand gilt eigentlich – die linke oder die rechte? Im ersten Teil unserer Videoserie „Handlesen lernen – Schritt für Schritt“ erfährst du in unter einer Minute, wie die klassische Überlieferung beide Hände unterscheidet, mit welchem einfachen Rückblick du deine aktive Hand bestimmst und warum ein Warnzeichen niemals ein festes Urteil ist.</p>

  <h2>Links geplant, rechts gelebt: Die Grundregel der Tradition</h2>
  <p>In der alten Tradition des Handlesens liest man nie nur eine einzige Handfläche isoliert, sondern versteht beide Hände als ein Gespräch zwischen Anlage und Lebensweg. Bei Rechtshändern gilt dabei eine klare Aufteilung, die sich leicht merken lässt: Die <strong>linke Hand</strong> zeigt das, was in dir angelegt ist – also deine mitgegebenen Neigungen, dein Temperament und den ursprünglichen Entwurf, mit dem du gestartet bist.</p>
  <p>Die <strong>rechte Hand</strong> hingegen zeigt bei Rechtshändern, wie du tatsächlich lebst: welche konkreten Entscheidungen du im Lauf der Jahre getroffen hast, welchen Belastungen du standgehalten hast und wer du durch dein Handeln heute geworden bist. Erfahrene Handleser schauen deshalb zuerst und vor allem auf die rechte Hand. Sie gilt in der Überlieferung als die „ehrlichere“ Hand, weil sie nicht bei bloßen Möglichkeiten stehenbleibt, sondern deinen gelebten Alltag abbildet. Die linke Hand legt man direkt daneben, um zu erkennen, wo du deinem ursprünglichen Naturell folgst und wo du bewusst einen neuen Weg eingeschlagen hast.</p>

  <h2>Was gilt für Linkshänder?</h2>
  <p>Für Linkshänder dreht sich dieses Verhältnis in der Überlieferung um: Wer im Alltag überwiegend mit der linken Hand schreibt, greift und gestaltet, bei dem gilt die <strong>linke Handfläche</strong> als die aktive, gelebte Hand und die rechte als Spiegel der mitgegebenen Anlagen. Entscheidend ist in der traditionellen Lehre also niemals das Geschlecht – Männer und Frauen lesen nach denselben Regeln und denselben Linienmerkmalen –, sondern immer die persönliche Händigkeit und die Frage, welche Hand im Leben „arbeitet“.</p>

  <h2>Der Praxis-Trick: Wie du deine „arbeitende“ Hand selbst prüfst</h2>
  <p>Manchmal ist die Händigkeit im Alltag nicht völlig eindeutig, etwa weil man als Kind umgeschult wurde oder beide Hände fast gleichwertig nutzt. Dafür gibt das Video einen einfachen Prüfweg aus der Praxis weiter: Denk an ein einschneidendes, klar datierbares Ereignis aus deiner eigenen Vergangenheit zurück – zum Beispiel an einen großen Umzug, einen beruflichen Neuanfang oder eine fordernde Lebensphase, an deren Alter du dich genau erinnerst.</p>
  <p>Anschließend suchst du auf beiden Handflächen auf der <a href="/handlesen/lebenslinie.html">Lebenslinie</a> oder der <a href="/handlesen/schicksalslinie.html">Schicksalslinie</a> nach dem entsprechenden Lebensjahr (wie man das Alter mit dem Zirkel abliest, lernst du in <a href="/handlesen/zirkel-methode.html">der Zirkel-Methode</a>). Diejenige Hand, auf der dieses vergangene Ereignis als feiner Querstrich, Versatz oder Unterbrechung deutlich sichtbar eingezeichnet ist, ist deine persönlich „arbeitende“ Hand. Auf sie stützt du dich bei allen weiteren Beobachtungen der Serie.</p>

  <h2>Die wichtigste Haltung vorab: Aufmerksamkeit statt Angst</h2>
  <p>Bevor wir in den nächsten Teilen einzelne Linien, Inseln, Punkte oder Brüche betrachten, stellt Teil 1 die wichtigste Grundregel der gesamten Chiromantie an den Anfang: <strong>Ein Warnzeichen heißt Aufmerksamkeit, nicht Angst.</strong> Nach alter Auffassung sind Handlinien keine in Stein gemeißelte Vorhersage, sondern verändern sich mit deinen inneren und äußeren Entscheidungen. Die Überlieferung beschreibt dafür das klassische Beispiel einer geplanten, riskanten Reise: Entscheidet sich der Mensch rechtzeitig um und sagt die Fahrt ab, kann die zuvor sichtbare Warnlinie im Lauf der Zeit verblassen. Ein Zeichen auf der Hand will dir also keine Angst machen, sondern deinen Blick genau dorthin lenken, wo Achtsamkeit und kluge Entscheidungen gefragt sind.</p>
""".strip()

    chapters_html = "\n".join(
        f'    <li><a href="https://www.youtube.com/watch?v={vid}&amp;t={c["start"]}s">{fmt_mmss(c["start"])} · {c["name"]}</a></li>'
        for c in clips
    )

    series_links = """
    <li><a href="/handlesen/">Überblick: Handlesen lernen – Die 4 Hauptlinien Schritt für Schritt</a></li>
    <li><a href="/handlesen/welche-hand.html">Vertiefung zu Teil 1: Welche Hand liest man – links oder rechts?</a></li>
    <li><a href="/handlesen/zirkel-methode.html">Teil 3 &amp; Bonus: Die Zirkel-Methode – Alter auf Lebens-, Schicksals- und Kopflinie ablesen</a></li>
    <li><a href="/handlesen/lebenslinie.html">Teil 3: Lebenslinie – Bedeutung, Verlauf und Altersmarken (10, 20, 30 Jahre)</a></li>
    <li><a href="/handlesen/lebenslinie-unterbrochen.html">Teil 4: Lebenslinie unterbrochen – Insel, Punkt und Querstrich richtig einordnen</a></li>
    <li><a href="/handlesen/kurze-lebenslinie.html">Teil 5: Kurze Lebenslinie, Quadrat und Muttermal auf der Lebenslinie</a></li>
    <li><a href="/handlesen/schicksalslinie.html">Teil 6 &amp; 7: Schicksalslinie (Saturnlinie) finden und das Alter an den Kreuzungen ablesen</a></li>
    <li><a href="/handlesen/schicksalslinie-unterbrochen.html">Teil 8 &amp; 11: Schicksalslinie unterbrochen – Versatz, Gabelung und Richtungswechsel</a></li>
    <li><a href="/handlesen/kometenlinie.html">Teil 9 &amp; 10: Die Kometenlinie über Schicksals- und Herzlinie</a></li>
    <li><a href="/handlesen/kopflinie.html">Teil 14–19: Kopflinie – Verlauf, Alter und Zeichen</a></li>
""".strip()

    notes_and_cta = """
  <div class="cta">
    <p><strong>Zum Mitmachen am eigenen Tisch:</strong> Das illustrierte Arbeitsheft „Handlesen – Schritt für Schritt“ (31 Seiten A4, 17 Lektionen, Übungen und Musterlösungen) zum Ausdrucken – oder starte sofort kostenlos mit der 6-seitigen Einführung im Telegram-Bot.</p>
    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/handlinien_bot?start=hand" target="_blank" rel="noopener">✋ Gratis PDF: 6-Seiten-Starter (Telegram-Bot)</a>
    <a class="btn" href="https://www.etsy.com/de/listing/4587925265/handlesen-uben-ausgewahlte?utm_source=sorainfo&amp;utm_medium=handlesen_teil01" target="_blank" rel="noopener">📖 Vollständiges Arbeitsheft auf Etsy (31 S.)</a>
  </div>

  <p class="note" style="margin-top:1.75rem;">Handlesen ist eine alte Überlieferung, keine Wissenschaft. Wir zeigen, wie diese Tradition Linien liest – nimm das nicht wörtlich. Eine Linie sagt nichts Sicheres über Gesundheit, Lebensdauer oder künftige Ereignisse voraus und ersetzt keine ärztliche oder psychologische Beratung.</p>
  <p class="note">Video, Stimme und Begleittext wurden mit KI-Unterstützung erstellt und redaktionell durch Sora+ Psyche geprüft.</p>
""".strip()

    funnel_buttons = """
      <a class="btn" style="padding:0.55rem 0.95rem;font-size:0.9rem;" href="https://t.me/handlinien_bot?start=hand" target="_blank" rel="noopener">✋ Gratis 6-Seiten-PDF Handlesen (Telegram-Bot)</a>
      <a class="btn-teal" href="https://www.etsy.com/de/listing/4587925265/handlesen-uben-ausgewahlte?utm_source=sorainfo&amp;utm_medium=handlesen_teil01" target="_blank" rel="noopener">📖 Arbeitsbuch Handlesen (31 S. A4 auf Etsy)</a>
      <a class="btn-outline" href="/gesichtlesen/">👁 Gesicht lesen per Selfie (Browser)</a>
      <a class="btn-outline" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Gratis Geburtsdatum-Check (Bot)</a>
""".strip()

    html = template
    replacements = {
        "{{LANG}}": "de",
        "{{PAGE_TITLE}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt (Video & Anleitung) · Sora+ Psyche",
        "{{OG_TITLE}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt",
        "{{META_DESCRIPTION}}": "Handlesen lernen Schritt für Schritt (Teil 1): Welche Hand liest man – links oder rechts? Video-Lektion mit Zeitmarken, Praxis-Trick für deine arbeitende Hand und Grundregeln der Tradition.",
        "{{CANONICAL_URL}}": canonical,
        "{{HREFLANG_LINKS}}": '<link rel="alternate" hreflang="de" href="https://sorainfo.de/handlesen/teil-01.html">',
        "{{THUMBNAIL_URL}}": thumb_url,
        "{{THUMBNAIL_WIDTH}}": "1280",
        "{{THUMBNAIL_HEIGHT}}": "720",
        "{{EMBED_URL}}": f"https://www.youtube-nocookie.com/embed/{vid}",
        "{{SITE_NAME}}": "Sora+ Psyche",
        "{{VIDEO_JSON_LD}}": json.dumps(video_ld, ensure_ascii=False, indent=2),
        "{{BREADCRUMB_JSON_LD}}": json.dumps(breadcrumb_ld, ensure_ascii=False, indent=2),
        "{{YOUTUBE_CHANNEL_URL}}": "https://www.youtube.com/@SoraPlusDe",
        "{{KICKER}}": "Handlesen lernen · Video-Lektion · Teil 1",
        "{{H1}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt",
        "{{BYLINE}}": "Sora+ Psyche · 12. Oktober 2026 · Video (59 Sek.) + Begleittext (ca. 3 Min. Lesezeit)",
        "{{IFRAME_TITLE}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt (Sora+ Psyche)",
        "{{FUNNEL_HEADING}}": "Direkt zum Mitmachen (zu Teil 1 der Serie):",
        "{{FUNNEL_TEXT}}": "Hol dir die kostenlose 6-seitige Einführung mit Übungszeichnungen im Telegram-Bot oder das komplette 31-Seiten-Arbeitsbuch zum Ausdrucken.",
        "{{FUNNEL_BUTTONS}}": funnel_buttons,
        "{{ARTICLE_BODY_HTML}}": article_body,
        "{{CHAPTERS_INTRO}}": "Alle Schritte aus Teil 1 (0:59 Min.) im Überblick – mit Klick auf die Zeitmarke springst du direkt zur Stelle im Video:",
        "{{CHAPTERS_LIST_HTML}}": chapters_html,
        "{{SERIES_LINKS_HTML}}": series_links,
        "{{NOTES_AND_CTA_HTML}}": notes_and_cta,
        "{{FOOTER_DISCLAIMER}}": "Sora+ Psyche · Allgemeine Information zur Selbstreflexion, kein Ersatz für medizinische oder therapeutische Beratung."
    }
    for k, v in replacements.items():
        html = html.replace(k, v)

    out_path = os.path.join(REPO_DIR, "handlesen/teil-01.html")
    with open(out_path, "w", encoding="utf-8") as fp:
        fp.write(html)

    # Update handlesen/index.html: "на /handlesen/ вместо картинки-ссылки — ссылка на новую страницу"
    idx_path = os.path.join(REPO_DIR, "handlesen/index.html")
    with open(idx_path, "r", encoding="utf-8") as fp:
        idx_html = fp.read()

    idx_html = re.sub(
        r'<a class="video-embed video-facade" href="https://www\.youtube\.com/shorts/H7wPio23qZ4"[^>]*>.*?</a>',
        '<div class="cta" style="margin:1.25rem 0 1.75rem;">\n'
        '    <p style="margin:0 0 0.6rem;"><strong>🎬 Videoserie „Handlesen lernen“ · Teil 1:</strong> Welche Hand zeigt das Mitgegebene, welche das Gelebte – und wie findest du deine „arbeitende“ Hand?</p>\n'
        '    <a class="btn" href="/handlesen/teil-01.html">▶️ Teil 1: „Links geplant, rechts gelebt“ ansehen (Video &amp; Text)</a>\n'
        '  </div>',
        idx_html,
        flags=re.S
    )
    if '/handlesen/teil-01.html">Teil 1:' not in idx_html and '<h2>Alle Themen</h2>\n  <ul>' in idx_html:
        idx_html = idx_html.replace(
            '<h2>Alle Themen</h2>\n  <ul>',
            '<h2>Alle Themen</h2>\n  <ul>\n    <li><a href="/handlesen/teil-01.html">Video-Lektion Teil 1: Links geplant, rechts gelebt (Welche Hand liest man?)</a></li>'
        )
    with open(idx_path, "w", encoding="utf-8") as fp:
        fp.write(idx_html)

    return {
        "page": "handlesen/teil-01.html",
        "loc": canonical,
        "video_id": vid,
        "title": video_ld["name"],
        "description": video_ld["description"],
        "thumbnail_loc": thumb_url,
        "player_loc": f"https://www.youtube-nocookie.com/embed/{vid}",
        "content_loc": f"https://www.youtube.com/shorts/{vid}",
        "duration": vmeta["duration_seconds"],
        "publication_date": vmeta["upload_date"],
        "clips": clips
    }


def build_sternen_pilot(inv: dict, template: str):
    vid = "-MCD8B2cjns"
    thumb_url = ensure_thumbnail(vid)
    vmeta = next(v for v in inv["sternenpsychologie_de_videos"] if v["video_id"] == vid)
    slug = "venus-im-skorpion-merkur-ruecklaeufig-oktober-2026.html"
    canonical = f"https://sorainfo.de/sternenpsychologie/{slug}"
    clips = [
        {"start": ch["start_time"], "end": ch["end_time"], "name": ch["title"]}
        for ch in vmeta["chapters"]
    ]
    video_ld = build_video_jsonld(
        name="Venus im Skorpion & Merkur rückläufig: Horoskop 19.–31. Oktober 2026 nach Geburtsdatum",
        description="In der zweiten Oktoberhälfte zieht sich ein Knoten zusammen: Venus im Skorpion und ein rückläufiger Merkur bringen alte Beziehungen, offene Papiere und finanzielle Prüfungen zurück. Die Berechnung nach exakt benannten Geburtsdaten (Skorpion, Waage, Löwe, Widder, Wassermann) und 5 Regeln bis Mitte November.",
        thumbnail_url=thumb_url,
        upload_date=vmeta["upload_date"],
        duration_iso=vmeta["duration_iso8601"],
        video_id=vid,
        canonical_url=canonical,
        clips=clips,
        is_short=False
    )
    breadcrumb_ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Startseite", "item": "https://sorainfo.de/"},
            {"@type": "ListItem", "position": 2, "name": "Sternenpsychologie", "item": "https://sorainfo.de/sternenpsychologie/"},
            {"@type": "ListItem", "position": 3, "name": "Venus im Skorpion & Merkur rückläufig (19.–31. Oktober 2026)", "item": canonical}
        ]
    }

    hreflang_links = """<link rel="alternate" hreflang="de" href="https://sorainfo.de/sternenpsychologie/venus-im-skorpion-merkur-ruecklaeufig-oktober-2026.html">
<link rel="alternate" hreflang="en" href="https://sorainfo.de/en/horoscope/">
<link rel="alternate" hreflang="es" href="https://sorainfo.de/es/horoscopo/">
<link rel="alternate" hreflang="pt" href="https://sorainfo.de/pt/horoscopo/">"""

    article_body = """
  <p class="lede">Wenn plötzlich Menschen aus der Vergangenheit wieder vor der Tür stehen, alte Rechnungen auftauchen oder Gespräche unerwartet scharf werden, liegt das in der astrologischen Tradition oft an einer besonderen Verdichtung am Himmel. In dieser Video-Analyse von <strong>Sternenpsychologie</strong> berechnen wir die „Knoten-Zeit“ vom 19. bis 31. Oktober 2026 – mit ihrem Nachwirken bis Mitte November – nach dem genauen Geburtsdatum.</p>

  <h2>Warum sich Ende Oktober und bis Mitte November ein „Knoten“ zusammenzieht</h2>
  <p>Ein Tierkreiszeichen umfasst rund dreißig Tage, doch laufende Konstellationen treffen niemals alle Grade gleich, sondern bestimmte Geburtsdaten. In der zweiten Oktoberhälfte überlagern sich zwei Faktoren: Zum einen zieht <strong>Venus durch den Skorpion</strong>, wo sie nach alter Lehre Eifersucht, alten Schmerz, finanzielle Spannung und den Wunsch weckt, frühere Beziehungen zurückzuholen. Zum anderen läuft <strong>Merkur rückläufig</strong> und verstärkt Gerüchte, unklare Nachrichten sowie Verzögerungen bei Dokumenten.</p>
  <p>Vier Daten geben dabei den Takt vor: Um den <strong>22. Oktober</strong> rücken offene Papiere und Rechtsfragen in den Fokus. Um den <strong>25. Oktober</strong> zieht sich der Knoten am engsten zusammen – ab hier gilt Vorsicht bei Entscheidungen, Geld und eigenen Kräften. Vom <strong>26. bis 28. Oktober</strong> folgt eine nervlich provokante Phase, während der <strong>30. Oktober</strong> zu äußerer Show verleitet, bei der dein Geld ruhen sollte.</p>

  <h2>Die 5 Geburtsdaten-Gruppen im Fokus der Berechnung</h2>
  <ul>
    <li><strong>Skorpion (26.–28. Oktober, 27. Oktober, 9. November):</strong> Für am 26.–28. Oktober Geborene wird die innere Haltung dieser Tage zum Programm für das ganze Lebensjahr (Wohnort, Beruf, Geld) bis zum Aufschwung ab August 2027. Um den <strong>27. Oktober</strong> gilt: keine alten Beziehungswunden aufreißen und keine Geldgeschäfte abschließen. Wer um den <strong>9. November</strong> geboren ist, sollte Pläne von Freunden kritisch prüfen, da Informationen derzeit nicht stimmen.</li>
    <li><strong>Waage / Skorpion-Grenze (22. Oktober):</strong> Rund um den Geburtstag kehren ungeklärte Papier- oder Rechtsfragen zurück, die fast ein Jahr dauern können. Auf zwei Stühlen gleichzeitig zu sitzen gelingt jetzt nicht – unterschreibe nichts unter Druck.</li>
    <li><strong>Löwe (9. August und 3. August):</strong> Am <strong>9. August</strong> Geborene sollten große Schritte bei Immobilien oder Zuhause nicht um den 30. Oktober starten, sondern bis zur zweiten Novemberhälfte warten. Wer am <strong>3. August</strong> geboren ist, merkt, dass sich ein Mitte Oktober hart erkämpftes Ziel selbst wandelt.</li>
    <li><strong>Widder (31. März):</strong> Bis Mitte November läuft eine ehrliche Lebens-Inventur. Überflüssiges darf gehen; vermeide unüberlegte Ausgaben und alte Streitigkeiten, besonders mit wichtigen Männern im Umfeld.</li>
    <li><strong>Wassermann (24. Januar):</strong> Bis Mitte November klopft oft jemand aus der Vergangenheit an. Da derzeit Klarheit fehlt, lautet der Rat: freundlich bleiben, Abstand halten und nichts versprechen.</li>
  </ul>

  <h2>Die 5 Regeln für alle Sternzeichen in der Knoten-Zeit</h2>
  <p>Für Stier, Zwillinge, Krebs, Jungfrau, Schütze, Steinbock und Fische zeigt die Berechnung keine direkten Krisenspitzen. Dennoch helfen bis Mitte November fünf Grundregeln:</p>
  <ol>
    <li><strong>Nichts Neues beginnen:</strong> Jedes Vorhaben hat sein eigenes Horoskop; ein Start im Knoten bringt lange Reibungsverluste.</li>
    <li><strong>Geld in Ruhe lassen:</strong> Keine riskanten Geschäfte, auch nicht auf späteren Gewinn.</li>
    <li><strong>Alte Wunden nicht aufreißen:</strong> In dieser Phase heilen sie durch Streit nicht.</li>
    <li><strong>Nicht hetzen lassen:</strong> Eile, die nach Fortschritt aussieht, ist jetzt eine Falle.</li>
    <li><strong>Ruhig bleiben:</strong> Ein Risiko zu vermeiden ist bis zur Wende Mitte November bereits ein wichtiges Ergebnis.</li>
  </ol>
""".strip()

    chapters_html = "\n".join(
        f'    <li><a href="https://www.youtube.com/watch?v={vid}&amp;t={c["start"]}s">{fmt_mmss(c["start"])} · {c["name"]}</a></li>'
        for c in clips
    )

    series_links = """
    <li><a href="/sternenpsychologie/">Interaktiver Geburtsdaten-Kompass 2026–2027: Alle 12 Sternzeichen &amp; Sonnengrade durchsuchen</a></li>
    <li><a href="/handlesen/">Handlesen lernen: Was deine Lebens- und Schicksalslinie zum selben Lebensjahr zeigen</a></li>
    <li><a href="/handlesen/teil-01.html">Video-Lektion Handlesen · Teil 1: Links geplant, rechts gelebt</a></li>
    <li><a href="/shop.html">Alle A4-Arbeitsbücher &amp; kostenlosen Starter-PDFs im Überblick</a></li>
""".strip()

    notes_and_cta = """
  <div class="cta">
    <p><strong>Prüfe dein genaues Geburtsdatum (TT.MM) für 2026–2027:</strong> Im offiziellen Telegram-Bot erhältst du sofort dein kostenloses 3-seitiges PDF-Dossier, oder du nutzt das große 28-seitige A4-Arbeitsbuch „Geburtsdaten-Kompass 2026–2027“ zum Ausdrucken.</p>
    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Geburtsdatum im Telegram-Bot prüfen (@sternenpsychologie_bot)</a>
    <a class="btn" style="margin:0 .5rem .5rem 0" href="/downloads/Geburtsdaten_Kompass_2026_2027_Starter_DE.pdf">📄 Gratis Starter-Tabelle (PDF, 6 S.)</a>
    <a class="btn" href="https://www.etsy.com/listing/4598276698?utm_source=sorainfo&amp;utm_medium=sternen_watch" target="_blank" rel="noopener">📖 Großes Arbeitsbuch auf Etsy (28 S. A4)</a>
  </div>

  <p class="note" style="margin-top:1.75rem;"><strong>Hinweis zur Tradition &amp; Ethik:</strong> Die Betrachtung von Sonnengraden und Tierkreispositionen beruht auf überlieferten Methoden der klassischen Astrologie und dient als strukturierte Reflexionshilfe zur achtsamen Selbstbeobachtung. Sie stellt keine wissenschaftlich gesicherte Vorhersage dar und ersetzt zu keinem Zeitpunkt eine medizinische, psychotherapeutische, finanzielle oder juristische Beratung.</p>
  <p class="note">Video, Stimme und Begleittext wurden unter Zuhilfenahme moderner KI-Systeme erstellt und redaktionell durch Sternenpsychologie · Sora+ Psyche geprüft.</p>
""".strip()

    funnel_buttons = """
      <a class="btn" style="padding:0.55rem 0.95rem;font-size:0.9rem;" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Gratis Geburtsdatum-Check im Bot (@sternenpsychologie_bot)</a>
      <a class="btn-teal" href="/downloads/Geburtsdaten_Kompass_2026_2027_Starter_DE.pdf">📄 Gratis Starter-Tabelle (6 S. PDF)</a>
      <a class="btn-outline" href="https://www.etsy.com/listing/4598276698?utm_source=sorainfo&amp;utm_medium=sternen_watch" target="_blank" rel="noopener">📖 Arbeitsbuch „Geburtsdaten-Kompass“ (28 S. Etsy)</a>
      <a class="btn-outline" href="/sternenpsychologie/">📋 Alle 12 Zeichen in der Tabelle suchen</a>
""".strip()

    html = template
    replacements = {
        "{{LANG}}": "de",
        "{{PAGE_TITLE}}": "Venus im Skorpion & Merkur rückläufig: Horoskop nach Geburtsdatum (Video) · Sternenpsychologie",
        "{{OG_TITLE}}": "Venus im Skorpion & Merkur rückläufig: Horoskop 19.–31. Oktober 2026 nach Geburtsdatum",
        "{{META_DESCRIPTION}}": "Video-Analyse nach genauem Geburtsdatum: Warum sich mit Venus im Skorpion und rückläufigem Merkur ein Knoten zusammenzieht, welche Geburtsdaten betroffen sind und 5 Regeln bis Mitte November.",
        "{{CANONICAL_URL}}": canonical,
        "{{HREFLANG_LINKS}}": hreflang_links,
        "{{THUMBNAIL_URL}}": thumb_url,
        "{{THUMBNAIL_WIDTH}}": "1280",
        "{{THUMBNAIL_HEIGHT}}": "720",
        "{{EMBED_URL}}": f"https://www.youtube-nocookie.com/embed/{vid}",
        "{{SITE_NAME}}": "Sternenpsychologie · Sora+ Psyche",
        "{{VIDEO_JSON_LD}}": json.dumps(video_ld, ensure_ascii=False, indent=2),
        "{{BREADCRUMB_JSON_LD}}": json.dumps(breadcrumb_ld, ensure_ascii=False, indent=2),
        "{{YOUTUBE_CHANNEL_URL}}": "https://www.youtube.com/@Sternenpsychologie",
        "{{KICKER}}": "Sternenpsychologie · Video-Analyse nach Geburtsdatum",
        "{{H1}}": "Venus im Skorpion &amp; Merkur rückläufig: Horoskop nach Geburtsdatum",
        "{{BYLINE}}": "Sternenpsychologie · 19. Oktober 2026 · Video (10:29 Min.) + Begleittext (ca. 4 Min. Lesezeit)",
        "{{IFRAME_TITLE}}": "Venus im Skorpion & Merkur rückläufig: Horoskop 19.–31. Oktober 2026 nach Geburtsdatum",
        "{{FUNNEL_HEADING}}": "Direkt starten (passend zum Video):",
        "{{FUNNEL_TEXT}}": "Prüfe dein genaues Geburtsdatum (TT.MM) kostenlos im Telegram-Bot, lade die 6-seitige Starter-Tabelle als PDF herunter oder öffne das 28-seitige Arbeitsbuch.",
        "{{FUNNEL_BUTTONS}}": funnel_buttons,
        "{{ARTICLE_BODY_HTML}}": article_body,
        "{{CHAPTERS_INTRO}}": "Alle 10 Kapitel des Videos (10:29 Min.) mit direktem Sprung zum jeweiligen Geburtsdatum:",
        "{{CHAPTERS_LIST_HTML}}": chapters_html,
        "{{SERIES_LINKS_HTML}}": series_links,
        "{{NOTES_AND_CTA_HTML}}": notes_and_cta,
        "{{FOOTER_DISCLAIMER}}": "Sternenpsychologie · Ein Projekt von Sora+ Psyche. Allgemeine Information zur Selbstreflexion, kein Ersatz für medizinische, therapeutische oder rechtliche Beratung."
    }
    for k, v in replacements.items():
        html = html.replace(k, v)

    out_path = os.path.join(REPO_DIR, f"sternenpsychologie/{slug}")
    with open(out_path, "w", encoding="utf-8") as fp:
        fp.write(html)

    # Link the new watch page from sternenpsychologie/index.html (in the 19.-31. Oktober table row and top buttons)
    sp_idx = os.path.join(REPO_DIR, "sternenpsychologie/index.html")
    if os.path.exists(sp_idx):
        with open(sp_idx, "r", encoding="utf-8") as fp:
            sp_html = fp.read()
        if f"/sternenpsychologie/{slug}" not in sp_html:
            sp_html = sp_html.replace(
                "<td>„Zeit des Knotens“ (Venus im Skorpion + rückläufiger Merkur)</td>",
                f'<td>„Zeit des Knotens“ (Venus im Skorpion + rückläufiger Merkur)<br><a href="/sternenpsychologie/{slug}" style="font-weight:600;display:inline-block;margin-top:0.35rem;">🎬 Video-Analyse &amp; Zeitmarken ansehen →</a></td>'
            )
            with open(sp_idx, "w", encoding="utf-8") as fp:
                fp.write(sp_html)

    return {
        "page": f"sternenpsychologie/{slug}",
        "loc": canonical,
        "video_id": vid,
        "title": video_ld["name"],
        "description": video_ld["description"],
        "thumbnail_loc": thumb_url,
        "player_loc": f"https://www.youtube-nocookie.com/embed/{vid}",
        "content_loc": f"https://www.youtube.com/watch?v={vid}",
        "duration": vmeta["duration_seconds"],
        "publication_date": vmeta["upload_date"],
        "clips": clips
    }


def update_sitemaps(pilot_entries: list):
    sitemap_path = os.path.join(REPO_DIR, "sitemap.xml")
    with open(sitemap_path, "r", encoding="utf-8") as fp:
        sm = fp.read()

    # Update muede-trotz-schlaf entry in sitemap.xml with full duration and new thumbnail
    p0 = pilot_entries[0]
    muede_block = f"""  <url>
    <loc>{p0['loc']}</loc>
    <lastmod>2026-11-06</lastmod>
    <priority>0.8</priority>
    <video:video>
      <video:thumbnail_loc>{p0['thumbnail_loc']}</video:thumbnail_loc>
      <video:title>{xml_escape(p0['title'])}</video:title>
      <video:description>{xml_escape(p0['description'])}</video:description>
      <video:player_loc>{p0['player_loc']}</video:player_loc>
      <video:duration>{p0['duration']}</video:duration>
      <video:publication_date>{p0['publication_date']}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>"""
    sm = re.sub(
        r'  <url>\s*<loc>https://sorainfo\.de/artikel/muede-trotz-schlaf\.html</loc>.*?</url>',
        muede_block,
        sm,
        flags=re.S
    )

    # Remove any previous pilot entries for teil-01 or venus-im-skorpion before re-adding
    for p in pilot_entries[1:]:
        sm = re.sub(
            rf'\s*<url>\s*<loc>{re.escape(p["loc"])}</loc>.*?</url>',
            '',
            sm,
            flags=re.S
        )
        new_url_block = f"""  <url>
    <loc>{p['loc']}</loc>
    <lastmod>2026-11-06</lastmod>
    <priority>0.9</priority>
    <video:video>
      <video:thumbnail_loc>{p['thumbnail_loc']}</video:thumbnail_loc>
      <video:title>{xml_escape(p['title'])}</video:title>
      <video:description>{xml_escape(p['description'])}</video:description>
      <video:player_loc>{p['player_loc']}</video:player_loc>
      <video:duration>{p['duration']}</video:duration>
      <video:publication_date>{p['publication_date']}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>
</urlset>"""
        sm = sm.replace("</urlset>", new_url_block)

    with open(sitemap_path, "w", encoding="utf-8") as fp:
        fp.write(sm)

    # Build dedicated video-sitemap.xml for pages with verified live embedded players
    vsm_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'
    ]
    for p in pilot_entries:
        vsm_lines.append("  <url>")
        vsm_lines.append(f"    <loc>{p['loc']}</loc>")
        vsm_lines.append("    <video:video>")
        vsm_lines.append(f"      <video:thumbnail_loc>{p['thumbnail_loc']}</video:thumbnail_loc>")
        vsm_lines.append(f"      <video:title>{xml_escape(p['title'])}</video:title>")
        vsm_lines.append(f"      <video:description>{xml_escape(p['description'])}</video:description>")
        vsm_lines.append(f"      <video:content_loc>{p['content_loc']}</video:content_loc>")
        vsm_lines.append(f"      <video:player_loc>{p['player_loc']}</video:player_loc>")
        vsm_lines.append(f"      <video:duration>{p['duration']}</video:duration>")
        vsm_lines.append(f"      <video:publication_date>{p['publication_date']}</video:publication_date>")
        vsm_lines.append("      <video:family_friendly>yes</video:family_friendly>")
        vsm_lines.append("      <video:live>no</video:live>")
        vsm_lines.append("    </video:video>")
        vsm_lines.append("  </url>")
    vsm_lines.append("</urlset>\n")

    vsm_path = os.path.join(REPO_DIR, "video-sitemap.xml")
    with open(vsm_path, "w", encoding="utf-8") as fp:
        fp.write("\n".join(vsm_lines))


def main():
    with open(INVENTORY_PATH, "r", encoding="utf-8") as fp:
        inv = json.load(fp)
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as fp:
        template = fp.read()

    p1 = update_muede_trotz_schlaf(inv)
    p2 = build_handlesen_teil_01(inv, template)
    p3 = build_sternen_pilot(inv, template)
    pilots = [p1, p2, p3]
    update_sitemaps(pilots)
    for p in pilots:
        print(f"Built pilot watch page: {p['page']} -> video={p['video_id']} ({p['duration']}s, {len(p['clips'])} clips)")
    print("Updated sitemap.xml and created video-sitemap.xml")


if __name__ == "__main__":
    main()
