import { ClockSettingsRepository } from '@/repositories/clock-settings';
import { resetNative } from '@/test/native-driver';
import Storage from '@/repositories/storage';
beforeEach(() => resetNative());
test('defaults OFF/10 and validates before writing; saved settings survive storage read', async () => {
 expect(await ClockSettingsRepository.get()).toEqual({enabled:false,minutes:10});
 await expect(ClockSettingsRepository.save({enabled:true,minutes:7})).rejects.toThrow();
 for(const minutes of [5,10,15,30]) {
  await ClockSettingsRepository.save({enabled:true,minutes});
  expect(JSON.parse((await Storage.getItem('@runjourney/current-time/v1'))!)).toEqual({enabled:true,minutes});
  expect(await ClockSettingsRepository.get()).toEqual({enabled:true,minutes});
 }
 await ClockSettingsRepository.save({enabled:false,minutes:10});
});
