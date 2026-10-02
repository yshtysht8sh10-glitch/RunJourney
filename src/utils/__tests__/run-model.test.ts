import { ActiveRun, LocationPoint } from '@/types/run';
import { detectStop, effectiveDistance, paceTime, stateOf, timeModel, transition } from '@/utils/run-model';
import { StopHold } from '@/utils/stop-hold';
const minute = 60000;
const run = (autoStop = true, manualBreak = true): ActiveRun => ({ id: 'test', startedAt: new Date(0).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0, features: { autoStop, break: manualBreak }, events: [] });
const point = (timestamp: number, meters = 0, speed = 0, accuracy = 5): LocationPoint => ({ latitude: 35 + meters / 111195, longitude: 139, timestamp, speed, accuracy });
describe('stop / break model', () => {
  test.each(['AUTO_STOP', 'BREAK'] as const)('%s time and stop closes open interval', state => {
    let r = transition(run(), state, 10 * minute, 'user');
    expect(timeModel(r, 12 * minute).activeRunningTime).toBe(10 * minute);
    r = transition(r, 'RUNNING', (state === 'BREAK' ? 13 : 12) * minute, 'user');
    const end = (state === 'BREAK' ? 23 : 22) * minute;
    const times = timeModel({ ...r, endedAt: new Date(end).toISOString() });
    expect(times.activeRunningTime).toBe(20 * minute);
    expect(times.wallClockElapsed).toBe(end);
    expect(times.autoStoppedDuration + times.breakDuration).toBe(end - 20 * minute);
  });
  test.each([[false, false], [true, false], [false, true], [true, true]])('opt-in matrix %s %s', (auto, manual) => {
    expect(stateOf(transition(run(auto, manual), 'AUTO_STOP', 100, 'sensor'))).toBe(auto ? 'AUTO_STOP' : 'RUNNING');
    expect(stateOf(transition(run(auto, manual), 'BREAK', 100, 'user'))).toBe(manual ? 'BREAK' : 'RUNNING');
  });
  test('legacy record uses wall time and unchanged distance', () => {
    const r = { ...run(), features: undefined, events: undefined, points: [point(0), point(5000, 10)] };
    expect(paceTime(r, minute)).toBe(minute);
    expect(effectiveDistance(r)).toBeCloseTo(10, 0);
  });
  test('stationary consecutive fixes stop, valid movement resumes', () => {
    let r = run();
    for (let t = 0; t <= 20000; t += 5000) r = detectStop(r, point(t));
    expect(stateOf(r)).toBe('AUTO_STOP');
    r = detectStop(r, point(25000, 12, 2.4));
    expect(stateOf(r)).toBe('RUNNING');
  });
  test('auto off, poor accuracy, missing fixes and spikes never infer stop', () => {
    for (const off of [true, false]) {
      let r = run(!off);
      for (let t = 0; t <= 60000; t += 20000) r = detectStop(r, point(t, 0, 0, off ? 5 : 100));
      expect(stateOf(r)).toBe('RUNNING');
      expect(paceTime(r, minute)).toBe(minute);
    }
    expect(stateOf(detectStop(detectStop(run(), point(0)), point(5000, 300, 60)))).toBe('RUNNING');
  });
  test('break cannot auto resume and survives serialization', () => {
    const r = transition(transition(run(), 'AUTO_STOP', 100, 'sensor'), 'BREAK', 200, 'user');
    const restored = JSON.parse(JSON.stringify(r));
    expect(stateOf(detectStop(restored, point(1000, 100, 2)))).toBe('BREAK');
    expect(stateOf(transition(restored, 'RUNNING', 2000, 'sensor'))).toBe('BREAK');
    expect(stateOf(transition(restored, 'RUNNING', 2000, 'user'))).toBe('RUNNING');
  });
  test.each(['BREAK', 'AUTO_STOP'] as const)('%s movement and resume boundary excluded', state => {
    let r = transition(run(), state, 6000, 'user');
    r = transition(r, 'RUNNING', 20000, 'user');
    r.points = [point(0), point(5000, 10), point(10000, 100), point(15000, 200), point(20000, 300), point(25000, 310), point(30000, 320)];
    expect(effectiveDistance(r)).toBeCloseTo(20, 0);
    expect(r.points).toHaveLength(7);
  });
  test('all pace modes and five minute boundary', () => {
    let r = transition(run(), 'AUTO_STOP', 4 * minute, 'sensor');
    expect(paceTime(r, 6 * minute)).toBe(4 * minute);
    r = transition(r, 'RUNNING', 6 * minute, 'sensor');
    expect(paceTime(r, 7 * minute)).toBe(5 * minute);
    r = transition(r, 'BREAK', 7 * minute, 'user');
    expect(paceTime(r, 9 * minute)).toBe(5 * minute);
    expect(paceTime(r, 9 * minute, 'with-break')).toBe(7 * minute);
    expect(paceTime(r, 9 * minute, 'wall')).toBe(9 * minute);
  });
});
describe('STOP hold in every state and setting', () => {
  test.each(['RUNNING', 'AUTO_STOP', 'BREAK'])('%s short, cancel, complete, duplicate', () => {
    const hold = new StopHold(); hold.begin(0);
    expect(hold.complete(200)).toBe(false); hold.cancel(); expect(hold.complete(2000)).toBe(false);
    hold.begin(3000); expect(hold.progress(3750)).toBe(0.5);
    expect(hold.complete(4500)).toBe(true); expect(hold.complete(5000)).toBe(false);
  });
});
