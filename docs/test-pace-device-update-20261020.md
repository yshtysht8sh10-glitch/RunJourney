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

更新後のアプリ起動コマンドは成功し、アプリプロセスのAndroidRuntime/ReactNativeJSエラーは検出されなかった。
ただし端末のsecure keyguardが表示中のため、実際の画面での起動確認・更新後の履歴再Export比較・設定保存はロック解除待ち。
ユーザーへロック解除を依頼した。認証の回避や端末のセキュリティ設定変更は行わない。

解除後は、履歴の件数と既存詳細、START画面を確認し、一定ペース走6:15/km・3km・±15秒・音声ONを保存して再起動後の保持を確認する。
更新後の標準バックアップを再Exportして、更新前35件の全フィールドとRaw GPSが一致し、設定差分がペース走設定だけであることを照合する。
現在はSTARTを実行していない。走行中カード・画面OFF発話・実走時の警告・目標到達後の記録継続は実走で確認する。

## PC検証

lint / TypeScript成功。Jest 40 suites / 370 tests成功。
バックアップ、APK、画面検証の私有ファイルはリポジトリ外またはGit対象外領域だけに保存する。
