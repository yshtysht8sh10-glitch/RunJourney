import { cyclingReport, cyclingVoiceBatch, cyclingVoiceId } from '@/domain/cycling-voice';
import { DEFAULT_CYCLING_SETTINGS } from '@/repositories/cycling-settings';
import type { CyclingDraft } from '@/repositories/cycling-recorder';
const base = 1000000;
const fixture = (): CyclingDraft => ({ id: 'same', startedAt: new Date(base).toISOString(), createdAt: '', updatedAt: '',
  distanceMeters: 0, features: { autoStop: true, break: true }, events: [], cyclingSettings: DEFAULT_CYCLING_SETTINGS,
  points: Array.from({ length: 61 }, (_, i) => ({ timestamp: base + i * 5000, latitude: 35 + i * 100 / 111195, longitude: 139, accuracy: 5, speed: 20 })) });
test('Cycling report uses km/h, distance and active time without pace savings or marathon', () => {
  const message = cyclingReport(300000, 2400);
  expect(message).toContain('5分'); expect(message).toContain('時速28.8');
  expect(message).not.toMatch(/ペース|貯金|遅れ|マラソン/);
});
test('periodic snapshot uses the effective five-minute boundary and a scoped identity', () => {
  const run = fixture(), batch = cyclingVoiceBatch(run, base + 305000);
  expect(batch.runId).toBe(cyclingVoiceId(run.id));
  expect(batch.notices).toHaveLength(1);
  expect(batch.notices[0].type).toBe('FIVE_MINUTES');
  expect(batch.notices[0].id).toBe('cycling:same:five:1');
  expect(batch.notices[0].message).toContain('時速72.0');
  expect(batch.recovery.message).not.toMatch(/ペース|貯金|マラソン/);
});
test('OFF, stale GPS and a pre-boundary sample do not invent a due report', () => {
  const run = fixture();
  expect(cyclingVoiceBatch({ ...run, cyclingSettings: { ...DEFAULT_CYCLING_SETTINGS, voice: false } }, base + 300000).notices).toEqual([]);
  expect(cyclingVoiceBatch(run, base + 360000).notices).toEqual([]);
  expect(cyclingVoiceBatch({ ...run, points: run.points.slice(0, -1) }, base + 300000).notices).toEqual([]);
});
test('state notices retain shared priority and wording; stop packets contain no late report', () => {
  const run = fixture();
  run.events = [{ timestamp: base + 299000, confirmedAt: base + 305000, state: 'AUTO_STOP', source: 'sensor' }];
  const batch = cyclingVoiceBatch(run, base + 305000);
  expect(batch.notices.map(n => n.type)).toEqual(['AUTO_STOP_CONFIRMED']);
  expect(batch.notices[0].priority).toBe(100); expect(batch.notices[0].data.eventIndex).toBe(0);
  const ended = cyclingVoiceBatch({ ...run, endedAt: new Date(base + 306000).toISOString() }, base + 306000);
  expect(ended.notices).toEqual([]); expect(ended.cyclingEnd).toBe(true);
});
