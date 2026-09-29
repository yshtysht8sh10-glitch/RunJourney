const { withAppBuildGradle } = require('@expo/config-plugins');

const DEBUG_BUILD_TYPE = /(buildTypes\s*\{\s*debug\s*\{)(\s*)/;

module.exports = function withDebugApplicationId(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('RunJourney debug applicationId plugin expects Groovy build.gradle');
    }

    const source = mod.modResults.contents;
    if (!DEBUG_BUILD_TYPE.test(source)) {
      throw new Error('Could not find Android debug buildType');
    }
    if (!/applicationIdSuffix ['"]\.debug['"]/.test(source)) {
      mod.modResults.contents = source.replace(
        DEBUG_BUILD_TYPE,
        "$1$2applicationIdSuffix '.debug'$2",
      );
    }
    return mod;
  });
};
