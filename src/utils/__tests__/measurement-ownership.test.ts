import { createMeasurementOwnership, type MeasurementBinding } from '@/services/measurement-ownership';

const owner: MeasurementBinding = { sessionId: 'synthetic', purpose: 'cycling', databaseKey: 'runjourney-cycling.sqlite',
  profileVersion: 1, startedAt: 1000, generation: 2, status: 'ACTIVE' };
const snapshot = (binding: MeasurementBinding | null = owner, leases = {}) => JSON.stringify({ version: 1, generation: 2, binding, leases });

test('claim derives the storage capability from purpose, never a caller supplied path', async () => {
  const port = jest.fn(async (_action: string, _payload: string) => snapshot());
  const client = createMeasurementOwnership(port);
  expect((await client.claim('cycling', 'synthetic', 1000)).databaseKey).toBe('runjourney-cycling.sqlite');
  expect(port.mock.calls[0][0]).toBe('claimSport');
  expect(JSON.parse(port.mock.calls[0][1])).toEqual({ purpose: 'cycling', sessionId: 'synthetic', startedAt: 1000,
    databaseKey: 'runjourney-cycling.sqlite', profileVersion: 1 });
});

test('lease surrounds the complete async write and releases once even on failure', async () => {
  const calls: string[] = [];
  const client = createMeasurementOwnership(async action => { calls.push(action);
    return action === 'lease' ? JSON.stringify({ token: 'ticket', binding: owner }) : snapshot(); });
  await expect(client.withWriteLease(owner, async fixed => {
    expect(Object.isFrozen(fixed)).toBe(true);
    expect(calls).toEqual(['lease']);
    await Promise.resolve(); throw Error('disk failure');
  })).rejects.toThrow('disk failure');
  expect(calls).toEqual(['lease', 'release']);
});

test('stale or cross-purpose lease is never passed to a storage callback', async () => {
  const write = jest.fn();
  const client = createMeasurementOwnership(async () => JSON.stringify({ token: 'ticket', binding: { ...owner, generation: 3 } }));
  await expect(client.withWriteLease(owner, write)).rejects.toThrow(); expect(write).not.toHaveBeenCalled();
});

test.each([
  JSON.stringify({ version: 2, generation: 2, binding: null, leases: {} }),
  snapshot({ ...owner, databaseKey: 'runjourney.sqlite' }),
  snapshot(null, { orphan: 2 }), snapshot(owner, { stale: 1 }),
  snapshot({ ...owner, generation: 1 }),
])('invalid persisted owner cannot be treated as idle: %s', async raw => {
  await expect(createMeasurementOwnership(async () => raw).read()).rejects.toThrow();
});

test('Native failure never falls back to a JS mutex or calls the sink', async () => {
  const write = jest.fn();
  const client = createMeasurementOwnership(async () => { throw Error('native unavailable'); });
  await expect(client.withWriteLease(owner, write)).rejects.toThrow('native unavailable');
  expect(write).not.toHaveBeenCalled();
});
test('a valid legacy record ID is preserved as opaque identity, not narrowed to a new UUID format', async () => {
  const id = '旧RUN:2020 / original';
  const client = createMeasurementOwnership(async () => snapshot({ ...owner, sessionId: id }));
  expect((await client.read()).binding?.sessionId).toBe(id);
});
