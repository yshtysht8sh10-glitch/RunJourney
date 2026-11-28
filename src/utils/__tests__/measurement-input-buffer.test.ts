import { createMeasurementInputBuffer } from '@/services/measurement-input-buffer';
import type { MeasurementBinding } from '@/services/measurement-ownership';
const owner: MeasurementBinding = { sessionId: 'r', purpose: 'running', databaseKey: 'runjourney.sqlite',
  generation: 1, profileVersion: 1, startedAt: 1000, status: 'ACTIVE' };
function fixture(options: Parameters<typeof createMeasurementInputBuffer>[1] = {}) {
  const port = { read: jest.fn(async () => owner), token: jest.fn(async () => 'ticket'),
    acquire: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
  const report = jest.fn(); return { port, report, queue: createMeasurementInputBuffer(port, { retryMs: 10, report, ...options }) };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(2000); });
afterEach(() => { jest.useRealTimers(); });
test.each(['read', 'acquire'] as const)('%s failure retains the same input and preserves FIFO through recovery', async stage => {
  const f = fixture(); f.port[stage].mockRejectedValueOnce(Error('control I/O'));
  const order: number[] = [];
  const a = f.queue.submit('running', owner, 2000, 100, async () => { order.push(1); return 1; });
  const b = f.queue.submit('running', owner, 2000, 100, async () => { order.push(2); return 2; });
  await jest.advanceTimersByTimeAsync(20);
  expect(await a).toBe(1); expect(await b).toBe(2); expect(order).toEqual([1, 2]);
  expect(f.report).toHaveBeenCalledWith('ADMISSION_RETRY', expect.any(Number));
});
test('release failure retries only its ACK, never observes the raw batch twice', async () => {
  const f = fixture(); f.port.release.mockRejectedValueOnce(Error('ACK lost'));
  const write = jest.fn(async () => 7); const result = f.queue.submit('running', owner, 2000, 100, write);
  await jest.advanceTimersByTimeAsync(20);
  expect(await result).toBe(7); expect(write).toHaveBeenCalledTimes(1);
  expect(f.port.acquire).toHaveBeenCalledTimes(1); expect(f.port.release).toHaveBeenCalledTimes(2);
});
test('changed sport, same-ID new generation or changed start never inherits queued input', async () => {
  for (const altered of [{ ...owner, generation: 2 }, { ...owner, startedAt: 999 },
    { ...owner, purpose: 'cycling' as const, databaseKey: 'runjourney-cycling.sqlite' }]) {
    const f = fixture(); f.port.read.mockResolvedValue(altered);
    const write = jest.fn(); expect(await f.queue.submit('running', owner, 2000, 1, write)).toBeNull();
    expect(write).not.toHaveBeenCalled(); expect(f.report).toHaveBeenCalledWith('BINDING_CHANGED', 1);
  }
});
test('STOP waits for received inputs and rejects later callbacks; rejected auto-goal can reopen', async () => {
  const f = fixture(); f.port.read.mockRejectedValueOnce(Error('temporary'));
  const write = jest.fn(async () => 1); const pending = f.queue.submit('running', owner, 2000, 10, write);
  f.queue.requestStop('running'); const closed = f.queue.close(owner);
  expect(await f.queue.submit('running', owner, 2100, 10, write)).toBeNull();
  await jest.advanceTimersByTimeAsync(20); await closed; expect(await pending).toBe(1);
  expect(write).toHaveBeenCalledTimes(1); f.queue.reopen(owner);
  expect(await f.queue.submit('running', owner, 2200, 10, write)).toBe(1);
});
test('bounded capacity is explicit and never evicts the older received fix', async () => {
  const f = fixture({ maxEntries: 1 }); f.port.read.mockRejectedValueOnce(Error('temporary'));
  const original = f.queue.submit('running', owner, 2000, 10, async () => 1);
  await expect(f.queue.submit('running', owner, 2000, 10, async () => 2)).rejects.toThrow('容量');
  await jest.advanceTimersByTimeAsync(20); expect(await original).toBe(1);
  expect(f.report).toHaveBeenCalledWith('CAPACITY_REJECTED', 1);
});
test('admission expiry is reported; it never executes an unleased SQL fallback', async () => {
  const f = fixture({ maxAgeMs: 15 }); f.port.read.mockRejectedValue(Error('offline'));
  const write = jest.fn(); const result = f.queue.submit('running', owner, 2000, 10, write);
  const failed = expect(result).rejects.toThrow('offline'); await jest.advanceTimersByTimeAsync(30); await failed;
  expect(write).not.toHaveBeenCalled(); expect(f.report).toHaveBeenCalledWith('ADMISSION_EXPIRED', 1);
});
test('SQL exception is not retried as a duplicate observation; lease release still confirmed', async () => {
  const f = fixture(); const write = jest.fn(async () => { throw Error('SQL failed after RAM update'); });
  await expect(f.queue.submit('running', owner, 2000, 10, write)).rejects.toThrow('SQL');
  expect(write).toHaveBeenCalledTimes(1); expect(f.port.release).toHaveBeenCalledTimes(1);
});
test('unbound input cannot be attached to a session that began after its receipt', async () => {
  const f = fixture(); f.port.read.mockResolvedValue({ ...owner, startedAt: 3000 });
  const write = jest.fn(); expect(await f.queue.submit('running', null, 2000, 10, write)).toBeNull(); expect(write).not.toHaveBeenCalled();
});
test('STOP timeout never executes its caller early or clears an uncertain input lease', async () => {
  const f = fixture({ retryMs: 1000, maxAgeMs: 10000 }); f.port.release.mockRejectedValue(Error('release unavailable'));
  const write = jest.fn(async () => 1); const result = f.queue.submit('running', owner, 2000, 10, write);
  const stopFailed = expect(f.queue.close(owner)).rejects.toThrow('保存待ち');
  await jest.advanceTimersByTimeAsync(6000); await stopFailed;
  expect(write).toHaveBeenCalledTimes(1); expect(f.queue.pendingCount).toBe(1);
  await jest.advanceTimersByTimeAsync(5000);
  expect(f.report).toHaveBeenCalledWith('CONTROL_UNCONFIRMED', 1);
  expect(f.queue.pendingCount).toBe(1);
  f.port.release.mockResolvedValue(undefined); await jest.advanceTimersByTimeAsync(1000);
  expect(await result).toBe(1); expect(write).toHaveBeenCalledTimes(1);
});
