// Read-only private analysis: exact run boundaries from verified backup, retained logs.
require('./sqlite-pc-runtime.cjs');
const fs=require('node:fs'),{createHash}=require('node:crypto');
const {decodeBackup}=require('../src/repositories/sqlite-backup.ts');
const {sourceFromRun}=require('../src/domain/pages.ts');
const {effectiveRun}=require('../src/utils/run-model.ts');
const {summarizeGroup}=require('../src/domain/history-groups.ts');
(async()=>{
  const [backup,voice,localDay='2026-11-05']=process.argv.slice(2);
  const decoded=await decodeBackup(fs.readFileSync(backup,'utf8'),async t=>createHash('sha256').update(t).digest('hex'));
  const journal=JSON.parse(fs.readFileSync(voice,'utf8'));
  const runs=decoded.snapshot.runs.filter(r=>!r.trashedAt&&new Date(r.startedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})===localDay).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const groupMembers=await Promise.all(runs.map(async r=>{
    const summary=await sourceFromRun(r).summary();
    return {summary,first:r.points.find(p=>p.timestamp>=Date.parse(r.startedAt)),last:r.points.filter(p=>p.timestamp<=Date.parse(r.endedAt)).at(-1)};
  }));
  const report={localDay,group:summarizeGroup(groupMembers,true),runs:runs.map(r=>{
    const rows=journal.entries.filter(e=>e.data?.runId===r.id);
    const first=Math.min(...rows.map(e=>e.loggedAt)),last=Math.max(...rows.map(e=>e.loggedAt));
    const boundaries=Array.from({length:Math.floor((Date.parse(r.endedAt)-Date.parse(r.startedAt))/600000)},(_,i)=>{
      const due=i+1,scheduledAt=Date.parse(r.startedAt)+due*600000,id=`${r.id}:clock:${due}`;
      const notices=rows.filter(e=>e.id===id),when=notices[0]?.loggedAt??scheduledAt;
      const competing=rows.filter(e=>e.status==='STARTED'&&e.type!=='CURRENT_TIME').filter(e=>{
        const terminal=rows.find(t=>t.id===e.id&&t.loggedAt>=e.loggedAt&&['DONE','INTERRUPTED_STATE_CHANGED','INTERRUPTED_BY_TRANSITION','ERROR'].includes(t.status));
        return e.loggedAt<=when&&terminal?.loggedAt>=when;
      }).map(e=>e.type);
      return {due,scheduledAt,statuses:notices.map(e=>e.status),generatedAt:notices[0]?.loggedAt??null,competing,
        classification:!notices.length?'UNCONFIRMED_MISSING_OR_RETENTION':notices.some(e=>e.status==='SKIPPED_CLOCK_BUSY_PAUSED_OR_LATE')?'EXPECTED_SUPPRESSION':'GENERATED',withinRetainedSpan:scheduledAt>=first&&scheduledAt<=last};
    });
    const noise=rows.filter(e=>e.type==='NOISE_LEVEL'&&e.status==='MONITORING');
    const gains=noise.map(e=>e.data.gain).sort((a,b)=>a-b);
    const audio=rows.filter(e=>e.status==='STARTED');
    return {id:r.id,startedAt:r.startedAt,endedAt:r.endedAt,retainedRows:rows.length,retainedFrom:first,retainedTo:last,
      clockSettingsAtExport:JSON.parse(decoded.snapshot.settings['@runjourney/current-time/v1']??'null'),
      clockIntervalInference:'10 minute boundaries observed; export settings are not proof of unchanged settings throughout older runs.',boundaries,
      noise:{samples:noise.length,gainMin:gains[0]??null,gainMedian:gains[Math.floor(gains.length/2)]??null,gainMax:gains.at(-1)??null,
        atCeiling:gains.filter(g=>g>=.99).length,minDbfs:Math.min(...noise.map(e=>e.data.dbfs)),maxDbfs:Math.max(...noise.map(e=>e.data.dbfs)),
        routes:[...new Set(audio.map(e=>e.audio?.outputType))],mediaVolumes:[...new Set(audio.map(e=>e.audio?.mediaVolume))],fallbackIds:[...new Set(rows.filter(e=>e.audio?.adaptiveFallback).map(e=>e.id))]},
      observedActiveMs:effectiveRun(r).activeRunningTime};
  })};
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
