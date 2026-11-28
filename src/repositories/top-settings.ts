import type { OwnershipPort } from '@/services/measurement-ownership';
export type TopSettings = Readonly<{ version: 1; assistantEnabled: boolean; genericTimeEnabled: boolean; onboardingSeen: boolean }>;
export function effectiveTimeEnabled(settings: TopSettings) { return settings.assistantEnabled || settings.genericTimeEnabled; }
export function topTabs(settings: TopSettings) { return settings.assistantEnabled ? ['アシスタント', '履歴', '設定'] : ['計測', '設定']; }
function validate(raw: string): TopSettings {
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || ['assistantEnabled', 'genericTimeEnabled', 'onboardingSeen'].some(key => typeof value[key] !== 'boolean')
    || Object.keys(value).length !== 4) throw Error('TOP設定を確認できません。元のデータは保持しています');
  return Object.freeze({ ...value });
}
export function createTopSettings(port: OwnershipPort) {
  return {
    get: async () => validate(await port('topRead', '{}')),
    async save(value: TopSettings) {
      validate(JSON.stringify(value));
      return validate(await port('topSave', JSON.stringify(value)));
    },
  };
}
export const TopSettingsRepository = createTopSettings(async (action, payload) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require('../../modules/run-announcer').default as typeof import('../../modules/run-announcer').default;
  if (!native.measurementOwnership) throw Error('TOP設定に対応するTest APKが必要です');
  return native.measurementOwnership(action, payload);
});
