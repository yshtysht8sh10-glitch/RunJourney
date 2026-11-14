import fs from 'node:fs';
import path from 'node:path';
const plugin = jest.requireActual('../../../plugins/with-sensor-clock');
test('Test source-build override preserves existing module exclusions and is idempotent', () => {
  const config = { expo: { autolinking: { android: { exclude: ['preserve-me'] } } } };
  const once = plugin.sourceBuildPackage(config);
  const twice = plugin.sourceBuildPackage(JSON.parse(JSON.stringify(once)));
  expect(twice).toEqual(once);
  expect(twice.expo.autolinking.android.exclude).toEqual(['preserve-me']);
  expect(twice.expo.autolinking.android.buildFromSource).toEqual(['^expo-location$']);
});
test('clock patch is pinned, idempotent, and fails closed on drift or partial patch', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'node_modules/expo-location/android/src/main/java/expo/modules/location/records/LocationResults.kt'), 'utf8');
  const patched = plugin.patch(source);
  expect(plugin.patch(patched)).toBe(patched);
  expect(patched).toContain('location.elapsedRealtimeNanos.toString()');
  expect(() => plugin.patch(source + '// unexpected SDK drift')).toThrow();
  expect(() => plugin.patch('diagnosticElapsedNanos')).toThrow();
});
test('Production/default config does not execute a dependency patch', () => {
  const prior = process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS;
  delete process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS;
  const config = { name: 'production' }; expect(plugin(config)).toBe(config);
  if (prior !== undefined) process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS = prior;
});
