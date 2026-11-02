'use strict';
// Settings for this stage. No external libraries or build step are required.
const APP_SETTINGS = Object.freeze({dataUrl:'data/events.json', fetchTimeoutMs:12000, clockRefreshMs:30000});
const D = globalThis.ICCPulseData;
const C = globalThis.ICCPulseCalendar;
const E = globalThis.ICCPulseExport;
const $ = id => document.getElementById(id);
let acceptedData = null;
let selectedDay = D.dayKey(new Date());
let calendarDay = null;
let calendarView = 'day';
let renderedView = null;
let lastToday = selectedDay;
let returnFocus = null;
let overlapContext = null;
const expanded = {now:false,next:false};
function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function eventCard(event) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'event-card';
  card.onclick = () => openEvent(event,card);
  card.style.setProperty('--club-color', D.clubColor(event.club_color_key));
  const clubs = [...new Set(event.club_names.filter(n => n.trim()))];
  const location = typeof event.location === 'string' && event.location.trim() ? event.location.trim() : 'Location not listed';
  card.append(textElement('p','event-time',D.timeRange(event)), textElement('p','event-title',event.title), textElement('p','event-clubs',clubs.length ? clubs.join(' · ') : event.primary_club), textElement('p','event-location',location + (D.safeUrl(event.online_url) ? ' · Online option available' : '')), textElement('span','event-action','Details ›'));
  card.setAttribute('aria-label',`${event.title}, ${D.timeRange(event)}. Open event details.`);
  return card;
}
function renderSection(key, events, title, detail) {
  const container = $(key+'-events');
  container.replaceChildren();
  $(key+'-count').textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.append(textElement('p','empty-title',title),textElement('p','',detail));
    container.append(empty); return;
  }
  const visible = expanded[key] ? events : events.slice(0,D.SETTINGS.visiblePerSection);
  visible.forEach(e => container.append(eventCard(e)));
  if (events.length > D.SETTINGS.visiblePerSection) {
    const more = textElement('button','show-more',expanded[key] ? 'Show fewer' : `Show ${events.length-D.SETTINGS.visiblePerSection} more`);
    more.type = 'button'; more.setAttribute('aria-expanded',String(expanded[key]));
    more.onclick = () => {expanded[key] = !expanded[key]; render(); $(key+'-events').querySelector('button')?.focus();};
    container.append(more);
  }
}
function render() {
  const now = new Date();
  if (!acceptedData) return;
  const today=D.dayKey(now);
  const changedDay=today!==lastToday;
  if(changedDay){selectedDay=selectedDay===lastToday ? today : C.clampDay(selectedDay,C.navigation(now));lastToday=today;}
  const selection = D.selectToday(acceptedData.events, now);
  const warning = D.dataWarning(acceptedData, now);
  $('stale-notice').hidden = !warning; $('stale-notice').textContent = warning;
  $('empty-dataset').hidden = acceptedData.events.length !== 0;
  renderSection('now',selection.now,'No events happening now.', 'No events in these listings are happening right now.');
  renderSection('next',selection.next,'No more listed events today.',selection.ended.length ? 'Today’s earlier events have finished. Explore DVC Synch for upcoming dates.' : 'Check DVC Synch for events on another day.');
  renderCalendar(!calendarDay || changedDay);
  $('last-updated').textContent = 'Last updated '+D.formatter({month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(acceptedData.last_updated));
}
async function loadEvents() {
  const retrying=document.activeElement===$('retry');
  $('load-state').hidden = false; $('error-state').hidden = true;
  $('events-content').hidden = true; $('stale-notice').hidden = true;
  $('sample-notice').hidden = true; acceptedData = null; calendarDay = null;
  $('last-updated').textContent = 'Checking the latest update…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),APP_SETTINGS.fetchTimeoutMs);
  try {
    const response = await fetch(APP_SETTINGS.dataUrl,{cache:'no-store',signal:controller.signal});
    if (!response.ok) throw new Error(`Event data could not be opened (HTTP ${response.status}). Make sure data/events.json exists, then try again.`);
    acceptedData = D.validate(await response.json());
    $('sample-notice').hidden = response.headers.get('X-ICC-Sample') !== 'true';
    $('events-content').hidden = false; render();
    if(retrying) $('main').focus();
    console.info(`ICC PULSE — PART 2, STAGE 5\nAccepted events loaded: ${acceptedData.events.length}\nTimezone: ${acceptedData.timezone}\nLast updated: ${acceptedData.last_updated}\nCandidate data: rejected by design`);
  } catch (error) {
    $('error-message').textContent = error.name === 'AbortError' ? 'Loading took too long. Check your connection and try again.' : error instanceof SyntaxError ? 'The event file is not valid JSON. Run refresh_events.py to create accepted data.' : error.message;
    $('error-state').hidden = false; $('last-updated').textContent = 'Last update unavailable';
    if(retrying) $('retry').focus();
  } finally {clearTimeout(timeout); $('load-state').hidden = true;}
}
function renderDayCalendar(reposition=false) {
  if(!acceptedData) return;
  const now=new Date();
  const day=C.layout(acceptedData.events,selectedDay);
  const isNewDate=calendarDay!==selectedDay;calendarDay=selectedDay;
  const dateLabel=D.formatter({weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(new Date(day.start));
  $('day-summary').textContent=`${dateLabel} · ${day.segments.length} listed ${day.segments.length===1?'event':'events'}`;
  $('day-scroll').setAttribute('aria-label',`${dateLabel}, day calendar. Scroll for all hours.`);
  const coverage=C.coverage(acceptedData,day);
  const notes=[];
  if(coverage==='none') notes.push('This date is outside the saved data window. Refresh the event data or check DVC Synch for listings.');
  else if(coverage==='partial') notes.push('Saved data covers only part of this date. Check DVC Synch for complete listings.');
  else if(!day.segments.length) notes.push('No events listed for this date.');
  $('day-notice').hidden=!notes.length;$('day-notice').textContent=notes.join(' ');
  const timeline=$('day-timeline'),oldScroll=$('day-scroll').scrollTop;
  timeline.replaceChildren();timeline.style.height=`${day.minutes*C.SETTINGS.pixelsPerMinute+24}px`;
  // Elapsed-hour positions preserve both repeated hours on a fall-back day.
  for(let minute=0;minute<=day.minutes;minute+=60) {
    const row=document.createElement('div');row.className='hour-row';row.style.top=`${minute*C.SETTINGS.pixelsPerMinute}px`;
    const f=D.formatter({hour:'numeric',...(day.minutes!==1440 ? {timeZoneName:'short'} : {})});
    const label=minute===day.minutes ? 'Midnight' : f.format(new Date(day.start+minute*60000));
    row.append(textElement('span','hour-label',label));timeline.append(row);
  }
  const layer=document.createElement('div');layer.className='grid-events';timeline.append(layer);
  for(const group of day.groups) {
    const reserved=group.hidden.length ? 58 : 0;
    for(const s of group.visible) {
      const button=document.createElement('button');button.type='button';button.className='grid-event';
      button.style.setProperty('--club-color',D.clubColor(s.event.club_color_key));
      button.style.top=`${s.start*C.SETTINGS.pixelsPerMinute}px`;
      button.style.height=`${(s.end-s.start)*C.SETTINGS.pixelsPerMinute-1}px`;
      button.style.left=`calc((100% - ${reserved}px) / ${group.lanes} * ${s.lane} + 2px)`;
      button.style.width=`calc((100% - ${reserved}px) / ${group.lanes} - 4px)`;
      if(s.end-s.start<45) button.classList.add('short-event');
      const continuations=[s.continuesBefore?'Continues from previous day':'',s.continuesAfter?'Continues to next day':''].filter(Boolean);
      button.append(textElement('span','grid-title',(s.continuesBefore?'↑ ':'')+s.event.title+(s.continuesAfter?' ↓':'')),textElement('span','grid-time',D.timeRange(s.event)),textElement('span','grid-club',s.event.primary_club));
      button.title=`${s.event.title}\n${D.timeRange(s.event)}${continuations.length?'\n'+continuations.join('; '):''}`;
      button.setAttribute('aria-label',`${s.event.title}, ${D.timeRange(s.event)}. ${continuations.length?continuations.join('. ')+'. ':''}Open event details.`);
      button.onclick=()=>openEvent(s.event,button);layer.append(button);
    }
    if(group.hidden.length) {
      const more=textElement('button','overlap-more',`+${group.hidden.length} more`);more.type='button';
      more.style.top=`${Math.min(group.hidden[0].start*C.SETTINGS.pixelsPerMinute,day.minutes*C.SETTINGS.pixelsPerMinute-44)}px`;
      more.setAttribute('aria-label',`Show ${group.hidden.length} more overlapping ${group.hidden.length===1?'event':'events'}`);
      more.onclick=()=>openOverlap(group.hidden.map(s=>s.event),more);layer.append(more);
    }
  }
  if(selectedDay===D.dayKey(now)) {
    const line=document.createElement('div');line.className='now-line';line.style.top=`${(+now-day.start)/60000*C.SETTINGS.pixelsPerMinute}px`;
    line.setAttribute('aria-hidden','true');line.append(textElement('span','','Now'));timeline.append(line);
  }
  $('day-scroll').scrollTop=reposition || isNewDate ? C.initialScroll(day,selectedDay,now) : oldScroll;
}
function renderCalendar(reposition=false) {
  if(!acceptedData)return;
  const range=C.navigation(new Date());selectedDay=C.clampDay(selectedDay,range);
  $('previous-day').disabled=C.navigationTarget(calendarView,selectedDay,-1,range)===null;
  $('next-day').disabled=C.navigationTarget(calendarView,selectedDay,1,range)===null;
  $('previous-day').setAttribute('aria-label','Previous '+calendarView);
  $('next-day').setAttribute('aria-label','Next '+calendarView);
  for(const view of ['day','week','month']) $('view-'+view).setAttribute('aria-pressed',String(view===calendarView));
  $('day-scroll').hidden=calendarView!=='day';$('week-panel').hidden=calendarView!=='week';$('month-panel').hidden=calendarView!=='month';
  const reset=reposition || renderedView!==calendarView || calendarDay!==selectedDay;
  if(calendarView==='day')renderDayCalendar(reset);
  else if(calendarView==='week')renderWeekCalendar(reset);
  else renderMonthCalendar();
  $('grid-note').textContent=calendarView==='day'?'Tap an event for details · Scroll for all hours':calendarView==='week'?'Tap a day heading for Day view · Tap a block or +N for details':'Tap a date to open Day view · Numbers count events';
  calendarDay=selectedDay;renderedView=calendarView;
}
function switchView(view) {calendarView=view;renderCalendar(true);}
function navigateCalendar(direction) {
  const next=C.navigationTarget(calendarView,selectedDay,direction,C.navigation(new Date()));
  if(next!==null)changeDay(next);
}
function openDay(key) {calendarView='day';changeDay(key);$('view-day').focus();}
function setCalendarNotice(messages) {$('day-notice').hidden=!messages.length;$('day-notice').textContent=messages.join(' ');}
function shortDate(key) {return D.formatter({month:'short',day:'numeric'}).format(new Date(C.midnight(key)));}
function fullDate(key) {return D.formatter({weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(C.midnight(key)));}
function renderWeekCalendar(reposition) {
  const now=new Date(),range=C.navigation(now),axis=C.weekAxis(selectedDay),head=$('week-head'),timeline=$('week-timeline');
  const oldScroll=$('week-scroll').scrollTop;head.replaceChildren();timeline.replaceChildren();
  head.append(textElement('span','week-head-spacer',''));
  const pixels=C.SETTINGS.pixelsPerMinute;
  timeline.style.height=`${axis.minutes*pixels+24}px`;
  const rows=document.createElement('div');rows.className='week-hour-rows';timeline.append(rows);
  axis.slots.forEach((slot,index)=>{
    const row=document.createElement('div');row.className='week-hour-row';row.style.top=`${index*60*pixels}px`;
    const hour=slot.hour%12||12,label=`${hour} ${slot.hour<12?'AM':'PM'}${slot.occurrence?' ②':''}`;
    row.append(textElement('span','',label));rows.append(row);
  });
  const midnight=document.createElement('div');midnight.className='week-hour-row';midnight.style.top=`${axis.minutes*pixels}px`;midnight.append(textElement('span','','12 AM'));rows.append(midnight);
  const columns=document.createElement('div');columns.className='week-columns';timeline.append(columns);
  const uniqueIds=new Set();let missingCoverage=false;const startingPositions=[];
  for(const day of axis.days) {
    const enabled=day.key>=range.min && day.key<=range.max;
    const data=C.layout(acceptedData.events,day.key),coverage=C.coverage(acceptedData,day);
    if(enabled){data.segments.forEach(s=>uniqueIds.add(s.event.id));if(coverage!=='full')missingCoverage=true;}
    const header=document.createElement('div');header.className='week-day-head';
    const dayButton=document.createElement('button');dayButton.type='button';dayButton.className='week-day-button';dayButton.disabled=!enabled;
    dayButton.append(textElement('span','weekday',D.formatter({weekday:'short'}).format(new Date(day.start))),textElement('span','day-number',String(+day.key.slice(8))));
    dayButton.setAttribute('aria-label',`${fullDate(day.key)}. ${enabled?'Open Day view.':'Outside available dates.'}`);
    if(day.key===selectedDay)dayButton.classList.add('selected');
    if(day.key===D.dayKey(now))dayButton.setAttribute('aria-current','date');
    dayButton.onclick=()=>openDay(day.key);header.append(dayButton);
    const extras=document.createElement('div');extras.className='week-extras';
    const hidden=data.groups.flatMap(g=>g.hidden.map(s=>s.event));
    if(enabled && hidden.length) {
      const more=textElement('button','week-more','+'+hidden.length);more.type='button';
      more.title=`${hidden.length} more overlapping ${hidden.length===1?'event':'events'} on ${shortDate(day.key)}`;
      more.setAttribute('aria-label',`Show ${hidden.length} more overlapping ${hidden.length===1?'event':'events'} on ${fullDate(day.key)}`);
      more.onclick=()=>openOverlap(hidden,more);extras.append(more);
    } else if(enabled && coverage!=='full') {const unknown=textElement('span','week-unknown','?');unknown.title='Saved data does not cover this full date';extras.append(unknown);}
    header.append(extras);head.append(header);
    const column=document.createElement('div');column.className='week-column'+(!enabled?' outside-range':'')+(enabled&&coverage!=='full'?' incomplete-coverage':'');columns.append(column);
    const present=new Set(day.hours.map(h=>h.row));
    axis.slots.forEach((slot,index)=>{if(!present.has(index)){const gap=document.createElement('div');gap.className='clock-gap';gap.style.top=`${index*60*pixels}px`;gap.style.height=`${60*pixels}px`;gap.title='This clock hour does not occur on this date';column.append(gap);}});
    if(!enabled)continue;
    for(const group of data.groups)for(const segment of group.visible) {
      for(const [pieceIndex,piece] of C.weekPieces(segment,day).entries()) {
        startingPositions.push(piece.start);
        const event=segment.event,button=document.createElement('button');button.type='button';button.className='week-event';
        button.style.setProperty('--club-color',D.clubColor(event.club_color_key));
        button.style.top=`${piece.start*pixels}px`;button.style.height=`${Math.max(24,(piece.end-piece.start)*pixels-1)}px`;
        button.style.left=`calc(100% / ${group.lanes} * ${segment.lane} + 1px)`;button.style.width=`calc(100% / ${group.lanes} - 2px)`;
        button.append(textElement('span','week-event-text',(pieceIndex?'↳ ':'')+event.title));
        button.title=`${event.title}\n${fullDate(day.key)}\n${D.timeRange(event)}`;
        button.setAttribute('aria-label',`${event.title}, ${fullDate(day.key)}, ${D.timeRange(event)}. Open event details.`);
        button.onclick=()=>openEvent(event,button);column.append(button);
      }
    }
    if(day.key===D.dayKey(now)) {
      const marker=document.createElement('div');marker.className='week-now';marker.style.top=`${C.weekPosition(day,(+now-day.start)/60000)*pixels}px`;marker.setAttribute('aria-hidden','true');column.append(marker);
    }
  }
  $('day-summary').textContent=`${shortDate(axis.days[0].key)} – ${shortDate(axis.days[6].key)}, ${axis.days[6].key.slice(0,4)} · ${uniqueIds.size} listed ${uniqueIds.size===1?'event':'events'}`;
  $('week-scroll').setAttribute('aria-label',`Week of ${fullDate(axis.days[0].key)}. Scroll for all hours.`);
  const notes=[];
  if(missingCoverage)notes.push('Some dates are outside the saved data window. Shaded columns have incomplete coverage.');
  if(!uniqueIds.size && !missingCoverage)notes.push('No events listed on the available dates in this week.');
  setCalendarNotice(notes);
  const current=axis.days.find(d=>d.key===D.dayKey(now));
  const start=current?C.weekPosition(current,(+now-current.start)/60000)-60:startingPositions.length?Math.min(...startingPositions)-30:C.SETTINGS.defaultHour*60;
  $('week-scroll').scrollTop=reposition?Math.max(0,start)*pixels:oldScroll;
  head.style.paddingRight=`${Math.max(0,$('week-scroll').offsetWidth-$('week-scroll').clientWidth-2)}px`;
}
function renderMonthCalendar() {
  const now=new Date(),range=C.navigation(now),grid=$('month-grid');grid.replaceChildren();
  let missingCoverage=false;const uniqueIds=new Set();
  for(const cell of C.monthCells(selectedDay)) {
    if(!cell.inMonth){const blank=document.createElement('div');blank.className='month-blank';grid.append(blank);continue;}
    const day=C.layout(acceptedData.events,cell.key),enabled=cell.key>=range.min && cell.key<=range.max,coverage=C.coverage(acceptedData,day);
    const button=document.createElement('button');button.type='button';button.className='month-day';button.disabled=!enabled;
    button.append(textElement('span','month-number',String(+cell.key.slice(8))));
    if(cell.key===selectedDay)button.classList.add('selected');
    if(cell.key===D.dayKey(now))button.setAttribute('aria-current','date');
    if(enabled) {
      day.segments.forEach(s=>uniqueIds.add(s.event.id));
      if(coverage!=='full'){missingCoverage=true;button.append(textElement('span','month-count','?'));button.classList.add('incomplete-coverage');}
      else if(day.segments.length){button.append(textElement('span','month-count',String(day.segments.length)));}
      const dots=document.createElement('span');dots.className='month-dots';dots.setAttribute('aria-hidden','true');
      [...new Set(day.segments.map(s=>s.event.club_color_key))].slice(0,3).forEach(key=>{const dot=document.createElement('i');dot.style.background=D.clubColor(key);dots.append(dot);});button.append(dots);
    }
    button.setAttribute('aria-label',`${fullDate(cell.key)}. ${!enabled?'Outside available dates.':coverage!=='full'?'Saved data incomplete. Open Day view.':day.segments.length+' listed '+(day.segments.length===1?'event':'events')+'. Open Day view.'}`);
    button.onclick=()=>openDay(cell.key);grid.append(button);
  }
  const name=D.formatter({month:'long',year:'numeric'}).format(new Date(C.midnight(C.monthStart(selectedDay))));
  $('day-summary').textContent=`${name} · ${uniqueIds.size} listed ${uniqueIds.size===1?'event':'events'} on available dates`;
  grid.setAttribute('aria-label',name);
  setCalendarNotice(missingCoverage?['? means the saved data does not cover that full date. Open the day or check DVC Synch.']:!uniqueIds.size?['No events listed on the available dates in this month.']:[]);
}
function changeDay(value) {
  const range=C.navigation(new Date());
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z'));
  if(valid) selectedDay=C.clampDay(value,range);
  renderCalendar(true);
}
function showDialog(trigger) {
  const dialog=$('event-dialog');
  if(!dialog.open) {returnFocus=trigger;dialog.showModal();}
  $('dialog-close').focus();
}
function externalLink(label,url) {
  const a=textElement('a','detail-link',label+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';
  a.setAttribute('aria-label',label+', opens a new tab');return a;
}
function detailField(label,value) {
  const block=document.createElement('div');block.className='detail-field';
  block.append(textElement('h3','detail-label',label),textElement('p','',value));return block;
}
function exportActions(event) {
  const section=document.createElement('section');section.className='export-section';
  section.setAttribute('aria-label','Add this event to your calendar');
  section.append(textElement('h3','detail-label','Add to your calendar'));
  const actions=document.createElement('div');actions.className='export-actions';
  const status=textElement('p','export-status','');status.setAttribute('role','status');
  try {
    const google=externalLink('Google Calendar',E.googleUrl(event));google.className='export-button';
    const apple=textElement('button','export-button','Apple / Outlook (.ics)');apple.type='button';
    apple.setAttribute('aria-label','Apple / Outlook, download this event as an .ics calendar file');
    apple.onclick=()=>{
      let url=null;
      try {
        const blob=new Blob([E.ics(event)],{type:'text/calendar;charset=utf-8'});
        url=URL.createObjectURL(blob);
        const link=document.createElement('a');link.href=url;link.download=E.filename(event);
        link.hidden=true;actions.append(link);link.click();link.remove();
        status.textContent='Open the downloaded .ics file in your calendar to finish adding it.';
      } catch (_) {
        status.textContent='The calendar file could not be created. Try Google Calendar or check DVC Synch.';
      } finally {
        // Give the browser time to finish handing the file to its download handler.
        if(url) setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
    };
    actions.append(google,apple);section.append(actions);
    section.append(textElement('p','export-note','Adds a copy. Later event changes won’t sync automatically.'));
  } catch (_) {
    status.textContent='Calendar export is unavailable for this event. Check its details on DVC Synch.';
  }
  section.append(status);return section;
}
function openEvent(event,trigger,fromOverlap=false) {
  if(!fromOverlap) overlapContext=null;
  $('dialog-back').hidden=!overlapContext;
  $('dialog-title').textContent=event.title;
  const body=$('dialog-body');body.replaceChildren();
  const clubs=[...new Set(event.club_names.filter(n=>n.trim()))];
  body.append(detailField(clubs.length>1?'Clubs / co-hosts':'Club',clubs.length?clubs.join(' · '):event.primary_club));
  const location=typeof event.location==='string' && event.location.trim() ? event.location.trim() : 'Location not listed';
  const place=detailField('Location',location);
  const online=D.safeUrl(event.online_url);
  if(online) place.append(externalLink('Open online attendance link',online));
  body.append(place);
  const dateFormat=D.formatter({weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const dateLabel=dateFormat.format(new Date(event.start));
  const fullTime=D.formatter({weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const exactTime=D.dayKey(event.start)===D.dayKey(event.end) ? dateLabel+' · '+D.timeRange(event) : fullTime.format(new Date(event.start))+' – '+fullTime.format(new Date(event.end));
  body.append(detailField('Exact time',exactTime));
  body.append(externalLink('View event on DVC Synch',D.safeUrl(event.url,true)));
  body.append(exportActions(event));
  showDialog(trigger);
}
function openOverlap(events,trigger,returning=false) {
  if(!returning) overlapContext={events,trigger};
  $('dialog-back').hidden=true;
  $('dialog-title').textContent=`${events.length} more overlapping ${events.length===1?'event':'events'}`;
  const body=$('dialog-body');body.replaceChildren();body.className='dialog-body';
  const list=document.createElement('div');list.className='event-list';
  for(const event of events) {const card=eventCard(event);card.onclick=()=>openEvent(event,trigger,true);list.append(card);}
  body.append(list);showDialog(trigger);
}
$('dialog-close').onclick=()=>$('event-dialog').close();
$('dialog-back').onclick=()=>{if(overlapContext) openOverlap(overlapContext.events,overlapContext.trigger,true);};
$('event-dialog').addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')].filter(element=>element.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(!first)return;
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});
$('event-dialog').addEventListener('click',e=>{if(e.target===$('event-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)e.target.close();}});
$('event-dialog').addEventListener('close',()=>{overlapContext=null;if(returnFocus?.isConnected)returnFocus.focus();else $('view-day').focus();});
$('previous-day').onclick=()=>navigateCalendar(-1);
$('next-day').onclick=()=>navigateCalendar(1);
$('today-button').onclick=()=>changeDay(D.dayKey(new Date()));
for(const view of ['day','week','month']) $('view-'+view).onclick=()=>switchView(view);
$('retry').addEventListener('click',loadEvents);
// Avoid replacing focused controls or moving the grid while a popup is open.
function canRefresh(){return !$('event-dialog').open && !document.activeElement.closest?.('.today-overview, .event-list, .day-section');}
setInterval(()=>{if(canRefresh())render();},APP_SETTINGS.clockRefreshMs);
document.addEventListener('visibilitychange',()=>{if(!document.hidden && canRefresh())render();});
loadEvents();
