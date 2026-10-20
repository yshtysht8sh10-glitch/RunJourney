import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TextInput, Switch } from 'react-native';
import PaceWorkoutSettings, { parseWorkoutClock } from '@/components/pace-workout-settings';
import { PaceWorkoutCard } from '@/components/pace-workout-card';
import PaceWorkoutReport from '@/components/pace-workout-report';
import { PaceSettingsRepository } from '@/repositories/pace-settings';
import { DEFAULT_PACE_SETTINGS, createPaceWorkout } from '@/domain/pace-workout';
import { sourceFromRun } from '@/domain/pages';
import { RunRepository } from '@/repositories/run-repository';
import { ActiveRun } from '@/types/run';
jest.mock('@/repositories/pace-settings', () => ({ PaceSettingsRepository: { get: jest.fn(), save: jest.fn() } }));
jest.mock('@/repositories/run-repository', () => ({ RunRepository: { pagedSource: jest.fn() } }));
let tree: ReactTestRenderer;
const settings = { ...DEFAULT_PACE_SETTINGS, enabled: true };
beforeEach(() => { jest.mocked(PaceSettingsRepository.get).mockResolvedValue(settings); jest.mocked(PaceSettingsRepository.save).mockResolvedValue(); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.clearAllMocks(); });
test.each(['', 'NaN', 'Infinity', '6:60', '0', '-1:30', '6e1:15'])('invalid clock text %s is rejected', text => {
  expect(Number.isNaN(parseWorkoutClock(text))).toBe(true);
});
test('clock parser accepts minutes/seconds and hours/minutes/seconds', () => {
  expect(parseWorkoutClock('6:15')).toBe(375); expect(parseWorkoutClock('3:59:00', true)).toBe(14340);
});
test('settings UI mutually converts pace and distance/time, then saves precise canonical values', async () => {
  await act(async () => { tree = create(createElement(PaceWorkoutSettings)); });
  const field = (name: string) => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === name)!;
  await act(async () => { field('目標時間（時:分:秒）').props.onChangeText('0:30:01'); });
  expect(field('目標ペース（分:秒 /km）').props.value).toBe('6:00');
  const save = tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === 'ペース走設定を保存')[0];
  await act(async () => { await save.props.onPress(); });
  expect(PaceSettingsRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ paceSecPerKm: 360.2 }));
  await act(async () => { field('目標ペース（分:秒 /km）').props.onChangeText('6:15'); });
  await act(async () => { field('目標距離（km）').props.onChangeText('10'); });
  expect(field('目標時間（時:分:秒）').props.value).toBe('1:02:30');
});
test('opening and saving time-derived settings does not round their pace; invalid draft can still turn OFF', async () => {
  jest.mocked(PaceSettingsRepository.get).mockResolvedValue({ ...settings, paceSecPerKm: 360.2 });
  await act(async () => { tree = create(createElement(PaceWorkoutSettings)); });
  const save = () => tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === 'ペース走設定を保存')[0];
  await act(async () => { await save().props.onPress(); });
  expect(PaceSettingsRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ paceSecPerKm: 360.2 }));
  await act(async () => { tree.root.findAllByType(TextInput)[0].props.onChangeText('0'); });
  expect(save().props.disabled).toBe(true);
  await act(async () => { tree.root.findAllByType(Switch)[0].props.onValueChange(false); });
  await act(async () => { await save().props.onPress(); });
  expect(PaceSettingsRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, distanceKm: 5 }));
});
test('workout OFF does not add a card; paused/stale pace is hidden and goal never replaces STOP', async () => {
  const r: ActiveRun = { id: 'ui', startedAt: new Date(0).toISOString(), points: [], distanceMeters: 5000, createdAt: '', updatedAt: '' };
  await act(async () => { tree = create(createElement(PaceWorkoutCard, { run: r, now: 60000 })); });
  expect(tree.toJSON()).toBeNull();
  r.paceWorkout = createPaceWorkout(settings, 0); r.paceWorkout!.currentPace = 375; r.paceWorkout!.status = 'FAST'; r.paceWorkout!.reached = true;
  await act(async () => { tree.update(createElement(PaceWorkoutCard, { run: r, now: 60000 })); });
  expect(JSON.stringify(tree.toJSON())).toContain('判定保留');
  expect(JSON.stringify(tree.toJSON())).toContain('記録は継続中');
});
test('report displays valid-time-only ratio and unknown intervals without reading GPS until laps requested', async () => {
  const r = { id: 'report', startedAt: new Date(0).toISOString(), endedAt: new Date(120000).toISOString(), points: [], distanceMeters: 0, createdAt: '', updatedAt: '', paceWorkout: createPaceWorkout(settings, 0) };
  Object.assign(r.paceWorkout!, { validMs: 60000, onTargetMs: 30000, unknownMs: 60000, unknownIntervals: [{ start: 0, end: 30000, reason: 'GPS_QUALITY' }] });
  const source = sourceFromRun(r), read = jest.spyOn(source, 'read');
  jest.mocked(RunRepository.pagedSource).mockReturnValue(source);
  await act(async () => { tree = create(createElement(PaceWorkoutReport, { runId: r.id })); });
  expect(JSON.stringify(tree.toJSON())).toContain('50.0%');
  expect(JSON.stringify(tree.toJSON())).toContain('GPS_QUALITY');
  expect(read.mock.calls.every(([kind]) => kind !== 'gps')).toBe(true);
});
