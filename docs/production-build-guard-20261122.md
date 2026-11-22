# Production artifact guard during integration

The main AsyncStorage → SQLite compatibility gate is not resolved by this change.
Until a separately reviewed code change removes this guard, Android application
variants whose **resolved applicationId is `app.runjourney.mobile` and whose
build type is not debuggable** cannot enter APK/AAB artifact tasks.

The config plugin runs after the existing build-variants plugin. It injects a
Gradle task-graph check into the generated app build.gradle. Direct Gradle,
abbreviated task selection, and aggregate tasks are checked after dependency
resolution, independently of EAS profile names or environment variables.
There is no environment-variable bypass. Library release tasks and app Native
unit tests remain allowed. Debug/Test/Pace packages remain allowed.

This does not prevent distribution of already-built artifacts or OTA updates;
those remain prohibited by the integration procedure. It is not a data migration.
The task names cover the current Android APK/AAB packaging chain; a future AGP
upgrade or custom artifact-producing task needs renewed review and tests.

## Verification

Expo SDK 57 versioned reference, llms.txt and config-plugin docs were read.
`npx expo prebuild --platform android --no-install` succeeded, generating the
guard without modifying tracked package metadata or editing Native files by hand.

Run the executable Gradle fixture with an installed Gradle:

```powershell
$env:GRADLE_BIN='C:/path/to/gradle.bat'
node scripts/test-production-build-guard.cjs
```

12 real Gradle `--dry-run` cases passed: release assemble/bundle/package/sign,
aggregate dependency and renamed production variant rejected; StandaloneTest,
Pace, debuggable production ID, library release and Native unit test allowed.
Injection is idempotent. These fixture tests model variant metadata; they do not
claim an APK build or device test.

Actual prebuilt Android project checks also passed: `app:assembleRelease
--dry-run --offline` failed in the guard at `:app:packageRelease`, before app
artifact execution; `app:assembleStandaloneTest --dry-run --offline` succeeded.
Gradle included-build tooling was configured/compiled as needed; no app APK/AAB
was produced.

Initial project typecheck/lint failed with a sensor-worktree dependency junction
that lacked main's AsyncStorage package. After switching the junction to the
main lockfile's clean `npm ci` dependencies, `npx tsc --noEmit` and
`npx expo lint --no-cache` passed. Cached lint results from the previous dependency
tree were not used as final evidence. No APK was installed, no device or user
data was accessed. Independent review remains required.
