import fs from 'node:fs';
import path from 'node:path';
jest.mock('@expo/config-plugins', () => ({ withAppBuildGradle: (_config: unknown, apply: (v: unknown) => unknown) => apply(_config) }));
const plugin = jest.requireActual('../../../plugins/with-android-build-variants');
const gradle = `android {
    defaultConfig { applicationId 'app.runjourney.mobile' }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;
const apply = (contents: string) => plugin({ modResults: { language: 'groovy', contents } }).modResults.contents as string;
test('isolated Pace variant cannot overwrite production or Test; generation is idempotent', () => {
  const result = apply(gradle);
  expect(result).toContain("applicationId 'app.runjourney.mobile'");
  expect(result).toMatch(/paceWorkout\s*\{[\s\S]*?applicationIdSuffix '\.pace'/);
  expect(result).toMatch(/standaloneTest\s*\{[\s\S]*?applicationIdSuffix '\.test'/);
  expect(result).toContain('RunJourney Pace'); expect(result).toContain('output.versionCodeOverride = 19');
  expect(apply(result)).toBe(result);
});
test('EAS pace profile selects only the isolated APK build type', () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'eas.json'), 'utf8'));
  expect(config.build.paceWorkout.android.gradleCommand).toBe(':app:assemblePaceWorkout');
  expect(config.build.paceWorkout.android.applicationArchivePath).toBe('android/app/build/outputs/apk/paceWorkout/*.apk');
  expect(config.build.sqliteTest.android.gradleCommand).toBe(':app:assembleStandaloneTest');
});
