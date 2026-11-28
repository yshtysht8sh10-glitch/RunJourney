import { createMeasurementSessions, type CompletionRecovery, type DraftInspection } from '@/services/measurement-sessions';
import { createMeasurementOwnership, type MeasurementBinding, type OwnershipState } from '@/services/measurement-ownership';

function fixture(recovery?: CompletionRecovery) {
  let state: OwnershipState = { version: 1, generation: 0, binding: null, leases: {} };
  const calls: string[] = [];
  // JS lifecycle contract double only. Actual atomic ownership is tested separately in Kotlin.
  const client = createMeasurementOwnership(async (action, payload) => {
    calls.push(action); const value = JSON.parse(payload);
    if (action === 'claim' || action === 'claimSport') {
      if (state.binding) throw Error('busy');
      state = { ...state, generation: state.generation + 1, binding: { ...value, generation: state.generation + 1, status: 'STARTING' } };
    } else if (action === 'activate') state.binding = { ...state.binding!, status: 'ACTIVE' };
    else if (action === 'stop') state.binding = { ...state.binding!, status: 'STOPPING' };
    else if (action === 'finish') { if (Object.keys(state.leases).length) throw Error('pending writes'); state.binding = null; }
    else if (action === 'lease' || action === 'recoveryLease') { state.leases.ticket = state.generation; return JSON.stringify({ token: 'ticket', binding: state.binding }); }
    else if (action === 'release') delete state.leases.ticket;
    return JSON.stringify(state);
  });
  const drafts: DraftInspection = { running: null, cycling: null, unownedTracking: false };
  const sessions = createMeasurementSessions(client, async () => drafts, recovery);
  return { sessions, drafts, calls, client, current: () => state };
}
test('legacy Running draft is adopted before another sport can start, without modifying the draft', async () => {
  const f = fixture(); f.drafts.running = { id: 'legacy', startedAt: new Date(1000).toISOString(), endedAt: null };
  const original = JSON.stringify(f.drafts);
  await expect(f.sessions.forStart('cycling')).rejects.toThrow();
  expect(f.current().binding?.purpose).toBe('running'); expect(JSON.stringify(f.drafts)).toBe(original);
});
test('both drafts and unowned tracking fail closed without claiming or deleting anything', async () => {
  const f = fixture(); f.drafts.unownedTracking = true;
  await expect(f.sessions.forStart('cycling')).rejects.toThrow(); expect(f.calls).toEqual(['read']);
  f.drafts.unownedTracking = false; const draft = { id: 'r', startedAt: new Date(1000).toISOString(), endedAt: null };
  f.drafts.running = draft; f.drafts.cycling = { ...draft, id: 'c' };
  await expect(f.sessions.forStart('cycling')).rejects.toThrow(); expect(f.current().binding).toBeNull();
});
test('input gets the fixed destination; another purpose cannot ingest or start while owned', async () => {
  const f = fixture(); const b = await f.sessions.ensure('cycling', 'cycle', 1000); await f.sessions.activate(b);
  const write = jest.fn(async (owner: MeasurementBinding) => owner.databaseKey);
  expect(await f.sessions.withInput('cycling', write)).toBe('runjourney-cycling.sqlite');
  expect(await f.sessions.withInput('running', write)).toBeNull(); expect(write).toHaveBeenCalledTimes(1);
  await expect(f.sessions.ensure('running', 'run', 1000)).rejects.toThrow();
});
test('STOPPING fences another start until final ACK, then permits a new generation', async () => {
  const f = fixture(); const b = await f.sessions.ensure('cycling', 'cycle', 1000); await f.sessions.activate(b);
  await f.sessions.freeze(b); await expect(f.sessions.forStart('running')).rejects.toThrow();
  await f.sessions.finish(b); const next = await f.sessions.ensure('running', 'run', 2000);
  expect(next.generation).toBeGreaterThan(b.generation);
});
test('an ended legacy draft stays STOPPING for save retry instead of restarting GPS', async () => {
  const f = fixture(); f.drafts.running = { id: 'ended', startedAt: new Date(1000).toISOString(), endedAt: new Date(2000).toISOString() };
  expect((await f.sessions.reconcile())?.status).toBe('STOPPING');
  await expect(f.sessions.forStart('running')).rejects.toThrow();
});
test('a competing OS GPS registration cannot be hidden by an existing owner/draft', async () => {
  const f = fixture(); await f.sessions.ensure('cycling', 'cycle', 1000);
  f.drafts.cycling = { id: 'cycle', startedAt: new Date(1000).toISOString(), endedAt: null };
  f.drafts.trackingPurposes = ['running'];
  await expect(f.sessions.forStart('cycling')).rejects.toThrow('GPS登録');
  expect(f.current().binding?.purpose).toBe('cycling');
});
test('a new JS coordinator recovers SQL-completed STOPPING without RAM lastFinished or a data write', async () => {
  const completed = jest.fn(async () => true), stopTracking = jest.fn(async () => undefined);
  const f = fixture(); const owner = await f.sessions.ensure('running', 'saved', 1000);
  await f.sessions.activate(owner); await f.sessions.freeze(owner);
  const restarted = createMeasurementSessions(f.client, async () => f.drafts, { completed, stopTracking });
  expect(await restarted.forStart('cycling')).toBeNull();
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'running', sessionId: 'saved', startedAt: 1000 }));
  expect(stopTracking).toHaveBeenCalledWith('running'); expect(f.current().binding).toBeNull();
});
test('unmatched history or uncertain writes never release STOPPING ownership', async () => {
  const completed = jest.fn(async () => false), stopTracking = jest.fn(async () => undefined);
  const f = fixture({ completed, stopTracking }); const owner = await f.sessions.ensure('cycling', 'unmatched', 1000);
  await f.sessions.activate(owner); await f.sessions.freeze(owner);
  await expect(f.sessions.reconcile()).rejects.toThrow('照合'); expect(f.current().binding?.status).toBe('STOPPING');
  completed.mockResolvedValue(true); f.current().leases.unknown = owner.generation;
  await expect(f.sessions.reconcile()).rejects.toThrow('未確定'); expect(stopTracking).not.toHaveBeenCalled();
});
test('failed OS stop after completion preserves the same owner for another recovery attempt', async () => {
  const stopTracking = jest.fn(async () => undefined).mockRejectedValueOnce(Error('OS stop failed'));
  const f = fixture({ completed: async () => true, stopTracking }); const owner = await f.sessions.ensure('running', 'saved', 1000);
  await f.sessions.activate(owner); await f.sessions.freeze(owner);
  await expect(f.sessions.reconcile()).rejects.toThrow('OS stop failed');
  expect(f.current().binding?.sessionId).toBe('saved');
  expect(await f.sessions.reconcile()).toBeNull(); expect(stopTracking).toHaveBeenCalledTimes(2);
});
