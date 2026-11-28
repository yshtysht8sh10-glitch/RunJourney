import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Switch, Text, type AppStateStatus } from 'react-native';
import { Redirect, router } from 'expo-router';
import { ActivityBootstrap, ActivityEnvironment } from '@/components/activity-environment';
import { ActivityButton } from '@/components/activity-ui';
import { LegacyRunningRoute } from '@/components/legacy-running-route';
import { TopReturn } from '@/components/top-return';
import Entry from '@/app/top/index';
import TopSettingsScreen from '@/app/top/settings';
import CyclingMap from '@/app/cycling/map';
import { TopSettingsRepository, type TopSettings } from '@/repositories/top-settings';
import { MeasurementOwnership } from '@/services/measurement-ownership';
import { MeasurementSessions } from '@/services/measurement-sessions';
import { cyclingDatabase } from '@/repositories/cycling-database';

const mockEnvironment: { settings: TopSettings; owner: null | { purpose: string }; refresh: jest.Mock } = {
  settings: { version: 1, assistantEnabled: true, genericTimeEnabled: false, onboardingSeen: false }, owner: null, refresh: jest.fn(async () => undefined),
};
jest.mock('@/components/activity-environment', () => ({ ...jest.requireActual('@/components/activity-environment'), useActivityEnvironment: () => mockEnvironment }));
jest.mock('@/repositories/top-settings', () => ({ ...jest.requireActual('@/repositories/top-settings'), TopSettingsRepository: { get: jest.fn(), save: jest.fn() } }));
jest.mock('@/services/measurement-ownership', () => ({ MeasurementOwnership: { read: jest.fn() } }));
jest.mock('@/services/measurement-sessions', () => ({ MeasurementSessions: { reconcile: jest.fn(async () => null) } }));
jest.mock('@/repositories/cycling-settings', () => ({ CyclingSettingsRepository: { get: async () => ({ map: false }) } }));
jest.mock('@/repositories/cycling-database', () => ({ cyclingDatabase: jest.fn() }));
jest.mock('@/services/pace-edit-guard', () => ({ paceEditorDirty: () => false, requestPaceLeave: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Redirect: () => null,
  useLocalSearchParams: () => ({ id: 'same-id', activity: 'cycling' }),
  useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
let tree: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks(); mockEnvironment.settings = { version: 1, assistantEnabled: true, genericTimeEnabled: false, onboardingSeen: false }; mockEnvironment.owner = null;
  jest.mocked(TopSettingsRepository.get).mockResolvedValue(mockEnvironment.settings);
  jest.mocked(MeasurementOwnership.read).mockResolvedValue({ version: 1, generation: 0, binding: null, leases: {} });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });

test('bootstrap does not mount the ordinary storage gate before evidence/settings ACK', async () => {
  let resolve!: (value: TopSettings) => void;
  jest.mocked(TopSettingsRepository.get).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const gate = jest.fn(() => createElement(Text, null, 'ordinary gate'));
  await act(async () => { tree = create(createElement(ActivityBootstrap, null, createElement(gate))); });
  expect(gate).not.toHaveBeenCalled();
  await act(async () => { resolve(mockEnvironment.settings); });
  expect(gate).toHaveBeenCalledTimes(1);
});
test('foreground refresh cannot mount the app before legacy reconciliation completes', async () => {
  let resolve!: () => void, onState: (state: AppStateStatus) => void = () => undefined;
  jest.mocked(MeasurementSessions.reconcile).mockReturnValueOnce(new Promise(done => { resolve = () => done(null); }));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => { onState = callback; return { remove: jest.fn() }; });
  const child = jest.fn(() => createElement(Text, null, 'app'));
  await act(async () => { tree = create(createElement(ActivityEnvironment, null, createElement(child))); });
  await act(async () => { onState('active'); });
  expect(MeasurementOwnership.read).not.toHaveBeenCalled(); expect(child).not.toHaveBeenCalled();
  await act(async () => { resolve(); }); expect(child).toHaveBeenCalledTimes(1);
});
test('a later refresh failure keeps an active screen mounted and shows an explicit warning', async () => {
  let onState: (state: AppStateStatus) => void = () => undefined; const cleanup = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => { onState = callback; return { remove: jest.fn() }; });
  function Child() { useEffect(() => cleanup, []); return createElement(Text, null, 'active measurement'); }
  await act(async () => { tree = create(createElement(ActivityEnvironment, null, createElement(Child))); });
  jest.mocked(MeasurementOwnership.read).mockRejectedValueOnce(Error('control read failed'));
  await act(async () => { onState('active'); });
  expect(cleanup).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain('記録を保持しています');
});
test('assistant OFF hides sport entry buttons; ON restores both entrances without data writes', async () => {
  mockEnvironment.settings = { ...mockEnvironment.settings, assistantEnabled: false };
  await act(async () => { tree = create(createElement(Entry)); });
  expect(tree.root.findAllByType(ActivityButton).map(item => item.props.label)).not.toContain('サイクリング');
  mockEnvironment.settings = { ...mockEnvironment.settings, assistantEnabled: true };
  await act(async () => { tree.update(createElement(Entry)); });
  expect(tree.root.findAllByType(ActivityButton).map(item => item.props.label)).toEqual(['ランニング', 'サイクリング']);
  expect(TopSettingsRepository.save).not.toHaveBeenCalled();
});
test('assistant locks effective time ON; active ownership locks both TOP switches', async () => {
  await act(async () => { tree = create(createElement(TopSettingsScreen)); });
  expect(tree.root.findByProps({ accessibilityLabel: '時間計測' }).props.value).toBe(true);
  expect(tree.root.findByProps({ accessibilityLabel: '時間計測' }).props.disabled).toBe(true);
  mockEnvironment.owner = { purpose: 'cycling' };
  await act(async () => { tree.update(createElement(TopSettingsScreen)); });
  expect(tree.root.findAllByType(Switch).every(item => item.props.disabled)).toBe(true);
});
test('legacy detail ID stays in the Running hierarchy even with a Cycling query parameter', async () => {
  await act(async () => { tree = create(createElement(LegacyRunningRoute, { screen: 'run-detail' })); });
  expect(tree.root.findByType(Redirect).props.href).toEqual({ pathname: '/(running)/run-detail', params: { id: 'same-id', activity: 'cycling' } });
  expect(cyclingDatabase).not.toHaveBeenCalled();
});
test('Top navigation does not issue any measurement stop or reset', async () => {
  await act(async () => { tree = create(createElement(TopReturn)); });
  act(() => tree.root.findByProps({ accessibilityLabel: 'Topに戻る。計測は継続します' }).props.onPress());
  expect(router.push).toHaveBeenCalledWith('/top'); expect(MeasurementSessions.reconcile).not.toHaveBeenCalled();
});
test('Cycling map OFF cannot read GPS or open its DB', async () => {
  await act(async () => { tree = create(createElement(CyclingMap)); });
  expect(JSON.stringify(tree.toJSON())).toContain('設定でOFF'); expect(cyclingDatabase).not.toHaveBeenCalled();
});
