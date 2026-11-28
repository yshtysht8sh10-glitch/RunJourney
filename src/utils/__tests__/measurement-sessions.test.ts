import { createMeasurementSessions, type DraftInspection } from '@/services/measurement-sessions';
import { createMeasurementOwnership, type MeasurementBinding, type OwnershipState } from '@/services/measurement-ownership';

function fixture() {
  let state: OwnershipState = { version: 1, generation: 0, binding: null, leases: {} };
  const calls: string[] = [];
  // JS lifecycle contract double only. Actual atomic ownership is tested separately in Kotlin.
  const client = createMeasurementOwnership(async (action, payload) => {
    calls.push(action); const value = JSON.parse(payload);
    if (action === 'claim') {
      if (state.binding) throw Error('busy');
      state = { ...state, generation: state.generation + 1, binding: { ...value, generation: state.generation + 1, status: 'STARTING' } };
    } else if (action === 'activate') state.binding = { ...state.binding!, status: 'ACTIVE' };
    else if (action === 'stop') state.binding = { ...state.binding!, status: 'STOPPING' };
    else if (action === 'finish') { if (Object.keys(state.leases).length) throw Error('pending writes'); state.binding = null; }
    else if (action === 'lease') { state.leases.ticket = state.generation; return JSON.stringify({ token: 'ticket', binding: state.binding }); }
    else if (action === 'release') delete state.leases.ticket;
    return JSON.stringify(state);
  });
  const drafts: DraftInspection = { running: null, cycling: null, unownedTracking: false };
  const sessions = createMeasurementSessions(client, async () => drafts);
  return { sessions, drafts, calls, current: () => state };
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
