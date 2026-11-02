/* Pure data functions shared by the page and the offline checks. */
(function (root) {
  'use strict';
  const SETTINGS = Object.freeze({
    timeZone: 'America/Los_Angeles', staleHours: 36, visiblePerSection: 3,
    colors: ['#93d8ff', '#a8e5ab', '#dec0ff', '#ffd294', '#ffafbe', '#8ee0d6', '#cfde93', '#b9c8ff']
  });
  const formatter = (options) => new Intl.DateTimeFormat('en-US', { timeZone: SETTINGS.timeZone, ...options });
  function dayKey(value) {
    const parts = formatter({year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const get = (type) => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function safeUrl(value, eventLink = false) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password) return null;
      if (eventLink && (u.hostname !== 'dvc.campuslabs.com' || !u.pathname.startsWith('/engage/event/'))) return null;
      return u.href;
    } catch (_) { return null; }
  }
  function validInstant(value) {
    return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function validate(data) {
    const fail = (reason) => { throw new Error(reason); };
    if (!data || data.schema_version !== 1 || data.candidate_only !== false) fail('The file is not accepted schema-version-1 event data. Run refresh_events.py and use data/events.json.');
    if (data.timezone !== SETTINGS.timeZone) fail('The event file has an unexpected time zone.');
    if (![data.last_updated, data.window_start, data.window_end_exclusive].every(validInstant) || Date.parse(data.window_start) >= Date.parse(data.window_end_exclusive)) fail('The event file has invalid update or date-window information.');
    if (!Array.isArray(data.events) || data.counts?.included !== data.events.length) fail('The event count does not match the file contents.');
    const ids = new Set();
    const events = data.events.map((e, index) => {
      if (!e || !['id','title','primary_club','club_color_key','url'].every(k => typeof e[k] === 'string' && e[k].trim()) || !Array.isArray(e.club_names) || !e.club_names.every(n => typeof n === 'string') || !validInstant(e.start) || !validInstant(e.end)) fail(`Event ${index + 1} has missing or invalid fields.`);
      const startMs = Date.parse(e.start), endMs = Date.parse(e.end);
      if (endMs <= startMs || startMs >= Date.parse(data.window_end_exclusive) || endMs <= Date.parse(data.window_start) || ids.has(e.id)) fail(`Event ${index + 1} has invalid times or a duplicate ID.`);
      if (!safeUrl(e.url, true)) fail(`Event ${index + 1} has an invalid DVC Synch link.`);
      ids.add(e.id);
      return {...e, startMs, endMs};
    });
    return {...data, events: events.sort((a,b) => a.startMs-b.startMs || a.title.localeCompare(b.title))};
  }
  function selectToday(events, now) {
    const time = +now, today = dayKey(now);
    return {
      now: events.filter(e => e.startMs <= time && e.endMs > time),
      next: events.filter(e => e.startMs > time && dayKey(e.startMs) === today),
      ended: events.filter(e => e.endMs <= time && dayKey(e.endMs - 1) === today)
    };
  }
  function dataWarning(data, now) {
    const ageHours = (+now - Date.parse(data.last_updated)) / 3600000;
    if (ageHours < -0.08334) return 'The update time is in the future. Check your device clock before relying on these listings.';
    if (+now < Date.parse(data.window_start) || +now >= Date.parse(data.window_end_exclusive)) return 'This saved data does not cover today. Listings may be incomplete; check DVC Synch for current events.';
    if (ageHours > SETTINGS.staleHours || dayKey(data.window_start) < dayKey(now)) return 'These are saved listings from an earlier update. Events may have changed; check DVC Synch before attending.';
    return '';
  }
  function clubColor(key) {
    let hash = 0;
    for (const c of key) hash = (Math.imul(hash,31) + c.charCodeAt(0)) >>> 0;
    return SETTINGS.colors[hash % SETTINGS.colors.length];
  }
  function timeRange(e) {
    const time = formatter({hour:'numeric',minute:'2-digit'});
    const dated = formatter({month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const zoneAt = value => formatter({timeZoneName:'short'}).formatToParts(new Date(value)).find(p => p.type === 'timeZoneName').value;
    const startZone = zoneAt(e.start), endZone = zoneAt(e.end);
    const f = dayKey(e.start) === dayKey(e.end) ? time : dated;
    return `${f.format(new Date(e.start))}${startZone !== endZone ? ' '+startZone : ''} – ${f.format(new Date(e.end))} ${endZone}`;
  }
  const api = {SETTINGS, formatter, dayKey, safeUrl, validate, selectToday, dataWarning, clubColor, timeRange};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICCPulseData = api;
})(globalThis);
