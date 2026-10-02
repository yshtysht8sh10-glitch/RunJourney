import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import RunScreen from '@/app/index';
import { RunService } from '@/services/run-service';
import { ActiveRun, RunState } from '@/types/run';
jest.mock('@/components/build-info', () => ({ BuildInfo: () => null }));
jest.mock('@/services/run-service', () => ({ RunService: { restoreActiveRun: jest.fn(), getActiveRun: jest.fn(), stopRun: jest.fn(), breakRun: jest.fn(), resumeRun: jest.fn() } }));
let tree: ReactTestRenderer;
afterEach(() => { if (tree) act(() => tree.unmount()); jest.clearAllMocks(); });
test.each([[false, false], [true, false], [false, true], [true, true]])('screen matrix auto=%s break=%s', async (autoStop, manualBreak) => {
  const run: ActiveRun = { id: 'screen', startedAt: new Date().toISOString(), points: [], distanceMeters: 0, createdAt: '', updatedAt: '', features: { autoStop, break: manualBreak } };
  jest.mocked(RunService.restoreActiveRun).mockResolvedValue(run);
  await act(async () => { tree = create(createElement(RunScreen)); });
  const ui = JSON.stringify(tree.toJSON());
  expect(ui.includes('休 憩')).toBe(manualBreak);
  expect(ui).toContain('長押しで終了');
});
test.each(['RUNNING', 'AUTO_STOP', 'BREAK'] as RunState[])('STOP available in %s', async state => {
  const run: ActiveRun = { id: 'screen', startedAt: new Date(0).toISOString(), points: [], distanceMeters: 0, createdAt: '', updatedAt: '', features: { autoStop: true, break: true }, events: [{ state, timestamp: 1, source: 'user' }] };
  jest.mocked(RunService.restoreActiveRun).mockResolvedValue(run);
  await act(async () => { tree = create(createElement(RunScreen)); });
  expect(JSON.stringify(tree.toJSON())).toContain('長押しで終了');
  if (state === 'BREAK') expect(JSON.stringify(tree.toJSON())).toContain('再 開');
});
