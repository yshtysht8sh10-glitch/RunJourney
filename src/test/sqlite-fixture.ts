import { database } from '../repositories/database';
import { resetNative } from './native-driver';
import { RunRecord, ActiveRun } from '../types/run';

// Legacy-shaped seed/assert helpers for existing behavior tests only.
// These are not included in application code and do not read any old DB.
const fixture = {
  clear: jest.fn(async () => { resetNative(); }),
  getItem: jest.fn(async (key: string): Promise<string | null> => {
    const db = await database();
    if (key === '@runjourney/runs/v1') {
      const runs = await db.list(true); return runs.length ? JSON.stringify(runs) : null;
    }
    if (key === '@runjourney/active-run/v1') { const run = await db.getDraft(); return run ? JSON.stringify(run) : null; }
    return db.getSetting(key);
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    const db = await database();
    if (key === '@runjourney/runs/v1') {
      const runs = JSON.parse(value) as RunRecord[];
      await db.atomic(async s => {
        await s.db.runAsync("DELETE FROM runs WHERE status='completed'");
        for (const run of runs) await s.writeRun(run, 'completed', true);
      }); return;
    }
    if (key === '@runjourney/active-run/v1') { await db.saveDraft(JSON.parse(value) as ActiveRun); return; }
    await db.setSetting(key, value);
  }),
  removeItem: jest.fn(async (key: string) => { const db = await database(); if (key === '@runjourney/active-run/v1') await db.clearDraft(); else await db.setSetting(key, null); }),
  multiSet: jest.fn(async (entries: [string, string][]) => { for (const [key, value] of entries) await fixture.setItem(key, value); }),
};
export default fixture;
