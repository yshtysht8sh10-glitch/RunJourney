import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RunDetail from '@/app/run-detail';
import TrashScreen from '@/app/trash';
import HistoryScreen from '@/app/history';
import { RunRepository } from '@/repositories/run-repository';
import { TRASH_RETENTION_MS } from '@/utils/run-trash';
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({ id: 'ui' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => false }));
jest.mock('@/components/build-info', () => ({ BuildInfo: () => null }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/services/run-service', () => ({ RunService: { getHistory: () => require('@/repositories/run-repository').RunRepository.getRuns() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let tree: ReactTestRenderer;
const original = { id: 'ui', startedAt: new Date(0).toISOString(), endedAt: new Date(18000).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0 };
beforeEach(async () => { await AsyncStorage.clear(); jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); jest.clearAllMocks(); });
const render = async (component: typeof RunDetail) => { if (tree) act(() => tree.unmount()); await act(async () => { tree = create(createElement(component)); }); };
const press = async (testID: string) => { await act(async () => { await tree.root.findAllByProps({ testID }).find(n => typeof n.props.onPress === 'function')!.props.onPress(); }); };
const confirm = async () => { const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!; await act(async () => { await buttons[1].onPress!(); }); };
test('legacy history → detail confirmation → trash → restore → history; cancel does not delete', async () => {
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([original]));
  await render(HistoryScreen); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('1970');
  await press('open-trash'); expect(router.push).toHaveBeenCalledWith('/trash');
  await render(RunDetail);
  expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('GPSポイント 0件');
  await press('move-to-trash');
  expect(Alert.alert).toHaveBeenLastCalledWith('ごみ箱へ移動', expect.stringContaining('7日以内'), expect.any(Array));
  expect(await RunRepository.getRuns()).toEqual([original]);
  await confirm(); expect(router.replace).toHaveBeenCalledWith('/history');
  await render(HistoryScreen); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('まだ記録がありません');
  await render(RunDetail); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('記録が見つかりません');
  await render(TrashScreen); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('完全削除予定');
  await press('restore-ui'); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('ごみ箱は空です');
  await render(HistoryScreen); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('1970');
  expect(await RunRepository.getRuns()).toEqual([original]);
});
test('permanent deletion requires irreversible confirmation and updates empty state', async () => {
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([{ ...original, trashedAt: Date.now() }]));
  await render(TrashScreen); await press('delete-ui');
  expect(Alert.alert).toHaveBeenLastCalledWith('完全に削除', expect.stringContaining('取り消せません'), expect.any(Array));
  expect(await RunRepository.getTrashedRuns()).toHaveLength(1);
  await confirm(); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('ごみ箱は空です');
  expect(await RunRepository.getTrashedRuns()).toEqual([]);
});
test('expired final record purges into empty state', async () => {
  await AsyncStorage.setItem('@runjourney/runs/v1', JSON.stringify([{ ...original, trashedAt: Date.now() - TRASH_RETENTION_MS }]));
  await render(TrashScreen); expect(tree.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('ごみ箱は空です');
});
