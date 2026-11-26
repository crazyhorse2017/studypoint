"""
Runs Studyflare's pure-module test suites in headless Chrome/Edge, with no Node.js (TESTING §1).
TypeScript is stripped on the fly by tests/ts_strip.py (erasable syntax only, AGENTS rule 21).
Ported from Prizm's harness.

Usage:
  uv run --no-project --python 3.12 python tests/run_js_tests.py all
  uv run --no-project --python 3.12 python tests/run_js_tests.py uuid7,workerHttp
"""

import functools
import http.server
import sys
import threading
import urllib.parse
from pathlib import Path

from chrome_cdp import ChromeCdpSession
from ts_strip import strip_typescript

ROOT = Path(__file__).resolve().parent.parent
REPORT = "window.__STUDYPOINT_TEST_REPORT__"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".ts": "application/javascript; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        clean_path = self.path.split("?", 1)[0].lstrip("/")
        file_path = (ROOT / urllib.parse.unquote(clean_path)).resolve()
        # Only serve files inside the repo.
        if ROOT not in file_path.parents and file_path != ROOT:
            self.send_error(403)
            return
        if file_path.suffix == ".ts" and file_path.is_file():
            try:
                encoded = strip_typescript(file_path.read_text(encoding="utf-8")).encode("utf-8")
            except Exception as e:  # report the stripping failure as a server error the test page will show
                self.send_error(500, f"Error stripping TypeScript: {e}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return
        return super().do_GET()


def main() -> int:
    suite = sys.argv[1] if len(sys.argv) > 1 else "all"
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    session = None
    try:
        session = ChromeCdpSession()
        session.navigate(f"http://127.0.0.1:{port}/tests/js_tests.html?suite={urllib.parse.quote(suite)}", wait_ms=100)
        session.wait_for(REPORT, timeout_s=60)
        report = session.evaluate(REPORT)
    finally:
        if session:
            session.close()
        server.shutdown()
        server.server_close()

    for line in report["logs"]:
        print(line)
    if session and session.console_errors:
        print("\nBrowser console/page errors:")
        for e in session.console_errors:
            print(" ", e)

    print(f"\nJS Tests: {report['passed']}/{report['total']} passed, {report['failed']} failed.")
    return 1 if report["failed"] > 0 or report["total"] == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
