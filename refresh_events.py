"""ICC Pulse: collect, validate, and safely update public event data.

Run: python refresh_events.py
Tests: python refresh_events.py --self-test
Requires Python 3.9+ and tzdata. See README.md.
"""

import argparse
from contextlib import contextmanager
import copy
from datetime import datetime, time, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# SETTINGS: paths are relative to this script, not the terminal folder.
BASE_DIR = Path(__file__).resolve().parent
COLLECTOR_SCRIPT = Path(__file__).resolve()
API_URL = "https://dvc.campuslabs.com/engage/api/discovery/event/search"
RSS_URL = "https://dvc.campuslabs.com/engage/events.rss"
EVENT_BASE_URL = "https://dvc.campuslabs.com/engage/event/"
TIME_ZONE = "America/Los_Angeles"
DAYS_AHEAD = 30
PAGE_SIZE = 15
MAX_PAGES = 100  # Safety stop, never a claim of complete results.
TIMEOUT_SECONDS = 30
MAX_COLLECTION_SECONDS = 180
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
MAX_CANDIDATE_AGE_MINUTES = 15
MAX_CLOCK_SKEW_MINUTES = 5
MIN_RETAINED_FRACTION = 0.50
USER_AGENT = "ICC-Pulse/1.0"
OUTPUT_DIR = BASE_DIR / "collector_output"
RAW_DIR = OUTPUT_DIR / "raw"
DATA_FILE = BASE_DIR / "data" / "events.json"
BACKUP_FILE = OUTPUT_DIR / "events.previous.json"
JSON_FILE = "events_candidate.json"
CANDIDATE_FILE = OUTPUT_DIR / JSON_FILE
RSS_FILE = "fresh_feed.xml"
PREVIEW_FILE = "events_preview.txt"
REPORT_FILE = "refresh_report.txt"
TEST_REPORT_FILE = "safety_test_report.txt"
COLLECTION_REPORT_FILE = "collection_report.txt"
LOCK_FILE = OUTPUT_DIR / "refresh.lock"
SAMPLE_COUNT = 2


def date_window(now, zone):
    today = now.astimezone(zone).date()
    start = datetime.combine(today, time.min, tzinfo=zone)
    stop = datetime.combine(today + timedelta(days=DAYS_AHEAD + 1), time.min, tzinfo=zone)
    return start, stop


def download(url, filename):
    print("Downloading " + filename + " ...", flush=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        (RAW_DIR / filename).write_bytes(error.read(MAX_RESPONSE_BYTES))
        raise ValueError("HTTP {} for {}. Error response saved.".format(error.code, filename)) from error
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Response too large for this diagnostic: " + filename)
    (RAW_DIR / filename).write_bytes(raw)
    return raw


def read_api(start, lines):
    params = {"endsAfter": start.isoformat(), "orderByField": "endsOn",
              "orderByDirection": "ascending", "status": "Approved",
              "take": PAGE_SIZE, "query": ""}
    rows, seen, total = [], set(), None
    for page in range(1, MAX_PAGES + 1):
        if rows:
            params["skip"] = len(rows)
        url = API_URL + "?" + urlencode(params)
        raw = download(url, "api_page_{:03d}.json".format(page))
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("API response is not a JSON object.")
        count, batch = data.get("@odata.count"), data.get("value")
        if type(count) is not int or count < 0 or not isinstance(batch, list):
            raise ValueError("API count or event list has changed format.")
        if total is None:
            total = count
        if total != count:
            raise ValueError("API total changed during pagination. Please rerun.")
        lines.append("API page {}: {} entries; reported total {}".format(page, len(batch), count))
        if len(batch) > PAGE_SIZE:
            raise ValueError("API returned more rows than requested; inspect pagination.")
        for row in batch:
            if not isinstance(row, dict):
                raise ValueError("API returned an event that is not an object.")
            event_id = str(row.get("id") or "")
            if not re.fullmatch(r"[0-9]+", event_id):
                raise ValueError("API event has a missing or unexpected ID.")
            if event_id in seen:
                raise ValueError("Repeated API event ID {}. Results may have shifted; rerun.".format(event_id))
            seen.add(event_id)
            rows.append(row)
        if len(rows) > total:
            raise ValueError("Collected more IDs than the API total. Rerun.")
        if len(rows) == total:
            lines.append("API COUNT CHECK: {} unique IDs match the reported total.".format(total))
            return rows, total
        if not batch:
            raise ValueError("API stopped returning events before its total was reached.")
    raise ValueError("Safety page limit reached. Coverage is incomplete; paste the report.")


def timestamp(value, label, rss=False):
    try:
        dt = parsedate_to_datetime(value) if rss else datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None:
            raise ValueError("time zone missing")
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid or missing time for {}: {!r}".format(label, value)) from error


def event_record(event_id, name, club, location, start, end, status, lines):
    if end <= start:
        raise ValueError("Event {} has an end time at or before its start.".format(event_id))
    record = {"id": event_id, "name": str(name or "").strip(),
              "club": str(club or "").strip(), "location": str(location or "").strip(),
              "start": start, "end": end, "status": status}
    for field in ("name", "club", "location"):
        if not record[field]:
            lines.append("WARNING: Event {} has a blank {}.".format(event_id, field))
    return record


def rss_records(raw, lines):
    root = ET.fromstring(raw)
    if root.tag != "rss" or root.find("channel") is None:
        raise ValueError("RSS response is not the expected RSS channel.")
    channel = root.find("channel")
    lines.append("\nFresh RSS window label: " + channel.findtext("title", "(missing)"))
    lines.append("Fresh RSS build time: " + channel.findtext("lastBuildDate", "(missing)"))
    records = {}
    for item in channel.findall("item"):
        link = item.findtext("link", "")
        match = re.fullmatch(r"/engage/event/([0-9]+)/?", urlsplit(link).path)
        if not match or urlsplit(link).hostname != "dvc.campuslabs.com":
            raise ValueError("RSS event has an unexpected link: " + link)
        event_id = match.group(1)
        if event_id in records:
            raise ValueError("Repeated RSS event ID: " + event_id)
        start = timestamp(item.findtext("{events}start"), event_id + " RSS start", rss=True)
        end = timestamp(item.findtext("{events}end"), event_id + " RSS end", rss=True)
        status = item.findtext("{events}status", "")
        if status != "confirmed":
            lines.append("WARNING: RSS event {} has status {!r}.".format(event_id, status))
        records[event_id] = event_record(event_id, item.findtext("title"), item.findtext("{events}host"),
                                        item.findtext("{events}location"), start, end, status, lines)
    lines.append("Fresh RSS entries: " + str(len(records)))
    return records


def in_window(record, start, stop):
    # Compare instants in UTC, including overnight events overlapping today.
    return record["end"] > start.astimezone(timezone.utc) and record["start"] < stop.astimezone(timezone.utc)


def clean_text(value, label):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(label + " has an unexpected data type.")
    return " ".join(value.split())


def web_url(value):
    """Keep only complete HTTP(S) links; never turn arbitrary text into a link."""
    if not value or any(char.isspace() for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return None


def club_details(row, event_id, warnings):
    primary = clean_text(row.get("organizationName"), event_id + " organizationName")
    names = row.get("organizationNames") or []
    if not isinstance(names, list):
        raise ValueError(event_id + " organizationNames is not a list.")
    names = [clean_text(name, event_id + " co-host") for name in names]
    all_names, seen = [], set()
    for name in [primary, *names]:
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            all_names.append(name)
    if not primary:
        warnings.append(event_id + ": primary club name is missing; preserved the available co-hosts.")
    raw_id = row.get("organizationId")
    primary_id = str(raw_id) if raw_id is not None else None
    if primary_id is not None and not re.fullmatch(r"[0-9]+", primary_id):
        raise ValueError(event_id + ": unexpected organizationId format.")
    if primary_id:
        color_key = "organization:" + primary_id
    elif primary:
        color_key = "name:" + hashlib.sha256(primary.casefold().encode("utf-8")).hexdigest()[:16]
        warnings.append(event_id + ": club ID missing; color key uses the primary club name.")
    else:
        color_key = "event:" + event_id
        warnings.append(event_id + ": no stable primary club identity; using an event-specific color key.")
    # Do not zip organizationIds and organizationNames: their ordering is unverified.
    return primary or None, primary_id, all_names, color_key


def normalize(rows, rss, start, stop, zone, warnings):
    events, seen, outside = [], set(), 0
    for row in rows:
        event_id = str(row.get("id") or "")
        if not re.fullmatch(r"[0-9]+", event_id):
            raise ValueError("Missing or invalid event ID.")
        if event_id in seen:
            raise ValueError("Repeated event ID: " + event_id)
        seen.add(event_id)
        if row.get("visibility") != "Public" or row.get("status") != "Approved":
            raise ValueError(event_id + ": event is not marked Public and Approved.")
        begin = timestamp(row.get("startsOn"), event_id + " start")
        end = timestamp(row.get("endsOn"), event_id + " end")
        if end <= begin:
            raise ValueError(event_id + ": end must be after start.")
        if end <= start.astimezone(timezone.utc):
            raise ValueError(event_id + ": API returned an event ending before/at the cutoff.")
        if begin >= stop.astimezone(timezone.utc):
            outside += 1
            continue
        title = clean_text(row.get("name"), event_id + " name")
        if not title:
            raise ValueError(event_id + ": event title is missing.")
        primary, primary_id, names, color_key = club_details(row, event_id, warnings)
        api_location = clean_text(row.get("location"), event_id + " location")
        online = web_url(api_location)
        location = None if online else (api_location or None)
        online_source = "api_location" if online else None
        match = rss.get(event_id)
        supplement_status = "not_in_rss"
        if match:
            supplement_status = "matched"
            # Never combine attendance details from records with inconsistent times/status.
            if match["start"] != begin or match["end"] != end or match["status"] != "confirmed":
                raise ValueError(event_id + ": RSS times/status disagree with the API. Rerun, then paste the report if it persists.")
            rss_location = clean_text(match["location"], event_id + " RSS location")
            rss_online = web_url(rss_location)
            if rss_online:
                if online and online != rss_online:
                    warnings.append(event_id + ": API and RSS online links differ; retained the API link. Check DVC Synch.")
                elif not online:
                    online, online_source = rss_online, "rss_location"
            elif rss_location and rss_location != api_location:
                warnings.append(event_id + ": text locations differ; retained API location. RSS says: " + rss_location)
        if not location and not online:
            warnings.append(event_id + ": neither a location nor an online link was supplied.")
        events.append({
            "id": event_id, "title": title,
            "primary_club": primary, "primary_club_id": primary_id,
            "club_names": names, "club_color_key": color_key,
            "location": location, "online_url": online,
            "start": begin.astimezone(zone).isoformat(),
            "end": end.astimezone(zone).isoformat(),
            "url": EVENT_BASE_URL + event_id,
            "online_url_source": online_source,
            "rss_supplement_status": supplement_status,
        })
    events.sort(key=lambda event: (timestamp(event["start"], "sort"), event["id"]))
    return events, outside


def collect_candidate(lines):
    zone = ZoneInfo(TIME_ZONE)
    started = datetime.now(timezone.utc)
    start, stop = date_window(started, zone)
    lines.extend(["Pacific window start: " + start.isoformat(),
                  "Pacific window end (exclusive): " + stop.isoformat()])
    rows, total = read_api(start, lines)
    rss = rss_records(download(RSS_URL, RSS_FILE), lines)
    warnings = []
    events, outside = normalize(rows, rss, start, stop, zone, warnings)
    if len(events) + outside != total:
        raise ValueError("COUNT MISMATCH: included plus outside-window events do not match the API total.")
    event_ids = {event["id"] for event in events}
    rss_only = [key for key, row in rss.items()
                if in_window(row, start, stop) and key not in event_ids]
    if rss_only:
        raise ValueError("RSS contains in-window IDs absent from the API: " + ", ".join(sorted(rss_only)))
    finished = datetime.now(timezone.utc)
    if finished.astimezone(zone).date() != started.astimezone(zone).date():
        raise ValueError("Pacific midnight passed during the run. Run again for the new day.")
    unmatched = sum(event["rss_supplement_status"] == "not_in_rss" for event in events)
    if unmatched:
        warnings.append("{} event(s) are absent from RSS; extra online links could not be checked for them.".format(unmatched))
    if not events:
        warnings.append("No events fall in the calendar window. This candidate needs review before publication.")
    payload = {
        "schema_version": 1, "candidate_only": True,
        "last_updated": finished.isoformat(), "timezone": TIME_ZONE,
        "window_start": start.isoformat(), "window_end_exclusive": stop.isoformat(),
        "sources": {"events": API_URL, "online_link_supplement": RSS_URL},
        "counts": {"api_reported": total, "api_collected": len(rows),
                   "outside_window": outside, "included": len(events),
                   "rss_supplement_unavailable": unmatched},
        "warnings": warnings, "events": events,
    }
    preview = []
    for event in events:
        preview.extend([event["title"] + " [" + event["id"] + "]",
                        "Clubs: " + ("; ".join(event["club_names"]) or "Not supplied"),
                        "Location: " + (event["location"] or "Not supplied"),
                        "Online: " + (event["online_url"] or "No link supplied in available data"),
                        "Time: " + event["start"] + " to " + event["end"],
                        "DVC Synch: " + event["url"], ""])
    (OUTPUT_DIR / PREVIEW_FILE).write_text("\n".join(preview), encoding="utf-8")
    (OUTPUT_DIR / JSON_FILE).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines.extend(["\nNORMALIZATION SUMMARY",
                  "API reported / collected: {} / {}".format(total, len(rows)),
                  "Excluded outside date window: " + str(outside),
                  "Events saved: " + str(len(events)),
                  "Events with multiple club names: " + str(sum(len(event["club_names"]) > 1 for event in events)),
                  "Events with online links: " + str(sum(bool(event["online_url"]) for event in events)),
                  "COUNT CHECK: included + excluded = API reported total.",
                  "Exact times preserved; no grid rounding applied."])
    for event in events[:SAMPLE_COUNT]:
        lines.append("\nSAMPLE EVENT:\n" + json.dumps(event, indent=2, ensure_ascii=False))
    lines.append("\nWarnings: " + str(len(warnings)))
    lines.extend("  WARNING: " + warning for warning in warnings)
    lines.append("\nRESULT: Candidate JSON created for review. Not yet accepted as website data.")
    lines.append("Candidate: " + str(OUTPUT_DIR / JSON_FILE))
    lines.append("Readable preview: " + str(OUTPUT_DIR / PREVIEW_FILE))


class CheckFailed(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailed(message)


def moment(value, label):
    try:
        require(isinstance(value, str), label + " must be a timestamp string.")
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(result.tzinfo is not None and result.utcoffset() is not None,
                label + " needs a time-zone offset.")
        return result
    except (TypeError, ValueError) as error:
        raise CheckFailed("Invalid {}: {!r}".format(label, value)) from error


def utc(value, label="time"):
    return moment(value, label).astimezone(timezone.utc)


def safe_web_url(value):
    if not isinstance(value, str) or any(char.isspace() for char in value):
        return False
    try:
        parts = urlsplit(value)
        return bool(parts.scheme in {"https", "http"} and parts.hostname
                    and not parts.username and not parts.password)
    except ValueError:
        return False


def validate(payload, now, current=False):
    require(isinstance(payload, dict), "Event file must contain a JSON object.")
    require(type(payload.get("schema_version")) is int and payload["schema_version"] == 1,
            "Unsupported event schema version.")
    require(payload.get("timezone") == TIME_ZONE, "Unexpected calendar time zone.")
    require(type(payload.get("candidate_only")) is bool, "Missing candidate/published marker.")
    zone = ZoneInfo(TIME_ZONE)
    start = moment(payload.get("window_start"), "window start")
    stop = moment(payload.get("window_end_exclusive"), "window end")
    expected_start = datetime.combine(start.astimezone(zone).date(), time.min, tzinfo=zone)
    expected_stop = datetime.combine(expected_start.date() + timedelta(days=DAYS_AHEAD + 1), time.min, tzinfo=zone)
    require(start.isoformat() == expected_start.isoformat() and stop.isoformat() == expected_stop.isoformat(),
            "Calendar window must cover complete Pacific dates, the configured number of Pacific dates.")
    updated = utc(payload.get("last_updated"), "last updated")
    if current:
        require(payload["candidate_only"] is True, "Expected a fresh candidate from the collector.")
        require(start.date() == now.astimezone(zone).date(), "Candidate belongs to another Pacific day. Rerun.")
        age = now.astimezone(timezone.utc) - updated
        require(-timedelta(minutes=MAX_CLOCK_SKEW_MINUTES) <= age <= timedelta(minutes=MAX_CANDIDATE_AGE_MINUTES),
                "Candidate is stale or future-dated. Check the computer clock and rerun.")
    events, counts = payload.get("events"), payload.get("counts")
    require(isinstance(events, list) and isinstance(counts, dict), "Missing event list or counts.")
    for key in ("api_reported", "api_collected", "outside_window", "included", "rss_supplement_unavailable"):
        require(type(counts.get(key)) is int and counts[key] >= 0, "Invalid count: " + key)
    require(counts["api_reported"] == counts["api_collected"], "Collected count differs from API total.")
    require(counts["included"] == len(events), "Saved event count differs from the event list.")
    require(counts["included"] + counts["outside_window"] == counts["api_reported"],
            "Included plus excluded counts do not match the API total.")
    require(isinstance(payload.get("warnings"), list) and all(isinstance(x, str) for x in payload["warnings"]),
            "Warnings must be a list of text messages.")
    seen = set()
    for number, event in enumerate(events, 1):
        require(isinstance(event, dict), "Event {} is not an object.".format(number))
        event_id = event.get("id")
        require(isinstance(event_id, str) and bool(re.fullmatch(r"[0-9]+", event_id)), "Invalid event ID.")
        require(event_id not in seen, "Repeated event ID: " + event_id)
        seen.add(event_id)
        for field in ("title", "club_color_key"):
            require(isinstance(event.get(field), str) and bool(event[field].strip()), event_id + ": invalid " + field)
        require(isinstance(event.get("club_names"), list) and all(isinstance(x, str) and x.strip() for x in event["club_names"]),
                event_id + ": invalid club names.")
        for field in ("primary_club", "primary_club_id", "location"):
            require(field in event and (event[field] is None or isinstance(event[field], str)),
                    event_id + ": invalid " + field)
        require("online_url" in event and (event["online_url"] is None or safe_web_url(event["online_url"])),
                event_id + ": invalid online link.")
        require(event.get("url") == EVENT_BASE_URL + event_id, event_id + ": invalid DVC Synch link.")
        begin, end = moment(event.get("start"), event_id + " start"), moment(event.get("end"), event_id + " end")
        require(begin.utcoffset() == begin.astimezone(zone).utcoffset() and end.utcoffset() == end.astimezone(zone).utcoffset(),
                event_id + ": event timestamps are not in Pacific time.")
        begin, end = begin.astimezone(timezone.utc), end.astimezone(timezone.utc)
        require(end > begin, event_id + ": end must be after start.")
        require(end > start.astimezone(timezone.utc) and begin < stop.astimezone(timezone.utc),
                event_id + ": event is outside the declared window.")
        require(event.get("rss_supplement_status") in {"matched", "not_in_rss"}, event_id + ": invalid RSS status.")
        require(event.get("online_url_source") in {None, "api_location", "rss_location"}, event_id + ": invalid online source.")
    require(counts["rss_supplement_unavailable"] == sum(x["rss_supplement_status"] == "not_in_rss" for x in events),
            "RSS supplement count does not match the event list.")


def count_check(candidate, previous, allow_change, lines):
    start, stop = utc(candidate["window_start"]), utc(candidate["window_end_exclusive"])
    baseline = set()
    if previous is not None:
        baseline = {x["id"] for x in previous["events"] if utc(x["end"]) > start and utc(x["start"]) < stop}
    new_ids = {x["id"] for x in candidate["events"]}
    retained = len(baseline & new_ids)
    lines.append("Previous events still within new date window: " + str(len(baseline)))
    lines.append("Those event IDs retained in new data: " + str(retained))
    suspicious = not new_ids or (baseline and retained / len(baseline) <= MIN_RETAINED_FRACTION)
    if suspicious:
        require(allow_change, "Suspicious event loss or empty result. Last good data kept. Verify DVC Synch before using --accept-count-change.")
        lines.append("WARNING: Suspicious count change accepted by explicit command-line option.")


def atomic_write(path, content):
    """Write alongside the destination, then replace it in one filesystem step."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".icc-pulse-", suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def promote(candidate, data_file, backup_file, now, lines, allow_change=False):
    validate(candidate, now, current=True)
    old_bytes, previous = None, None
    if data_file.exists():
        old_bytes = data_file.read_bytes()
        previous = json.loads(old_bytes)
        validate(previous, now)
        require(previous["candidate_only"] is False, "Existing data file is marked as an unpublished candidate.")
        require(utc(candidate["last_updated"]) > utc(previous["last_updated"]), "Candidate is not newer than the last good data.")
    count_check(candidate, previous, allow_change, lines)
    published = copy.deepcopy(candidate)
    published["candidate_only"] = False
    content = (json.dumps(published, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    # All validation and serialization finish before changing the last good file.
    if old_bytes is not None:
        atomic_write(backup_file, old_bytes)
    atomic_write(data_file, content)


def refresh(lines, allow_change=False, show_progress=True):
    require(COLLECTOR_SCRIPT.is_file(), "The collector script is missing or inaccessible.")
    if show_progress:
        print("Collecting fresh event data; this may take a minute ...", flush=True)
    # A failed collector must never cause an older candidate to be promoted.
    run = subprocess.run([sys.executable, str(COLLECTOR_SCRIPT), "--collect-only"], cwd=BASE_DIR, capture_output=True,
                         text=True, encoding="utf-8", errors="replace", timeout=MAX_COLLECTION_SECONDS,
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    lines.append("\nCOLLECTOR OUTPUT\n" + run.stdout.strip())
    if run.stderr.strip():
        lines.append("Collector error output:\n" + run.stderr.strip())
    require(run.returncode == 0, "Collection failed. Last good data kept; see collector output above.")
    candidate = json.loads(CANDIDATE_FILE.read_text(encoding="utf-8"))
    promote(candidate, DATA_FILE, BACKUP_FILE, datetime.now(timezone.utc), lines, allow_change)
    lines.append("\nRESULT: Last good event data updated successfully.")
    lines.append("Events saved: " + str(len(candidate["events"])))
    lines.append("Data file: " + str(DATA_FILE))
    lines.append("No website has been uploaded or deployed by this script.")


def safety_tests(lines):
    """Failure tests use temporary files only, never the real data directory."""
    from unittest.mock import patch
    zone = ZoneInfo(TIME_ZONE)
    now = datetime.now(timezone.utc)
    today = now.astimezone(zone).date()
    start = datetime.combine(today, time.min, tzinfo=zone)
    stop = datetime.combine(today + timedelta(days=DAYS_AHEAD + 1), time.min, tzinfo=zone)
    event_start = datetime.combine(today + timedelta(days=1), time(12), tzinfo=zone)
    events = [{"id": str(100 + i), "title": "Safety test " + str(i), "primary_club": "Test club",
               "primary_club_id": "1", "club_names": ["Test club"], "club_color_key": "organization:1",
               "location": "Test room", "online_url": None, "online_url_source": None,
               "rss_supplement_status": "matched", "start": event_start.isoformat(),
               "end": (event_start + timedelta(hours=1)).isoformat(), "url": EVENT_BASE_URL + str(100 + i)} for i in range(6)]
    candidate = {"schema_version": 1, "candidate_only": True, "timezone": TIME_ZONE,
                 "last_updated": now.isoformat(), "window_start": start.isoformat(),
                 "window_end_exclusive": stop.isoformat(), "warnings": [], "events": events,
                 "counts": {"api_reported": 6, "api_collected": 6, "included": 6,
                            "outside_window": 0, "rss_supplement_unavailable": 0}}
    previous = copy.deepcopy(candidate)
    previous["candidate_only"] = False
    previous["last_updated"] = (now - timedelta(minutes=1)).isoformat()
    with tempfile.TemporaryDirectory(prefix="icc-pulse-safety-") as folder:
        data = Path(folder) / "events.json"
        backup = Path(folder) / "events.previous.json"
        original = json.dumps(previous).encode("utf-8")

        def blocked(label, bad):
            data.write_bytes(original)
            try:
                promote(bad, data, backup, now, [])
            except (ValueError, OSError):
                require(data.read_bytes() == original, label + ": old bytes changed!")
                lines.append("PASS: " + label + "; last good file unchanged byte-for-byte.")
            else:
                raise CheckFailed(label + " was incorrectly accepted.")

        bad = copy.deepcopy(candidate)
        bad["counts"]["included"] += 1
        blocked("Incorrect event count", bad)
        bad = copy.deepcopy(candidate)
        bad["events"][0]["start"] = "TBD"
        blocked("Invalid event time", bad)
        bad = copy.deepcopy(candidate)
        bad["events"][1] = copy.deepcopy(bad["events"][0])
        blocked("Duplicate event ID", bad)
        for count in (0, 3):
            bad = copy.deepcopy(candidate)
            bad["events"] = bad["events"][:count]
            for field in ("api_reported", "api_collected", "included"):
                bad["counts"][field] = count
            blocked("Empty result" if count == 0 else "Half of expected events disappear", bad)
        bad = copy.deepcopy(candidate)
        for event in bad["events"]:
            event["id"] = str(int(event["id"]) + 1000)
            event["url"] = EVENT_BASE_URL + event["id"]
        blocked("New IDs hide disappearance despite unchanged total", bad)
        bad = copy.deepcopy(candidate)
        bad["last_updated"] = (now - timedelta(hours=1)).isoformat()
        blocked("Stale candidate", bad)

        # Simulate a failed collector even when a candidate file is available.
        data.write_bytes(original)
        with patch.dict(refresh.__globals__, {"DATA_FILE": data, "BACKUP_FILE": backup, "COLLECTOR_SCRIPT": data}):
            with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "Simulated network failure", "")):
                try:
                    refresh([], show_progress=False)
                except CheckFailed:
                    require(data.read_bytes() == original, "Failed collector changed last good data.")
                    lines.append("PASS: Failed collection; last good file unchanged byte-for-byte.")
                else:
                    raise CheckFailed("Collector failure was accepted.")

        data.write_bytes(original)
        real_replace = os.replace
        def broken_replace(source, destination):
            if Path(destination) == data:
                raise PermissionError("Simulated interruption before final replacement")
            real_replace(source, destination)
        with patch.object(os, "replace", side_effect=broken_replace):
            try:
                promote(candidate, data, backup, now, [])
            except PermissionError:
                require(data.read_bytes() == original, "Interrupted write changed last good data.")
                lines.append("PASS: Interrupted replacement; last good file unchanged byte-for-byte.")
            else:
                raise CheckFailed("Write-interruption simulation failed.")

        # A prior-day event falling out of the window must not count as a loss.
        old = copy.deepcopy(previous)
        old_start = datetime.combine(today - timedelta(days=1), time.min, tzinfo=zone)
        old_stop = datetime.combine(today + timedelta(days=DAYS_AHEAD), time.min, tzinfo=zone)
        old["window_start"], old["window_end_exclusive"] = old_start.isoformat(), old_stop.isoformat()
        expired = copy.deepcopy(events[0])
        expired["id"], expired["url"] = "99", EVENT_BASE_URL + "99"
        expired["start"] = (old_start + timedelta(hours=12)).isoformat()
        expired["end"] = (old_start + timedelta(hours=13)).isoformat()
        old["events"].append(expired)
        for field in ("api_reported", "api_collected", "included"):
            old["counts"][field] = 7
        old_bytes = json.dumps(old).encode("utf-8")
        data.write_bytes(old_bytes)
        promote(candidate, data, backup, now, [])
        require(json.loads(data.read_bytes())["candidate_only"] is False, "Valid candidate was not promoted.")
        require(backup.read_bytes() == old_bytes, "Backup did not preserve the prior file.")
        lines.append("PASS: Valid update and normal past-day removal accepted; previous file backed up exactly.")
    lines.append("\nRESULT: All 10 safety checks passed. Real event data was not changed.")

@contextmanager
def refresh_lock():
    # Avoid two local refreshes writing to the same candidate or backup.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise CheckFailed("Another refresh may be running. See README.md before removing collector_output/refresh.lock.") from error
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(str(os.getpid()))
        yield
    finally:
        LOCK_FILE.unlink(missing_ok=True)


def clean_work_files():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in (JSON_FILE, PREVIEW_FILE, COLLECTION_REPORT_FILE):
        (OUTPUT_DIR / name).unlink(missing_ok=True)
    for path in RAW_DIR.iterdir():
        if path.name == RSS_FILE or re.fullmatch(r"api_page_[0-9]+\.json", path.name):
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description="Refresh ICC Pulse event data safely.")
    parser.add_argument("--self-test", action="store_true", help="Run 10 safety tests with temporary files and no network.")
    parser.add_argument("--accept-count-change", action="store_true", help="Accept a manually verified empty result or major event loss; all other checks still apply.")
    parser.add_argument("--collect-only", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.collect_only and (args.self_test or args.accept_count_change):
        parser.error("The internal collection option cannot be combined with other options.")
    title = "SAFETY TESTS" if args.self_test else ("COLLECTION" if args.collect_only else "SAFE REFRESH")
    lines = ["ICC PULSE - " + title]
    result = 1
    try:
        if args.self_test:
            safety_tests(lines)
        elif args.collect_only:
            clean_work_files()
            collect_candidate(lines)
        else:
            with refresh_lock():
                refresh(lines, args.accept_count_change)
        result = 0
    except ZoneInfoNotFoundError:
        lines.append("ERROR: Time-zone data missing. Run: python -m pip install -r requirements.txt")
    except subprocess.TimeoutExpired:
        lines.append("ERROR: Collection took too long and was stopped. Last good data kept. Check Wi-Fi and retry.")
    except FileNotFoundError as error:
        lines.append("ERROR: Required file missing. Extract the package and run refresh_events.py from your ICC Pulse folder. " + str(error))
    except PermissionError as error:
        lines.append("ERROR: Cannot access a file. Close it in other programs and check folder permissions or OneDrive syncing. " + str(error))
    except URLError as error:
        lines.append("ERROR: Network request failed. Check Wi-Fi, try another network, and rerun. " + str(error))
    except (OSError, ValueError, ET.ParseError) as error:
        lines.append("ERROR: " + str(error))
    except KeyboardInterrupt:
        lines.append("ERROR: Run cancelled. Rerun to finish a fresh update.")
    if result:
        lines.append("RESULT: Refresh/check failed. Do not delete the last good data; inspect the error above.")
    report = "\n".join(lines) + "\n"
    filename = TEST_REPORT_FILE if args.self_test else (COLLECTION_REPORT_FILE if args.collect_only else REPORT_FILE)
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / filename).write_text(report, encoding="utf-8")
    except OSError as error:
        report += "WARNING: Could not save report: " + str(error) + "\n"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    print(report)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
