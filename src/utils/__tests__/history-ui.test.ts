import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HistoryScreen from '@/app/history';
import { RunRecord } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';
import { parseBackup, serializeBackup } from '@/utils/run-backup';
import { RunRepository } from '@/repositories/run-repository';

jest.mock('expo-router', () => ({ router: { push: jest.fn() },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/components/build-info', () => ({ BuildInfo: () => null }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/services/run-service', () => ({ RunService: { getHistory: () => require('@/repositories/run-repository').RunRepository.getRuns() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const minute = 60000;
const legacy: RunRecord = { id: 'history', startedAt: new Date(0).toISOString(), endedAt: new Date(32 * minute).toISOString(),
  createdAt: '', updatedAt: '', distanceMeters: 4780,
  points: Array.from({ length: 385 }, (_, i) => ({ latitude: 35 + i * 12.435 / 111195, longitude: 139, timestamp: i * 5000 })) };
const stopped: RunRecord = { ...legacy, features: { autoStop: true, break: true }, events: [
  { timestamp: 10 * minute, state: 'AUTO_STOP', source: 'sensor' },
  { timestamp: 11 * minute, state: 'RUNNING', source: 'sensor' },
  { timestamp: 20 * minute, state: 'BREAK', source: 'user' },
  { timestamp: 22 * minute, state: 'RUNNING', source: 'user' },
] };
const imported = parseBackup(serializeBackup([stopped], {}, 1)).runs[0];
let tree: ReactTestRenderer | undefined;
beforeEach(async () => { await AsyncStorage.clear(); });
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; });

test.each([
  ['legacy', legacy, 32],
  ['normal', { ...legacy, features: { autoStop: true, break: true }, events: [] }, 32],
  ['Auto Stop and Break', stopped, 29],
  ['imported', imported, 29],
  ['included stop override', { ...stopped, stopOverrides: { '0:600000:AUTO_STOP': { included: true, updatedAt: '' } } }, 30],
  ['long duration', { ...legacy, endedAt: new Date(12345 * minute + 59000).toISOString() }, 12345],
  ['zero distance', { ...legacy, points: [], distanceMeters: 0 }, 32],
  ['zero duration', { ...legacy, endedAt: legacy.startedAt }, 0],
  ['invalid date', { ...legacy, startedAt: 'invalid', endedAt: 'invalid' }, 0],
  ['invalid GPS coordinates', { ...legacy, points: legacy.points.map(p => ({ ...p, latitude: 999 })) }, 32],
] satisfies [string, RunRecord, number][])('%s: active time appears once in the primary row using effective run; stored data stays intact', async (_, record, minutes) => {
  const stored = JSON.stringify([record]);
  await AsyncStorage.setItem('@runjourney/runs/v1', stored);
  await act(async () => { tree = create(createElement(HistoryScreen)); });
  const when = tree!.root.findByProps({ testID: 'history-when' });
  expect(when.findAllByType(Text).map(node => node.props.testID)).toEqual(['history-date', 'history-times']);
  const primary = tree!.root.findByProps({ testID: 'history-primary' });
  const texts = primary.findAllByType(Text);
  expect(texts.map(node => node.props.testID)).toEqual(['history-active-time', 'history-distance', 'history-speed']);
  expect(texts[0].props.children.join('')).toBe(`実走 ${minutes}分`);
  expect(minutes).toBe(Math.floor(effectiveRun(record).activeRunningTime / minute));
  expect(texts[1].props.children.join('')).toBe(`${(effectiveRun(record).distanceMeters / 1000).toFixed(2)} km`);
  const speed = effectiveRun(record).pace.kmPerHour;
  expect(texts[2].props.children.join('')).toBe(`平均 ${speed === null ? '—' : speed.toFixed(1)} km/h`);
  const secondary = tree!.root.findByProps({ testID: 'history-secondary' });
  const supplemental = secondary.findAllByType(Text).map(node => [node.props.children].flat().join('')).join('');
  expect(supplemental).toContain(`GPSポイント ${record.points.length}件`);
  expect(supplemental).toContain('詳細 ›');
  expect(supplemental).not.toContain('実走');
  expect(tree!.root.findAllByType(Text).filter(node => [node.props.children].flat().join('').includes('実走'))).toHaveLength(1);
  expect(await AsyncStorage.getItem('@runjourney/runs/v1')).toBe(stored);
  expect(tree!.root.findAllByType(Text).map(node => [node.props.children].flat().join('')).join('')).not.toMatch(/NaN|Infinity/);
  if (record === stopped) {
    expect(speed).not.toBeNull();
    expect(speed).toBeCloseTo(effectiveRun(record).distanceMeters / 1000 / (29 / 60));
    expect(speed).not.toBeCloseTo(effectiveRun(record).distanceMeters / 1000 / (32 / 60));
  }
});

test('restored legacy run retains its metrics and is visible in history', async () => {
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([{ ...legacy, trashedAt: Date.now() }]));
  await RunRepository.restoreFromTrash(legacy.id);
  const snapshot = await AsyncStorage.getItem('@runjourney/runs/v1');
  await act(async () => { tree = create(createElement(HistoryScreen)); });
  const speed = effectiveRun(legacy).pace.kmPerHour;
  expect(tree!.root.findAllByType(Text).find(node => node.props.testID === 'history-speed')!.props.children.join('')).toBe(`平均 ${speed!.toFixed(1)} km/h`);
  expect(await AsyncStorage.getItem('@runjourney/runs/v1')).toBe(snapshot);
});
