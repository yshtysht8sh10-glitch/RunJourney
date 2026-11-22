const MARKER = '// RunJourney production artifact guard';
const GUARD = `
${MARKER}
// Temporary integration safety gate. Removal requires a reviewed code change.
// Inspect resolved variants and the complete graph, not CLI task/profile names.
gradle.taskGraph.whenReady { graph ->
    android.applicationVariants.all { variant ->
        if (variant.applicationId == 'app.runjourney.mobile' && !variant.buildType.debuggable) {
            def suffix = variant.name.capitalize()
            def artifactTasks = ["assemble\$suffix", "bundle\$suffix", "package\$suffix",
                "package\$\{suffix\}Bundle", "sign\$\{suffix\}Bundle", "install\$suffix",
                "build\$\{suffix\}Apks", "extract\$\{suffix\}Apks"].collect { it.toString() }
            def blocked = graph.allTasks.find { task ->
                task.project == project && artifactTasks.contains(task.name)
            }
            if (blocked != null) {
                throw new GradleException("RunJourney production artifact blocked: \$\{blocked.path\}. Legacy data compatibility must be reviewed before removing this guard.")
            }
        }
    }
}
`;

function addGuard(source) {
  return source.includes(MARKER) ? source : source + GUARD;
}

module.exports = function withProductionBuildGuard(config) {
  const { withAppBuildGradle } = require('@expo/config-plugins');
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('RunJourney production artifact guard expects Groovy build.gradle');
    }
    mod.modResults.contents = addGuard(mod.modResults.contents);
    return mod;
  });
};
module.exports.addGuard = addGuard;
module.exports.guardScript = GUARD;
