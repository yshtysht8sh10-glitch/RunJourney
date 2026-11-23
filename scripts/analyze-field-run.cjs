// Read-only private logs. Output is NEW and contains no coordinates or utterance text.
require('./sqlite-pc-runtime.cjs');
const fs=require('node:fs'),{createHash}=require('node:crypto');
const {summarizeStopLatency}=require('../src/domain/stop-latency.ts');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/analyze-field-run.cjs voice.json NEW-private-report.json');
const bytes=fs.readFileSync(input),j=JSON.parse(bytes);
const runId=j.latencySummary?.runId;if(!runId)throw Error('Select a run before exporting diagnostics');
const rows=j.entries.filter(e=>e.data?.runId===runId),p=rows.filter(e=>e.type==='STOP_PIPELINE'),c=rows.filter(e=>e.type==='STOP_CHECKPOINT');
const native=rows.filter(e=>!['STOP_PIPELINE','STOP_CHECKPOINT','VOICE_GENERATED','PACE_EVALUATION'].includes(e.type));
const events=new Map(),byType={};
for(const e of native){const k=e.id??e.type;const v=events.get(k)??{id:k,type:e.type,generatedAt:e.generatedAt,sourceSampleAt:e.data?.gps?.timestamp,expiresAt:e.expiresAt,queueAt:e.nativeQueuedAt,statuses:[]};v.statuses.push({status:e.status,at:e.loggedAt});events.set(k,v);((byType[e.type]??={})[e.status]??=0);byType[e.type][e.status]++;}
const confirmed=p.filter(e=>/CONFIRMED/.test(e.status)).map(e=>({decision:e.status,...e.data.pipeline,overlappingCheckpoints:c.filter(c=>c.data.startedAt<e.data.pipeline.enteredAt&&c.data.finishedAt>e.data.pipeline.submittedAt).length}));
const long=p.filter(e=>e.data.pipeline.repositoryWaitMs>1000);
const report={schema:1,sha256:createHash('sha256').update(bytes).digest('hex'),runId,summary:summarizeStopLatency(j.entries,runId),nativeByType:byType,events:[...events.values()],confirmations:confirmed,
 longQueueSamples:long.length,longQueueOverlappingCheckpoint:long.filter(e=>c.some(c=>c.data.startedAt<=e.data.pipeline.submittedAt&&c.data.finishedAt>e.data.pipeline.submittedAt)).length,
 alreadyExpiredWhenGenerated:native.filter(e=>e.status==='EXPIRED'&&e.generatedAt>e.expiresAt).length,
 limitations:['DONE does not prove audibility.','Pace interval is minimum eligibility interval, not a periodic one-minute timer.','Provider-native arrival and physical stop time are unavailable.']};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({runId,stages:report.summary.stages,nativeByType:byType,longQueueSamples:report.longQueueSamples,overlap:report.longQueueOverlappingCheckpoint,alreadyExpired:report.alreadyExpiredWhenGenerated},null,2));
