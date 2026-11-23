import Storage from './storage';
import { FinishGoal, validFinishGoal } from '../domain/finish-goal';
export const FinishSettings = {
  async get(): Promise<FinishGoal> {
    const text = await Storage.getItem('@runjourney/finish-goal/v1');
    if (!text) return { kind: 'manual' };
    const value: unknown = JSON.parse(text);
    if (!validFinishGoal(value)) throw new Error('終了条件を確認してください');
    return value;
  },
  async save(goal: FinishGoal) {
    if (!validFinishGoal(goal)) throw new Error('距離0.1〜200km、時間1〜2880分で指定してください');
    await Storage.setItem('@runjourney/finish-goal/v1', JSON.stringify(goal));
  },
};
