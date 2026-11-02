# ICC Pulse — Website guide

**Part 2, Stage 5 — final local website package**

ICC Pulse is a phone-first public calendar for DVC club events. It uses plain HTML, CSS and JavaScript. Python runs the local preview; your separate Part 1 collector creates the accepted event data.

## 1. Install this update

1. Stop any preview with **Ctrl+C** in the VS Code terminal.
2. Extract the ZIP to a temporary folder.
3. Copy its contents into your existing **ICC Pulse** project folder, alongside `refresh_events.py`. Replace matching website files. Do not leave them inside another nested folder.
4. Open that project folder in VS Code, then open **Terminal → New Terminal**.
5. Run:

```powershell
python preview_website.py --check
python preview_website.py
```

6. Open **http://127.0.0.1:8000/** and press **Ctrl+F5** to reload the updated files. Leave the terminal running. Press Ctrl+C to stop when finished.

If Windows does not recognize `python`, try `py` instead. No new Python packages, Node.js installation, or build step is needed for this website update. Your collector's existing setup requirements still apply when you collect events.

The permanent preview command is now **`python preview_website.py`**. Older `preview_stage*.py` files can remain, but use the new launcher. Its printed header is `ICC PULSE - PART 2, STAGE 5`.

This package does not include `data/events.json` or replace `refresh_events.py`, your collector README, or collector outputs. `WEBSITE_README.md` is named separately to preserve the Part 1 `README.md`.

## 2. Typical daily use while developing locally

To collect fresh data and then preview the site:

```powershell
python refresh_events.py
python preview_website.py --check
python preview_website.py
```

Check the collector's printed result before relying on an update. A failed collection preserves the last accepted file and its original timestamp. The website never promotes a candidate file or changes accepted event data.

If the preview is already running, run the collector in another terminal and refresh the browser afterward. The page does **not** fetch newly written JSON automatically. Its 30-second clock refresh updates current-event status from the data already loaded; it pauses while a popup is open or focus is in event/calendar controls so it does not disrupt interaction.

The address `127.0.0.1` refers to the computer running the preview. Opening that address on a separate phone will not connect to this preview. Use the desktop browser's phone emulation for now; a shareable address comes in Part 3.

## 3. What students see

- ICC logo and **ICC Pulse**, with the credit **By Justinn Rodriguez and ICC Board**. Justinn Rodriguez is `#00AEF3` blue.
- Compact **Happening now** and **Up next today** lists, followed by Calendar. On portrait phones, the top area is capped below half the viewport at the tested sizes. Busy lists scroll inside that area; tap a card for full details.
- Calendar and Today on the first control row; Previous, Day/Week/Month, and Next on the second. There is no date picker or club/date filter.
- A visible accepted-data update timestamp near the bottom, plus clear messages for old data, missing coverage, empty results, loading and errors.

Very short landscape screens allow a slightly taller top area for usable scrolling; the below-half target applies to the tested portrait layouts. Browser zoom and larger accessibility text can also change the proportions.

## 4. Calendar controls and time rules

The page opens on **Day / Today**. Switching views preserves the selected date. Arrows move by one day, week, or month according to the active view. Today returns to the current Pacific date while keeping that view. Reloading returns to Day / Today.

**Day:** a vertically scrollable timeline with every hour accessible. It initially scrolls near now for today, the first event for another date, or 9 AM when there are no events. At most two overlapping blocks are visible side by side; **+N more** opens the other events.

**Week:** Monday–Sunday columns. On phones, compact colored blocks open full details when tapped. Tap a day heading to open Day view. Extra overlaps are available through **+N** below that day's heading. Desktop blocks also show titles. Day view provides larger event targets when the Week columns feel too narrow.

**Month:** Monday-first date cells with event counts and up to three club-color dots. Tap a date to open Day view. Dots represent clubs, not the number of events. A **?** means saved data does not cover that complete date.

All views use **America/Los_Angeles** even if the device uses another timezone. Dates run from today through 30 days ahead, inclusive: 31 calendar dates. Past and later dates are disabled. The boundary moves with the actual Pacific date.

The grid rounds placement to the nearest 15 minutes, with a minimum visible slot. Popups and exports preserve the exact source start/end. Overnight events appear on each date they overlap; a midnight end does not occupy the following day. Week/month totals count distinct events within available dates, so the sum of daily counts can be higher for multi-day events.

Clock changes are handled automatically. The explanatory daylight-saving note is removed as requested. Repeated-hour labels and missing-hour gaps remain where necessary for accurate timeline placement.

## 5. Event details and calendar exports

Every event popup includes its title, all co-hosts, physical location, separate online attendance link when available, exact time, and DVC Synch link. Missing online-link data does not prove an event is in person only.

**Google Calendar** opens a new tab with the event prepared for review and saving. If Google shows an introduction or sign-in page, sign in in your browser, return to ICC Pulse, and click the button again.

**Apple / Outlook (.ics)** requests a single-event calendar download. Open/import the file in your calendar app and check its details before adding it. The downloaded filename begins `ICC-Pulse-`. On a short screen, scroll inside the popup to reach the buttons; Close and Back remain at the top while scrolling.

- Apple Calendar on Mac: **File → Import**, select the `.ics` file, then select a calendar.
- Outlook on the web: **Calendar → Add calendar → Upload from file**, then choose the file and destination calendar. Labels can vary by version.
- Google Calendar on a computer: **Settings → Import & export** also accepts the `.ics` file.
- Phone handling depends on the browser and calendar app. If the phone only downloads or previews the file, use the calendar app's import flow or import on a computer.

Exports are copies, not subscriptions. Changes or cancellations will not sync automatically, and repeated saves/imports may create duplicates. The popup hint means a download was requested; ICC Pulse cannot confirm that another app imported it.

Export files store exact UTC instants. A receiving calendar may display them in its own timezone. Physical location stays in the location field; co-hosts, online attendance, a Pacific time reference, and the source URL are in the description. No recurrence or all-day status is inferred from this source schema. ICC Pulse does not require calendar credentials, API keys, or access to anyone's existing calendar.

## 6. Keyboard and accessibility

Use **Tab** and **Shift+Tab** to move between controls. The first link skips to the events area. Buttons support Enter/Space; calendar view controls announce their selected state. Scroll regions can receive keyboard focus, and event buttons have full spoken labels even when visible text is abbreviated.

Opening details focuses Close. Tab stays inside the native dialog; Escape closes it. Back returns to an overlap list. Closing returns focus to the originating control, with a Day-button fallback if that control no longer exists. A successful data retry moves focus to the main events area.

Colors supplement names and labels. Checked text/background pairs exceed 4.5:1 contrast. Motion is limited and respects reduced-motion preferences. This is a targeted accessibility review, not a complete assistive-technology or WCAG conformance audit. Dense Week blocks remain small by the approved design; tap a day heading to use larger Day targets.

## 7. Final local checklist

1. Run the two preview commands above. Expect **YOUR ACCEPTED EVENT DATA**, the current count/timestamp, and **File checks passed**.
2. Confirm the blue name, compact header, two-row controls, and no date picker.
3. Switch Day → Week → Month. Open a date from Month, then use Today. Check that the week starts Monday and boundaries are disabled.
4. Open an event, scroll the popup, and confirm Close stays reachable. Try Tab, Enter, and Escape.
5. In Chrome/Edge, press **F12**, then **Ctrl+Shift+M**. Check **320 × 568** and **390 × 844**. The page should have no horizontal scrolling. The top lists and calendar grid scroll separately.
6. Confirm the Google and `.ics` actions still behave as in your Stage 4 test. The examples below help if you need to compare details.

| Sample event | Expected Pacific details |
| --- | --- |
| November 3 — Path to Medicine Guest Speaker | 4:00–5:00 PM PST; Women in Healthcare and Pre-PA Club; DVC Pleasant Hill, LS-210 |
| November 3 — ASDVC General Meeting #8 | Exact start 2:10 PM PST, even though grid placement is rounded |
| November 18 — Fifth Nursing Club Meeting - Fall 2026 | 5:30–6:30 PM PST; ST 112, DVC PHC Campus; separate Zoom registration link |

These examples apply while the dates remain within the navigation window and the accepted source still lists them. Counts and dates are not hard-coded in the site.

For a local speed check, open the browser's Network panel, select **Disable cache**, and reload. Judge when the events become usable. Record the browser, network/throttling setting, and result rather than treating a fast desktop test as a phone-network guarantee.

## 8. Loading, stale data and troubleshooting

| Symptom | Meaning and action |
| --- | --- |
| Loading club events… | The accepted JSON is being fetched and validated. After 12 seconds, a timeout offers Try again. |
| HTTP 404 / events couldn't load | Confirm `data/events.json` exists and that you started the preview in the correct project. Run the collector if needed. |
| Candidate or schema error | Use the collector's accepted output. Never rename `events_candidate.json` to bypass validation. |
| Invalid JSON | Run the collector again; do not edit the accepted file to suppress the error. |
| Old-data warning | The accepted data is from an earlier Pacific date or is more than 36 hours old. Check DVC Synch and refresh the collector. |
| Future update timestamp | Check the device clock and timezone settings. |
| Data does not cover today / ? in Month | The saved date window is incomplete or expired. This is unknown coverage, not confirmed zero events. |
| No events listed | The accepted file contains no matching events for that covered date/window. Check the source for newly announced events. |
| New files do not appear | Stop/restart the preview and press Ctrl+F5. Check that files are next to the collector, not in a nested folder. |
| Export unavailable | Check that `calendar-export.js` was copied and refresh the page. |
| No calendar file appears | Check browser downloads and permissions; try a normal browser tab. Import the `.ics` through the calendar app if file association is missing. |
| Port already in use | Stop the older preview, or use `python preview_website.py --port 8001` and open its printed address. |
| No Week event visible | Scroll inside the hour grid or tap its day heading for Day view. |
| Separate phone cannot open localhost | The preview listens only on your computer. Shareable hosting is the next major part. |

For sample-only diagnosis:

```powershell
python preview_website.py --sample --check
python preview_website.py --sample
```

Sample mode virtually serves the original attached backup and labels it. It does not copy over accepted data or change today's date. The backup timestamp is earlier than your November 1 accepted refresh, so a difference is expected.

**Recovery:** restore the matching website files from `ICC_Pulse_Part2_Stage4.zip` and run `preview_stage4.py`. Your collector and accepted data remain separate. Back up personal edits before replacing website files. Use the collector's Part 1 README for data recovery; its safety rules remain in force.

## 9. Files and settings

| File | Purpose |
| --- | --- |
| `index.html` | Page sections, navigation, script loading and popup shell |
| `styles.css` | Theme, mobile layout, calendar views, focus and popup styling |
| `event-data.js` | Data validation, Pacific formatting, colors and freshness checks |
| `calendar-data.js` | Date bounds, day/week/month calculations and overlap layout |
| `calendar-export.js` | Google links, single-event `.ics` generation and filenames |
| `app.js` | Loading, rendering, navigation, popups and interactions |
| `preview_website.py` | Local preview, sample mode and printed file checks |
| `assets/icc-logo.png` | Original supplied ICC logo |
| `sample_data/events.previous.json` | Original accepted backup for optional sample mode |
| `WEBSITE_CHECKS.txt` | Final verification results and limitations |
| `WEBSITE_README.md` | This guide |

Settings are grouped at the top of `event-data.js`, `calendar-data.js`, `calendar-export.js`, `app.js`, and the preview launcher. CSS theme variables are at the top of `styles.css`; final responsive rules follow later. The main website source is JavaScript, not Python; the Python launcher only serves it locally.

The website and 20-event sample total about 430 KiB uncompressed. The supplied logo accounts for about 353 KiB. There are no remote font, framework, or JavaScript-library downloads. Keep the original logo for now; icon quality is scheduled for the PWA part.

## 10. Completion status and next part

All five Part 2 stages are implemented. Stage 5 passed 56 automated regression checks and targeted browser checks; details are in `WEBSITE_CHECKS.txt`. Your Stage 4 report confirmed successful accepted-data file checks and HTTP 200 responses for all site assets and event JSON.

The remaining acceptance step is your Windows/browser check of this final package. Physical iOS/Android behavior, specific calendar-app imports, real mobile-network speed, and a full screen-reader audit have not been independently certified here.

**Part 3: hosting and daily refresh** comes next: GitHub setup, GitHub Pages, and scheduled collector runs with last-good-data safeguards. Its current service requirements and plan will be reviewed before implementation. **Part 4: installable PWA and icons** follows. No public deployment, automatic collection, installation manifest, or service worker is included in this local website package.
