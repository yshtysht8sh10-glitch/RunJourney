import { analyzePace, MARATHON_METERS } from '@/utils/pace-analysis';
import { DEFAULT_VOICE_ITEMS, formatAnnouncement, lapDistanceSpeech } from '@/utils/voice-format';

const items = { ...DEFAULT_VOICE_ITEMS, lapDistance: true, pace: true, speed: true, marathon: true };
test.each([[826.73, 'れいてんはちさん'], [824, 'れいてんはちに'], [824.999, 'れいてんはちに'], [825, 'れいてんはちさん'], [825.001, 'れいてんはちさん'], [1000, '1てんれいれい'], [0, 'れいてんれいれい']])('formats %sm to two spoken decimal digits (%s)', (meters, speech) => {
  expect(lapDistanceSpeech(Number(meters))).toBe(`${speech}キロメートル`);
});
test('826.73m speech is 0.83km while all calculated metrics retain 826.73m', () => {
  const lap = analyzePace(0, 300000, 826.73), original = { ...lap };
  const message = formatAnnouncement(300000, 826.73, lap, items);
  expect(message).toContain('総走行距離0.8キロメートル'); expect(message).toContain('れいてんはちさんキロメートル');
  expect(lap.distanceMeters).toBe(826.73); expect(lap.secondsPerKm).toBeCloseTo(300000 / 826.73, 10);
  expect(lap.kmPerHour).toBeCloseTo(826.73 * 12 / 1000, 10);
  expect(lap.projectedTimeSeconds(MARATHON_METERS)).toBeCloseTo(300 * MARATHON_METERS / 826.73, 10);
  expect(lap.secondsPerKm).not.toBe(analyzePace(0, 300000, 830).secondsPerKm);
  expect(lap).toEqual(original);
});
test.each([0, 0.001, 10, 29.999])('very short %sm lap retains existing suppression of unstable metrics', meters => {
  expect(formatAnnouncement(300000, 1000, analyzePace(0, 300000, meters), items)).not.toMatch(/直近|時速|ペース|フルマラソン/);
});
test.each([NaN, Infinity, -Infinity])('nonfinite %s is never spoken', value => {
  expect(lapDistanceSpeech(value)).toBeNull();
  expect(formatAnnouncement(value, value, analyzePace(0, 300000, value), items)).not.toMatch(/NaN|Infinity|null|undefined/);
});
test('Japanese speech is explicit kana and never relies on English decimal punctuation', () => {
  const message = formatAnnouncement(300000, 826.73, analyzePace(0, 300000, 826.73), { ...DEFAULT_VOICE_ITEMS, totalDistance: false, lapDistance: true });
  expect(message).toContain('れいてんはちさん'); expect(message).not.toMatch(/point|0\.830000|83キロメートル/);
});
