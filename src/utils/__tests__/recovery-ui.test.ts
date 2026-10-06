import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RunRecovery from '@/app/run-recovery';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
jest.mock('expo-router', () => ({ router: { back: jest.fn() }, useLocalSearchParams: () => ({ id: 'ui-recovery' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });
test('opening/canceling preview does not write; confirmation applies; undo restores', async () => {
  await AsyncStorage.clear();
  const run: RunRecord = { id: 'ui-recovery', startedAt: new Date(0).toISOString(), endedAt: new Date(60000).toISOString(), createdAt: '', updatedAt: '', distanceMeters: 0,
    events: [{ timestamp: 0, state: 'AUTO_STOP', source: 'sensor' }],
    points: Array.from({ length: 13 }, (_, i) => ({ timestamp: i * 5000, latitude: 35 + Math.max(0, i - 3) * 10 / 111195, longitude: 139, accuracy: 5 })) };
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([run]));
  const writes = jest.spyOn(AsyncStorage, 'setItem'); writes.mockClear();
  const alert = jest.spyOn(Alert, 'alert');
  await act(async () => { tree = create(createElement(RunRecovery)); });
  expect(writes).not.toHaveBeenCalled();
  act(() => tree.root.findAllByProps({ testID: 'recovery-apply' })[0].props.onPress());
  expect(writes).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)![2]!;
  expect(buttons[0].style).toBe('cancel');
  await act(async () => { await buttons[1].onPress?.(); });
  // Alert callbacks intentionally start an asynchronous repository operation.
  await act(async () => { await RunRepository.getBackupRuns(); });
  expect((await RunRepository.getBackupRuns())[0].recovery).toBeDefined();
  await act(async () => { await tree.root.findAllByProps({ testID: 'recovery-undo' })[0].props.onPress(); });
  expect((await RunRepository.getBackupRuns())[0]).toEqual(run);
});
