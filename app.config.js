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
  plugins: [...(config.plugins || []), './plugins/with-debug-application-id'],
  extra: {
    ...config.extra,
    buildGitHash: getGitCommitHash(),
    buildId: process.env.EAS_BUILD_ID || 'local',
  },
});
