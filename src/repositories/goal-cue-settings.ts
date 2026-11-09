import { database } from './database';
import { CUE_SETTINGS_KEY,DEFAULT_CUES,validCueSettings,type CueSettings } from '../domain/goal-cues';
export const GoalCueSettings={
 async get():Promise<CueSettings>{const text=await(await database()).getSetting(CUE_SETTINGS_KEY);if(!text)return {...DEFAULT_CUES};const value=JSON.parse(text);if(!validCueSettings(value))throw Error('目標案内の設定が不正です');return value;},
 async save(value:Pick<CueSettings,'turnaround'|'countdown'>){
  if(typeof value.turnaround!=='boolean'||typeof value.countdown!=='boolean')throw Error('設定が不正です');
  return (await database()).atomic(async s=>{const text=await s.readSetting(CUE_SETTINGS_KEY);const old=text?JSON.parse(text):DEFAULT_CUES;if(!validCueSettings(old))throw Error('設定が不正です');
   const next={...value,version:old.version+1};if(!validCueSettings(next))throw Error('設定の保存上限です');await s.writeSetting(CUE_SETTINGS_KEY,JSON.stringify(next));return next;});
 },
};
