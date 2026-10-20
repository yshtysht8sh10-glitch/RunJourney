# ペース走対応Test版の実機更新（2026-10-20）

ユーザーから最新バックアップ取得後のTest版上書き更新・起動確認・今晩のペース設定について明示承認を受けた。
Production、隔離Pace版、救出原本は更新対象外。mainへのマージ、本番Firebaseへの実走データ送信は行わない。

## 更新元とバックアップ

- 端末: SO-51B。ADB接続を確認。
- 更新対象: `app.runjourney.mobile.test`、更新前versionCode18、ソース表示 `a707fd8+cloud-sync-v18`。
- 開始時 `feature/pace-workout` / `2e6d9c8`、fetch後も差分なし。未コミット変更なし。PR #34のブランチがancestorであることを確認。
- アプリの標準Backup JSON Exportから最新バックアップを保存。
- PC保存先: `D:\working\RunJourney-preservation\pre-pace-update-20261020\pre-update-backup.json`（Git対象外）。更新前APKと検証結果JSONも同じフォルダに保管。
- 7,220,158 bytes。通常履歴20件、ごみ箱15件、合計35件。GPS 11,272点、draftなし。
- ファイルSHA-256: `ffe424741bede25c281504c79423152d40ab4b0c4c4ec2e216621e7e06b98ec4`。端末とPCのhash一致。
- 現行のbackup decoderで内部SHA-256とsnapshot構造を検証済み。
- 更新前の履歴一覧と既存走行詳細の表示を確認済み。

## APK

- 既存 `cloudSyncTest` EAS profile / `assembleStandaloneTest` を使用。ソース `2e6d9c8`（PR #34と#35を含む）。
- [EAS build](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/03c5d726-e093-4b07-b1bc-c60fe790142f)。
- インストール前に完成APKのApplication IDと署名証明書を更新前APKと照合する。
- 既存TestのversionCode18は維持する。同番号での通常更新を使い、ダウングレードやアンインストールはしない。
- EAS build成功。PC保存先: `.expo-export-check/runjourney-test-pace-2e6d9c8.apk`（Git対象外）。
- manifest: `app.runjourney.mobile.test` / `RunJourney Test` / versionCode18。
- 署名証明書SHA-256は更新前APKと一致: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。
- APK SHA-256: `EC492257FF99E79F1A5C9EE6217234186874B58C1DAD7039C35681F6D0833FE5`。
- `adb install -r` 成功。アンインストールやデータ削除を使っていない。
- APK内configの `2e6d9c8+cloud-sync-v18` / `sqlite-v2` と、Hermes bundle内のPACE WORKOUT表示文字列を確認。

## 実機確認の状態

端末ロック解除後、Test版の起動・Git表示 `2e6d9c8`・履歴一覧・既存走行詳細・START待機画面を実画面で確認した。
アプリプロセスのAndroidRuntime/ReactNativeJSエラーは検出されなかった。

設定画面から一定ペース走ON、6:15/km、3km、許容±15秒/km、ペース音声ON、最小通知間隔120秒を保存。
目標時間18分45秒への換算表示を確認。アプリをforce-stopして再起動し、設定保持を実画面で確認した。

更新後の標準バックアップを再Exportし、PC保存・端末/PC hash一致・内部SHA検証を実施した。
- `post-update-backup.json`: 7,220,312 bytes。
- SHA-256: `238801fe4e812a506553e3e9eea12d08287b1a20f2a5978d7179bbfcec285e85`。
- 通常20件＋ごみ箱15件＝35件、GPS11,272点、draftなし。更新前と一致。
- snapshot内の全履歴フィールド（Raw GPS、イベント、補正、診断等を含む）、draft、protectedIdsが更新前と完全一致。
- 設定の変更は `@runjourney/pace-workout/v1` の新規追加のみ。他の設定は完全保持。
- 比較結果を `post-update-verification.json` として同じ私有保全フォルダに保存。

STARTを実行せず履歴を追加していない。走行中カード・画面OFF発話・実走時の警告・目標到達後の記録継続は実走で確認する。
最後にSTART待機画面へ戻した。Production、隔離Pace版、救出原本は変更せず、本番Firebaseへの送信は行っていない。

## PC検証

lint / TypeScript成功。Jest 40 suites / 370 tests成功。
バックアップ、APK、画面検証の私有ファイルはリポジトリ外またはGit対象外領域だけに保存する。
