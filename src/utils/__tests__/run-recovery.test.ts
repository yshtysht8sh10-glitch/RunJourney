import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';
import { applyRecovery, recoveryPreview, undoRecovery } from '@/utils/run-recovery';
import { parseBackup, serializeBackup } from '@/utils/run-backup';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const record = (): RunRecord => ({ id: 'recovery-fixture', startedAt: new Date(0).toISOString(), endedAt: new Date(60000).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0,
  features: { autoStop: true, break: true }, events: [{ timestamp: 0, confirmedAt: 5000, source: 'sensor', state: 'AUTO_STOP' }],
  points: Array.from({ length: 13 }, (_, i) => ({ timestamp: i * 5000, latitude: 35 + Math.max(0, i * 5 - 15) * 2 / 111195, longitude: 139, accuracy: 5, speed: i <= 3 ? 0 : 2 })),
});
beforeEach(async () => { await AsyncStorage.clear(); });
test('preview computes real GPS metrics without mutating any original field', () => {
  const run = record(), before = JSON.stringify(run), preview = recoveryPreview(run);
  expect(JSON.stringify(run)).toBe(before);
  expect(preview.current.distanceMeters).toBe(0);
  expect(preview.proposed.distanceMeters).toBeCloseTo(90, 0);
  expect(preview.proposed.activeRunningTime).toBe(45000);
  expect(preview.proposed.pace.kmPerHour).toBeCloseTo(7.2, 2);
  expect(preview.restoredDistanceMeters).toBeCloseTo(90, 0);
  expect(preview.restoredTimeMs).toBe(45000);
  expect(preview.transitions[1]).toMatchObject({ timestamp: 15000, confirmedAt: 25000 });
});
test('apply/undo preserve raw GPS, original events, dates, stored distance and legacy fields', () => {
  const run = record(), original = JSON.stringify(run), applied = applyRecovery(run);
  expect(applied.points).toBe(run.points); expect(applied.events).toBe(run.events);
  expect(applied.distanceMeters).toBe(run.distanceMeters); expect(applied.updatedAt).toBe(run.updatedAt);
  expect(effectiveRun(applied).distanceMeters).toBeCloseTo(90, 0);
  expect(undoRecovery(applied)).toEqual(run); expect(JSON.stringify(run)).toBe(original);
  expect(parseBackup(serializeBackup([applied], {}, 1)).runs[0]).toEqual(applied);
});
test('manual Break survives replay and is not auto resumed by moving GPS', () => {
  const run = record(); run.events = [{ timestamp: 10000, state: 'BREAK', source: 'user' }, { timestamp: 40000, state: 'RUNNING', source: 'user' }];
  const preview = recoveryPreview(run);
  expect(preview.transitions.filter(e => e.timestamp >= 10000 && e.timestamp < 40000)).toEqual([run.events[0]]);
  expect(preview.proposed.breakDuration).toBe(30000);
});
test('legacy record with no new fields works and existing corrections fail safely', () => {
  const run = record(); delete run.features; delete run.events;
  expect(recoveryPreview(run).proposed.distanceMeters).toBeGreaterThan(0);
  expect(() => recoveryPreview({ ...record(), stopOverrides: { '0:0:AUTO_STOP': { included: true, updatedAt: '' } } })).toThrow('手動訂正');
  expect(() => recoveryPreview({ ...run, points: [] })).toThrow('GPS');
});
test('repository persists only the operation and undo restores the exact record', async () => {
  const run = record(), other = { ...record(), id: 'other' };
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([run, other]));
  await RunRepository.setRecovery(run.id, true);
  let runs = await RunRepository.getBackupRuns();
  expect(runs[0].points).toEqual(run.points); expect(runs[0].events).toEqual(run.events); expect(runs[1]).toEqual(other);
  await expect(RunRepository.setStopInclusion(run.id, '0:0:AUTO_STOP', true)).rejects.toThrow('元の記録');
  await RunRepository.setRecovery(run.id, false);
  runs = await RunRepository.getBackupRuns(); expect(runs).toEqual([run, other]);
});
test('invalid stored recovery operation is rejected on backup import', () => {
  const applied = applyRecovery(record()); applied.recovery!.events[0].timestamp = -1;
  expect(() => serializeBackup([applied], {}, 1)).toThrow();
});
