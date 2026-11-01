# 2026-11-01 Test v22 実走フィードバック

## 取得・保全

Xperia SO-51Bの通常ExportからBackupと音声診断を取得。対象はJST 06:26:09〜06:53:48、5.000km/27分39秒、保存GPS307点。原ログはリポジトリ外の私有保全先のみ。生マイク音声は保存されていない。

取得時Backupは46履歴/17,759 GPS点、draftなし。内部SHA/構造検証、新規の隔離SQLite復元snapshot一致、integrity_check=ok、foreign_key_check=0を確認。今回取得時点を保全基準とし、以前のBackupを端末に上書きしない。

- Backup SHA256: `0ccafcd3d545567995e4867f7b870afd512eb8e4af2742bc4df8b0391a8647f0`
- 音声診断 SHA256: `8d2ddbb614151b1b0e66b5526b8bf0f341a7e8b25b72e4842122dc8e284bfc20`
- 騒音ON、現在時刻ON/10分、Auto Stop/Break ON。設定を維持する。

処理遅延も分離して確認：GPS→JS中央値54ms/p95 294ms/max809ms、Repository待ち中央値0ms/p95 1ms/max1ms、判定中央値3ms。checkpoint中央値4,492msだが、今回のRepository待ち1秒超は0件。#50で対処した保存待ちによる観測キュー詰まりは、この27分39秒の実走では確認されない。異なる距離/条件の前回走との改善率は算出しない。

## 「音量Upの感触がない」

### 観測できたこと

マイク権限あり、内蔵マイクtype15、有効計測7,942回（画面OFF7,928回）。終了直前の基準-61.03dBFSに対し平均-41.13dBFS。dBFSは相対デジタル値で、環境のdB SPLではない。

NOISE_LEVEL341件中339件はgain>=0.999。ADAPTIVE_APPLIED60件は全て補正上限。実再生中にBluetooth A2DP type8を記録（再生開始直後は経路未取得のtype0もある）。端末media音量14/30で、端末音量の上限到達とは異なる。

現行[NoiseGain.update](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/NoiseGain.kt)は静音0.65→騒音1.0へ変化させる。騒音時は通常TTSの1.0を超えず、静音基準比約1.54倍が上限。計測と補正適用は確認できるが、今回のほぼ全区間が上限のため、走行中にさらに上がる余地がない。「聞こえ方が改善した」とは判定しない。

### 特定した別問題と修正

5分案内5回中4回と終了案内1回で、固定3秒の合成待ち時間が不足しSYNTHESIS_TIMEOUT。通常TTSへfallbackして全件DONEになったが、この経路は騒音追従を行わない。短いペース案内21回と距離案内4回は合成完了。88文字の5分案内の成功例は合成2,908msで上限近く、89〜90文字の4件と111文字の終了案内がtimeoutした。

[RunAnnouncerService.synthesizeAdaptive](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt)の待ち時間を[SynthesisBudget](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/SynthesisBudget.kt)へ切り出し、1文字60ms、最短3秒・最長8秒に変更。今回の5分案内は5.34〜5.4秒、終了案内は6.66秒となる。短い距離/ペース案内は3秒を維持。合成要求時刻/設定上限/成功所要時間も診断に記録する。

文言・優先度・TTL・停止時の割込み・gain上限・端末音量は変更しない。失敗時の通常TTS fallbackと一時ファイル削除は維持する。長文の待機が最大5秒増えるため、実機で合成時間と音声開始遅延を確認する。この修正が今回の体感不良全体を解消するとは断定しない。

### 聴取効果の改善候補（未実装）

| 候補 | 利点 | トレードオフ |
|---|---|---|
| 静音/騒音の同一文比較を実施し、適切な利用者設定音量を確認 | 端末/イヤホン/騒音の影響を分離できる | 屋外での受入試験が必要 |
| 明示的な音声増幅設定を別途設計 | 通常TTS以上の音量を得られる可能性 | クリッピング/音質/聴取負担、機種差の評価が必要 |
| 騒音時の基準更新を再設計 | 長時間上限に固定される状況を減らせる可能性 | 安定した交通騒音を静音として学習すると必要な補正が下がる |

上限だけを変更して聴取効果を保証することはできない。音量の受入は未完了としてIssue #19をOPEN維持。

## 「3km案内がなかったかもしれない」

| 処理 | JST |
|---|---|
| VOICE_GENERATED | 06:42:40.185 |
| native QUEUED | 06:42:40.194 |
| 合成完了 | 06:42:42.033 |
| MediaPlayer STARTED | 06:42:42.082 |
| DONE | 06:42:52.841 |

3kmは合成成功、gain約1、Bluetooth A2DP、失効/割込み/fallback/Focus要求拒否の記録なし。直前のペース案内は06:41:59.877に終了、次は06:43:35.905に開始。アプリ内の別案内との再生時間重複は確認されない。1〜4km全てDONE。

ただし、OS/イヤホンの最終出音、他アプリや着信によるFocus変化、物理的な聞こえ方は現行ログでは証明できない。Focus変化リスナーは空である。3km未生成やキュー欠落と断定して再読み上げを追加しない。5kmは目標達成の終了案内が出ており、3kmの事象と混同しない。

追加で取得したAndroid `dumpsys audio`の保持ログにも06:42:40.202の本アプリのFocus要求、06:42:52.861の解放があり、その間の他アプリのFocus要求は記録されていない。これは保持されたFocus要求履歴の範囲の確認であり、最終出音の証明ではない。

## 残りの機能・設計レビュー

- 現在時刻は06:36:10.525と06:46:10.550に開始し、両方DONE。画面OFFでの実行記録あり。聴取受入とは区別する。
- 目標変更は今回使用記録なし。5km目標の到達時刻で履歴を保存、自動終了の保存成功を確認。今回を7→12km変更の実走検証とは扱わない。
- Auto Stopの停止/再開イベントは0件。実際に停止した場面があったかはログだけでは不明。閾値や通知仕様を変更しない。
- ペース案内21回/5分案内5回/距離案内4回/現在時刻2回/終了1回、合計33回DONE。案内過多や聞き分けやすさは既存マトリクスの設計レビュー対象。

レビュー資料は次の順：
1. [Auto Stopフローチャート](auto-stop-flow-20261031.md)
2. [音声案内マトリクス](voice-matrix-20261031.md)

## 検証・Test APK

変更ファイル：
- `modules/run-announcer/android/src/main/java/app/runjourney/announcer/{RunAnnouncerService,SynthesisBudget}.kt`：長文の合成待ちと診断。
- 同`src/test/.../{SynthesisBudgetTest,VoiceRecoveryTest}.kt`：待ち時間の範囲、実serviceの期限/fallback/削除回帰。
- `app.config.js`、`plugins/with-android-build-variants.js`、`src/utils/__tests__/pace-workout-build.test.ts`：Test v23の識別/版数と分離回帰。Production/Paceの版数は変更なし。
- 本資料と既存Auto Stop/音声マトリクス：追加実走の証拠・未検証事項、現行の合成待ち時間を反映。

コードcommit `3d9c0b6`（PR #57、#50への積み重ねを維持）。修正後JS55 suites/457 tests、native40（静音→騒音→静音・合成失敗fallback・割込み後の遅延callback・長文3秒超待機/最終timeout/ファイル削除を含む）、SQLite13、型チェック・Lint成功。95分GPS simulator seed311は12遷移/135音声/Pace71/失効0。シミュレーターはPC内SQLiteであり、端末の音声/GPS実受信を検証しない。

午前中のEAS cloudSyncTestはFree planのAndroidビルド枠上限で受付不可（約1時間後resetとの応答）。同日夜の再開後に再試行し、[62ef996e](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/62ef996e-939b-4a2f-a8ce-11329e852694)がFINISHED。課金やProduction/Paceへの変更は行っていない。

先にローカルAndroidビルド成功、Test専用package/versionCode23/minSdk26/targetSdk36、署名SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` が旧Testと一致し、`adb install -r`成功。初回導入日時を保持。ローカル検証APK SHA256 `031914f95c61031750ad6a325ffec85a6cc43702ef48a860ea6ba7b1d18b3830`、112,574,999 bytes。クラウドAPKと混同しない。

同日23:16の実機プレビュー66文字は設定合成待ち3,960ms/実合成947ms、続く既存音声テスト86文字は設定5,160ms/実合成576msで合成再生DONE。合成所要時間の新診断フィールドも確認。出力は本体スピーカーtype2、media14/30、通常の20秒プレビュー終了後に計測停止。履歴は作成していない。

この室内試験では旧版も同じ長文を3秒以内で合成でき、実走時の長文timeoutを再現していない。3秒超の無callback待機と最終fallback/削除はnative回帰で検証した。20秒測定リース終了後にgainが1へ戻る動作を、周囲の騒音による増加とは扱わない。修正後の屋外/画面OFF/Bluetooth長文合成・聴取効果は引き続き実走受入対象。

ローカルv23更新/試験後のBackupは取得時snapshot全体と完全一致（配列順を含む）：46履歴/17,759 GPS点、全設定/保護ID/draftなし。新規隔離SQLite復元も一致、integrity_check=ok/FK違反0。BackupファイルSHA256 `40c3bf778a9c8cdef665b97bd0c13bddf3c95e4ba3865015d82c640a04f2b94e`。設定は騒音ON/現在時刻ON・10分/次START 5km・6:00/kmを保持。START待機画面の`3d9c0b6+cloud-sync-v23`表示を確認し、音声/騒音/終了時計serviceは停止。端末media14/30維持。Production APK SHA256 `30a956d9b5197475c1226d10ac39a82c580c4f25e6e84218f8470b9316086d3a`は更新前後不変。Pace未操作。

**最終クラウドAPK**：[Test v23 APK](https://expo.dev/artifacts/eas/bc8-pTH3UJ1Hp-Xn5tRiniM0rdozbnknamHL5X0hmys.apk)、SHA256 `704713529a8f4fc2087732f54fa691b07de8051f108d8bd250814b18b1c3a300`、112,575,031 bytes。package/versionCode/minSdk/targetSdk/署名を照合後、同じTestへ`adb install -r`成功。実画面でGit `3d9c0b6+cloud-sync-v23`とEAS `62ef996e`を確認。ローカル検証APKと区別する。

最終APKでマイクプレビュー開始後にHOMEへ戻し、アプリ背景/画面ONで66文字の案内を実行。合成512ms/設定3,960ms、補正付きMediaPlayerで23:35:26.707 STARTED→23:35:39.841 DONE、gain0.65/出力type2/端末media14・最大30を記録。33有効マイクサンプル、約20秒のリース後STOPPED。rawAudioStored=false。これは背景動作の確認であり、画面OFFやBluetooth/屋外の聴取受入とは扱わない。

最終クラウドAPK導入/試験後も、取得時とのsnapshot全体一致、隔離SQLite復元一致、integrity_check=ok/FK違反0を再確認。46履歴/17,759 GPS点/全設定/保護ID/配列順/draftなしを保全し、試験履歴の作成/削除なし。最終Backup SHA256 `c18ac095f4f7be50a9a842f126949cef49a810dc91a9399333824b12de1814cd`。端末内Test APKのSHA256は上記クラウドAPKと一致し、Production APK SHAも不変。START待機へ戻し、音声/マイク/終了時計serviceなし。全IssueはOPEN、PR #57はDraft、Auto Stop/音声設計資料はレビュー待ちを維持する。
