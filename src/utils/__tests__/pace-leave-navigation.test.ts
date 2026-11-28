import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, BackHandler } from 'react-native';
import { Tabs, useNavigation } from 'expo-router';
import TabLayout from '@/app/(running)/_layout';
import { usePaceLeaveGuard } from '@/hooks/use-pace-leave-guard';
import { paceEditorDirty } from '@/services/pace-edit-guard';

jest.mock('expo-router', () => ({
  useNavigation: jest.fn(),
  useFocusEffect: (effect: () => void) => { jest.requireActual('react').useEffect(effect, [effect]); },
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('@/tasks/location-task', () => ({}));
jest.mock('@/components/activity-environment', () => ({ useActivityEnvironment: () => ({ settings: { assistantEnabled: true }, owner: null }) }));
jest.mock('@/components/storage-compatibility-gate', () => ({ StorageCompatibilityGate: () => null }));
let tree: ReactTestRenderer;
let navigation: { addListener: jest.Mock; canGoBack: jest.Mock; goBack: jest.Mock; dispatch: jest.Mock };
let hardware: jest.SpyInstance;
const save = jest.fn<Promise<void>, []>(async () => undefined), discard = jest.fn();
function Guard({ dirty }: { dirty: boolean }) { usePaceLeaveGuard(dirty, save, discard); return null; }
const choose = (label: string) => jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === label)!.onPress!();
beforeEach(() => {
  navigation = { addListener: jest.fn(() => jest.fn()), canGoBack: jest.fn(() => true), goBack: jest.fn(), dispatch: jest.fn() };
  jest.mocked(useNavigation).mockReturnValue(navigation as unknown as ReturnType<typeof useNavigation>);
  hardware = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); jest.clearAllMocks(); });

test('Android back: clean passes through; dirty cancel stays; discard exits only after confirmation', () => {
  act(() => { tree = create(createElement(Guard, { dirty: false })); });
  expect(hardware.mock.calls.at(-1)![1]()).toBe(false);
  act(() => { tree.update(createElement(Guard, { dirty: true })); });
  expect(hardware.mock.calls.at(-1)![1]()).toBe(true);
  choose('編集に戻る'); expect(navigation.goBack).not.toHaveBeenCalled(); expect(paceEditorDirty()).toBe(true);
  navigation.canGoBack.mockReturnValue(false);
  hardware.mock.calls.at(-1)![1](); choose('破棄して移動');
  expect(discard).toHaveBeenCalledTimes(1); expect(BackHandler.exitApp).toHaveBeenCalledTimes(1);
});

test('beforeRemove blocks the action until save ACK and then replays exactly that action', async () => {
  let resolve!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  act(() => { tree = create(createElement(Guard, { dirty: true })); });
  const listener = navigation.addListener.mock.calls.at(-1)![1];
  const action = { type: 'GO_BACK' }, event = { preventDefault: jest.fn(), data: { action } };
  listener(event); choose('保存して移動');
  expect(event.preventDefault).toHaveBeenCalled(); expect(navigation.dispatch).not.toHaveBeenCalled();
  await act(async () => { resolve(); });
  expect(navigation.dispatch).toHaveBeenCalledWith(action); expect(navigation.dispatch).toHaveBeenCalledTimes(1);
});

test('actual tab listener guards dirty navigation; focus cleanup and re-entry retain no stale binding', () => {
  act(() => { tree = create(createElement(Guard, { dirty: true })); });
  const layout = TabLayout();
  const tabs = layout.props.children.find((child: { type: unknown }) => child.type === Tabs);
  const navigate = jest.fn(), event = { preventDefault: jest.fn() };
  tabs.props.screenListeners({ navigation: { navigate }, route: { name: 'history' } }).tabPress(event);
  expect(event.preventDefault).toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  choose('破棄して移動'); expect(navigate).toHaveBeenCalledWith('history');
  const remove = hardware.mock.results[0].value.remove;
  act(() => { tree.unmount(); }); expect(remove).toHaveBeenCalled(); expect(paceEditorDirty()).toBe(false);
  act(() => { tree = create(createElement(Guard, { dirty: false })); });
  expect(paceEditorDirty()).toBe(false);
});
