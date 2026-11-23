import { dayKey, eligible, runMetrics, shiftDay } from './review';
import type { RunRecord } from '../types/run';
import type { RunSummary } from './pages';
export type WeeklyGoal = {
    days: number;
    thresholdMeters: number;
    thresholdMinutes: number;
    weekStartsOn: number;
};
export const DEFAULT_WEEKLY_GOAL: WeeklyGoal = { days: 4, thresholdMeters: 1000, thresholdMinutes: 0, weekStartsOn: 1 };
export function validateWeeklyGoal(goal: WeeklyGoal) {
    if (!Number.isInteger(goal.days) || goal.days < 1 || goal.days > 7 || !Number.isInteger(goal.weekStartsOn) || goal.weekStartsOn < 0 || goal.weekStartsOn > 6 || !Number.isFinite(goal.thresholdMeters) || goal.thresholdMeters <= 0 || !Number.isFinite(goal.thresholdMinutes) || goal.thresholdMinutes < 0)
        throw new Error('週間目標の設定が不正です');
    return goal;
}
export function weeklyStreak(runs: (RunRecord | RunSummary)[], options: {
    now?: number;
    timeZone?: string;
    goal?: WeeklyGoal;
} = {}) {
    const { now = Date.now(), timeZone = 'Asia/Tokyo', goal = DEFAULT_WEEKLY_GOAL } = options;
    validateWeeklyGoal(goal);
    const today = dayKey(now, timeZone);
    const weekOf = (day: string) => shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() - goal.weekStartsOn + 7) % 7));
    const currentWeek = weekOf(today), days = new Map<string, {
        meters: number;
        minutes: number;
    }>();
    for (const run of runs.filter(eligible)) {
        if (Date.parse(run.startedAt) > now)
            continue;
        const day = dayKey(run.startedAt, timeZone), metrics = runMetrics(run), previous = days.get(day) ?? { meters: 0, minutes: 0 };
        days.set(day, { meters: previous.meters + metrics.distanceMeters, minutes: previous.minutes + metrics.activeRunningTime / 60000 });
    }
    const achieved = new Set([...days].filter(([, d]) => d.meters + 1e-6 >= goal.thresholdMeters && d.minutes + 1e-9 >= goal.thresholdMinutes).map(([day]) => day));
    const weeks = new Map<string, number>();
    for (const day of achieved) {
        const week = weekOf(day);
        weeks.set(week, (weeks.get(week) ?? 0) + 1);
    }
    const completed = [...weeks].filter(([, count]) => count >= goal.days).map(([week]) => week).sort(), complete = new Set(completed);
    let best = 0, length = 0, previous = '';
    for (const week of completed) {
        length = previous && shiftDay(previous, 7) === week ? length + 1 : 1;
        best = Math.max(best, length);
        previous = week;
    }
    const count = weeks.get(currentWeek) ?? 0, thisWeekAchieved = count >= goal.days;
    let cursor = thisWeekAchieved ? currentWeek : shiftDay(currentWeek, -7), current = 0;
    while (complete.has(cursor)) {
        current++;
        cursor = shiftDay(cursor, -7);
    }
    return { current, best, count, goal, currentWeek, thisWeekAchieved, remainingDays: Math.max(0, goal.days - count), calendar: Array.from({ length: 35 }, (_, i) => {
            const day = shiftDay(currentWeek, i - 28), data = days.get(day);
            return { day, meters: data?.meters ?? 0, minutes: data?.minutes ?? 0, state: day > today ? 'future' : achieved.has(day) ? 'achieved' : data ? 'recorded' : 'unrecorded' };
        }) };
}
