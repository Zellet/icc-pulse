# ICC Pulse — Part 1: event collector

ICC Pulse collects public DVC Synch events for a simple student calendar. This package finishes the data-collection portion. It does not include the website, GitHub setup, daily scheduling, or phone installation yet.

## What it does

Run `refresh_events.py` to download events, check the result, and update `data/events.json`. Python 3.9 or newer is required. Windows users also need the `tzdata` package.

The collector:

- Uses the same public event-search API as the DVC Synch events page. No account, cookies, or API key are needed in the tests completed so far.
- Requests every page and checks unique event IDs against the API's reported total.
- Includes events overlapping today through 30 days ahead, inclusive: 31 Pacific calendar dates. Events that ended earlier today remain visible for today's grid. Overnight events are included if they overlap the window.
- Converts exact start and end times to Pacific time using daylight-saving rules. It does not round times; the future calendar interface will round only grid placement.
- Preserves co-host names, primary club identity, location, event link, and available online attendance links.
- Uses the RSS feed to supplement online links. The API supplies event coverage and primary event details.
- Validates a candidate before replacing the last good JSON file. A failed request or rejected update leaves the old data and its old update timestamp in place.
- Keeps one previous accepted version as a backup.

All dates, event counts, and page counts are determined at runtime. No particular event is hard-coded.

## Why the API is the main source

During the November 1, 2026 checks, the public API returned 21 events ending after midnight. Twenty overlapped the requested calendar window; the remaining event was on December 10. The fresh RSS contained 19 of the in-window events and omitted a museum event that had already ended that afternoon.

The RSS window starts at the time of the request and ends 30 days later at that time. It cannot by itself provide all of today's earlier events or guarantee the entire final calendar day. The observed counts do not demonstrate a 20-event RSS cap.

The Nursing Club event confirmed that the API's location can be a room while the RSS location is an online link. The public event page showed both. These are stored separately. The public API also provides co-host names.

This is the website's public endpoint, not a documented compatibility promise. If its structure changes, the collector should stop with an error instead of replacing good data with an incomplete result. Matching the API total verifies that query's results, not private events, unpublished events, or events missing from the source itself.

## One-time setup on Windows

1. Extract the ZIP. Copy `refresh_events.py`, `requirements.txt`, and this `README.md` into your existing **ICC Pulse** folder. The package also includes a `.gitignore` for the later GitHub setup; copy it if you do not already have a custom one.
2. Keep your existing `data` folder. The ZIP contains no event data and will not replace it during extraction.
3. In VS Code, choose **File → Open Folder**, then select the ICC Pulse folder.
4. Choose **Terminal → New Terminal**.
5. Check Python:

```powershell
python --version
```

6. Install the one external dependency:

```powershell
python -m pip install -r requirements.txt
```

If Windows recognizes `py` instead of `python`, substitute `py` in these commands. Avoid installing packages with a bare `pip` command: `python -m pip` selects the Python interpreter you are running.

If you completed Stage 2B, `tzdata` is probably already installed. It is safe to run the installation command again.

The stage scripts are no longer required by this collector. Leave them alone until the new script passes its tests and a real refresh on your computer. Afterward, they can be moved with their output folders into an `archive` folder. Do not move your `data` folder or the new `collector_output` folder.

## Run and check

First run the safety checks:

```powershell
python refresh_events.py --self-test
```

Expected final line:

```text
RESULT: All 10 safety checks passed. Real event data was not changed.
```

These checks use temporary files and simulated failures. They make no network requests and do not change your real event data.

Then run a real refresh:

```powershell
python refresh_events.py
```

The script collects a fresh candidate in a child process, checks it, and updates the accepted file. Collection is limited to 180 seconds by default. During collection, the terminal may show only the starting message; the full output appears afterward.

Expected success summary:

```text
RESULT: Last good event data updated successfully.
Events saved: <current count>
```

The count will change as events are added, canceled, or move out of the window. The earlier count of 20 is a check result, not a permanent expectation.

Check `collector_output/events_preview.txt` for a readable list. On your first standalone run, verify that the Nursing Club event keeps its physical and online locations, and the guest-speaker event keeps both club names if those events are still within the date window.

There is no web server to start for Part 1. Running the collector does not upload files or schedule future runs.

## Files and folders

| Path | Purpose |
| --- | --- |
| `refresh_events.py` | Standalone collector and safety checks |
| `requirements.txt` | Python dependency list |
| `data/events.json` | Latest accepted data; the future website will read this |
| `collector_output/events.previous.json` | Previous accepted data, replaced on each successful update |
| `collector_output/events_candidate.json` | Candidate from the latest collection attempt; not necessarily accepted |
| `collector_output/events_preview.txt` | Readable preview of that candidate |
| `collector_output/refresh_report.txt` | Latest normal refresh result, including collector output |
| `collector_output/collection_report.txt` | Collection details from the child process |
| `collector_output/safety_test_report.txt` | Most recent safety-test result |
| `collector_output/raw/api_page_*.json` | Downloaded API pages for troubleshooting |
| `collector_output/raw/fresh_feed.xml` | Downloaded RSS response |
| `collector_output/refresh.lock` | Temporary marker preventing simultaneous normal refreshes |

The backup is now in `collector_output`, rather than Stage 4's `data/events.previous.json`. An older Stage 4 backup is left untouched. Only `data/events.json` is intended as calendar input.

Known scratch outputs from the previous collection attempt are removed at the start of a new collection, so old extra page files cannot be mistaken for new results. Accepted data and its backup are not cleared. A failed run may leave partial diagnostics; check the refresh report before using a candidate or preview.

Paths are anchored to the script's folder. You can run it from another terminal folder by giving the full quoted path to `refresh_events.py`.

## Safety rules in plain language

The collector rejects invalid JSON, missing required structure, inconsistent counts, duplicate IDs, invalid times, wrong date windows, and incompatible source timestamps/status. It also rejects stale candidates or candidates older than the already accepted file.

An empty result is always held for review. With existing data, the collector also rejects an update that retains half or fewer of the previous event IDs that still overlap the new window. New events cannot hide the disappearance of those earlier IDs. Events falling into past days are excluded from this comparison.

This is deliberately conservative. Real cancellations or a quiet vacation period can trigger it. It is a warning mechanism, not proof that the source is wrong. Smaller unexplained losses may not trigger the threshold, so API counts and source comparisons remain useful.

The first successful run has no prior accepted file to compare against. It still checks source counts, schema, dates, and duplicate IDs, and rejects an empty result.

After validation, the script writes a temporary file in the destination directory and replaces `events.json` in one filesystem operation. If the replacement fails before it happens, the previous file remains. The previous bytes are also saved as a backup before replacement.

Do not run old stage scripts at the same time as this collector. Normal standalone refreshes use a lock to prevent overlapping runs; the old scripts do not share that lock.

## Troubleshooting

| Message or symptom | What to do |
| --- | --- |
| `getaddrinfo failed`, `Errno 11001`, or DNS error | Open DVC Synch in your browser. Check Wi-Fi and try another network, as worked during Stage 1. Then rerun. |
| HTTP 403, 429, or another server error | Check the public site in your browser. For rate limits, wait before retrying. Do not repeatedly hammer the site. Keep the last good data and share the report if access keeps failing. |
| Collection timed out | Try another network and rerun once. If the site works but the collector repeatedly times out, inspect the report and source availability before increasing the timeout setting. |
| `No module named zoneinfo` | Python is too old; use Python 3.9 or newer. Check which interpreter VS Code is using. |
| Pacific time-zone data missing | Run `python -m pip install -r requirements.txt` using the same interpreter as the collector. |
| API total changed, repeated IDs, or RSS/API disagreement | Events may have changed during collection, or one source may be cached. Rerun once after a short interval. If it persists, share the report and relevant raw response. Do not remove the check. |
| Expected JSON/XML or missing fields | The server may have returned an error page, or the source format changed. Share the report and raw response; do not replace the accepted file manually with that response. |
| File access or permission error | Close programs holding the file open, check that the folder is writable, and check OneDrive syncing. If needed, copy the complete project to a normal writable local folder and retry there. |
| Another refresh may be running | Let the other run finish. If none is running and the prior run was forcibly terminated, close any remaining collector processes, then delete only `collector_output/refresh.lock` and retry. |
| Candidate belongs to another day or appears future-dated | Check Windows date, time, and automatic time synchronization, then rerun. |
| Suspicious event loss or empty result | Compare the candidate preview with the public DVC Synch page for the same dates. Follow the manual-review steps below only if the change is legitimate. |
| Existing `events.json` is malformed | Do not bypass validation. Preserve it for troubleshooting. An intact prior backup can be restored using the steps below. |

### Legitimate large changes or zero events

1. Open the public events page and check the same date range.
2. Review `collector_output/events_preview.txt` and `refresh_report.txt`.
3. Confirm the missing events were genuinely canceled, removed, or no longer listed.
4. Only after that verification, run:

```powershell
python refresh_events.py --accept-count-change
```

This downloads fresh data again and bypasses only the count-loss/empty-result check. It does not bypass malformed data, duplicate IDs, bad dates, missing pages, or failed downloads. Do not add this option to the daily scheduled command.

### Restore an earlier accepted file

If the current accepted file is damaged and `collector_output/events.previous.json` is intact:

1. Stop any running refresh.
2. Copy the current `data/events.json` somewhere safe for troubleshooting.
3. Copy `collector_output/events.previous.json` into `data` and rename the copy to `events.json`, replacing the damaged file.
4. Run a normal refresh again. If the backup is also damaged, retain both files and seek help rather than deleting the validation checks.

On the first-ever successful run, a backup does not exist yet. After a later successful refresh, the previous accepted version becomes the backup. A backup retains its original update time and can be stale.

### What the RSS warning means

`Extra online links could not be checked` means an API event was not present in the current RSS feed. Its API data is still retained. This is expected for events that already ended today. A null `online_url` means no online link was obtained from the available sources, not proof that online attendance is impossible. The DVC Synch link remains available for details.

If downloading RSS itself fails, this version rejects the refresh and keeps the last good data. It does not silently discard known online information. If either source becomes persistently inaccessible, we will review the source strategy; the fallback for a failed run is the last good file.

## JSON fields for the upcoming website

| Field | Meaning |
| --- | --- |
| `schema_version` | Current structure version: 1 |
| `candidate_only` | `false` in accepted `data/events.json`; `true` in the working candidate |
| `last_updated` | Successful collection completion timestamp, with an explicit offset |
| `timezone` | `America/Los_Angeles` |
| `window_start` / `window_end_exclusive` | Full calendar-day bounds; the ending instant itself is excluded |
| `counts` | API totals, included/excluded counts, RSS supplement availability |
| `warnings` | Source-quality observations |
| `events[].id` / `url` | Stable event ID and DVC Synch link |
| `events[].title` | Event name |
| `events[].primary_club` / `primary_club_id` | Main organization identified by the API |
| `events[].club_names` | Primary and co-host names, with repeated names removed |
| `events[].club_color_key` | Stable input for assigning colors in the website |
| `events[].location` / `online_url` | Separate physical/text location and available online URL |
| `events[].start` / `end` | Exact Pacific timestamps with offsets |
| `events[].online_url_source` / `rss_supplement_status` | Where the optional online information came from and whether RSS matched |

Organization-name and organization-ID arrays are not paired by position because that ordering has not been verified. Color assignment uses the primary organization ID; a stable name-based fallback is used if its ID is missing. The website should treat source text as text, not execute it as HTML.

## Settings

Edit the clearly labeled settings at the top of `refresh_events.py`. They include URLs, paths, date range, page size, request/run timeouts, response-size and page safety limits, freshness allowance, and the event-retention threshold.

Safety limits fail clearly instead of silently truncating results. The collector uses all pages of the query with no upper date cutoff, then applies the upper bound locally. This avoids relying on an unverified API parameter, but a much larger future listing could require a higher timeout or a separately verified upper-date filter.

## Part 1 acceptance status

| Requirement | Evidence/status |
| --- | --- |
| Public event fields and pagination | Verified on your Windows computer |
| Full date window and source-count reconciliation | 21 fetched = 20 included + 1 outside the window on November 1 |
| Co-hosts and physical/online locations | Checked against the supplied event page and preview |
| Safe updates | Stage 4 live refresh succeeded; standalone safety tests also pass locally |
| Standalone package | Awaiting your Windows safety test and live refresh |
| Website, phone performance, views, event actions | Part 2, not built yet |
| Automatic daily refresh and deployment | Part 3, not configured yet |
| Home-screen installation | Part 4, not built yet |

The `.gitignore` excludes diagnostic responses, backups, stage scripts, and temporary files from the later repository. It deliberately keeps `data/events.json` eligible for tracking. Repository publishing and the daily workflow will be planned and tested separately.
