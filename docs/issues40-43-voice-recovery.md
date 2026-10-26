# Issues #40–#43 音声案内

実装・自動テスト・ローカルTest APK上書き更新まで完了。更新後の全データ照合は端末ロック解除待ち、EASクラウドAPKはキュー待ち。両項目を完了扱いにはしていない。

## ベースと範囲

PR #39はOPEN、baseはcodex/voice-savings-33-36。今回のブランチcodex/voice-recovery-40-43はそのhead 20685dfから派生。main 626f4be、開始時の作業ツリーはclean。#33/#36/#38/#40〜#43本文と既存テストを確認した。今回のPRも#39に依存し、実走受入までIssueをCloseしない。

## 原因と観測

提供ログ979行・398イベントID。停止予告16件中5件が生成後4087〜11168msで期限切れ。再生開始11件のnativeキュー待ちは7〜1271ms。生成→native到達には9〜2999msの例があり、停止確定音声との開始差が39msの例もある。GPS速度低下前後の完全な1Hz観測はログにないため、身体停止時刻や全例の検出遅延は確定できない。

旧予告は直近4秒の全点が低速であることを要求し、2秒の静止証拠がそろっても過去の移動点の消失を待つ。修正は連続した低速末尾を使う。3点・2秒、速度0.35m/s以下、精度12m以内、全点間2m以内、最大点間隔2秒、鮮度3秒、30秒クールダウンを維持。再現列では低速開始後4秒→2秒。これは合成GPSの比較であり、実走後の聴取遅延・誤予告率改善の実測ではない。

TestのRAM観測後・SQLite checkpoint前に状態通知だけを非同期送信する。音声用設定は走行内キャッシュ（変更時更新）。状態通知はラップ補間・音声項目設定読出しより先にdispatch。native notifyBatchは共有async executorを経由せず短いIntent発行だけを同期実行し、再生はserviceに委譲する。既存の4秒TTLを延ばして古い予告を読ませる対処はしていない。OSスケジューリング等の個別原因は既存ログから断定できない。

## 制御

- #42: 原作PCM WAV、mono/22kHz/16bit、0.32秒。停止880→587.33Hz、再開659.25→987.77Hz。各160ms、attack10ms/release30ms、同振幅。scripts/generate-chimes.pyで再現可能。MediaPlayerの完了を待ってTTSを開始。内部割込みはチャイム中禁止、状態変化・終了後は古いTTSを捨てる。準備/再生失敗や2秒timeoutでも状態計測・保存は待たない。OS中断、音量、Bluetooth実聴取は保証・自動試験の対象外。
- #40: 状態通知は鮮度・最新eventIndexを優先。5分/1km/貯金は中断時に元IDとretry IDを対応させ1回だけ保持。待機中の同種は最新1件、最大3種を再案内時に統合。最新snapshotから実走時間・距離・全走行平均ペース・累計貯金を再生成し「実走行…時点」と明示。旧ラップ全文の途中再生はしない。保留期限120秒、snapshotも120秒以内。再割込みは破棄し無限再試行しない。終了時は待機情報を破棄。
- #41: 表示と同じsavingsSeconds/savingsMessageを使用。target秒/km×距離km−停止を除いた実走秒。先行10秒/30秒/80秒は「目標より10秒/30秒/1分20秒早いです」。遅れ30秒は「目標より30秒遅れています」。±0.5秒未満は既存のゼロ表現。瞬間ペースは警告発生条件にのみ使い、読上げ差分は累積基準。
- 優先順: 終了110、停止/再開100、予告80、保留情報75、1km70、既存workout到達60、5分40、ペース20。チャイム中だけ全優先度の割込みを禁止。旧「高優先の後20秒抑制」「高優先投入で低優先を削除」を廃止。
- ログは既存QUEUED/STARTED/DONE/INTERRUPTEDと互換。DEFERRED/RESUMED/DISCARDED系、CHIME_STARTED/COMPLETED/FAILED/TIMEOUT/INTERRUPT_BLOCKEDを追加。低速観測proxy/候補検出/生成/JS投入/native投入/TTS開始/確定時刻を突合可能。GPS/履歴のschema・保存・正式停止判定・有効時間計算は変更しない。

## 保全と検証

更新前標準BackupをPCの私有フォルダD:/working/RunJourney-preservation/voice-40-43-20261027へ保存。9,458,282bytes、SHA256 4b8df9466d112330dd0a912d5c6344c1aefe7adca4d791353de80726bc7174b6。43履歴/14,851 GPS点/draftなし/設定6キー。端末・PC hash、decodeBackup内部SHA、別SQLite全snapshot復元一致、integrity_check=okを確認。個人の位置・走行ログはGitに含めない。

Jest、Android JVM/Robolectric実serviceキュー試験、lint、TypeScriptを実行。チャイム中の終了/新状態、停止中の定期情報保持、5分/1km/貯金の一回復旧、統合、重複/最新状態、チャイム失敗後のTTS継続を確認。具体的件数・配布APK・導入後照合は確定後追記する。

未検証: 実走の停止予告先行時間、信号待ち・足踏み・低速往復・GPSノイズでの誤予告率、Bluetooth/ミュート/通話/OSフォーカス喪失、バックグラウンド・画面OFFでの新チャイムと中断復旧の聴取。自動試験は実機実走の代用ではない。

追加回帰: 音声OFFは走行終了の永久抑制フラグを立てず、同一走行でONへ戻せる。手動STOPはJS側の進行中payloadも破棄する。最終Jest 46 suites/425 tests、Android 25 tests（Robolectric実service9件）、lint/型チェック成功。先行EAS 00673319はこの追加修正のためcancel済みで配布対象外。

## APKと端末更新

- 実装SHA: c68552511d44a0655fecbca338e04574ff934137。PR: https://github.com/yshtysht8sh10-glitch/RunJourney/pull/44 。#40〜#43へ個別の実装・検証・未完了事項をコメント済み。IssueはOPENのまま。
- ローカルAndroid assembleStandaloneTest成功（4分10秒）。APKの実manifest: app.runjourney.mobile.test / versionCode19 / minSdk26 / targetSdk36。APK内app.configもc685525+cloud-sync-v19を確認。
- APK: `D:/working/RunJourney-preservation/voice-40-43-20261027/runjourney-test-local-c685525.apk`。112,505,467bytes、SHA256 `93d38057b19f954d4fc2159064100811e876caa934724f781b255774fa36b288`。
- 署名SHA256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。更新前Testの実APKから取得した値と一致。
- 2026-10-27 01:27 JST、adb install -r成功。versionCode18→19。初回インストール日時2026-09-30 23:40:36とdataDirを保持。アンインストール・アプリデータ消去・ダウングレードは実施していない。Production/Paceには更新操作をしていない。
- 更新後バックアップの全43件/GPS/設定/保護IDの比較は、端末の自動ロックにより未実施。初回インストール日・dataDir維持だけで「全データ一致」とは判定しない。ロック解除後、標準Backupを再Exportして端末/PC SHA・内部SHA・隔離SQLite復元と更新前snapshotの全フィールドを比較する。
- EAS cloudSyncTest: https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/e18118a2-c9d4-4c82-9e11-c09d6989ed01 。実装c685525、最終確認時IN_QUEUE。クラウドAPK生成・ダウンロード・署名検証は未完了。端末に導入したものは上記ローカルAPK。

再導入する場合も、更新前Backupの検証後、同じpackage/署名・versionCode19以上を確認して `adb install -r <APK>` のみを使用する。既に上記APKの上書き更新は成功している。実走の受入項目は前節に記載。
