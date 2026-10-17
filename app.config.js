const { execFileSync } = require('node:child_process');

function getGitCommitHash() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim() || 'unknown';
  } catch {
    return process.env.EAS_BUILD_GIT_COMMIT_HASH?.slice(0, 7) || 'unknown';
  }
}

module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins || []), 'expo-sharing', 'expo-sqlite', './plugins/with-android-build-variants'],
  extra: {
    ...config.extra,
    buildGitHash: `${getGitCommitHash()}+cloud-sync-v18`,
    buildId: process.env.EAS_BUILD_ID || 'local',
    persistenceSchema: 'sqlite-v2',
  },
});
