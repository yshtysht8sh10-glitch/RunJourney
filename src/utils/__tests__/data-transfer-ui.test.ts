import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';
import DataTransfer from '@/app/data-transfer';
import { RunRepository } from '@/repositories/run-repository';
import { exportBackup, pickBackup } from '@/services/run-export';
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/services/run-export', () => ({ exportBackup: jest.fn(), pickBackup: jest.fn() }));
jest.mock('@/repositories/run-repository', () => ({ RunRepository: { getBackupRuns: jest.fn(), importRuns: jest.fn() } }));
let tree: ReactTestRenderer;
const run = { id: 'ui', startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0 };
beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(RunRepository.getBackupRuns).mockResolvedValue([run]);
  jest.mocked(pickBackup).mockResolvedValue({ name: 'backup.json', backup: { format: 'runjourney-backup', schemaVersion: 1, exportedAt: 1, app: {}, runs: [run, { ...run, id: 'new', trashedAt: 1 }] } });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); jest.clearAllMocks(); });
async function press(testID: string) { await act(async () => { await tree.root.findAllByProps({ testID }).find(node => typeof node.props.onPress === 'function')!.props.onPress(); }); }
test('select/preview/cancel never commit, confirm alert waits for explicit approval and shows result', async () => {
  await act(async () => { tree = create(createElement(DataTransfer)); });
  await press('backup-select');
  expect(JSON.stringify(tree.toJSON())).toContain('Import Preview');
  expect(JSON.stringify(tree.toJSON())).toContain('重複のためスキップ：');
  expect(RunRepository.importRuns).not.toHaveBeenCalled();
  await press('backup-cancel'); expect(RunRepository.importRuns).not.toHaveBeenCalled();
  await press('backup-select'); await press('backup-confirm');
  expect(RunRepository.importRuns).not.toHaveBeenCalled();
  jest.mocked(RunRepository.importRuns).mockResolvedValue({ added: 1, skipped: 0 });
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => { await buttons.find(button => button.text === '追加する')!.onPress!(); });
  expect(RunRepository.importRuns).toHaveBeenCalledTimes(1);
  expect(RunRepository.importRuns).toHaveBeenCalledWith([{ ...run, id: 'new', trashedAt: 1 }]);
  expect(Alert.alert).toHaveBeenLastCalledWith('Import完了', '1件を追加しました\n1件の重複をスキップしました', expect.any(Array));
});
test('picker cancel/error leave history untouched; backup requires privacy confirmation', async () => {
  await act(async () => { tree = create(createElement(DataTransfer)); });
  jest.mocked(pickBackup).mockResolvedValueOnce(null); await press('backup-select');
  jest.mocked(pickBackup).mockRejectedValueOnce(new Error('JSONが壊れています')); await press('backup-select');
  expect(Alert.alert).toHaveBeenLastCalledWith('処理できませんでした', 'JSONが壊れています');
  expect(RunRepository.importRuns).not.toHaveBeenCalled();
  await press('backup-export'); expect(exportBackup).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('位置情報を含むバックアップ', expect.stringContaining('位置情報'), expect.any(Array));
});
