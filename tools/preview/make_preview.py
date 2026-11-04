"""Build a self-contained preview of public/ with relative links and a pretend backend (mock-api.js),
so the whole site can be clicked through as a multi-file artifact.  Usage: python3 tools/preview/make_preview.py OUTDIR"""
import hashlib, json, os, posixpath, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUB, HERE = ROOT / "public", Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/preview")
SKIP = {"vercel.json", "_headers"}

def rel(page_dir, url):
    """'/map/?x#y' seen from page_dir -> 'map/index.html?x#y' style relative path."""
    m = re.match(r"^/([^?#]*)([?#].*)?$", url)
    if not m:
        return url
    path, tail = m.group(1), m.group(2) or ""
    if path == "" or path.endswith("/"):
        path += "index.html"
    r = posixpath.relpath(path, page_dir or ".")
    return r + tail

if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(PUB, OUT, ignore=shutil.ignore_patterns(*SKIP))
shutil.copy(HERE / "mock-api.js", OUT / "assets/js/mock-api.js")
(OUT / "preview-bank").mkdir(exist_ok=True)
shutil.copy(HERE / "bank.html", OUT / "preview-bank/index.html")
mockv = hashlib.md5((HERE / "mock-api.js").read_bytes()).hexdigest()[:10]

for f in OUT.rglob("*.html"):
    page_dir = posixpath.dirname(f.relative_to(OUT).as_posix())
    s = f.read_text(encoding="utf-8")
    s = re.sub(r'((?:href|src|action|data-[a-z]+)=")(/[^"/][^"]*|/)(")', lambda m: m.group(1) + rel(page_dir, m.group(2)) + m.group(3), s)
    s = re.sub(r'(content="\d+; url=)(/[^"]*)(")', lambda m: m.group(1) + rel(page_dir, m.group(2)) + m.group(3), s)
    def fix_data(m):
        d = json.loads(m.group(2))
        d["urls"] = {k: rel(page_dir, v) for k, v in d.get("urls", {}).items()}
        d["paymentsOpen"] = True  # the preview walks the whole purchase, through a demo bank page
        return m.group(1) + json.dumps(d, ensure_ascii=False).replace("</", "<\\/") + m.group(3)
    s = re.sub(r'(<script id="site-data" type="application/json">)(.*?)(</script>)', fix_data, s, flags=re.S)
    # The preview always shows the whole flow, even while the real site says "payments open soon".
    s = s.replace('<div id="lBuy" hidden>', '<div id="lBuy">')
    s = re.sub(r'<div class="card lt-soon"[^>]*>.*?</div>', '', s, flags=re.S)
    mock = '<script src="' + rel(page_dir, "/assets/js/mock-api.js") + "?v=" + mockv + '"></script>\n'
    s = s.replace('<script id="site-data"', mock + '<script id="site-data"', 1)
    f.write_text(s, encoding="utf-8")

files = sorted(p.relative_to(OUT).as_posix() for p in OUT.rglob("*") if p.is_file())
(OUT.parent / (OUT.name + "-files.json")).write_text(json.dumps(files))
print(len(files), "files in", OUT)
