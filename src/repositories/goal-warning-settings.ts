import Storage from './storage';
import { DEFAULT_GOAL_WARNING, validGoalWarning, type GoalWarningSettings } from '../domain/run-notices';
let cached: GoalWarningSettings | undefined;
export const GoalWarningSettingsRepository = {
  async get(): Promise<GoalWarningSettings> {
    if(cached) return {...cached};
    const text = await Storage.getItem('@runjourney/goal-warning/v1');
    if (!text) { cached={...DEFAULT_GOAL_WARNING};return {...cached}; }
    const value = JSON.parse(text);
    if (!validGoalWarning(value)) throw Error('終了予告の設定が不正です');
    cached=value;return {...value};
  },
  async save(value: GoalWarningSettings) {
    if (!validGoalWarning(value)) throw Error('予告距離50〜5000m、時間10〜600秒で指定してください');
    await Storage.setItem('@runjourney/goal-warning/v1', JSON.stringify(value));
    cached={...value};
  },
};
