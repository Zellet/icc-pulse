/* Calendar math. Pure functions keep time zones and layout independently testable. */
(function(root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./event-data.js') : root.ICCPulseData;
  const SETTINGS = Object.freeze({daysAhead:30, roundingMinutes:15, pixelsPerMinute:1.6, defaultHour:9});
  function addDays(key, days) {
    const date = new Date(key+'T12:00:00Z');
    date.setUTCDate(date.getUTCDate()+days);
    return date.toISOString().slice(0,10);
  }
  // Solve Pacific midnight independently of the device timezone. Midnight is
  // unambiguous in this zone, including the spring/fall transition dates.
  function midnight(key) {
    const target = Date.parse(key+'T00:00:00Z');
    let guess = target;
    const f = D.formatter({year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<3;i++) {
      const p = Object.fromEntries(f.formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
      const localAsUTC = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
      guess += target-localAsUTC;
    }
    return guess;
  }
  function bounds(key) {
    const start = midnight(key), end = midnight(addDays(key,1));
    return {start,end,minutes:(end-start)/60000};
  }
  function navigation(now) {const min=D.dayKey(now);return {min,max:addDays(min,SETTINGS.daysAhead)};}
  function clampDay(key, range) {return key < range.min ? range.min : key > range.max ? range.max : key;}
  function layout(events, key) {
    const day=bounds(key), step=SETTINGS.roundingMinutes;
    const segments=events.filter(e=>e.startMs<day.end && e.endMs>day.start).map(event=>{
      const exactStart=Math.max(0,(event.startMs-day.start)/60000);
      const exactEnd=Math.min(day.minutes,(event.endMs-day.start)/60000);
      const start=Math.min(day.minutes-step, Math.max(0,Math.round(exactStart/step)*step));
      const end=Math.min(day.minutes,Math.max(start+step,Math.round(exactEnd/step)*step));
      return {event,start,end,continuesBefore:event.startMs<day.start,continuesAfter:event.endMs>day.end};
    }).sort((a,b)=>a.start-b.start || a.event.startMs-b.event.startMs || a.event.id.localeCompare(b.event.id));
    const groups=[];
    for(const segment of segments) {
      let group=groups.at(-1);
      if(!group || segment.start>=group.end) {group={start:segment.start,end:segment.end,items:[]};groups.push(group);}
      group.items.push(segment); group.end=Math.max(group.end,segment.end);
    }
    for(const group of groups) {
      const laneEnds=[-1,-1]; group.visible=[];group.hidden=[];group.lanes=1;
      for(const segment of group.items) {
        const lane=laneEnds.findIndex(end=>end<=segment.start);
        if(lane<0) group.hidden.push(segment);
        else {laneEnds[lane]=segment.end;group.visible.push({...segment,lane});group.lanes=Math.max(group.lanes,lane+1);}
      }
    }
    return {...day,segments,groups};
  }
  function coverage(data, day) {
    const start=Date.parse(data.window_start),end=Date.parse(data.window_end_exclusive);
    if(day.start>=end || day.end<=start) return 'none';
    return start>day.start || end<day.end ? 'partial' : 'full';
  }
  function initialScroll(day, key, now) {
    const target=key===D.dayKey(now) ? (+now-day.start)/60000-60 : day.segments.length ? day.segments[0].start-30 : SETTINGS.defaultHour*60;
    return Math.max(0,target)*SETTINGS.pixelsPerMinute;
  }
  function weekStart(key) {
    const weekday=new Date(key+'T12:00:00Z').getUTCDay();
    return addDays(key,-((weekday+6)%7));
  }
  function monthStart(key){return key.slice(0,7)+'-01';}
  function shiftMonth(key, amount) {
    const date=new Date(monthStart(key)+'T12:00:00Z');
    date.setUTCMonth(date.getUTCMonth()+amount);
    const year=date.getUTCFullYear(),month=date.getUTCMonth();
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    date.setUTCDate(Math.min(+key.slice(8),last));
    return date.toISOString().slice(0,10);
  }
  function period(view,key) {
    if(view==='week'){const start=weekStart(key);return {start,end:addDays(start,6)};}
    if(view==='month'){const start=monthStart(key);return {start,end:addDays(shiftMonth(start,1),-1)};}
    return {start:key,end:key};
  }
  function navigationTarget(view,key,direction,range) {
    const p=period(view,key);
    if(direction<0 && p.start<=range.min || direction>0 && p.end>=range.max)return null;
    const target=view==='month'?shiftMonth(key,direction):addDays(key,direction*(view==='week'?7:1));
    return clampDay(target,range);
  }
  function monthCells(key) {
    const p=period('month',key),first=weekStart(p.start),cells=[];
    const last=addDays(weekStart(p.end),6);
    for(let date=first;date<=last;date=addDays(date,1)) cells.push({key:date,inMonth:date.slice(0,7)===key.slice(0,7)});
    return cells;
  }
  // A common wall-clock axis aligns the seven days. During fall-back it has
  // an extra 1 AM row; ordinary days leave that row blank. Spring-forward
  // days leave the missing hour blank. No event is painted into a skipped hour.
  function weekAxis(key) {
    const first=weekStart(key),days=[],union=new Map();
    const hourFormat=D.formatter({hour:'2-digit',hourCycle:'h23'});
    for(let i=0;i<7;i++) {
      const date=addDays(first,i),day=bounds(date),seen=new Map(),hours=[];
      for(let minute=0;minute<day.minutes;minute+=60) {
        const hour=+hourFormat.format(new Date(day.start+minute*60000));
        const occurrence=seen.get(hour)||0;seen.set(hour,occurrence+1);
        const id=hour+':'+occurrence;
        const slot={id,hour,occurrence,minute};hours.push(slot);union.set(id,{id,hour,occurrence});
      }
      days.push({...day,key:date,hours});
    }
    const slots=[...union.values()].sort((a,b)=>a.hour-b.hour || a.occurrence-b.occurrence);
    const rows=new Map(slots.map((s,i)=>[s.id,i]));
    days.forEach(d=>d.hours.forEach(h=>{h.row=rows.get(h.id);}));
    return {days,slots,minutes:slots.length*60};
  }
  function weekPieces(segment,day) {
    const pieces=[];
    for(const h of day.hours) {
      const a=Math.max(segment.start,h.minute),b=Math.min(segment.end,h.minute+60);
      if(b<=a)continue;
      const start=h.row*60+a-h.minute,end=h.row*60+b-h.minute;
      const previous=pieces.at(-1);
      if(previous && previous.end===start)previous.end=end;else pieces.push({start,end});
    }
    return pieces;
  }
  function weekPosition(day,elapsed) {
    const hour=day.hours.find(h=>elapsed>=h.minute && elapsed<h.minute+60);
    return hour ? hour.row*60+elapsed-hour.minute : elapsed<=0 ? 0 : (day.hours.at(-1).row+1)*60;
  }
  const api={SETTINGS,addDays,midnight,bounds,navigation,clampDay,layout,coverage,initialScroll,weekStart,monthStart,shiftMonth,period,navigationTarget,monthCells,weekAxis,weekPieces,weekPosition};
  if(typeof module!=='undefined' && module.exports) module.exports=api;else root.ICCPulseCalendar=api;
})(globalThis);
