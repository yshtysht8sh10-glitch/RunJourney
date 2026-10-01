import { analyzePace, analyzePoints, MARATHON_METERS } from '@/utils/pace-analysis';
import { formatAnnouncement, DEFAULT_VOICE_ITEMS } from '@/utils/voice-format';

describe('pace analysis', () => {
  it('computes a five-minute 800m lap', () => {
    const lap = analyzePace(0, 300_000, 800);
    expect(lap.secondsPerKm).toBe(375);
    expect(lap.kmPerHour).toBeCloseTo(9.6);
    expect(lap.projectedTimeSeconds(MARATHON_METERS)).toBeCloseTo(15823.125);
  });
  it('omits invalid derived values', () => {
    for (const lap of [analyzePace(0, 0, 800), analyzePace(0, 300_000, 0), analyzePace(0, 300_000, 0.001)]) {
      if (lap.distanceMeters < 1 || lap.durationMs === 0) {
        expect(formatAnnouncement(300_000, 0, lap, { ...DEFAULT_VOICE_ITEMS, speed: true, marathon: true })).not.toMatch(/Infinity|NaN|時速|フルマラソン/);
      }
    }
  });
  it('requires GPS fixes and respects filtered distance', () => {
    expect(analyzePoints([], 0, 300_000)).toBeNull();
    expect(analyzePoints([{ latitude: 35, longitude: 138, timestamp: 10_000 }], 0, 300_000)).toBeNull();
  });
  it('uses the latest five-minute window', () => {
    const points = [
      { latitude: 35, longitude: 138, timestamp: 0, accuracy: 5 },
      { latitude: 35.002, longitude: 138, timestamp: 300_000, accuracy: 5 },
      { latitude: 35.0025, longitude: 138, timestamp: 450_000, accuracy: 5 },
      { latitude: 35.003, longitude: 138, timestamp: 600_000, accuracy: 5 },
    ];
    const first = analyzePoints(points, 0, 300_000);
    const second = analyzePoints(points, 300_000, 600_000);
    expect(first?.distanceMeters).toBeGreaterThan(second!.distanceMeters);
    expect(second?.distanceMeters).toBeGreaterThan(100);
  });
});
