import * as Application from 'expo-application';
import { SensorDiagnostics } from '@/services/sensor-diagnostics';
import { Platform } from 'react-native';
const mockGps = jest.fn();
const mockControl = jest.fn((...args: unknown[]) => Boolean(args));
jest.mock('expo-application', () => ({ applicationId: 'app.runjourney.mobile.test' }));
jest.mock('../../../modules/run-announcer', () => ({ __esModule: true, default: {
  sensorGps: (...args: unknown[]) => mockGps(...args), sensorControl: (...args: unknown[]) => mockControl(...args),
} }));
beforeEach(() => { jest.clearAllMocks(); Object.assign(Platform, { OS: 'android' }); Object.assign(Application, { applicationId: 'app.runjourney.mobile.test' }); });
test('failed diagnostic bridge does not reject or mutate a GPS observation', () => {
  const observations = Object.freeze([Object.freeze({ timestamp: 100, diagnosticElapsedNanos: '1000000', diagnosticSerializedNanos: '2000000' })]);
  mockGps.mockImplementationOnce(() => { throw Error('synthetic diagnostic failure'); });
  expect(() => SensorDiagnostics.gps([...observations], 150)).not.toThrow();
  expect(observations[0].timestamp).toBe(100);
  expect(mockGps).toHaveBeenCalledTimes(1);
});
test.each(['app.runjourney.mobile', 'app.runjourney.mobile.pace', 'app.runjourney.mobile.debug'])('package %s cannot arm or submit GPS to sensor diagnostic', applicationId => {
  Object.assign(Application, { applicationId });
  expect(SensorDiagnostics.control('arm', 'POCKET')).toBe(false);
  SensorDiagnostics.gps([{ timestamp: 100 }], 150);
  expect(mockGps).not.toHaveBeenCalled(); expect(mockControl).not.toHaveBeenCalled();
});

test('missing diagnostic status API is explicitly unavailable rather than reporting recording', () => {
  const status = SensorDiagnostics.status();
  expect(status?.sensor.state).toBe('FAILED');
  expect(status?.marker.accepting).toBe(false);
});
test.each(['app.runjourney.mobile', 'app.runjourney.mobile.pace'])('diagnostic status is absent for %s', applicationId => {
  Object.assign(Application, { applicationId });
  expect(SensorDiagnostics.available()).toBe(false);
  expect(SensorDiagnostics.status()).toBeNull();
});

test.each(['app.runjourney.mobile', 'app.runjourney.mobile.pace'])('never request diagnostic alert permission in %s', async applicationId => {
  Object.assign(Application, { applicationId });
  await expect(SensorDiagnostics.requestAlerts()).resolves.toBe(false);
  expect(mockControl).not.toHaveBeenCalled();
});
