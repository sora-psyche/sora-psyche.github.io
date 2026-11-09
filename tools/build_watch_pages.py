#!/usr/bin/env python3
"""
Generator for dedicated YouTube Watch Pages and 5-Language Course Hubs on sorainfo.de (Z15 + K01).
Reads:
- ~/Claude outputs/site_video/inventory.json
- tools/course_240_watch_source.json
- templates/watch.html
Builds:
1. The 3 Z15 pilot watch pages (artikel/muede-trotz-schlaf.html, handlesen/teil-01.html, sternenpsychologie/venus-im-skorpion-merkur-ruecklaeufig-oktober-2026.html).
2. Course Watch Pages across all 5 languages (DE, EN, ES, PT, JA) for published lessons (by default lessons 1..2, configurable via --max-lesson N up to 48).
3. Updates all 5 Language Hubs (/sternenpsychologie/, /en/horoscope/, /es/horoscopo/, /pt/horoscopo/, /ja/horoscope/) with:
   - 5-language switcher bar + hreflang (de, en, es, pt, ja, x-default)
   - Self-referencing canonical URLs
   - Prominent Telegram Course Channel buttons (@astrologie_lernen, @learntraditionalastrology, @aprende_astrologia, @astrologiatradicional_br, @koten_senseijutsu) + Bots
   - Full 48-lesson course curriculum section linking to live Watch Pages
4. Updates sitemap.xml and video-sitemap.xml.
"""
import os
import re
import sys
import json
import shutil
import argparse
import urllib.request
from xml.sax.saxutils import escape as xml_escape

REPO_DIR = os.path.expanduser("~/sorainfo-blog-deploy")
INVENTORY_PATH = os.path.expanduser("~/Claude outputs/site_video/inventory.json")
COURSE_SRC_PATH = os.path.expanduser("~/Antigravity/07_Совет_Каналы/data/course_240_watch_source.json")
THUMBS_CACHE_DIR = os.path.expanduser("~/Antigravity/07_Совет_Каналы/data/thumbs_240")
TEMPLATE_PATH = os.path.join(REPO_DIR, "templates/watch.html")
JA_DRAFT_PATH = "/tmp/ds_sorainfo_task/ja_hub.html"

LANG_CFG = {
    "DE": {
        "html_lang": "de",
        "in_lang": "de",
        "dir": "sternenpsychologie",
        "hub_url": "https://sorainfo.de/sternenpsychologie/",
        "hub_rel": "/sternenpsychologie/",
        "slug_prefix": "lektion",
        "site_name": "Sternenpsychologie · Sora+ Psyche",
        "yt_url": "https://www.youtube.com/@Sternenpsychologie",
        "yt_handle": "@Sternenpsychologie",
        "tg_channel_url": "https://t.me/astrologie_lernen",
        "tg_channel_label": "📲 Telegram-Kurskanal (@astrologie_lernen)",
        "tg_bot_url": "https://t.me/sternenpsychologie_bot",
        "tg_bot_label": "🔮 Gratis Geburtsdatum-Check im Bot (@sternenpsychologie_bot)",
        "kicker_prefix": "Astrologie & Handlesen lernen · Video-Kurs · Lektion",
        "byline_prefix": "Sternenpsychologie · Video-Lektion + Begleittext",
        "funnel_heading": "Direkt zum Kurs & Mitmachen:",
        "funnel_text": "Tritt unserem kostenlosen Telegram-Kurskanal bei, prüfe dein Geburtsdatum im Bot oder öffne die Kurs-Übersicht mit allen 48 Lektionen.",
        "chapters_heading": "Kapitel &amp; Zeitmarken im Video",
        "chapters_intro": "Alle Kapitel dieser Video-Lektion im Überblick – mit Klick auf die Zeitmarke springst du direkt zur Stelle im Video:",
        "series_heading": "Mehr aus dem Kurs (48 Lektionen)",
        "hub_link_label": "Kurs-Übersicht: Alle 48 Lektionen (Astrologie &amp; Handlesen lernen) + Geburtsdaten-Kompass",
        "prev_label": "Vorherige Lektion",
        "next_label": "Nächste Lektion",
        "course_sec_title": "Vollständiger Video-Kurs: Astrologie &amp; Handlesen lernen (48 Lektionen)",
        "course_sec_intro": "Jeden Tag erscheint eine neue Lektion aus unserer 48-teiligen Serie basierend auf alten Lehrbüchern. Klicke auf eine veröffentlichte Lektion, um das Video mit Zeitmarken und Begleittext direkt hier anzusehen:",
        "watch_btn_label": "▶️ Video &amp; Text ansehen",
        "sched_label": "Geplant für",
        "nav_html": (
            '<a href="/gesichtlesen/" style="color:var(--accent);font-weight:650;">👁 Gesichtlesen</a>\n'
            '      <a href="/handlesen/">Handlesen</a>\n'
            '      <a href="/sternenpsychologie/">Sternenpsychologie</a>\n'
            '      <a href="/shop.html">Shop</a>\n'
            '      <a href="https://www.youtube.com/@Sternenpsychologie">YouTube</a>\n'
            '      <a href="https://t.me/astrologie_lernen">Telegram</a>'
        ),
        "footer_disclaimer": "Sternenpsychologie · Ein Projekt von Sora+ Psyche. Allgemeine Information zur Selbstreflexion und Bildung, kein Ersatz für medizinische, therapeutische oder rechtliche Beratung.",
        "footer_links": (
            '<a href="/">Startseite</a> · <a href="/sternenpsychologie/">Sternenpsychologie</a> · '
            '<a href="/handlesen/">Handlesen</a> · <a href="/gesichtlesen/">Gesichtlesen</a> · '
            '<a href="https://www.youtube.com/@Sternenpsychologie">YouTube</a> · '
            '<a href="https://t.me/astrologie_lernen">Telegram-Kurs</a> · '
            '<a href="/impressum.html">Impressum</a> · <a href="/datenschutz.html">Datenschutz</a>'
        ),
        "notes_html": (
            '<div class="cta">\n'
            '    <p><strong>Begleitend zum Kurs (48 Lektionen):</strong> Folge dem kostenlosen Telegram-Kanal zum Kurs oder prüfe dein genaues Geburtsdatum (TT.MM) im Telegram-Bot.</p>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/astrologie_lernen" target="_blank" rel="noopener">📲 Telegram-Kurskanal (@astrologie_lernen)</a>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Geburtsdatum-Bot (@sternenpsychologie_bot)</a>\n'
            '    <a class="btn" href="https://t.me/handlinien_bot?start=hand" target="_blank" rel="noopener">✋ Gratis 6-Seiten-PDF Handlesen (Bot)</a>\n'
            '  </div>\n'
            '  <p class="note" style="margin-top:1.75rem;">Hinweis: Dient der Selbstreflexion und Bildung – kein ärztlicher, psychologischer oder rechtlicher Rat. Video, Stimme und Begleittext wurden mit KI-Unterstützung erstellt und redaktionell geprüft.</p>'
        )
    },
    "EN": {
        "html_lang": "en",
        "in_lang": "en",
        "dir": "en/horoscope",
        "hub_url": "https://sorainfo.de/en/horoscope/",
        "hub_rel": "/en/horoscope/",
        "slug_prefix": "lesson",
        "site_name": "Learn Astrology, Palmistry & Horoscope · Sora+ Psyche",
        "yt_url": "https://www.youtube.com/@HoroscopeStarPsychology",
        "yt_handle": "@HoroscopeStarPsychology",
        "tg_channel_url": "https://t.me/learntraditionalastrology",
        "tg_channel_label": "📲 Telegram Course Channel (@learntraditionalastrology)",
        "tg_bot_url": "https://t.me/relationshipadvice_bot",
        "tg_bot_label": "🔮 Check Your Birth Date in Telegram Bot (@relationshipadvice_bot)",
        "kicker_prefix": "Learn Astrology & Palmistry · Video Course · Lesson",
        "byline_prefix": "Star Psychology · Video Lesson + Full Study Guide",
        "funnel_heading": "Start Learning Right Now:",
        "funnel_text": "Join our free Telegram course channel for daily study notes, check your exact birth date in the bot, or browse all 48 lessons of the course.",
        "chapters_heading": "Chapters &amp; Timestamps in This Video",
        "chapters_intro": "All chapters of this video lesson at a glance – click any timestamp to jump directly to that section:",
        "series_heading": "More from This Course (48 Lessons)",
        "hub_link_label": "Course Hub: All 48 Lessons (Learn Astrology &amp; Palmistry) + 2026–2027 Birth Date Compass",
        "prev_label": "Previous Lesson",
        "next_label": "Next Lesson",
        "course_sec_title": "Full 48-Lesson Video Course: Learn Astrology, Palmistry &amp; Natal Chart",
        "course_sec_intro": "A new lesson from our 48-part traditional course is released every day. Click any published lesson below to watch the video with timestamps and study text:",
        "watch_btn_label": "▶️ Watch Video &amp; Read Guide",
        "sched_label": "Scheduled for",
        "nav_html": (
            '<a href="/en/face-reading/">👁 Face Reading</a>\n'
            '      <a href="/en/horoscope/">Astrology Course &amp; Horoscope</a>\n'
            '      <a href="https://www.youtube.com/@HoroscopeStarPsychology">YouTube</a>\n'
            '      <a href="https://t.me/learntraditionalastrology">Telegram</a>'
        ),
        "footer_disclaimer": "Star Psychology · A project of Sora+ Psyche. Traditional astrology and palmistry for self-reflection and education – not medical, psychological, legal or financial advice.",
        "footer_links": (
            '<a href="/en/horoscope/">Course &amp; Horoscope Hub</a> · <a href="/en/face-reading/">Face Reading</a> · '
            '<a href="https://www.youtube.com/@HoroscopeStarPsychology">YouTube</a> · '
            '<a href="https://t.me/learntraditionalastrology">Telegram Course</a> · '
            '<a href="/impressum.html">Legal Notice</a> · <a href="/datenschutz.html">Privacy</a>'
        ),
        "notes_html": (
            '<div class="cta">\n'
            '    <p><strong>Study Along with the 48-Lesson Course:</strong> Join our official Telegram course channel or check your exact birth date (DD.MM) in our Telegram bot.</p>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/learntraditionalastrology" target="_blank" rel="noopener">📲 Telegram Course Channel (@learntraditionalastrology)</a>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/relationshipadvice_bot" target="_blank" rel="noopener">🔮 Birth Date Bot (@relationshipadvice_bot)</a>\n'
            '    <a class="btn" href="/en/face-reading/">👁 Free Face Reading by Selfie</a>\n'
            '  </div>\n'
            '  <p class="note" style="margin-top:1.75rem;">Note: For self-reflection and educational purposes – not medical, psychological or financial advice. Video, voice and study text partly created with AI assistance.</p>'
        )
    },
    "ES": {
        "html_lang": "es",
        "in_lang": "es",
        "dir": "es/horoscopo",
        "hub_url": "https://sorainfo.de/es/horoscopo/",
        "hub_rel": "/es/horoscopo/",
        "slug_prefix": "leccion",
        "site_name": "Aprende Astrología y Quiromancia · Sora+ Psyche",
        "yt_url": "https://www.youtube.com/@HoroscopoAstrologiaPsicologica",
        "yt_handle": "@HoroscopoAstrologiaPsicologica",
        "tg_channel_url": "https://t.me/aprende_astrologia",
        "tg_channel_label": "📲 Canal del Curso en Telegram (@aprende_astrologia)",
        "tg_bot_url": "https://t.me/psicologiaastral_bot",
        "tg_bot_label": "🔮 Consulta tu Fecha de Nacimiento en el Bot (@psicologiaastral_bot)",
        "kicker_prefix": "Aprende Astrología y Quiromancia · Curso en Video · Lección",
        "byline_prefix": "Astrología Psicológica · Video-Lección + Guía de Estudio",
        "funnel_heading": "Empieza a Aprender Ahora:",
        "funnel_text": "Únete gratis al canal de Telegram del curso, consulta tu fecha de nacimiento exacta en el bot o explora las 48 lecciones del curso.",
        "chapters_heading": "Capítulos y Marcas de Tiempo del Video",
        "chapters_intro": "Todos los capítulos de esta lección de un vistazo – haz clic en cualquier marca de tiempo para ir directamente a esa parte:",
        "series_heading": "Más Lecciones del Curso (48 Lecciones)",
        "hub_link_label": "Índice del Curso: Las 48 Lecciones (Aprende Astrología y Quiromancia) + Brújula 2026–2027",
        "prev_label": "Lección anterior",
        "next_label": "Siguiente lección",
        "course_sec_title": "Curso Completo en Video: Aprende Astrología, Carta Natal y Quiromancia (48 Lecciones)",
        "course_sec_intro": "Cada día se publica una nueva lección de nuestro curso de 48 partes basado en libros antiguos. Haz clic en cualquier lección publicada para ver el video con marcas de tiempo y texto de estudio:",
        "watch_btn_label": "▶️ Ver Video y Guía",
        "sched_label": "Programado para",
        "nav_html": (
            '<a href="/es/lectura-facial/">👁 Lectura Facial</a>\n'
            '      <a href="/es/horoscopo/">Curso de Astrología y Horóscopo</a>\n'
            '      <a href="https://www.youtube.com/@HoroscopoAstrologiaPsicologica">YouTube</a>\n'
            '      <a href="https://t.me/aprende_astrologia">Telegram</a>'
        ),
        "footer_disclaimer": "Astrología Psicológica · Un proyecto de Sora+ Psyche. Tradición astrológica y quiromancia para la autorreflexión y educación – no sustituye el consejo médico, psicológico, legal o financiero.",
        "footer_links": (
            '<a href="/es/horoscopo/">Curso y Horóscopo</a> · <a href="/es/lectura-facial/">Lectura Facial</a> · '
            '<a href="https://www.youtube.com/@HoroscopoAstrologiaPsicologica">YouTube</a> · '
            '<a href="https://t.me/aprende_astrologia">Telegram del Curso</a> · '
            '<a href="/es/impressum.html">Aviso Legal</a> · <a href="/es/datenschutz.html">Privacidad</a>'
        ),
        "notes_html": (
            '<div class="cta">\n'
            '    <p><strong>Acompaña el Curso de 48 Lecciones:</strong> Únete a nuestro canal oficial de estudio en Telegram o consulta tu fecha de nacimiento exacta (DD.MM) en el bot.</p>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/aprende_astrologia" target="_blank" rel="noopener">📲 Canal del Curso en Telegram (@aprende_astrologia)</a>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/psicologiaastral_bot" target="_blank" rel="noopener">🔮 Bot Fecha de Nacimiento (@psicologiaastral_bot)</a>\n'
            '    <a class="btn" href="/es/lectura-facial/">👁 Lectura Facial Gratis por Selfie</a>\n'
            '  </div>\n'
            '  <p class="note" style="margin-top:1.75rem;">Nota: Para autorreflexión y formación – no es consejo médico, psicológico ni financiero. Video, voz y texto elaborados en parte con apoyo de IA.</p>'
        )
    },
    "PT": {
        "html_lang": "pt-BR",
        "in_lang": "pt-BR",
        "dir": "pt/horoscopo",
        "hub_url": "https://sorainfo.de/pt/horoscopo/",
        "hub_rel": "/pt/horoscopo/",
        "slug_prefix": "licao",
        "site_name": "Aprenda Astrologia e Quiromancia · Sora+ Psyche",
        "yt_url": "https://www.youtube.com/@HoroscopoAstrologiaePsicologia",
        "yt_handle": "@HoroscopoAstrologiaePsicologia",
        "tg_channel_url": "https://t.me/astrologiatradicional_br",
        "tg_channel_label": "📲 Canal do Curso no Telegram (@astrologiatradicional_br)",
        "tg_bot_url": "https://t.me/astrologiadorelacionamento_bot",
        "tg_bot_label": "🔮 Confira sua Data de Nascimento no Bot (@astrologiadorelacionamento_bot)",
        "kicker_prefix": "Aprenda Astrologia e Quiromancia · Curso em Vídeo · Lição",
        "byline_prefix": "Astrologia e Psicologia · Vídeo-Lição + Guia de Estudo",
        "funnel_heading": "Comece a Estudar Agora:",
        "funnel_text": "Entre gratuitamente no canal do curso no Telegram, confira sua data de nascimento exata no bot ou veja todas as 48 lições do curso.",
        "chapters_heading": "Capítulos e Minutagem do Vídeo",
        "chapters_intro": "Todos os capítulos desta lição em resumo – clique na minutagem para pular diretamente para o trecho do vídeo:",
        "series_heading": "Mais Lições do Curso (48 Lições)",
        "hub_link_label": "Índice do Curso: Todas as 48 Lições (Aprenda Astrologia e Quiromancia) + Bússola 2026–2027",
        "prev_label": "Lição anterior",
        "next_label": "Próxima lição",
        "course_sec_title": "Curso Completo em Vídeo: Aprenda Astrologia, Mapa Astral e Quiromancia (48 Lições)",
        "course_sec_intro": "Todos os dias sai uma nova lição do nosso curso de 48 partes baseado em livros antigos. Clique em uma lição publicada para assistir ao vídeo com minutagem e texto de estudo:",
        "watch_btn_label": "▶️ Assistir Vídeo e Ler Guia",
        "sched_label": "Agendado para",
        "nav_html": (
            '<a href="/pt/leitura-facial/">👁 Leitura Facial</a>\n'
            '      <a href="/pt/horoscopo/">Curso de Astrologia e Horóscopo</a>\n'
            '      <a href="https://www.youtube.com/@HoroscopoAstrologiaePsicologia">YouTube</a>\n'
            '      <a href="https://t.me/astrologiatradicional_br">Telegram</a>'
        ),
        "footer_disclaimer": "Astrologia e Psicologia · Um projeto da Sora+ Psyche. Tradição astrológica e quiromancia para autorreflexão e estudo – não substitui aconselhamento médico, psicológico, jurídico ou financeiro.",
        "footer_links": (
            '<a href="/pt/horoscopo/">Curso e Horóscopo</a> · <a href="/pt/leitura-facial/">Leitura Facial</a> · '
            '<a href="https://www.youtube.com/@HoroscopoAstrologiaePsicologia">YouTube</a> · '
            '<a href="https://t.me/astrologiatradicional_br">Telegram do Curso</a> · '
            '<a href="/impressum.html">Aviso Legal</a> · <a href="/datenschutz.html">Privacidade</a>'
        ),
        "notes_html": (
            '<div class="cta">\n'
            '    <p><strong>Acompanhe o Curso de 48 Lições:</strong> Entre no nosso canal oficial de estudos no Telegram ou confira sua data de nascimento exata (DD.MM) no bot.</p>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/astrologiatradicional_br" target="_blank" rel="noopener">📲 Canal do Curso no Telegram (@astrologiatradicional_br)</a>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/astrologiadorelacionamento_bot" target="_blank" rel="noopener">🔮 Bot Data de Nascimento (@astrologiadorelacionamento_bot)</a>\n'
            '    <a class="btn" href="/pt/leitura-facial/">👁 Leitura Facial Grátis por Selfie</a>\n'
            '  </div>\n'
            '  <p class="note" style="margin-top:1.75rem;">Aviso: Para autorreflexão e estudo – não é orientação médica, psicológica nem financeira. Vídeo, voz e texto criados em parte com apoio de IA.</p>'
        )
    },
    "JA": {
        "html_lang": "ja",
        "in_lang": "ja",
        "dir": "ja/horoscope",
        "hub_url": "https://sorainfo.de/ja/horoscope/",
        "hub_rel": "/ja/horoscope/",
        "slug_prefix": "lesson",
        "site_name": "占星術と手相を学ぶ · Sora+ Psyche",
        "yt_url": "https://www.youtube.com/@SenseijutsuTesou",
        "yt_handle": "@SenseijutsuTesou",
        "tg_channel_url": "https://t.me/koten_senseijutsu",
        "tg_channel_label": "📲 Telegram 占星術・手相講座 (@koten_senseijutsu)",
        "tg_bot_url": "https://t.me/koten_senseijutsu",
        "tg_bot_label": "📖 全48回講座一覧と資料 (@koten_senseijutsu)",
        "kicker_prefix": "占星術と手相を学ぶ · 動画講座 · 第",
        "byline_prefix": "星の心理学 · 動画講義＋学習ガイド",
        "funnel_heading": "講座を今すぐ始める：",
        "funnel_text": "Telegram公式講座チャンネル（無料）への参加、YouTubeチャンネル登録、または全48回のカリキュラム一覧をご覧いただけます。",
        "chapters_heading": "動画のチャプター・目次",
        "chapters_intro": "この講義の全チャプター一覧です。タイムスタンプをクリックすると動画の該当箇所へ移動します：",
        "series_heading": "講座の他の講義（全48回）",
        "hub_link_label": "講座トップ：全48回カリキュラム（占星術・手相・ホロスコープ入門）＋2026–2027年コンパス",
        "prev_label": "前の講義",
        "next_label": "次の講義",
        "course_sec_title": "動画で学ぶ完全講座：占星術・ホロスコープ・手相入門（全48回）",
        "course_sec_intro": "古典の原典に基づく全48回の動画講座を毎日1本ずつ公開しています。公開済みの講義をクリックすると、動画プレーヤー・チャプター・解説テキストをご覧いただけます：",
        "watch_btn_label": "▶️ 動画と解説を見る",
        "sched_label": "公開予定日",
        "nav_html": (
            '<a href="/ja/horoscope/">占星術・手相講座</a>\n'
            '      <a href="/en/face-reading/">👁 人相・顔相 (EN)</a>\n'
            '      <a href="https://www.youtube.com/@SenseijutsuTesou">YouTube</a>\n'
            '      <a href="https://t.me/koten_senseijutsu">Telegram</a>'
        ),
        "footer_disclaimer": "占星術と手相を学ぶ · Sora+ Psycheのプロジェクト。自己省察と教養のためのコンテンツであり、医療・心理・法律・財務の助言の代わりにはなりません。",
        "footer_links": (
            '<a href="/ja/horoscope/">占星術・手相講座トップ</a> · '
            '<a href="https://www.youtube.com/@SenseijutsuTesou">YouTube (@SenseijutsuTesou)</a> · '
            '<a href="https://t.me/koten_senseijutsu">Telegram講座 (@koten_senseijutsu)</a> · '
            '<a href="/impressum.html">法的通知 (Impressum)</a> · <a href="/datenschutz.html">プライバシー</a>'
        ),
        "notes_html": (
            '<div class="cta">\n'
            '    <p><strong>全48回講座を一緒に学ぶ：</strong> Telegram公式チャンネルで毎回の講義ノートを受け取るか、YouTubeチャンネルを登録して順番に学びましょう。</p>\n'
            '    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/koten_senseijutsu" target="_blank" rel="noopener">📲 Telegram 占星術・手相講座 (@koten_senseijutsu)</a>\n'
            '    <a class="btn" href="https://www.youtube.com/@SenseijutsuTesou" target="_blank" rel="noopener">▶️ YouTube (@SenseijutsuTesou)</a>\n'
            '  </div>\n'
            '  <p class="note" style="margin-top:1.75rem;">※自己省察と教養のためのコンテンツであり、医学的助言ではありません。動画・音声・解説テキストの一部にAIを使用しています。</p>'
        )
    }
}


def ensure_thumbnail(vid: str, local_src_path: str = None) -> str:
    vdir = os.path.join(REPO_DIR, "assets/video")
    os.makedirs(vdir, exist_ok=True)
    out_path = os.path.join(vdir, f"{vid}.jpg")
    cached_p = os.path.join(THUMBS_CACHE_DIR, f"{vid}.jpg")
    if not os.path.exists(out_path) or os.path.getsize(out_path) < 10000:
        if os.path.exists(cached_p) and os.path.getsize(cached_p) >= 10000:
            shutil.copyfile(cached_p, out_path)
        elif local_src_path and os.path.exists(local_src_path):
            shutil.copyfile(local_src_path, out_path)
        else:
            url = f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg"
            urllib.request.urlretrieve(url, out_path)
    return f"https://sorainfo.de/assets/video/{vid}.jpg"


def fmt_mmss(sec: int) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def sec_to_iso8601(sec: int) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    if h:
        return f"PT{h}H{m}M{s}S"
    if m:
        return f"PT{m}M{s}S"
    return f"PT{s}S"


def build_lang_switcher(active_lang: str, urls_by_lang: dict) -> str:
    labels = [
        ("DE", "🇩🇪 Deutsch"),
        ("EN", "🇬🇧 English"),
        ("ES", "🇪🇸 Español"),
        ("PT", "🇧🇷 Português"),
        ("JA", "🇯🇵 日本語"),
    ]
    items = []
    for code, label in labels:
        u = urls_by_lang.get(code, LANG_CFG[code]["hub_rel"])
        cls = ' class="active"' if code == active_lang else ''
        items.append(f'<a href="{u}"{cls}>{label}</a>')
    return '<div class="lang-bar" aria-label="Language selection">' + " ".join(items) + '</div>'


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
    in_language: str = "de",
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
        "uploadDate": f"{upload_date}T17:00:00+01:00" if "T" not in upload_date else upload_date,
        "duration": duration_iso,
        "embedUrl": embed_url,
        "contentUrl": content_url,
        "inLanguage": in_language,
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
        in_language="de",
        is_short=False
    )

    page_path = os.path.join(REPO_DIR, "artikel/muede-trotz-schlaf.html")
    with open(page_path, "r", encoding="utf-8") as fp:
        html = fp.read()

    if 'name="robots"' not in html:
        html = html.replace(
            '<link rel="canonical" href="https://sorainfo.de/artikel/muede-trotz-schlaf.html">',
            '<meta name="robots" content="max-image-preview:large">\n<link rel="canonical" href="https://sorainfo.de/artikel/muede-trotz-schlaf.html">'
        )

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
        "clips": clips,
        "mode": "preserved"
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
        in_language="de",
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

    cfg = LANG_CFG["DE"]
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
        "{{NAV_HTML}}": cfg["nav_html"],
        "{{LANG_SWITCHER_HTML}}": "",
        "{{KICKER}}": "Handlesen lernen · Video-Lektion · Teil 1",
        "{{H1}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt",
        "{{BYLINE}}": "Sora+ Psyche · 12. Oktober 2026 · Video (59 Sek.) + Begleittext (ca. 3 Min. Lesezeit)",
        "{{IFRAME_TITLE}}": "Handlesen lernen – Teil 1: Links geplant, rechts gelebt (Sora+ Psyche)",
        "{{FUNNEL_HEADING}}": "Direkt zum Mitmachen (zu Teil 1 der Serie):",
        "{{FUNNEL_TEXT}}": "Hol dir die kostenlose 6-seitige Einführung mit Übungszeichnungen im Telegram-Bot oder das komplette 31-Seiten-Arbeitsbuch zum Ausdrucken.",
        "{{FUNNEL_BUTTONS}}": funnel_buttons,
        "{{ARTICLE_BODY_HTML}}": article_body,
        "{{CHAPTERS_HEADING}}": cfg["chapters_heading"],
        "{{CHAPTERS_INTRO}}": "Alle Schritte aus Teil 1 (0:59 Min.) im Überblick – mit Klick auf die Zeitmarke springst du direkt zur Stelle im Video:",
        "{{CHAPTERS_LIST_HTML}}": chapters_html,
        "{{SERIES_HEADING}}": "Mehr aus der Serie",
        "{{SERIES_LINKS_HTML}}": series_links,
        "{{NOTES_AND_CTA_HTML}}": notes_and_cta,
        "{{FOOTER_DISCLAIMER}}": cfg["footer_disclaimer"],
        "{{FOOTER_LINKS_HTML}}": cfg["footer_links"]
    }
    for k, v in replacements.items():
        html = html.replace(k, v)

    out_path = os.path.join(REPO_DIR, "handlesen/teil-01.html")
    with open(out_path, "w", encoding="utf-8") as fp:
        fp.write(html)

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
        "clips": clips,
        "mode": "new"
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
        in_language="de",
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
<link rel="alternate" hreflang="pt" href="https://sorainfo.de/pt/horoscopo/">
<link rel="alternate" hreflang="ja" href="https://sorainfo.de/ja/horoscope/">"""

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
    <li><a href="/sternenpsychologie/lektion-1-1.html">Video-Kurs Lektion 1.1: Sternzeichen Widder erklärt – Charakter, Mars &amp; Gesicht</a></li>
    <li><a href="/sternenpsychologie/lektion-1-2.html">Video-Kurs Lektion 1.2: Sternzeichen Stier Charakter – Besitz, Tastsinn &amp; Venus</a></li>
    <li><a href="/sternenpsychologie/">Interaktiver Geburtsdaten-Kompass 2026–2027 &amp; alle 48 Lektionen</a></li>
    <li><a href="/handlesen/teil-01.html">Video-Lektion Handlesen · Teil 1: Links geplant, rechts gelebt</a></li>
""".strip()

    notes_and_cta = """
  <div class="cta">
    <p><strong>Prüfe dein genaues Geburtsdatum (TT.MM) für 2026–2027:</strong> Folge dem kostenlosen Telegram-Kurskanal (@astrologie_lernen) oder erhalte im offiziellen Telegram-Bot sofort dein kostenloses 3-seitiges PDF-Dossier.</p>
    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/astrologie_lernen" target="_blank" rel="noopener">📲 Telegram-Kurskanal (@astrologie_lernen)</a>
    <a class="btn" style="margin:0 .5rem .5rem 0" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Geburtsdatum im Telegram-Bot prüfen (@sternenpsychologie_bot)</a>
    <a class="btn" href="/downloads/Geburtsdaten_Kompass_2026_2027_Starter_DE.pdf">📄 Gratis Starter-Tabelle (PDF, 6 S.)</a>
  </div>

  <p class="note" style="margin-top:1.75rem;"><strong>Hinweis zur Tradition &amp; Ethik:</strong> Die Betrachtung von Sonnengraden und Tierkreispositionen beruht auf überlieferten Methoden der klassischen Astrologie und dient als strukturierte Reflexionshilfe zur achtsamen Selbstbeobachtung. Sie stellt keine wissenschaftlich gesicherte Vorhersage dar und ersetzt zu keinem Zeitpunkt eine medizinische, psychotherapeutische, finanzielle oder juristische Beratung.</p>
  <p class="note">Video, Stimme und Begleittext wurden unter Zuhilfenahme moderner KI-Systeme erstellt und redaktionell durch Sternenpsychologie · Sora+ Psyche geprüft.</p>
""".strip()

    funnel_buttons = """
      <a class="btn" style="padding:0.55rem 0.95rem;font-size:0.9rem;" href="https://t.me/astrologie_lernen" target="_blank" rel="noopener">📲 Telegram-Kurskanal (@astrologie_lernen)</a>
      <a class="btn-teal" href="https://t.me/sternenpsychologie_bot" target="_blank" rel="noopener">🔮 Gratis Geburtsdatum-Check im Bot (@sternenpsychologie_bot)</a>
      <a class="btn-outline" href="/downloads/Geburtsdaten_Kompass_2026_2027_Starter_DE.pdf">📄 Gratis Starter-Tabelle (6 S. PDF)</a>
      <a class="btn-outline" href="/sternenpsychologie/">📋 Alle 48 Lektionen &amp; Tabelle</a>
""".strip()

    cfg = LANG_CFG["DE"]
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
        "{{NAV_HTML}}": cfg["nav_html"],
        "{{LANG_SWITCHER_HTML}}": build_lang_switcher("DE", {}),
        "{{KICKER}}": "Sternenpsychologie · Video-Analyse nach Geburtsdatum",
        "{{H1}}": "Venus im Skorpion &amp; Merkur rückläufig: Horoskop nach Geburtsdatum",
        "{{BYLINE}}": "Sternenpsychologie · 19. Oktober 2026 · Video (10:29 Min.) + Begleittext (ca. 4 Min. Lesezeit)",
        "{{IFRAME_TITLE}}": "Venus im Skorpion & Merkur rückläufig: Horoskop 19.–31. Oktober 2026 nach Geburtsdatum",
        "{{FUNNEL_HEADING}}": "Direkt starten (passend zum Video):",
        "{{FUNNEL_TEXT}}": "Tritt dem Telegram-Kurskanal bei, prüfe dein Geburtsdatum (TT.MM) kostenlos im Bot oder lade die 6-seitige Starter-Tabelle als PDF herunter.",
        "{{FUNNEL_BUTTONS}}": funnel_buttons,
        "{{ARTICLE_BODY_HTML}}": article_body,
        "{{CHAPTERS_HEADING}}": cfg["chapters_heading"],
        "{{CHAPTERS_INTRO}}": "Alle 10 Kapitel des Videos (10:29 Min.) mit direktem Sprung zum jeweiligen Geburtsdatum:",
        "{{CHAPTERS_LIST_HTML}}": chapters_html,
        "{{SERIES_HEADING}}": "Mehr aus der Serie",
        "{{SERIES_LINKS_HTML}}": series_links,
        "{{NOTES_AND_CTA_HTML}}": notes_and_cta,
        "{{FOOTER_DISCLAIMER}}": cfg["footer_disclaimer"],
        "{{FOOTER_LINKS_HTML}}": cfg["footer_links"]
    }
    for k, v in replacements.items():
        html = html.replace(k, v)

    out_path = os.path.join(REPO_DIR, f"sternenpsychologie/{slug}")
    with open(out_path, "w", encoding="utf-8") as fp:
        fp.write(html)

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
        "clips": clips,
        "mode": "new"
    }


def build_course_prose(lesson_entry: dict, lang: str) -> str:
    d = lesson_entry["langs"][lang]
    clips = d["clips"]
    blocks = d["srt_blocks"]
    desc_lines = [x.strip() for x in d["desc"].splitlines() if x.strip()]
    lede = xml_escape(" ".join(desc_lines[:2]))

    ch_texts = []
    for ci, c in enumerate(clips):
        st, et = c["start"], c["end"]
        b_txts = [b["t"] for b in blocks if st <= b["s"] < et]
        if not b_txts and ci == len(clips) - 1:
            b_txts = [b["t"] for b in blocks if b["s"] >= st]
        ch_texts.append((c["name"], " ".join(b_txts)))

    if lang != "JA":
        lede_words = len(lede.split())
        target_body_words = 480 - lede_words
        total_raw_words = sum(len(t.split()) for _, t in ch_texts)
        ratio = min(1.0, max(0.35, target_body_words / max(1, total_raw_words)))
        html_parts = [f'  <p class="lede">{lede}</p>']
        for cname, ctext in ch_texts:
            if not ctext.strip():
                continue
            words = ctext.split()
            keep_n = max(35, int(len(words) * ratio))
            sub = " ".join(words[:keep_n])
            m = re.search(r"^(.+[.!?])", sub)
            if m and len(m.group(1).split()) >= 25:
                sub = m.group(1)
            elif not sub.endswith((".", "!", "?")):
                sub += "."
            html_parts.append(f"  <h2>{xml_escape(cname)}</h2>\n  <p>{xml_escape(sub)}</p>")
        body_html = "\n\n".join(html_parts)
        wc = len(re.sub(r"<[^>]+>", " ", body_html).split())
        if wc < 415 and total_raw_words > wc:
            need = 455 - wc
            last_words = ch_texts[-1][1].split()[-need - 15:]
            extra_p = xml_escape(" ".join(last_words))
            html_parts.append(f"  <p>{extra_p}</p>")
            body_html = "\n\n".join(html_parts)
        elif wc > 585:
            # Trim paragraphs from the end until wc <= 575
            while len(html_parts) > 2:
                excess = len(re.sub(r"<[^>]+>", " ", "\n\n".join(html_parts)).split()) - 550
                if excess <= 0:
                    break
                last_blk = html_parts[-1]
                pm = re.search(r"(<h2[^>]*>.*?</h2>\s*<p>)(.*)(</p>)", last_blk, re.S)
                if pm:
                    pwords = pm.group(2).split()
                    if len(pwords) - excess >= 25:
                        new_p = " ".join(pwords[:len(pwords) - excess])
                        if not new_p.endswith((".", "!", "?")):
                            new_p += "."
                        html_parts[-1] = pm.group(1) + new_p + pm.group(3)
                        break
                    else:
                        html_parts[-1] = pm.group(1) + " ".join(pwords[:25]) + "." + pm.group(3)
                break
            body_html = "\n\n".join(html_parts)
        return body_html
    else:
        html_parts = [f'  <p class="lede">{lede}</p>']
        for cname, ctext in ch_texts:
            if not ctext.strip():
                continue
            sub = ctext[:260]
            if "。" in sub:
                sub = sub[:sub.rfind("。") + 1]
            html_parts.append(f"  <h2>{xml_escape(cname)}</h2>\n  <p>{xml_escape(sub)}</p>")
        return "\n\n".join(html_parts)


def build_course_watch_pages(course_src: list, template: str, max_lesson_idx: int = 2) -> list:
    built = []
    selected = course_src[:max_lesson_idx]

    for entry in selected:
        slug_num = entry["slug_num"]
        num_str = entry["num"]
        idx = entry["index"]

        # Map URLs across all 5 languages for hreflang and language switcher
        urls_rel = {}
        urls_abs = {}
        for l_code, cfg in LANG_CFG.items():
            fname = f"{cfg['slug_prefix']}-{slug_num}.html"
            urls_rel[l_code] = f"/{cfg['dir']}/{fname}"
            urls_abs[l_code] = f"https://sorainfo.de/{cfg['dir']}/{fname}"

        hreflang_block = "\n".join([
            f'<link rel="alternate" hreflang="{LANG_CFG[lc]["html_lang"]}" href="{urls_abs[lc]}">'
            for lc in ["DE", "EN", "ES", "PT", "JA"]
        ] + [f'<link rel="alternate" hreflang="x-default" href="{urls_abs["EN"]}">'])

        for l_code, cfg in LANG_CFG.items():
            os.makedirs(os.path.join(REPO_DIR, cfg["dir"]), exist_ok=True)
            d = entry["langs"][l_code]
            vid = d["video_id"]
            thumb_url = ensure_thumbnail(vid, d.get("thumb_path"))
            canonical = urls_abs[l_code]
            rel_page = f"{cfg['dir']}/{cfg['slug_prefix']}-{slug_num}.html"
            dur_s = int(d["duration_s"])
            dur_iso = sec_to_iso8601(dur_s)
            clips = d["clips"]
            desc_first2 = " ".join([x.strip() for x in d["desc"].splitlines() if x.strip()][:2])

            video_ld = build_video_jsonld(
                name=d["title"],
                description=desc_first2,
                thumbnail_url=thumb_url,
                upload_date=d["publish_date"],
                duration_iso=dur_iso,
                video_id=vid,
                canonical_url=canonical,
                clips=clips,
                in_language=cfg["in_lang"],
                is_short=False
            )
            breadcrumb_ld = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Sora+ Psyche", "item": "https://sorainfo.de/"},
                    {"@type": "ListItem", "position": 2, "name": cfg["site_name"], "item": cfg["hub_url"]},
                    {"@type": "ListItem", "position": 3, "name": d["title"], "item": canonical}
                ]
            }

            body_html = build_course_prose(entry, l_code)
            chapters_html = "\n".join(
                f'    <li><a href="https://www.youtube.com/watch?v={vid}&amp;t={c["start"]}s">{fmt_mmss(c["start"])} · {xml_escape(c["name"])}</a></li>'
                for c in clips
            )

            # Series links: link to hub + prev/next lessons
            s_links = [f'    <li><a href="{cfg["hub_rel"]}"><strong>{cfg["hub_link_label"]}</strong></a></li>']
            for other in selected:
                if other["index"] == idx:
                    continue
                o_rel = f"/{cfg['dir']}/{cfg['slug_prefix']}-{other['slug_num']}.html"
                o_title = xml_escape(other["langs"][l_code]["title"])
                s_links.append(f'    <li><a href="{o_rel}">{o_title}</a></li>')

            funnel_btns = (
                f'      <a class="btn" style="padding:0.55rem 0.95rem;font-size:0.9rem;" href="{cfg["tg_channel_url"]}" target="_blank" rel="noopener">{cfg["tg_channel_label"]}</a>\n'
                f'      <a class="btn-teal" href="{cfg["tg_bot_url"]}" target="_blank" rel="noopener">{cfg["tg_bot_label"]}</a>\n'
                f'      <a class="btn-outline" href="{cfg["yt_url"]}" target="_blank" rel="noopener">▶️ YouTube ({cfg["yt_handle"]})</a>\n'
                f'      <a class="btn-outline" href="{cfg["hub_rel"]}">📋 48 Lessons</a>'
            )

            kicker = f"{cfg['kicker_prefix']} {num_str}" if l_code != "JA" else f"占星術と手相を学ぶ · 動画講座 · 第{num_str}回"
            byline = f"{cfg['byline_prefix']} · {d['publish_date']} · {fmt_mmss(dur_s)}"

            html = template
            replacements = {
                "{{LANG}}": cfg["html_lang"],
                "{{PAGE_TITLE}}": xml_escape(d["title"]),
                "{{OG_TITLE}}": xml_escape(d["title"]),
                "{{META_DESCRIPTION}}": xml_escape(desc_first2[:260]),
                "{{CANONICAL_URL}}": canonical,
                "{{HREFLANG_LINKS}}": hreflang_block,
                "{{THUMBNAIL_URL}}": thumb_url,
                "{{THUMBNAIL_WIDTH}}": "1280",
                "{{THUMBNAIL_HEIGHT}}": "720",
                "{{EMBED_URL}}": f"https://www.youtube-nocookie.com/embed/{vid}",
                "{{SITE_NAME}}": cfg["site_name"],
                "{{VIDEO_JSON_LD}}": json.dumps(video_ld, ensure_ascii=False, indent=2),
                "{{BREADCRUMB_JSON_LD}}": json.dumps(breadcrumb_ld, ensure_ascii=False, indent=2),
                "{{NAV_HTML}}": cfg["nav_html"],
                "{{LANG_SWITCHER_HTML}}": build_lang_switcher(l_code, urls_rel),
                "{{KICKER}}": kicker,
                "{{H1}}": xml_escape(d["title"]),
                "{{BYLINE}}": byline,
                "{{IFRAME_TITLE}}": xml_escape(d["title"]),
                "{{FUNNEL_HEADING}}": cfg["funnel_heading"],
                "{{FUNNEL_TEXT}}": cfg["funnel_text"],
                "{{FUNNEL_BUTTONS}}": funnel_btns,
                "{{ARTICLE_BODY_HTML}}": body_html,
                "{{CHAPTERS_HEADING}}": cfg["chapters_heading"],
                "{{CHAPTERS_INTRO}}": cfg["chapters_intro"],
                "{{CHAPTERS_LIST_HTML}}": chapters_html,
                "{{SERIES_HEADING}}": cfg["series_heading"],
                "{{SERIES_LINKS_HTML}}": "\n".join(s_links),
                "{{NOTES_AND_CTA_HTML}}": cfg["notes_html"],
                "{{FOOTER_DISCLAIMER}}": cfg["footer_disclaimer"],
                "{{FOOTER_LINKS_HTML}}": cfg["footer_links"]
            }
            for k, v in replacements.items():
                html = html.replace(k, v)

            out_path = os.path.join(REPO_DIR, rel_page)
            with open(out_path, "w", encoding="utf-8") as fp:
                fp.write(html)

            built.append({
                "page": rel_page,
                "loc": canonical,
                "video_id": vid,
                "title": d["title"],
                "description": desc_first2,
                "thumbnail_loc": thumb_url,
                "player_loc": f"https://www.youtube-nocookie.com/embed/{vid}",
                "content_loc": f"https://www.youtube.com/watch?v={vid}",
                "duration": dur_s,
                "publication_date": d["publish_date"],
                "clips": clips,
                "mode": "new",
                "lang": l_code
            })
    return built


def build_course_section_html(course_src: list, l_code: str, max_lesson_idx: int) -> str:
    cfg = LANG_CFG[l_code]
    cards = []
    for entry in course_src[:max_lesson_idx]:
        d = entry["langs"][l_code]
        rel_u = f"/{cfg['dir']}/{cfg['slug_prefix']}-{entry['slug_num']}.html"
        desc_short = xml_escape(" ".join([x.strip() for x in d["desc"].splitlines() if x.strip()][:1]))
        cards.append(
            f'<div class="hz-card" style="border:1px solid rgba(201,162,79,.45);border-radius:14px;padding:14px 16px;margin:12px 0;background:rgba(201,162,79,.06);">'
            f'<h3 style="margin:0 0 6px;"><a href="{rel_u}" style="text-decoration:none;">🎬 {xml_escape(d["title"])}</a></h3>'
            f'<p style="margin:0 0 10px;font-size:0.93em;">{desc_short}</p>'
            f'<a class="btn" style="display:inline-block;padding:0.45rem 0.9rem;font-size:0.88rem;" href="{rel_u}">{cfg["watch_btn_label"]}</a>'
            f'</div>'
        )

    rows = []
    for entry in course_src:
        d = entry["langs"][l_code]
        idx = entry["index"]
        if idx <= max_lesson_idx:
            rel_u = f"/{cfg['dir']}/{cfg['slug_prefix']}-{entry['slug_num']}.html"
            link_cell = f'<a href="{rel_u}" style="font-weight:600;">{xml_escape(d["title"])} →</a>'
        else:
            link_cell = f'{xml_escape(d["title"])} <span style="opacity:0.7;font-size:0.86em;">({cfg["sched_label"]}: {d["publish_date"]})</span>'
        rows.append(f'<tr><td style="white-space:nowrap;"><strong>{entry["num"]}</strong></td><td>{link_cell}</td></tr>')

    return f"""
  <!-- COURSE_HUB_SECTION_START -->
  <section id="course-48" style="margin:1.75rem 0 2.25rem;padding:1.25rem;border:1px solid var(--line, rgba(201,162,79,.4));border-radius:14px;background:var(--surface, rgba(201,162,79,.04));">
    <h2 style="margin-top:0;">🎓 {cfg["course_sec_title"]}</h2>
    <p>{cfg["course_sec_intro"]}</p>
    <div style="margin:0.85rem 0 1.15rem;display:flex;flex-wrap:wrap;gap:0.6rem;">
      <a class="btn" href="{cfg['tg_channel_url']}" target="_blank" rel="noopener">{cfg['tg_channel_label']}</a>
      <a class="btn" href="{cfg['yt_url']}" target="_blank" rel="noopener">▶️ YouTube ({cfg['yt_handle']})</a>
    </div>
    {"".join(cards)}
    <details style="margin-top:1rem;">
      <summary style="cursor:pointer;font-weight:600;padding:0.4rem 0;">📋 Alle 48 Lektionen im Überblick / Full 48-Lesson Syllabus (1.1 – 4.15)</summary>
      <div class="hz-wrap" style="overflow-x:auto;margin-top:0.75rem;">
        <table class="hz-tbl" style="width:100%;border-collapse:collapse;font-size:0.92em;">
          <tbody>
            {"".join(rows)}
          </tbody>
        </table>
      </div>
    </details>
  </section>
  <!-- COURSE_HUB_SECTION_END -->"""


def update_all_5_language_hubs(course_src: list, max_lesson_idx: int):
    # Ensure ja/horoscope/index.html exists from DeepSeek draft
    ja_dir = os.path.join(REPO_DIR, "ja/horoscope")
    os.makedirs(ja_dir, exist_ok=True)
    ja_idx = os.path.join(ja_dir, "index.html")
    if os.path.exists(JA_DRAFT_PATH):
        shutil.copyfile(JA_DRAFT_PATH, ja_idx)

    # Also create /ja/index.html redirecting/linking cleanly to /ja/horoscope/
    ja_root_idx = os.path.join(REPO_DIR, "ja/index.html")
    if os.path.exists(ja_idx):
        shutil.copyfile(ja_idx, ja_root_idx)

    hub_files = [
        ("DE", os.path.join(REPO_DIR, "sternenpsychologie/index.html")),
        ("DE", os.path.join(REPO_DIR, "sternenpsychologie/geburtsdaten-2026-2027.html")),
        ("EN", os.path.join(REPO_DIR, "en/horoscope/index.html")),
        ("ES", os.path.join(REPO_DIR, "es/horoscopo/index.html")),
        ("PT", os.path.join(REPO_DIR, "pt/horoscopo/index.html")),
        ("JA", ja_idx),
    ]

    for l_code, fpath in hub_files:
        if not os.path.exists(fpath):
            continue
        with open(fpath, "r", encoding="utf-8") as fp:
            html = fp.read()

        cfg = LANG_CFG[l_code]

        # 1. Fix canonical URL on sternenpsychologie/index.html to self-referencing https://sorainfo.de/sternenpsychologie/
        if fpath.endswith("sternenpsychologie/index.html"):
            html = html.replace(
                '<link rel="canonical" href="https://sorainfo.de/sternenpsychologie/geburtsdaten-2026-2027.html">',
                '<link rel="canonical" href="https://sorainfo.de/sternenpsychologie/">'
            )
            html = html.replace(
                '<meta property="og:url" content="https://sorainfo.de/sternenpsychologie/geburtsdaten-2026-2027.html">',
                '<meta property="og:url" content="https://sorainfo.de/sternenpsychologie/">'
            )

        # 2. Ensure hreflang="ja" is present in <head>
        if 'hreflang="ja"' not in html:
            html = html.replace(
                '<link rel="alternate" hreflang="pt" href="https://sorainfo.de/pt/horoscopo/">',
                '<link rel="alternate" hreflang="pt" href="https://sorainfo.de/pt/horoscopo/">\n'
                '<link rel="alternate" hreflang="ja" href="https://sorainfo.de/ja/horoscope/">'
            )

        # 3. Fix /ja/face-reading/ placeholder on JA hub
        if l_code == "JA":
            html = html.replace('href="/ja/face-reading/"', 'href="/ja/horoscope/lesson-1-1.html"')
            html = html.replace('👁 手相鑑定', '🎬 第1課を見る')
            html = html.replace('👁 自撮りで無料の手相鑑定', '🎬 第1課：牡羊座と火星（動画講義）')

        # 4. Inject 5-language switcher bar at the top of <article>
        html = re.sub(r'\s*<!-- LANG_BAR_START -->.*?<!-- LANG_BAR_END -->', '', html, flags=re.S)
        lang_bar_html = (
            '\n  <!-- LANG_BAR_START -->\n'
            '  <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin:0 0 1rem;font-size:0.85rem;">\n'
            f'    <a href="/sternenpsychologie/" style="padding:0.25rem 0.65rem;border-radius:999px;border:1px solid rgba(201,162,79,.5);text-decoration:none;{"font-weight:700;background:#c9a24f;color:#151a3a;" if l_code=="DE" else ""}">🇩🇪 Deutsch</a>\n'
            f'    <a href="/en/horoscope/" style="padding:0.25rem 0.65rem;border-radius:999px;border:1px solid rgba(201,162,79,.5);text-decoration:none;{"font-weight:700;background:#c9a24f;color:#151a3a;" if l_code=="EN" else ""}">🇬🇧 English</a>\n'
            f'    <a href="/es/horoscopo/" style="padding:0.25rem 0.65rem;border-radius:999px;border:1px solid rgba(201,162,79,.5);text-decoration:none;{"font-weight:700;background:#c9a24f;color:#151a3a;" if l_code=="ES" else ""}">🇪🇸 Español</a>\n'
            f'    <a href="/pt/horoscopo/" style="padding:0.25rem 0.65rem;border-radius:999px;border:1px solid rgba(201,162,79,.5);text-decoration:none;{"font-weight:700;background:#c9a24f;color:#151a3a;" if l_code=="PT" else ""}">🇧🇷 Português</a>\n'
            f'    <a href="/ja/horoscope/" style="padding:0.25rem 0.65rem;border-radius:999px;border:1px solid rgba(201,162,79,.5);text-decoration:none;{"font-weight:700;background:#c9a24f;color:#151a3a;" if l_code=="JA" else ""}">🇯🇵 日本語</a>\n'
            '  </div>\n'
            '  <!-- LANG_BAR_END -->'
        )
        html = re.sub(r'(<article[^>]*>)', r'\1' + lang_bar_html, html, count=1)

        # 5. Ensure Telegram Course Channel button is in .hz-cta on EN/ES/PT
        if l_code in ("EN", "ES", "PT") and cfg["tg_channel_url"] not in html:
            html = html.replace(
                '<div class="hz-cta">',
                f'<div class="hz-cta"><a class="main" href="{cfg["tg_channel_url"]}">{cfg["tg_channel_label"]}</a>',
                1
            )

        # 6. Inject 48-Lesson Course Section right after </header> inside <article>
        html = re.sub(r'\s*<!-- COURSE_HUB_SECTION_START -->.*?<!-- COURSE_HUB_SECTION_END -->', '', html, flags=re.S)
        c_sec = build_course_section_html(course_src, l_code, max_lesson_idx)
        # Find the first </header> inside <article>
        art_pos = html.find("<article")
        hdr_close = html.find("</header>", art_pos)
        if hdr_close != -1:
            insert_at = hdr_close + len("</header>")
            html = html[:insert_at] + c_sec + html[insert_at:]

        with open(fpath, "w", encoding="utf-8") as fp:
            fp.write(html)


def update_sitemaps(watch_entries: list):
    sitemap_path = os.path.join(REPO_DIR, "sitemap.xml")
    with open(sitemap_path, "r", encoding="utf-8") as fp:
        sm = fp.read()

    # Strip any legacy/broken <video:video>...</video:video> blocks from all existing <url> entries first
    sm = re.sub(r'\s*<video:video>.*?</video:video>', '', sm, flags=re.S)

    # Ensure /ja/horoscope/ is in sitemap.xml
    ja_hub_loc = "https://sorainfo.de/ja/horoscope/"
    if ja_hub_loc not in sm:
        ja_block = f"""  <url>
    <loc>{ja_hub_loc}</loc>
    <lastmod>2026-11-08</lastmod>
    <priority>0.9</priority>
  </url>
</urlset>"""
        sm = sm.replace("</urlset>", ja_block)

    for p in watch_entries:
        sm = re.sub(
            rf'\s*<url>\s*<loc>{re.escape(p["loc"])}</loc>.*?</url>',
            '',
            sm,
            flags=re.S
        )
        new_url_block = f"""  <url>
    <loc>{p['loc']}</loc>
    <lastmod>2026-11-08</lastmod>
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

    vsm_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'
    ]
    for p in watch_entries:
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


def clean_private_videos():
    # 1. artikel/nur-die-angst-song-ueber-angst-nachts.html (dsNhpb2ivUk, KMNpPaRY1mo are private)
    p1 = os.path.join(REPO_DIR, "artikel/nur-die-angst-song-ueber-angst-nachts.html")
    if os.path.exists(p1):
        h = open(p1, encoding="utf-8").read()
        h = re.sub(r',\s*"video":\s*\{\s*"@type":\s*"VideoObject".*?\n\s*\}', '', h, flags=re.S)
        h = re.sub(r'\s*<div class="video-embed">\s*<iframe[^>]*dsNhpb2ivUk[^>]*></iframe>\s*</div>', '', h, flags=re.S)
        h = re.sub(r'\s*<p><a href="https://youtu\.be/dsNhpb2ivUk">.*?</a></p>', '', h, flags=re.S)
        h = h.replace(' und als <a href="https://youtube.com/shorts/KMNpPaRY1mo">Shorts auf YouTube</a>', '')
        open(p1, "w", encoding="utf-8").write(h)

    # 2. artikel/warum-ich-nichts-sage.html (UyJvDJCeOG0 is private; C0FKLQ_-2Vk is the public Folge 2 video)
    p2 = os.path.join(REPO_DIR, "artikel/warum-ich-nichts-sage.html")
    if os.path.exists(p2):
        h = open(p2, encoding="utf-8").read()
        h = re.sub(r',\s*"video":\s*\{\s*"@type":\s*"VideoObject".*?\n\s*\}', '', h, flags=re.S)
        h = re.sub(r'\s*<a class="video-embed video-facade" href="https://youtu\.be/UyJvDJCeOG0".*?</a>', '', h, flags=re.S)
        h = h.replace('https://youtu.be/UyJvDJCeOG0?utm_source=blog&amp;utm_medium=article&amp;utm_campaign=einsam_unter_menschen', 'https://www.youtube.com/watch?v=C0FKLQ_-2Vk')
        open(p2, "w", encoding="utf-8").write(h)

    # 3. artikel/einschlafgeschichte-einsam-unter-menschen.html (replace UyJvDJCeOG0 link with public C0FKLQ_-2Vk)
    p3 = os.path.join(REPO_DIR, "artikel/einschlafgeschichte-einsam-unter-menschen.html")
    if os.path.exists(p3):
        h = open(p3, encoding="utf-8").read()
        h = h.replace('https://www.youtube.com/watch?v=UyJvDJCeOG0', 'https://www.youtube.com/watch?v=C0FKLQ_-2Vk')
        open(p3, "w", encoding="utf-8").write(h)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-lesson", type=int, default=2, help="Number of course lessons (1..48) to build watch pages for")
    args = parser.parse_args()

    clean_private_videos()

    with open(INVENTORY_PATH, "r", encoding="utf-8") as fp:
        inv = json.load(fp)
    with open(COURSE_SRC_PATH, "r", encoding="utf-8") as fp:
        course_src = json.load(fp)
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as fp:
        template = fp.read()

    p1 = update_muede_trotz_schlaf(inv)
    p2 = build_handlesen_teil_01(inv, template)
    p3 = build_sternen_pilot(inv, template)
    course_pages = build_course_watch_pages(course_src, template, max_lesson_idx=args.max_lesson)

    all_entries = [p1, p2, p3] + course_pages
    update_all_5_language_hubs(course_src, max_lesson_idx=args.max_lesson)
    update_sitemaps(all_entries)

    for p in all_entries:
        print(f"Built watch page: {p['page']} -> video={p['video_id']} ({p['duration']}s, {len(p['clips'])} clips)")
    print(f"Updated 5 language hubs, sitemap.xml, and video-sitemap.xml ({len(all_entries)} watch pages)")


if __name__ == "__main__":
    main()
