# RunJourney v0.1

Android実機で、画面OFF中もGPS軌跡・距離・日時を記録する最小構成のランニング記録アプリです。記録と進行中データは端末内のAsyncStorageへ保存します。

React Native / Expo SDK 57 / TypeScriptで実装しています。画面遷移にはExpo Routerを使用しています。

## Standalone Test APK（Android）

Metroなしで動作する屋外実機テスト用APKです。本番版・Development Buildとは別アプリとしてインストールされ、アプリデータも分離されます。

- applicationId: `app.runjourney.mobile.test`
- アプリ名: `RunJourney Test`
- APK: `android/app/build/outputs/apk/standaloneTest/app-standaloneTest.apk`
- ビルド: `npm run android:test:build`
- インストール/更新: `npm run android:test:install`

ローカルAndroid Gradleのみを使う非debuggableなrelease相当variantのため、JavaScript bundleとassetsはAPKへ埋め込まれます。端末への直接導入用としてローカルdebug keystoreで署名し、ストア配布には使用しません。

## Android端末への導入

バックグラウンド位置情報は **Expo Goでは動作しません**。RunJourney専用の開発ビルド、または直接インストールできるAPKを使用してください。

Android権限を変更した後は、既存のAPKへのJavaScript更新だけでは反映されません。下記の手順で新しいAPKまたは開発ビルドを作成し、端末へ上書きインストールしてください。履歴を残すため、先にアプリをアンインストールしないでください。

画面上部には `v0.1.0 (versionCode) · Build: Git短縮hash` が表示されます。Git hashはビルド時に自動取得します。異なるソースでAPKを作る際は `versionCode` も増やしてください。現在の修正版は `versionCode 6` です。履歴詳細で停止区間を走行に含める/除外できます。Test版の設定・履歴詳細には診断ログのコピー/共有があります。仕様と実走調査は [Auto Stop / Break設計](docs/auto-stop-break.md)、共通距離計算と10m単位のLap読み上げは [Pace / Voice設計](docs/pace-and-voice.md) を参照してください。

普段のランニングで使う場合は、PC上の開発サーバーを必要としない「方法A: EASでAPKを作る」を推奨します。

### 方法A: EASでAPKを作る（推奨）

Android StudioをPCへインストールしなくても、Expoのクラウド上でAPKを作成できます。Expoアカウントとインターネット接続が必要です。

#### 1. PCでビルドを開始する

プロジェクトのルートディレクトリで次を実行します。

```powershell
npm install
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

初回のみ、以下を尋ねられることがあります。

- EASプロジェクトを作成するか: `Y`
- Android署名鍵を新規作成するか: `Generate new keystore` を選択

ビルド完了まで待つと、CLIとEASのビルドページにAPKのURLが表示されます。`preview`プロファイルは `eas.json` でAPK出力に設定済みです。

#### 2. Android端末へインストールする

1. 表示されたURLまたはQRコードをAndroid端末で開きます。
2. APKをダウンロードします。
3. ダウンロードしたAPKを開きます。
4. Androidから許可を求められた場合、そのブラウザまたはファイルアプリに「不明なアプリのインストール」を一時的に許可します。
5. `インストール` をタップし、完了後にRunJourneyを開きます。

インストール後はPCやMetro開発サーバーへ接続せずに使用できます。アプリを更新する場合は、同じコマンドで新しいAPKを作って上書きインストールします。AsyncStorageのデータは通常そのまま保持されますが、アプリをアンインストールすると履歴も削除されます。

APKをPCへダウンロードした場合は、USB接続後に次の方法でもインストールできます。

```powershell
adb devices
adb install -r C:\path\to\RunJourney.apk
```

### 方法B: USB接続して開発ビルドを入れる

コードを変更しながら実機確認する開発者向けの方法です。Node.js、Android Studio、Android SDK Platform Tools、JDKが必要です。

ローカルのdebug版は `app.runjourney.mobile.debug` として生成され、EAS/release版の `app.runjourney.mobile` と共存します。保存領域もAndroidのアプリ別領域に分かれ、EAS版の履歴には触れません。画面上部の `Build: Debug` で区別できます。debug版は開発サーバーが必要で、EAS版とは異なり単独で普段のランニングには使わないでください。

#### 1. Android端末を準備する

1. Androidの `設定 > デバイス情報` を開きます。
2. `ビルド番号` を7回タップし、開発者向けオプションを有効にします。
3. `設定 > システム > 開発者向けオプション` で `USBデバッグ` をONにします。
4. USBケーブルでPCと接続します。充電専用ではなくデータ通信対応のケーブルを使ってください。
5. 端末に表示される「このパソコンからのUSBデバッグを許可しますか？」で `許可` を選びます。

接続確認:

```powershell
adb devices
```

端末のシリアル番号の横に `device` と表示されれば準備完了です。`unauthorized` の場合は端末画面の許可ダイアログを確認してください。

#### 2. 開発ビルドを作成・インストールする

接続中のAndroid端末を選んでビルド・インストールする標準コマンドは次のとおりです。

```powershell
npx expo run:android --device
```

release版と共存できるdebug用application IDを明示する場合は、次を実行します。

```powershell
npm install
npx expo run:android --device SO_51B --app-id app.runjourney.mobile.debug
```

ExpoがAndroidネイティブプロジェクトを生成し、開発ビルドをコンパイルして端末へインストールします。初回は依存関係のダウンロードで時間がかかります。共存端末では両版が同じURLスキームを使うため、自動起動リンクがEAS版へ渡る場合があります。その場合は端末のアプリ一覧からdebug版を開くか、次を実行してください。

```powershell
adb shell am start -n app.runjourney.mobile.debug/app.runjourney.mobile.MainActivity
```

#### 3. 2回目以降に起動する

TypeScript/JavaScriptだけを変更した場合、ネイティブアプリの再ビルドは不要です。PCと端末を同じネットワークへ接続し、次を実行します。

```powershell
npx expo start --dev-client
```

端末のRunJourneyを開き、表示された開発サーバーへ接続します。接続できない場合は、CLI表示のQRコードを端末で読み取るか、USB接続中に `adb reverse tcp:8081 tcp:8081` を実行します。

位置情報パッケージ、`app.json`、Expo SDKなどのネイティブ設定を変更した場合は、再度 `npx expo run:android --device` を実行してください。

### 初回起動後の確認

1. RunJourneyを開きます。
2. `START` をタップします。
3. 位置情報を許可し、バックグラウンド位置情報は **「常に許可」** を選びます。
4. Androidの通知欄に「RunJourneyでランニングを記録中」が表示されることを確認します。
5. 画面をOFFにして屋外を数分移動します。
6. 画面をONにしてRunJourneyへ戻り、距離とGPSポイント数が増えていることを確認します。
7. `STOP` を1.5秒長押しして終了・保存します。
8. `履歴` タブに日時と距離が表示されることを確認します。
9. アプリを終了・再起動し、履歴が残っていることを確認します。

### 導入時のトラブル

- `TaskManager` またはバックグラウンド計測を利用できないと表示される: Expo Goを開いていないか確認し、上記のAPKまたは開発ビルドを使用してください。
- APKをインストールできない: 署名が異なる場合はアンインストールせず、既存版と同じ署名鍵・applicationIdのAPKを用意し、上書きしてください。履歴・Diagnosticsを保持します。
- `adb devices` に端末が出ない: USBモードを「ファイル転送」に変更し、Windowsでは端末メーカーのUSBドライバーも確認します。
- 開発ビルドがサーバーへ接続できない: PCと端末のネットワーク、Windowsファイアウォール、または `adb reverse tcp:8081 tcp:8081` を確認します。
- 画面OFF後に記録が止まる: RunJourneyの位置情報が「常に許可」か確認し、端末のバッテリー最適化対象からRunJourneyを外します。
- `RECEIVE_BOOT_COMPLETED: granted=true` なのにJobSchedulerが同権限なしと報告する: 権限なしの旧APKで試行後に上書き更新した場合、OS側のUID別権限判定キャッシュが残ることがあります。**アプリをアンインストールせず端末を再起動**し、もう一度STARTしてください。再起動後も再現する場合は、端末のAndroid APIレベルと新しいlogcatを確認してください。

#### 2026-09-29 実機調査記録

- Android API Level 33（`adb shell getprop ro.build.version.sdk` が `33`）の端末で、起動直後に `Error: requested job be persisted without holding RECEIVE_BOOT_COMPLETED permission.` が発生した。
- 同じインストール済みAPKについて、`dumpsys package` では `versionCode=1`、`versionName=0.1.0`、`RECEIVE_BOOT_COMPLETED: granted=true` を確認した。権限がManifestにない、という説明はこの事例には当てはまらない。
- アンインストール・データ削除・APK更新をせず、端末だけを再起動したところ、起動直後クラッシュは発生しなくなった。
- Android JobSchedulerには永続ジョブの権限判定をUID単位でキャッシュする実装があるため、旧APK時点の判定が残っていた可能性と整合する。ただし、端末内のキャッシュ内容を直接確認したわけではなく、原因確定とはしない。再発時は同じAPK・同じ端末でのlogcatとインストール履歴を追加確認する。
- 新しいEAS preview APK（ビルドID `48339eaa-e201-4b28-a7a4-bc2b84a9a926`）のバイナリManifestを解析し、`app.runjourney.mobile`、`versionCode=2`、`versionName=0.1.0`、`RECEIVE_BOOT_COMPLETED` を確認した。APK内の `assets/app.config` に埋め込まれた `buildGitHash` は `b0b8489` で、ビルド時の `git rev-parse --short HEAD` と一致した。このAPKの実機動作は別途確認が必要。

### インストール済みAPKの識別

USBデバッグが使える場合、端末に入っているパッケージのversionCodeと権限を確認できます。

```powershell
adb shell dumpsys package app.runjourney.mobile | Select-String 'versionCode=|versionName=|RECEIVE_BOOT_COMPLETED'
```

表示されるversionCodeが `2` であり、`android.permission.RECEIVE_BOOT_COMPLETED` が要求権限にあることを確認してください。PCにAndroid SDKの `apkanalyzer` がある場合は、インストール前のAPKも確認できます。

端末に**実際にインストールされたAPK**を調べる場合は、`adb shell pm path app.runjourney.mobile` で表示された `base.apk` のパスを使用します。

```powershell
adb shell pm path app.runjourney.mobile
adb pull /data/app/表示されたパス/base.apk .\installed-runjourney.apk
apkanalyzer manifest permissions .\installed-runjourney.apk
apkanalyzer manifest version-code .\installed-runjourney.apk
```

`adb pull` のパスは端末に出た値へ置き換えてください。システム権限や機種によって引き出せない場合は、上の `dumpsys package` の表示を確認してください。

```powershell
apkanalyzer manifest permissions C:\path\to\RunJourney.apk
apkanalyzer manifest application-id C:\path\to\RunJourney.apk
apkanalyzer manifest version-code C:\path\to\RunJourney.apk
```

APKの署名が異なると上書きインストールできません。その場合、先にアプリを消すとAsyncStorageの履歴も失われます。履歴が必要ならアンインストールせず、同じEASプロジェクトと署名鍵で作ったAPKを使用してください。

## 位置情報権限

START時に、通常の位置情報とバックグラウンド位置情報を順に要求します。Androidの設定画面では **「常に許可」** を選択してください。記録中はAndroidのフォアグラウンドサービス通知が常時表示されます。

端末メーカー独自の省電力機能が強い場合は、RunJourneyをバッテリー最適化の対象外にしてください。アプリを強制停止した場合や、機種によっては最近使ったアプリ一覧から消した場合、OSの制約でGPS取得が停止します。取得済みの途中データは保持され、次回起動時に復元されます。

## 確認コマンド

```sh
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

## データと距離計算

- 完了したRunRecordと進行中ランを別キーで保存します。
- GPS更新のたびに生の位置情報を保存します。
- 表示距離では、精度50m超の測位、3m未満の揺れ、秒速12.5m超の不自然な移動を除外します。
- 生データは除去せず保持するため、将来アルゴリズムを改善して再計算できます。

## Auto Stop / Break（実走テスト）

DEFAULTは両方OFF。STOPは全ユーザー共通で1.5秒長押しです。設定・状態・GPS・実走チェックは [設計ドキュメント](docs/auto-stop-break.md) を参照してください。
