import { DEFAULT_WEEKLY_GOAL, weeklyStreak } from '../../domain/weekly-streak';
import type { RunSummary } from '../../domain/pages';
import { sourceFromRun } from '../../domain/pages';
import { demoRuns } from '../../web/demo';
const now = Date.parse('2026-10-17T12:00:00Z');
function run(day: string, meters = 1000, minutes = 10): RunSummary {
    const startedAt = `${day}T03:00:00Z`;
    return { kind: 'run-summary', id: day, startedAt, endedAt: new Date(Date.parse(startedAt) + minutes * 60000).toISOString(), distanceMeters: meters, originalDistanceMeters: meters, activeRunningTime: minutes * 60000, wallClockElapsed: minutes * 60000, pointCount: 0, counts: { gps: 0, events: 0, metadata: 0, operations: 0, diagnostics: 0 } };
}
const previous = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11'].map(d => run(d));
const current = ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-17'].map(d => run(d));
const calculate = (runs: RunSummary[], options = {}) => weeklyStreak(runs, { now, timeZone: 'UTC', ...options });
test('early weekly achievement survives the remaining unrecorded days and next Monday', () => {
    const early = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map(day => run(day));
    expect(calculate(early, { now: Date.parse('2026-10-18T23:59:00Z') })).toMatchObject({ current: 1, thisWeekAchieved: true, count: 4 });
    expect(calculate(early, { now: Date.parse('2026-10-19T00:00:00Z') })).toMatchObject({ current: 1, thisWeekAchieved: false, count: 0 });
});
test('four separated running days complete a week despite broken daily streak', () => {
    expect(calculate([...previous, ...current])).toMatchObject({ current: 2, best: 2, count: 4, thisWeekAchieved: true });
});
test('three days in ongoing week preserve previous completed streak', () => {
    expect(calculate([...previous, ...current.slice(0, 3)])).toMatchObject({ current: 1, count: 3, thisWeekAchieved: false });
});
test('three days in a finished week break streak at next week boundary', () => {
    expect(calculate([...previous, ...current.slice(0, 3)], { now: Date.parse('2026-10-19T00:00:00Z') }).current).toBe(0);
});
test('days after early goal need no records; missing days are not declared rest', () => {
    const result = calculate([...previous], { now: Date.parse('2026-10-12T12:00:00Z') });
    expect(result.current).toBe(1);
    expect(result.calendar.find(d => d.day === '2026-10-12')?.state).toBe('unrecorded');
});
test('same day runs aggregate distance and count once, subthreshold days do not qualify', () => {
    expect(calculate([run('2026-10-12', 600), run('2026-10-12', 400), run('2026-10-13', 999)]).count).toBe(1);
});
test('time threshold is additional to positive distance threshold', () => {
    expect(calculate([run('2026-10-12', 1200, 5), run('2026-10-13', 1200, 15), run('2026-10-14', 1, 60)], { goal: { ...DEFAULT_WEEKLY_GOAL, thresholdMinutes: 10 } }).count).toBe(1);
});
test('changed targets retrospectively reevaluate old weeks', () => {
    expect(calculate([...previous, ...current], { goal: { ...DEFAULT_WEEKLY_GOAL, days: 5 } }).current).toBe(0);
    expect(calculate([...previous, ...current], { goal: { ...DEFAULT_WEEKLY_GOAL, days: 3 } }).current).toBe(2);
});
test('deleted, corrupt, edited, future records recalculate without counters', () => {
    expect(calculate([...previous, ...current.slice(0, 3), { ...current[3], trashedAt: now }]).count).toBe(3);
    expect(calculate([{ ...current[0], distanceMeters: 10 }, { ...current[1], error: 'bad' }, run('2026-10-18')]).count).toBe(0);
});
test('cross-midnight run belongs to start day and timezone controls week boundary', () => {
    const edge = { ...run('2026-10-11'), startedAt: '2026-10-11T23:55:00Z', endedAt: '2026-10-12T00:05:00Z' };
    expect(calculate([edge]).count).toBe(0);
    expect(calculate([edge], { timeZone: 'Asia/Tokyo' }).count).toBe(1);
});
test('Sunday week start moves Saturday-ending records into the same week', () => {
    expect(calculate([run('2026-10-11')], { goal: { ...DEFAULT_WEEKLY_GOAL, weekStartsOn: 0 } }).count).toBe(1);
});
test('empty history yields zero weeks and no false rest or achieved days', () => {
    const result = calculate([]);
    expect(result).toMatchObject({ current: 0, best: 0, count: 0 });
    expect(result.calendar.every(d => ['future', 'unrecorded'].includes(d.state))).toBe(true);
});
test('Native RunRecord and metadata-only Web inputs produce identical results without mutation', async () => {
    const runs = demoRuns(), before = JSON.stringify(runs);
    const summaries = await Promise.all(runs.map(r => sourceFromRun(r).summary()));
    expect(weeklyStreak(runs, { now })).toEqual(weeklyStreak(summaries, { now }));
    expect(JSON.stringify(runs)).toBe(before);
});
test.each([{ days: 0 }, { days: 8 }, { thresholdMeters: 0 }, { thresholdMinutes: -1 }, { weekStartsOn: 7 }])('invalid settings fail explicitly %j', value => {
    expect(() => calculate([], { goal: { ...DEFAULT_WEEKLY_GOAL, ...value } })).toThrow();
});
