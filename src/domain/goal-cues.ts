import { hashText } from './pages';
export type CueSettings = { turnaround: boolean; countdown: boolean; version: number };
export const DEFAULT_CUES: CueSettings = { turnaround:false,countdown:false,version:0 };
export const CUE_SETTINGS_KEY='@runjourney/goal-cues/settings/v1';
export const cueStateKey=(runId:string)=>'@runjourney/goal-cues/state/v1/'+hashText(runId);
export type CueSample={runId:string;revision:string;epoch:number;kind:'distance'|'time';target:number;progress:number;at:number;sourceAt:number;running:boolean;enabled:boolean};
export type CueState={version:1;goals:Record<string,{progress:number;half:boolean;floor:number;countdownStarted:boolean;epoch:number;settingsVersion:number;turnaround:boolean;countdown:boolean}>};
export type CueEvent={type:'TURNAROUND'|'GOAL_COUNTDOWN';label:number;message:string;chime?:boolean};
export function validCueSettings(s:unknown):s is CueSettings {
 const v=s as CueSettings;return !!v&&typeof v.turnaround==='boolean'&&typeof v.countdown==='boolean'&&Number.isSafeInteger(v.version)&&v.version>=0;
}
export function cueLabel(remaining:number){return Math.ceil(remaining/10)*10;}
export function validCueState(value:unknown):value is CueState {
 const s=value as CueState;
 return !!s&&s.version===1&&!!s.goals&&typeof s.goals==='object'&&!Array.isArray(s.goals)&&Object.keys(s.goals).length<=64&&Object.values(s.goals).every(g=>g&&Number.isFinite(g.progress)&&g.progress>=0&&typeof g.half==='boolean'&&typeof g.countdownStarted==='boolean'&&Number.isInteger(g.floor)&&g.floor>=0&&g.floor<=210&&Number.isSafeInteger(g.epoch)&&g.epoch>=0&&Number.isSafeInteger(g.settingsVersion)&&g.settingsVersion>=0&&typeof g.turnaround==='boolean'&&typeof g.countdown==='boolean');
}
/** Pure monotone ledger. Consume before dispatch: crashes may skip, never replay. */
export function advanceCues(previous:CueState|null,s:CueSample,settings:CueSettings){
 const state:CueState=previous?JSON.parse(JSON.stringify(previous)):{version:1,goals:{}};
 const events:CueEvent[]=[],decisions:{reason:string;labels?:number[]}[]=[];
 if(!s.enabled||!Number.isFinite(s.target)||s.target<=0||!Number.isFinite(s.progress)||s.progress<0||!Number.isFinite(s.sourceAt)||s.at<s.sourceAt||s.at-s.sourceAt>5000){return {state,events,decisions:[{reason:'DISABLED_OR_INVALID_OR_STALE'}],changed:false};}
 if(!settings.turnaround&&!settings.countdown&&!previous)return {state,events,decisions:[{reason:'SETTINGS_OFF'}],changed:false};
 const range=s.kind==='distance'?200:60,remaining=s.target-s.progress,label=cueLabel(remaining);
 const old=state.goals[s.revision];
 const oldProgress=old?.progress,oldFields=old?JSON.stringify({...old,progress:0}):null;
 if(!old&&Object.keys(state.goals).length>=64)return {state,events,decisions:[{reason:'GOAL_LEDGER_CAPACITY'}],changed:false};
 const reset=!old||old.epoch!==s.epoch||old.settingsVersion!==settings.version;
 const g=old??{progress:s.progress,half:false,floor:range+10,countdownStarted:false,epoch:s.epoch,settingsVersion:settings.version,turnaround:settings.turnaround,countdown:settings.countdown};
 if(reset||g.turnaround!==settings.turnaround){
   if(s.progress>=s.target/2){g.half=true;decisions.push({reason:'HALF_ALREADY_PASSED_AT_BASELINE'});}
 }
 if(reset||g.countdown!==settings.countdown){g.floor=Math.min(g.floor,label);decisions.push({reason:'COUNTDOWN_BASELINE_NO_CATCHUP'});}
 if(s.progress>=s.target){g.half=true;g.floor=0;decisions.push({reason:'GOAL_REACHED_NO_AUDIO'});}
 else if(s.progress>=g.progress){
   if(settings.turnaround&&!g.half&&s.progress>=s.target/2){
     g.half=true;
     if(s.running&&s.progress-s.target/2<=(s.kind==='distance'?50:15)){
       const half=s.target/2;
       events.push({type:'TURNAROUND',label:half,message:s.kind==='distance'?`目標の半分、${half/1000}キロを通過しました。折り返し地点です。`:`目標時間の半分、${half/60}分が経過しました。折り返しの目安です。`});
     }else decisions.push({reason:s.running?'HALF_LATE_CROSSING_SKIPPED':'HALF_PAUSED_SKIPPED'});
   }
   if(settings.countdown&&label<=range&&label>=10&&label<g.floor){
     const skipped:number[]=[];for(let n=Math.min(range,g.floor-10);n>label;n-=10)skipped.push(n);
     if(skipped.length)decisions.push({reason:'COUNTDOWN_CROSSED_OLDER_SKIPPED',labels:skipped});
     g.floor=label;
     if(s.running){events.push({type:'GOAL_COUNTDOWN',label,chime:!g.countdownStarted,message:`残り${label}${s.kind==='distance'?'メートル':'秒'}`});g.countdownStarted=true;}
     else decisions.push({reason:'COUNTDOWN_PAUSED_SKIPPED',labels:[label]});
   }
 }else decisions.push({reason:'PROGRESS_REVERSED_NO_REPLAY'});
 g.progress=Math.max(g.progress,s.progress);g.epoch=s.epoch;g.settingsVersion=settings.version;g.turnaround=settings.turnaround;g.countdown=settings.countdown;state.goals[s.revision]=g;
 // Checkpoint only reservations/baselines, not every GPS fix. Monotone half and
 // threshold marks already prevent replay between checkpoints.
 if(oldFields===JSON.stringify({...g,progress:0}))g.progress=oldProgress!;
 return {state,events,decisions,changed:JSON.stringify(state)!==JSON.stringify(previous)};
}
