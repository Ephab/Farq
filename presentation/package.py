"""Builds Waypoint-pitch.html (index.html with fonts, clips and screenshots inlined, works offline)
and Waypoint-pitch.zip (that file + run_presentation.py + the editable source). Run: python3 package.py"""
import base64, re, urllib.request, pathlib, zipfile
root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA)).read()
b64 = lambda data, mime: f"data:{mime};base64," + base64.b64encode(data).decode()

css_url = re.search(r'<link rel="stylesheet" href="(https://fonts.googleapis.com/[^"]+)"', html).group(1).replace("&amp;", "&")
css = get(css_url).decode()
css = re.sub(r"url\((https://fonts.gstatic.com/[^)]+)\)", lambda m: f"url({b64(get(m.group(1)), 'font/woff2')})", css)
html = re.sub(r'<link rel="preconnect"[^>]*>\n', "", html)
html = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com/[^"]+">', lambda _: f"<style>{css}</style>", html)

mimes = {".jpg": "image/jpeg", ".mp4": "video/mp4"}
html = re.sub(r'(src|poster)="(media/[^"]+)"', lambda m: f'{m.group(1)}="{b64((root / m.group(2)).read_bytes(), mimes[pathlib.Path(m.group(2)).suffix])}"', html)
out = root / "Waypoint-pitch.html"
out.write_text(html)

with zipfile.ZipFile(root / "Waypoint-pitch.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name in ["Waypoint-pitch.html", "run_presentation.py", "index.html"]:
        z.write(root / name, f"Waypoint-pitch/{name}")
    for f in sorted((root / "media").iterdir()):
        z.write(f, f"Waypoint-pitch/media/{f.name}")
print(out.name, round(out.stat().st_size / 1e6, 1), "MB")
