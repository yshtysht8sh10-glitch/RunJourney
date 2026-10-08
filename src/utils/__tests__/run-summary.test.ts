import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { RunRepository } from '@/repositories/run-repository';
import { RunService } from '@/services/run-service';
import RunScreen from '@/app/index';
import RunSummary from '@/app/run-summary';
import { StopButton } from '@/components/stop-button';
import { ActiveRun } from '@/types/run';
import { effectiveRun } from '@/utils/run-model';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => ({ id: 'summary' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/components/build-info', () => ({ BuildInfo: () => null }));
jest.mock('@/services/run-service', () => ({ RunService: { restoreActiveRun: jest.fn(), getActiveRun: jest.fn(), stopRun: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const draft = (): ActiveRun => ({ id: 'summary', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 40,
  features: { autoStop: true, break: true }, points: [0, 5000, 10000].map((timestamp, i) => ({ timestamp, latitude: 35 + i * 20 / 111195, longitude: 139, accuracy: 5 })) });
let tree: ReactTestRenderer | undefined;
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; jest.restoreAllMocks(); });

test.each(['RUNNING', 'AUTO_STOP', 'BREAK'] as const)('%s STOP saves then renders exactly the shared effective metrics', async state => {
  const active = { ...draft(), events: state === 'RUNNING' ? [] : [{ timestamp: 5000, state, source: 'user' as const }] };
  await RunRepository.saveActiveRun(active);
  const saved = (await RunRepository.finishActiveRun(new Date(10000).toISOString()))!;
  await act(async () => { tree = create(createElement(RunSummary)); });
  const effective = effectiveRun(saved);
  expect(tree!.root.findByProps({ testID: 'summary-distance' }).props.children.join('')).toBe(`${(effective.distanceMeters / 1000).toFixed(2)} km`);
  expect(tree!.root.findByProps({ testID: 'summary-time' }).props.children.join('')).toBe(`0分${String(effective.activeRunningTime / 1000).padStart(2, '0')}秒`);
  expect(tree!.root.findByProps({ testID: 'summary-speed' }).props.children.join('')).toBe(`平均速度：${effective.pace.kmPerHour?.toFixed(2) ?? '—'} km/h`);
  expect(tree!.root.findByProps({ testID: 'summary-saved' }).props.children).toBe('履歴に保存しました');
  act(() => tree!.root.findByProps({ testID: 'summary-history' }).props.onPress());
  expect(router.replace).toHaveBeenLastCalledWith('/history');
  act(() => tree!.root.findByProps({ testID: 'summary-home' }).props.onPress());
  expect(router.replace).toHaveBeenLastCalledWith('/');
});

test('history write failure keeps STOP snapshot, retry retains end time, raw GPS and existing history', async () => {
  const old = { ...draft(), id: 'old', endedAt: new Date(10000).toISOString() };
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([old]));
  await RunRepository.saveActiveRun(draft());
  const write = jest.mocked(AsyncStorage.multiSet).getMockImplementation()!;
  jest.spyOn(AsyncStorage, 'multiSet').mockImplementationOnce(write).mockRejectedValueOnce(new Error('disk full'));
  await expect(RunRepository.finishActiveRun(new Date(10000).toISOString())).rejects.toThrow('disk full');
  expect((await RunRepository.getActiveRun())?.endedAt).toBe(new Date(10000).toISOString());
  await RunRepository.appendActivePoints([{ timestamp: 20000, latitude: 36, longitude: 139, accuracy: 5 }]);
  const saved = (await RunRepository.finishActiveRun(new Date(60000).toISOString()))!;
  expect(saved.endedAt).toBe(new Date(10000).toISOString());
  expect(saved.points).toEqual(draft().points);
  expect(await RunRepository.getRuns()).toEqual([saved, old]);
});

test('cleanup failure can retry without changing or duplicating the saved record', async () => {
  await RunRepository.saveActiveRun(draft());
  jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('cleanup failed'));
  await expect(RunRepository.finishActiveRun(new Date(10000).toISOString())).rejects.toThrow();
  const first = (await RunRepository.getRuns())[0];
  expect(await RunRepository.finishActiveRun(new Date(60000).toISOString())).toEqual(first);
  expect(await RunRepository.getRuns()).toEqual([first]);
});

test('pending STOP prevents duplicate calls and does not navigate before successful saving', async () => {
  let resolve!: (value: ReturnType<typeof draft> & { endedAt: string }) => void;
  jest.mocked(RunService.restoreActiveRun).mockResolvedValue(draft());
  jest.mocked(RunService.stopRun).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => { tree = create(createElement(RunScreen)); });
  const stop = tree!.root.findByType(StopButton).props.onStop;
  let pending!: Promise<void>;
  act(() => { pending = stop(); void stop(); });
  expect(RunService.stopRun).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).not.toContain('履歴に保存しました');
  await act(async () => { resolve({ ...draft(), endedAt: new Date(10000).toISOString() }); await pending; });
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith({ pathname: './run-summary', params: { id: 'summary' } });
});

test('failed STOP shows retry and only navigates after retry success', async () => {
  jest.mocked(RunService.restoreActiveRun).mockResolvedValue(draft());
  jest.mocked(RunService.getActiveRun).mockResolvedValue({ ...draft(), endedAt: new Date(10000).toISOString() });
  jest.mocked(RunService.stopRun).mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ ...draft(), endedAt: new Date(10000).toISOString() });
  await act(async () => { tree = create(createElement(RunScreen)); });
  await act(async () => { await tree!.root.findByType(StopButton).props.onStop(); });
  expect(router.replace).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain('disk full');
  await act(async () => { await tree!.root.findByProps({ testID: 'retry-save' }).props.onPress(); });
  expect(router.replace).toHaveBeenCalledTimes(1);
});

test('summary loading failure never reports successful persistence and reload is available', async () => {
  jest.spyOn(RunRepository, 'getRuns').mockRejectedValueOnce(new Error('read failure')).mockResolvedValueOnce([{ ...draft(), endedAt: new Date(10000).toISOString() }]);
  await act(async () => { tree = create(createElement(RunSummary)); });
  expect(tree!.root.findAllByProps({ testID: 'summary-saved' })).toHaveLength(0);
  await act(async () => { tree!.root.findByProps({ testID: 'summary-retry' }).props.onPress(); });
  expect(tree!.root.findByProps({ testID: 'summary-saved' }).props.children).toBe('履歴に保存しました');
});
