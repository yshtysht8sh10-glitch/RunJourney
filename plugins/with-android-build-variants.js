const { withAppBuildGradle } = require('@expo/config-plugins');

const DEBUG_BUILD_TYPE = /(buildTypes\s*\{\s*debug\s*\{)(\s*)/;
const RELEASE_BUILD_TYPE = /(\n\s*)(release\s*\{)/;

module.exports = function withAndroidBuildVariants(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('RunJourney Android build variants plugin expects Groovy build.gradle');
    }

    let source = mod.modResults.contents;
    // Test recovery baseline supports Android API26 and later.
    source = source.replace(/minSdkVersion rootProject.ext.minSdkVersion/g, 'minSdkVersion 26');
    if (!DEBUG_BUILD_TYPE.test(source) || !RELEASE_BUILD_TYPE.test(source)) {
      throw new Error('Could not find Android debug/release buildTypes');
    }

    if (!/applicationIdSuffix ['"]\.debug['"]/.test(source)) {
      source = source.replace(
        DEBUG_BUILD_TYPE,
        "$1$2applicationIdSuffix '.debug'$2",
      );
    }

    if (!/standaloneTest\s*\{/.test(source)) {
      source = source.replace(
        RELEASE_BUILD_TYPE,
        `$1standaloneTest {
            // Release-mode outdoor test APK: bundles JavaScript while keeping
            // its package and on-device data separate from production.
            initWith release
            applicationIdSuffix '.test'
            signingConfig signingConfigs.debug
            matchingFallbacks = ['release']
            resValue "string", "app_name", "RunJourney Test"
        }$1$2`,
      );
    }

    if (!/paceWorkout\s*\{/.test(source)) {
      source = source.replace(RELEASE_BUILD_TYPE,
        `$1paceWorkout {
            initWith release
            applicationIdSuffix '.pace'
            signingConfig signingConfigs.debug
            matchingFallbacks = ['release']
            resValue "string", "app_name", "RunJourney Pace"
        }$1$2`);
    }

    source = source.replace(/output.versionCodeOverride = \d+/g, 'output.versionCodeOverride = 19');
    if (!source.includes('output.versionCodeOverride = 19')) {
      source += `
// Increment only Standalone Test; production retains its configured version.
android.applicationVariants.all { variant ->
    if (variant.buildType.name == 'standaloneTest') {
        variant.outputs.all { output -> output.versionCodeOverride = 19 }
    }
}
`;
    }
    mod.modResults.contents = source;
    return mod;
  });
};
