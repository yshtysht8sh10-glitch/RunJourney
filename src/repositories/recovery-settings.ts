import Storage from './storage';
// v25 kept this switch in component state only; no persisted legacy key exists.
export const RECOVERY_SETTING_KEY = '@runjourney/recovery-analysis/v1';
const listeners=new Set<()=>void>();
export const RecoverySettings={
  async get(){return (await Storage.getItem(RECOVERY_SETTING_KEY))==='true';},
  async save(enabled:boolean){await Storage.setItem(RECOVERY_SETTING_KEY,String(enabled));listeners.forEach(fn=>fn());},
  subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
};
