import { LocationPoint } from '@/types/run';
import { calculateDistance, distanceBetween } from '@/utils/distance';

const point = (latitude: number, longitude: number, timestamp: number, accuracy = 5): LocationPoint => ({ latitude, longitude, timestamp, accuracy });

describe('distance calculation', () => {
  it('calculates a known geographic distance', () => {
    const distance = distanceBetween(point(35, 138, 0), point(35.001, 138, 10_000));
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });

  it('ignores stationary GPS jitter below three meters', () => {
    expect(calculateDistance([point(35, 138, 0), point(35.00001, 138, 5_000)])).toBe(0);
  });

  it('ignores inaccurate fixes and implausible jumps', () => {
    expect(calculateDistance([point(35, 138, 0), point(35.0001, 138, 5_000, 100), point(36, 139, 10_000)])).toBe(0);
  });

  it('adds plausible running segments', () => {
    const distance = calculateDistance([point(35, 138, 0), point(35.0001, 138, 5_000), point(35.0002, 138, 10_000)]);
    expect(distance).toBeGreaterThan(21);
    expect(distance).toBeLessThan(23);
  });
});
