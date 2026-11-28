import { MeasurementSessions } from '@/services/measurement-sessions';
import { MeasurementOwnership, type MeasurementBinding } from '@/services/measurement-ownership';
import reader from '../../../modules/legacy-storage-reader';
import * as Location from 'expo-location';

jest.mock('../../../modules/legacy-storage-reader', () => ({ __esModule: true, default: {
  activityMetadata: jest.fn(), activityRecordHeader: jest.fn(),
} }));
jest.mock('expo-location', () => ({ hasStartedLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn() }));
const owner: MeasurementBinding = { sessionId: 'saved', purpose: 'running', databaseKey: 'runjourney.sqlite',
  profileVersion: 1, startedAt: 1000, generation: 1, status: 'STOPPING' };
beforeEach(() => {
  jest.restoreAllMocks(); jest.resetAllMocks();
  jest.spyOn(MeasurementOwnership, 'read').mockResolvedValue({ version: 1, generation: 1, binding: owner, leases: {} });
  jest.spyOn(MeasurementOwnership, 'stop').mockResolvedValue({ version: 1, generation: 1, binding: owner, leases: {} });
  jest.spyOn(MeasurementOwnership, 'finish').mockResolvedValue({ version: 1, generation: 1, binding: null, leases: {} });
  jest.mocked(reader.activityMetadata).mockResolvedValue({ exists: true, rows: [] });
  jest.mocked(reader.activityRecordHeader).mockResolvedValue({ exists: true, rows: [{ id: 'saved', startedAt: new Date(1000).toISOString(),
    endedAt: new Date(2000).toISOString(), distanceMeters: 1, activeRunningTime: 1 }] });
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
});
test('runtime uses only the fixed sport/ID and verifies GPS stopped before releasing completed ownership', async () => {
  jest.mocked(Location.hasStartedLocationUpdatesAsync)
    .mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await MeasurementSessions.reconcile()).toBeNull();
  expect(reader.activityRecordHeader).toHaveBeenCalledWith('running', 'saved');
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('runjourney-background-location');
  expect(MeasurementOwnership.finish).toHaveBeenCalledWith(owner);
});
test.each(['id', 'startedAt', 'endedAt'] as const)('invalid completed %s never releases ownership', async field => {
  const result = await reader.activityRecordHeader('running', 'saved');
  const row = { ...result.rows[0], [field]: field === 'id' ? 'other' : 'invalid' };
  jest.mocked(reader.activityRecordHeader).mockResolvedValue({ exists: true, rows: [row] });
  await expect(MeasurementSessions.reconcile()).rejects.toThrow('照合');
  expect(MeasurementOwnership.finish).not.toHaveBeenCalled();
});
test('unconfirmed GPS stop retains ownership even with a matching completed row', async () => {
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockImplementation(async task => task === 'runjourney-background-location');
  await expect(MeasurementSessions.reconcile()).rejects.toThrow('GPS停止');
  expect(MeasurementOwnership.finish).not.toHaveBeenCalled();
});
