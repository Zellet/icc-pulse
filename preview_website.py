"""Local website preview. No installs, network collection, or data-file changes."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import argparse
import json

# SETTINGS
PROJECT_FOLDER = Path(__file__).resolve().parent
ACCEPTED_DATA = PROJECT_FOLDER / "data" / "events.json"
SAMPLE_DATA = PROJECT_FOLDER / "sample_data" / "events.previous.json"
HOST = "127.0.0.1"
PORT = 8000
REQUIRED_FILES = ["index.html", "styles.css", "event-data.js", "calendar-data.js", "calendar-export.js", "app.js", "assets/icc-logo.png"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true", help="Serve the attached backup virtually; do not change data/events.json.")
    parser.add_argument("--check", action="store_true", help="Print file checks and exit without starting a server.")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    source = SAMPLE_DATA if args.sample else ACCEPTED_DATA
    print("ICC PULSE - PART 2, STAGE 5")
    print("Mode:", "ATTACHED BACKUP SAMPLE" if args.sample else "YOUR ACCEPTED EVENT DATA")
    try:
        missing = [name for name in REQUIRED_FILES if not (PROJECT_FOLDER / name).is_file()]
        if missing:
            raise ValueError("Missing website files: " + ", ".join(missing))
        data = json.loads(source.read_text(encoding="utf-8-sig"))
        if data.get("schema_version") != 1 or data.get("candidate_only") is not False:
            raise ValueError("Use accepted data, not events_candidate.json.")
        if not isinstance(data.get("events"), list) or data.get("counts", {}).get("included") != len(data["events"]):
            raise ValueError("Invalid event list or event count.")
        print("Data file:", source)
        print("Accepted events:", len(data["events"]))
        print("Last updated:", data.get("last_updated", "MISSING"))
        print("Timezone:", data.get("timezone", "MISSING"))
        print("Window:", data.get("window_start"), "to", data.get("window_end_exclusive"), "(exclusive)")
        print("Website files: all present")
        print("RESULT: File checks passed. The browser performs full event validation.")
    except (OSError, ValueError, TypeError) as error:
        print("RESULT: Could not prepare preview:", error)
        print("Copy these website files into your ICC Pulse folder.")
        print("Run python refresh_events.py to create data/events.json, or try python preview_website.py --sample.")
        return 1
    if args.check:
        return 0

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **kwargs):
            super().__init__(*handler_args, directory=str(PROJECT_FOLDER), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self):
            if args.sample and urlsplit(self.path).path == "/data/events.json":
                try:
                    body = SAMPLE_DATA.read_bytes()
                except OSError:
                    self.send_error(404, "Sample data not found")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("X-ICC-Sample", "true")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    try:
        server = ThreadingHTTPServer((HOST, args.port), Handler)
    except (OSError, OverflowError) as error:
        print("Could not start preview:", error)
        print("Try another port: python preview_website.py --port 8001")
        return 1
    print(f"Open in your browser: http://{HOST}:{args.port}/")
    print("Keep this terminal open. Press Ctrl+C to stop.")
    print("Local preview only. No files have been changed or published.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPreview stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
