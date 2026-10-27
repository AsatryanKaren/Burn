#!/usr/bin/env python3
"""Static site generator.

Renders every page in every language from Jinja2 templates, the i18n string
files and the Markdown legal content into ../public. Run from anywhere:

    python3 site/build.py

The output in public/ is what Vercel serves. No other build step exists.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

import markdown
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from markupsafe import Markup

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "public"

CONFIG = json.loads((ROOT / "config" / "site.json").read_text(encoding="utf-8"))
LANGS = CONFIG["languages"]
DEFAULT = CONFIG["default_language"]
STRINGS = {l: json.loads((ROOT / "i18n" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}

# page key -> (template, url slug). Slug "" is the home page.
PAGES = {
    "home": ("home.html", ""),
    "burn": ("burn.html", "burn"),
    "paper": ("paper.html", "p"),
    "live": ("live.html", "live"),
    "gifts": ("gifts.html", "gifts"),
    "lights": ("lights.html", "lights"),
    "faq": ("faq.html", "faq"),
    "terms": ("legal.html", "terms"),
    "refund": ("legal.html", "refund"),
    "privacy": ("legal.html", "privacy"),
    "delivery": ("legal.html", "delivery"),
    "contact": ("legal.html", "contact"),
}
LEGAL = ["terms", "refund", "privacy", "delivery", "contact"]


def lookup(strings: dict, key: str):
    node = strings
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"missing i18n key: {key}")
        node = node[part]
    return node


def fmt_int(n: int, lang: str) -> str:
    sep = "," if lang == "en" else " "
    return f"{int(n):,}".replace(",", sep)


def price(n: int, lang: str) -> str:
    return f"{fmt_int(n, lang)} {CONFIG['currency_symbol']}"


def gift_share(amount: int) -> int:
    return amount * CONFIG["gift_share_percent"] // 100


def page_url(page: str, lang: str) -> str:
    slug = PAGES[page][1]
    prefix = "/" if lang == DEFAULT else f"/{lang}/"
    return prefix + (slug + "/" if slug else "")


def fill_placeholders(text: str, lang: str) -> str:
    company = CONFIG["company"]

    def rep(m: re.Match) -> str:
        key = m.group(1).strip()
        if key.startswith("company."):
            return str(company.get(key.split(".", 1)[1], m.group(0)))
        if key == "brand.name":
            return CONFIG["brand"]["name"][lang]
        if key == "domain":
            return CONFIG["domain"]
        return m.group(0)

    return re.sub(r"\{\{\s*([a-z_.]+)\s*\}\}", rep, text)


def asset_hashes() -> dict:
    hashes = {}
    for p in (ROOT / "assets").rglob("*"):
        if p.is_file():
            rel = p.relative_to(ROOT / "assets").as_posix()
            hashes[rel] = hashlib.sha256(p.read_bytes()).hexdigest()[:10]
    return hashes


def make_env(lang: str, hashes: dict) -> Environment:
    env = Environment(loader=FileSystemLoader(ROOT / "templates"), undefined=StrictUndefined, autoescape=True,
                      trim_blocks=True, lstrip_blocks=True)
    s = STRINGS[lang]
    cfg = CONFIG
    vars_common = {
        "year": cfg["year"], "next": cfg["next_year"], "pct": cfg["gift_share_percent"],
        "start": int(cfg["stream"]["start"][-2:]), "end": int(cfg["stream"]["end"][-2:]),
        "price": price(cfg["products"][0]["price"], lang),
        "amount": price(gift_share(cfg["products"][0]["price"]), lang),
    }

    def t(key: str, **kw):
        val = lookup(s, key)
        if isinstance(val, str):
            data = {**vars_common, **kw}
            val = re.sub(r"\{(\w+)\}", lambda m: str(data.get(m.group(1), m.group(0))), val)
            return Markup(val)  # i18n strings are trusted, authored content (may contain <b>, <a>)
        return val

    env.globals.update(
        t=t, cfg=cfg, lang=lang, langs=LANGS, s=s,
        url=lambda page, l=lang: page_url(page, l),
        price=lambda n: price(n, lang), fmt=lambda n: fmt_int(n, lang), gift_share=gift_share,
        asset=lambda rel: f"/assets/{rel}?v={hashes.get(rel, '0')}",
        brand=cfg["brand"]["name"][lang],
        today=date.today().isoformat(),
        faq_ld=lambda items: [{"@type": "Question", "name": i["q"], "acceptedAnswer": {"@type": "Answer", "text": i["a"]}} for i in items],
    )
    return env


def js_payload(lang: str, page: str) -> str:
    s = STRINGS[lang]
    payload = {
        "lang": lang, "page": page, "locale": s["locale"],
        "year": CONFIG["year"], "next": CONFIG["next_year"],
        "brand": CONFIG["brand"]["name"][lang],
        "paymentsOpen": CONFIG["payments_open"],
        "giftPct": CONFIG["gift_share_percent"],
        "showCounterFrom": CONFIG["show_counter_from"],
        "products": CONFIG["products"],
        "lightProducts": CONFIG["light_products"],
        "supabase": CONFIG["supabase"],
        "urls": {k: page_url(k, lang) for k in PAGES},
        "t": {k: s[k] for k in ("hero", "burn", "paper", "story", "live", "feed", "gifts", "gifts_page", "nav", "common", "lights")},
    }
    # Escape so the JSON can't break out of the <script> element.
    return json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")


def render_markdown(path: Path, lang: str) -> tuple[str, Markup]:
    raw = fill_placeholders(path.read_text(encoding="utf-8"), lang)
    lines = raw.strip().splitlines()
    title = lines[0].lstrip("# ").strip() if lines and lines[0].startswith("#") else ""
    body = "\n".join(lines[1:]) if title else raw
    html_body = markdown.markdown(body, extensions=["extra", "sane_lists"], output_format="html")
    return title, Markup(html_body)


def build() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "assets", OUT / "assets")
    hashes = asset_hashes()
    missing_content = []

    for lang in LANGS:
        env = make_env(lang, hashes)
        faq_path = ROOT / "content" / f"faq.{lang}.json"
        faq = json.loads(faq_path.read_text(encoding="utf-8")) if faq_path.exists() else []
        if not faq:
            missing_content.append(faq_path.name)
        for page, (tpl, slug) in PAGES.items():
            ctx = {"page": page, "payload": Markup(js_payload(lang, page)), "faq": faq,
                   "alternates": {l: page_url(page, l) for l in LANGS}}
            if page in LEGAL:
                md = ROOT / "content" / "legal" / f"{page}.{lang}.md"
                if md.exists():
                    ctx["legal_title"], ctx["legal_html"] = render_markdown(md, lang)
                else:
                    missing_content.append(md.name)
                    ctx["legal_title"], ctx["legal_html"] = lookup(STRINGS[lang], f"footer.{page}"), Markup("")
            out_html = env.get_template(tpl).render(**ctx)
            dest = OUT / (page_url(page, lang).lstrip("/")) / "index.html"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(out_html, encoding="utf-8")
        # Language-specific 404 lives at /{lang}/404/ for linking; Vercel uses /404.html (default language).
        nf = make_env(lang, hashes).get_template("404.html").render(
            page="notfound", payload=Markup(js_payload(lang, "notfound")), faq=[],
            alternates={l: page_url("home", l) for l in LANGS})
        if lang == DEFAULT:
            (OUT / "404.html").write_text(nf, encoding="utf-8")

    # Private admin page (English only, not linked anywhere, noindex).
    env = make_env("en", hashes)
    admin = env.get_template("admin.html").render(page="admin", payload=Markup(js_payload("en", "admin")))
    (OUT / "admin").mkdir(parents=True, exist_ok=True)
    (OUT / "admin" / "index.html").write_text(admin, encoding="utf-8")

    # robots + sitemap
    base = CONFIG["site_url"].rstrip("/")
    urls = []
    for page in PAGES:
        if page == "paper":
            continue
        for lang in LANGS:
            alts = "".join(
                f'<xhtml:link rel="alternate" hreflang="{l}" href="{base}{page_url(page, l)}"/>' for l in LANGS)
            urls.append(f"<url><loc>{base}{page_url(page, lang)}</loc>{alts}</url>")
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">' + "".join(urls) + "</urlset>\n", encoding="utf-8")
    (OUT / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nDisallow: /p/\nDisallow: /en/p/\nDisallow: /ru/p/\nDisallow: /admin/\nSitemap: {base}/sitemap.xml\n",
        encoding="utf-8")
    manifest = {
        "name": CONFIG["brand"]["name"][DEFAULT], "short_name": CONFIG["brand"]["name"][DEFAULT],
        "start_url": "/", "display": "standalone", "background_color": "#04060d", "theme_color": "#04060d",
        "icons": [{"src": "/assets/img/icon.svg", "sizes": "any", "type": "image/svg+xml"}],
    }
    (OUT / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    if missing_content:
        print("WARNING: missing content files:", ", ".join(sorted(set(missing_content))), file=sys.stderr)
    count = sum(1 for _ in OUT.rglob("index.html"))
    print(f"Built {count} pages into {OUT}")


if __name__ == "__main__":
    build()
