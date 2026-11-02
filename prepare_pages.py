"""Validate accepted ICC Pulse data and assemble the public website only."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from refresh_events import validate

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = (
    "index.html", "styles.css", "app.js", "event-data.js",
    "calendar-data.js", "calendar-export.js", "assets/icc-logo.png",
    "data/events.json", ".nojekyll",
)


def inspect_files(root):
    files = {}
    for name in PUBLIC_FILES:
        source = root / name
        if not source.is_file() or source.is_symlink():
            raise ValueError("Missing regular website file: " + name)
        content = source.read_bytes()
        if name != ".nojekyll" and not content:
            raise ValueError("Empty website file: " + name)
        files[name] = content
    payload = json.loads(files["data/events.json"])
    validate(payload, datetime.now(timezone.utc))
    if payload["candidate_only"] is not False:
        raise ValueError("Refusing to publish candidate data; accepted data is required.")
    return files, payload


def prepare(root, output=None):
    # Finish validation before creating anything; never rewrite source data.
    files, payload = inspect_files(root)
    if output is not None:
        output = output.resolve()
        if output.exists():
            raise ValueError("Output must be a NEW directory: " + str(output))
        output.mkdir(parents=True)
        for name, content in files.items():
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Check only; write nothing.")
    mode.add_argument("--output", type=Path, help="New folder for the public website.")
    args = parser.parse_args()
    try:
        payload = prepare(ROOT, args.output)
    except (OSError, ValueError) as error:
        print("RESULT: Pages preparation failed: " + str(error))
        return 1
    lines = [
        "ICC PULSE - PART 3, STAGE 3",
        "Mode: YOUR ACCEPTED EVENT DATA",
        "Accepted events: " + str(len(payload["events"])),
        "Last updated: " + payload["last_updated"],
        "Timezone: " + payload["timezone"],
        "Public website files: " + str(len(PUBLIC_FILES)),
        "RESULT: Accepted data and public website files passed validation.",
    ]
    print("\n".join(lines))
    if args.output:
        print("Prepared website: " + str(args.output))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as file:
                file.write("## Prepared website\n\n```text\n" + "\n".join(lines) + "\n```\n")
                file.write("\nPreparation is not deployment confirmation. Check the Deploy website job.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
