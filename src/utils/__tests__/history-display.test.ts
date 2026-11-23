import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Switch } from 'react-native';
import { HistoryDisplaySettingsPanel } from '@/components/history-display-settings';
import { createHistoryDisplaySettings, HistoryDisplaySettings, HISTORY_DISPLAY_KEY, historyElapsed } from '@/repositories/history-display';
import { resetNative, connection } from '@/test/native-driver';
import { SqliteStore } from '@/repositories/sqlite-store';

beforeEach(() => resetNative());
afterEach(() => jest.restoreAllMocks());
test.each([
  ['2026-12-31T23:50:00Z', '2027-01-01T00:25:00Z', '35:00'],
  ['2026-01-01T00:00:00Z', '2026-01-01T01:12:34Z', '1:12:34'],
  ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '00:00'],
  ['bad', 'bad', '経過時間不明'], ['2026-01-02', '2026-01-01', '経過時間不明'],
])('elapsed %s → %s is %s', (start, end, text) => expect(historyElapsed(start, end)).toBe(text));

test('no default write; store reopen and separate profile keys preserve unrelated settings', async () => {
  const db = new SqliteStore(connection); await db.setSetting('existing-settings', 'unchanged');
  expect(await HistoryDisplaySettings.get()).toBe('timestamps');
  expect(await db.getSetting(HISTORY_DISPLAY_KEY)).toBeNull();
  await HistoryDisplaySettings.save('elapsed');
  const reopened = new SqliteStore(connection);
  expect(await reopened.getSetting(HISTORY_DISPLAY_KEY)).toBe('elapsed');
  const store = { getItem: (key: string) => reopened.getSetting(key), setItem: (key: string, value: string) => reopened.setSetting(key, value) };
  const otherProfile = createHistoryDisplaySettings(store, '@fixture/other-activity/history');
  expect(await otherProfile.get()).toBe('timestamps'); await otherProfile.save('timestamps');
  expect(await HistoryDisplaySettings.get()).toBe('elapsed');
  expect(await reopened.getSetting('existing-settings')).toBe('unchanged');
});

test('panel only changes display after save ACK; failed read cannot overwrite unknown settings', async () => {
  let tree: ReactTestRenderer | undefined;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => { tree = create(createElement(HistoryDisplaySettingsPanel)); });
    jest.spyOn(HistoryDisplaySettings, 'save').mockRejectedValueOnce(Error('disk full'));
    await act(async () => { tree!.root.findByType(Switch).props.onValueChange(true); });
    expect(tree!.root.findByType(Switch).props.value).toBe(false); expect(alert).toHaveBeenCalled();
    expect(await HistoryDisplaySettings.get()).toBe('timestamps');
    act(() => tree!.unmount());
    jest.spyOn(HistoryDisplaySettings, 'get').mockRejectedValueOnce(Error('read failure'));
    await act(async () => { tree = create(createElement(HistoryDisplaySettingsPanel)); });
    expect(tree!.root.findByType(Switch).props.disabled).toBe(true);
  } finally { if (tree) act(() => tree!.unmount()); }
});
