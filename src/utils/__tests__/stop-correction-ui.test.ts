import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import RunDetail from '@/app/run-detail';
import { RunRepository } from '@/repositories/run-repository';
import { RunRecord } from '@/types/run';
import { sourceFromRun } from '@/domain/pages';
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({ id: 'ui' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/utils/build', () => ({ isStandaloneTest: () => false }));
jest.mock('@/repositories/run-repository', () => ({ RunRepository: { pagedSource: jest.fn(), getRun: jest.fn(), setStopInclusion: jest.fn() } }));
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); jest.clearAllMocks(); });
test('History Detail displays stop type/duration and both correction actions after save', async () => {
  const run: RunRecord = { id: 'ui', startedAt: new Date(0).toISOString(), endedAt: new Date(20000).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0,
    events: [{ timestamp: 5000, state: 'AUTO_STOP', source: 'sensor' }, { timestamp: 10000, state: 'RUNNING', source: 'sensor' }] };
  jest.mocked(RunRepository.getRun).mockResolvedValue(run);
  jest.mocked(RunRepository.pagedSource).mockReturnValue(sourceFromRun(run));
  jest.mocked(RunRepository.setStopInclusion).mockResolvedValue({ ...run, stopOverrides: { '0:5000:AUTO_STOP': { included: true, updatedAt: '' } } });
  await act(async () => { tree = create(createElement(RunDetail)); });
  const before = JSON.stringify(tree.toJSON());
  expect(before).toContain('Auto Stop（推定）'); expect(before).toContain('0分5秒'); expect(before).toContain('走行に含める');
  const button = tree.root.findAllByProps({ testID: 'stop-inclusion-0:5000:AUTO_STOP' }).find(n => typeof n.props.onPress === 'function')!;
  await act(async () => { await button.props.onPress(); });
  expect(RunRepository.setStopInclusion).toHaveBeenCalledWith('ui', '0:5000:AUTO_STOP', true);
  expect(JSON.stringify(tree.toJSON())).toContain('走行から除外する');
});

test('large Native detail opens metadata only and preserves the screen after page read failure', async () => {
  const run: RunRecord = { id: 'ui', startedAt: new Date(0).toISOString(), endedAt: new Date(86400000).toISOString(), createdAt: '', updatedAt: '', points: [], distanceMeters: 0 };
  const summary = await sourceFromRun(run).summary(), read = jest.fn().mockRejectedValue(new Error('synthetic corrupt page'));
  jest.mocked(RunRepository.pagedSource).mockReturnValue({ summary: async () => ({ ...summary, pointCount: 86401, counts: { ...summary.counts, gps: 86401 } }), read });
  await act(async () => { tree = create(createElement(RunDetail)); });
  expect(RunRepository.getRun).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('86401');
  const button = tree.root.findAllByProps({ testID: 'page-gps' }).find(n => typeof n.props.onPress === 'function')!;
  await act(async () => { button.props.onPress(); });
  expect(read).toHaveBeenCalledWith('gps', 0);
  expect(JSON.stringify(tree.toJSON())).toContain('原本は保持');
  expect(JSON.stringify(tree.toJSON())).toContain('86401');
});
