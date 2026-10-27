const { execFileSync } = require("node:child_process");

function getGitCommitHash() {
  try {
    return (
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: __dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      }).trim() || "unknown"
    );
  } catch {
    return process.env.EAS_BUILD_GIT_COMMIT_HASH?.slice(0, 7) || "unknown";
  }
}

module.exports = ({ config }) => {
  let cloudSyncProject = null;
  // EAS first reads local config before fetching its remote environment.
  // Enforce the requirement on the builder, and locally when config is supplied.
  if (
    process.env.RUNJOURNEY_REQUIRE_CLOUD === "1" &&
    (process.env.EXPO_PUBLIC_RUNJOURNEY_FIREBASE_CONFIG ||
      process.env.EAS_BUILD === "true")
  ) {
    const cloud = JSON.parse(
      process.env.EXPO_PUBLIC_RUNJOURNEY_FIREBASE_CONFIG || "{}",
    );
    if (
      cloud.projectId !== "runjourney-ysht-2026" ||
      !cloud.apiKey ||
      !cloud.appId?.includes(":web:") ||
      cloud.authDomain !== `${cloud.projectId}.firebaseapp.com`
    ) {
      throw new Error(
        "Cloud Sync APK requires the dedicated production Firebase Web configuration",
      );
    }
    cloudSyncProject = cloud.projectId;
  }
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      "expo-sharing",
      "expo-sqlite",
      "./plugins/with-android-build-variants",
    ],
    extra: {
      ...config.extra,
      buildGitHash: `${getGitCommitHash()}+${process.env.RUNJOURNEY_PACE_ISOLATED === '1' ? 'pace-workout' : 'cloud-sync-v20'}`,
      buildId: process.env.EAS_BUILD_ID || "local",
      persistenceSchema: "sqlite-v2",
      cloudSyncProject,
    },
  };
};
