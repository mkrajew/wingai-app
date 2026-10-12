"""A small local server for the browser part of the pose tools (127.0.0.1 only, read-only for the data).

    python tools/pose/browser/collect_server.py [minutes]       (stops by itself after the given time, default 180)

  GET  /raw/<file>             a photo of the 2026 series (skrzydełka 2026 świętokrzyskie), by file name
  GET  /rawbm/<path>           a photo of skrzydła-BM, /rawpl/<path>: of the Pulawy folder
  GET  /cropped/<path>         the ready-made wing databases (processed/cropped)
  GET  /browser/<file>         the scripts of tools/pose/browser
  GET  /work/<file>            tools/pose/work (the lists of photos that the browser scripts make)
  POST /collect/<name>         writes the JSON body to tools/pose/work/inbox/collected-<name>.json
  GET  /regression/<file>      the scripts of tools/regression
  POST /regression/collect/<name>   writes the JSON body to tools/regression/work/collected-<name>.json
"""
import http.server
import json
import socketserver
import sys
import threading
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from config import CROPPED, RAW_SETS, REPO, WORK  # noqa: E402

INBOX = WORK / "inbox"
REGRESSION = REPO / "tools" / "regression"
ROUTES = {
    "/rawbm/": RAW_SETS["bm"],
    "/rawpl/": RAW_SETS["pulawy"],
    "/cropped/": CROPPED,
    "/browser/": HERE,
    "/work/": WORK,
    "/regression/": REGRESSION,
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def translate_path(self, path):
        path = path.split("?")[0]
        if path.startswith("/raw/"):  # by name only
            return str(RAW_SETS["swietokrzyskie"] / Path(urllib.parse.unquote(path[len("/raw/") :])).name)
        for prefix, root in ROUTES.items():
            if path.startswith(prefix):
                target = (root / urllib.parse.unquote(path[len(prefix) :])).resolve()
                if root.resolve() in target.parents:
                    return str(target)
        return str(HERE / "no-such-file")

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        for prefix, folder in (("/regression/collect/", REGRESSION / "work"), ("/collect/", INBOX)):
            if self.path.startswith(prefix):
                break
        else:
            self.send_response(404)
            self.end_headers()
            return
        name = "".join(c for c in self.path[len(prefix) :] if c.isalnum() or c in "-_")
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        json.loads(body)  # must be valid JSON
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"collected-{name}.json").write_bytes(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 180
    socketserver.ThreadingTCPServer.daemon_threads = True
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", 8765), Handler) as server:
        threading.Timer(minutes * 60, server.shutdown).start()
        print(f"collect server on http://127.0.0.1:8765 for {minutes:.0f} minutes; inbox: {INBOX}", flush=True)
        server.serve_forever()
