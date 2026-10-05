import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HistoryScreen from '@/app/history';
import { RunRecord } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';
import { parseBackup, serializeBackup } from '@/utils/run-backup';

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
  createdAt: '', updatedAt: '', distanceMeters: 4780, points: [] };
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
] satisfies [string, RunRecord, number][])('%s: active time appears once in the primary row using effective run; stored data stays intact', async (_, record, minutes) => {
  const stored = JSON.stringify([record]);
  await AsyncStorage.setItem('@runjourney/runs/v1', stored);
  await act(async () => { tree = create(createElement(HistoryScreen)); });
  const primary = tree!.root.findByProps({ testID: 'history-primary' });
  const texts = primary.findAllByType(Text);
  expect(texts.map(node => node.props.testID)).toEqual(['history-times', 'history-active-time', 'history-distance']);
  expect(texts[1].props.children.join('')).toBe(`実走 ${minutes}分`);
  expect(minutes).toBe(Math.floor(effectiveRun(record).activeRunningTime / minute));
  expect(texts[2].props.children.join('')).toBe(`${(effectiveRun(record).distanceMeters / 1000).toFixed(2)} km`);
  const secondary = tree!.root.findByProps({ testID: 'history-secondary' });
  const supplemental = secondary.findAllByType(Text).map(node => [node.props.children].flat().join('')).join('');
  expect(supplemental).toContain('GPSポイント 0件');
  expect(supplemental).toContain('詳細 ›');
  expect(supplemental).not.toContain('実走');
  expect(tree!.root.findAllByType(Text).filter(node => [node.props.children].flat().join('').includes('実走'))).toHaveLength(1);
  expect(await AsyncStorage.getItem('@runjourney/runs/v1')).toBe(stored);
});
