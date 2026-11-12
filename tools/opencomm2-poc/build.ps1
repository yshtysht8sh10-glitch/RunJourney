param([Parameter(Mandatory)][string]$OutputDirectory, [Parameter(Mandatory)][string]$DebugKeystore)
$ErrorActionPreference='Stop'
# Only the small test-only instrumentation APK is built here, never the RunJourney application.
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$buildTools = Join-Path $sdkRoot 'build-tools/36.0.0'
$androidJar = Join-Path $sdkRoot 'platforms/android-36/android.jar'
$out = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
New-Item -ItemType Directory -Path "$out/classes","$out/dex" -Force | Out-Null
function Check-Exit { if($LASTEXITCODE -ne 0){throw "Build command failed: $LASTEXITCODE"} }
& javac --release 17 -classpath $androidJar -d "$out/classes" "$PSScriptRoot/../../modules/run-announcer/android/src/main/java/app/runjourney/markerprobe/MarkerKeys.java" "$PSScriptRoot/MarkerKeysTest.java" "$PSScriptRoot/MarkerProbe.java" "$PSScriptRoot/MarkerInventory.java"
Check-Exit
& java -classpath "$out/classes" app.runjourney.markerprobe.MarkerKeysTest
Check-Exit
& jar --create --file "$out/probe.jar" -C "$out/classes" .
Check-Exit
& "$buildTools/d8.bat" --lib $androidJar --min-api 26 --output "$out/dex" "$out/probe.jar"
Check-Exit
& "$buildTools/aapt2.exe" link -o "$out/unsigned.apk" --manifest "$PSScriptRoot/AndroidManifest.xml" -I $androidJar
Check-Exit
& jar --update --file "$out/unsigned.apk" -C "$out/dex" classes.dex
Check-Exit
& "$buildTools/zipalign.exe" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
Check-Exit
& "$buildTools/apksigner.bat" sign --ks $DebugKeystore --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$out/marker-probe.apk" "$out/aligned.apk"
Check-Exit
