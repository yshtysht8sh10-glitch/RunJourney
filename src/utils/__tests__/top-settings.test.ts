import { createTopSettings, effectiveTimeEnabled, topTabs, type TopSettings } from '@/repositories/top-settings';
const original: TopSettings = { version: 1, assistantEnabled: false, genericTimeEnabled: false, onboardingSeen: false };
test('assistant forces effective time without overwriting the generic time preference', () => {
  expect(topTabs(original)).toEqual(['計測', '設定']); expect(effectiveTimeEnabled(original)).toBe(false);
  const on = { ...original, assistantEnabled: true };
  expect(topTabs(on)).toEqual(['アシスタント', '履歴', '設定']); expect(effectiveTimeEnabled(on)).toBe(true);
  expect(effectiveTimeEnabled({ ...on, assistantEnabled: false })).toBe(false);
  expect(effectiveTimeEnabled({ ...original, genericTimeEnabled: true })).toBe(true);
});
test('write failure leaves the previously committed settings in place and does not fake ACK', async () => {
  const port = jest.fn(async (action: string) => { if (action === 'topSave') throw Error('disk failure'); return JSON.stringify(original); });
  const settings = createTopSettings(port);
  await expect(settings.save({ ...original, assistantEnabled: true })).rejects.toThrow();
  expect(await settings.get()).toEqual(original);
});
test('unknown settings are rejected without reset writes', async () => {
  const port = jest.fn(async () => JSON.stringify({ ...original, version: 2 }));
  await expect(createTopSettings(port).get()).rejects.toThrow(); expect(port).toHaveBeenCalledTimes(1);
});
