/* Single-event exports use source instants, never rounded calendar blocks. */
(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./event-data.js') : root.ICCPulseData;
  const SETTINGS = Object.freeze({
    googleUrl: 'https://calendar.google.com/calendar/render',
    productId: '-//ICC Pulse//Club Event Export//EN',
    uidSuffix: '@icc-pulse.dvc-engage',
    timeZone: D.SETTINGS.timeZone
  });
  const cleanText = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  function instant(value) {
    if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error('This event has an invalid calendar time.');
    }
    return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function fields(event) {
    if (!event || typeof event.id !== 'string' || !event.id.trim() || typeof event.title !== 'string' || !event.title.trim()) {
      throw new Error('This event is missing calendar details.');
    }
    const start = instant(event.start), end = instant(event.end);
    if (Date.parse(event.end) <= Date.parse(event.start)) throw new Error('This event has an invalid calendar duration.');
    const source = D.safeUrl(event.url, true);
    if (!source) throw new Error('This event has an invalid source link.');
    const names = Array.isArray(event.club_names) ? event.club_names : [];
    const clubs = [...new Set(names.filter(n => typeof n === 'string').map(n => cleanText(n).trim()).filter(Boolean))];
    const online = D.safeUrl(event.online_url);
    const location = typeof event.location === 'string' ? cleanText(event.location).trim() : '';
    const f = D.formatter({year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
    const description = [
      'Club / co-hosts: ' + (clubs.length ? clubs.join(' · ') : cleanText(event.primary_club).trim() || 'Not listed'),
      'Pacific time: ' + f.format(new Date(event.start)) + ' – ' + f.format(new Date(event.end)),
      ...(online ? ['Online attendance: ' + online] : []),
      'DVC Synch event: ' + source,
      'Added from ICC Pulse. This is a copy; check DVC Synch for changes.'
    ].join('\n\n');
    return {title:cleanText(event.title), location, description, source, start, end};
  }
  function googleUrl(event) {
    const f = fields(event), url = new URL(SETTINGS.googleUrl);
    url.search = new URLSearchParams({action:'TEMPLATE',text:f.title,dates:f.start+'/'+f.end,ctz:SETTINGS.timeZone,details:f.description,location:f.location}).toString();
    return url.href;
  }
  // RFC 5545 TEXT escaping prevents event text becoming extra properties.
  function escapeText(value) {
    return cleanText(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }
  // Fold at 75 UTF-8 octets, counting the continuation space and keeping
  // each Unicode code point intact. Calendar files require CRLF line breaks.
  function foldLine(value) {
    const encoder = new TextEncoder();
    let result = '', line = '', size = 0;
    for (const character of value) {
      const bytes = encoder.encode(character).length;
      if (size + bytes > 75) {result += line + '\r\n';line = ' ';size = 1;}
      line += character;size += bytes;
    }
    return result + line;
  }
  function ics(event, now = new Date()) {
    const f = fields(event);
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:'+SETTINGS.productId,'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT','UID:dvc-engage-'+encodeURIComponent(event.id)+SETTINGS.uidSuffix,
      'DTSTAMP:'+instant(now.toISOString()),'DTSTART:'+f.start,'DTEND:'+f.end,
      'SUMMARY:'+escapeText(f.title),
      ...(f.location ? ['LOCATION:'+escapeText(f.location)] : []),
      'DESCRIPTION:'+escapeText(f.description),'URL:'+f.source,'END:VEVENT','END:VCALENDAR'];
    return lines.map(foldLine).join('\r\n')+'\r\n';
  }
  function filename(event) {
    const slug = cleanText(event.title).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65) || 'event';
    const id = String(event.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40) || 'calendar';
    return 'ICC-Pulse-'+slug+'-'+id+'.ics';
  }
  const api = {SETTINGS,googleUrl,ics,filename};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICCPulseExport = api;
})(globalThis);
