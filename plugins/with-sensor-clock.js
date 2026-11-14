const { withDangerousMod, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EXPECTED = '88830b21ae9044e04cc6ef7f5bff9efbaa6d640a299f4156f265e54f6ac96b47';
const PATCHED = '92030c11d8aa6b2c088e09220eb94c4729c3bfb9a24d165224250a0c5e2db487';
function sourceBuildPackage(config) {
  config.expo ??= {}; config.expo.autolinking ??= {}; config.expo.autolinking.android ??= {};
  const android = config.expo.autolinking.android;
  android.buildFromSource = [...new Set([...(android.buildFromSource || []), '^expo-location$'])];
  return config;
}

/** Add clock metadata only; no location requests, callbacks, coordinates or sampling options change. */
function patch(source) {
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  if (digest === PATCHED) return source;
  if (digest !== EXPECTED) throw Error('SDK57 GPS clock source changed; review required');
  const replace = (a, b) => { if (!source.includes(a)) throw Error('GPS clock patch anchor missing'); source = source.replace(a, b); };
  replace('internal class LocationResponse(\n', 'internal class LocationResponse(\n  @Field var diagnosticElapsedNanos: String? = null,\n  @Field var diagnosticSerializedNanos: String? = null,\n');
  replace('    coords = LocationObjectCoords(location),\n', '    diagnosticElapsedNanos = location.elapsedRealtimeNanos.toString(),\n    diagnosticSerializedNanos = android.os.SystemClock.elapsedRealtimeNanos().toString(),\n    coords = LocationObjectCoords(location),\n');
  replace('      timestamp?.let { putDouble("timestamp", it) }', '      diagnosticElapsedNanos?.let { putString("diagnosticElapsedNanos", it) }\n      diagnosticSerializedNanos?.let { putString("diagnosticSerializedNanos", it) }\n      timestamp?.let { putDouble("timestamp", it) }');
  return source;
}
module.exports = config => {
  if (process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS !== '1') return config;
  if (process.env.RUNJOURNEY_PACE_ISOLATED === '1') throw Error('Sensor clock patch is Test only');
  config = withAppBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('RunJourney GPS clock source guard')) mod.modResults.contents += `
// RunJourney GPS clock source guard: a patched npm source must not be replaced by a precompiled AAR.
gradle.projectsEvaluated {
    def gpsSource = rootProject.findProject(':expo-location')
    if (gpsSource == null || gpsSource.tasks.findByName('compileReleaseKotlin') == null) {
        throw new GradleException('Test sensor GPS clock requires expo-location built from source')
    }
}
`;
    return mod;
  });
  return withDangerousMod(config, ['android', mod => {
    const root = path.dirname(require.resolve('expo-location/package.json', { paths: [mod.modRequest.projectRoot] }));
    if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '57.0.20') throw Error('Review GPS clock version');
    const file = path.join(root, 'android/src/main/java/expo/modules/location/records/LocationResults.kt');
    fs.writeFileSync(file, patch(fs.readFileSync(file, 'utf8')), 'utf8');
    // Expo SDK57 normally links its precompiled AAR. A source edit alone is insufficient.
    // Only this Test builder's working package.json is changed; Production/default mods do nothing.
    const projectPackage = path.join(mod.modRequest.projectRoot, 'package.json');
    fs.writeFileSync(projectPackage, JSON.stringify(sourceBuildPackage(JSON.parse(fs.readFileSync(projectPackage, 'utf8'))), null, 2) + '\n');
    return mod;
  }]);
};
module.exports.patch = patch;
module.exports.sourceBuildPackage = sourceBuildPackage;
