import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';
import { StopButton } from '@/components/stop-button';
let tree: ReactTestRenderer;
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });
function render() {
  const stop = jest.fn();
  act(() => { tree = create(createElement(StopButton, { disabled: false, onStop: stop })); });
  return { stop, button: () => tree.root.find(node => node.props.delayLongPress === 1500 && typeof node.props.onLongPress === 'function') };
}
test('actual button short tap and interrupted hold never stops', () => {
  const { stop, button } = render();
  expect(button().props.onPress).toBeUndefined();
  act(() => { button().props.onPressIn(); jest.advanceTimersByTime(200); button().props.onPressOut(); });
  act(() => { jest.advanceTimersByTime(2000); button().props.onLongPress(); });
  expect(stop).not.toHaveBeenCalled();
});
test('actual button renders progress, stops once at 1500ms', () => {
  const { stop, button } = render();
  expect(button().props.delayLongPress).toBe(1500);
  act(() => { button().props.onPressIn(); jest.advanceTimersByTime(750); });
  expect(JSON.stringify(tree.toJSON())).toContain('50%');
  act(() => { jest.advanceTimersByTime(750); button().props.onLongPress(); button().props.onLongPress(); });
  expect(stop).toHaveBeenCalledTimes(1);
});
test('background cancels actual button hold', () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  const { stop, button } = render();
  act(() => { button().props.onPressIn(); jest.advanceTimersByTime(700); listener.mock.calls.forEach(call => call[1]('background')); jest.advanceTimersByTime(1500); button().props.onLongPress(); });
  expect(stop).not.toHaveBeenCalled();
});
