#!/usr/bin/env python3
"""Run the Waypoint pitch: serves this folder locally and opens the deck in your browser.

    python3 run_presentation.py              # the offline single-file deck (Waypoint-pitch.html)
    python3 run_presentation.py --source     # index.html + media/ (use after editing)
    python3 run_presentation.py --slide 9    # open at a slide (0-based)
    python3 run_presentation.py --port 4777 --no-open

Keys in the deck: ← / Space next · → back · N notes · T timer · R reset timer · O overview · F fullscreen.
Needs only Python 3 (no packages).
"""
import argparse
import functools
import http.server
import pathlib
import socket
import sys
import threading
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser cancelled a video range request


def free_port(preferred):
    for port in [preferred, 0]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    sys.exit("No free port available.")


def main():
    ap = argparse.ArgumentParser(description="Serve and open the Waypoint pitch deck.")
    ap.add_argument("--source", action="store_true", help="open index.html (with media/) instead of the single-file build")
    ap.add_argument("--slide", type=int, default=0, help="slide number to open at (0-based)")
    ap.add_argument("--port", type=int, default=4777)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser")
    args = ap.parse_args()

    page = "index.html" if args.source else "Waypoint-pitch.html"
    if not (ROOT / page).exists():
        page = "index.html" if (ROOT / "index.html").exists() else sys.exit(f"{page} not found next to this script.")

    port = free_port(args.port)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/{page}" + (f"#{args.slide}" if args.slide else "")

    print(f"Waypoint pitch → {url}")
    print("Press F in the browser for fullscreen. Ctrl+C here to stop.")
    if not args.no_open:
        threading.Timer(0.4, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
