# #31 / #38 / #33 / #36 統合実装・実機検証

## 調査と保全

開始時HEAD bc1c9c7、作業ツリーはクリーン。fetch後mainは626f4be、HEADはmainに32コミット先行・遅れなし。既存Draft PRは#34 → #35 → #37の積上げ。本変更は#37ブランチをbaseとする別ブランチ codex/goal-finish-stop-31-38。Issueは全てOPENを維持。

Expo ~57.0.25を確認しSDK57 Location/TaskManager、Modules API、RN PressableとEAS docsを参照。追加依存なし。ProductionとPace分離環境は操作しない。

新規保全先: `D:\working\RunJourney-preservation\integrated-20261024-1f5293b5`。
Git全refsのbundleを作成・verify成功。Testの元APKを端末から保管（SHA256 cb735bb13a5f72159b0a0d8b436b50d053aff5c5c5044d9f5b24989fec67c9f3）。Testから新規標準Exportを作り、端末/PC SHA一致（86a38a546902de558aef91c2491dd8f7c0c3523be3645a14145a027d78fcb19f）。アプリと同じdecodeBackupで内部SHA・構造を検証、別SQLiteに復元し全snapshotのcanonical一致・integrity_check=okを確認。37履歴、13,701 GPS点、draftなし。全設定・ごみ箱・保護IDも比較対象。私有原本と復元DBはGitに追加しない。

## 添付実走ログ

version1、entries561行、verification561行、通知ID226個。記録範囲2026-10-22 20:08:42.134〜2026-10-23 02:05:42.877 JST（旧LEGACY音声2件を含む）。時刻が違う同一IDのQUEUED/STARTED/DONEは重複イベントではなくライフサイクルとして集約。

| 種別 | ID数 | 再生開始 | DONE | 期限切れ | その他 |
| --- | ---: | ---: | ---: | ---: | --- |
| 停止候補検出 | 14 | — | — | — | 全14候補に取消記録 |
| 停止予告 | 10 | 5 | 4 | 5 | 停止確定割込み1 |
| 予告抑制 | 4 | — | — | — | 30秒クールダウン |
| 自動停止確定 | 25 | 21 | 21 | 4 | |
| 自動再開確定 | 25 | 20 | 20 | 5 | |
| 5分 | 30 | 26 | 24 | 0 | 確定割込み2、優先通知直後抑制4 |
| 1km | 20 | 20 | 20 | 0 | |
| ペース警告 | 81 | 64 | 64 | 2 | 優先通知直後抑制15 |

確定事項: 予告は最初の1回だけではなく再検出・再生成されている。期限切れ予告5件は、JSのqueuedAt→最初のnative auditまで4,087 / 4,695 / 5,079 / 5,315 / 11,168msで、4秒TTLを既に超過。nativeキュー投入以前の遅延であり、native待機列の渋滞だけでは説明できない。再生した5予告のnativeキュー待ちは7〜1,271ms。停止/再開の未再生9件もEXPIRED。最初の予告は高優先の停止確定で中断。候補再許可フラグが永久に残る証拠や、過剰なID重複排除の証拠はない。

仮説: 保存キュー待ち、JS計算、同期native呼出し、バックグラウンドのOSスケジューリングが遅延を増幅した可能性。ログにAppState/CPUトレースがなく、寄与率やOS起因を断定しない。生成時刻は旧ログでは専用欄がなく、queuedAtはJSペイロード作成時刻として扱う。音量・イヤホン聴取は不明。DONEはTTS完了であり聴取成功ではない。

`node scripts/analyze-voice-log.cjs INPUT NEW_REPORT` で再集計可能。私有分析JSONに全IDのJS投入/native投入/開始/終端/待ち時間/期限/優先度を保存。既存verifyVoiceLogも561行全てを再計算しfalseは0。IDで集約した確認可能な貯金・停止除外・全体予測224、5分ペース/フル換算30、ラップ/ラップ貯金/発話時間20は全て整合。元GPS精度や未取得データの正しさは証明しない。

## 実装

- STOPゲージの30ms時計が1.5秒成立判定と発火を兼ねる。早いonLongPressの一度きりの判定失敗を同じ時計で再評価。コールバックは最新propsを参照。release/AppState/disabled/unmountは取消。
- prepareFinishをGPS書込と直列化。GPS停止の非同期待ちより先に終了snapshotを固定・保存。finishActiveRunとSQLite completeの既存一意ID/トランザクションを再利用。初回保存失敗もRAMの固定snapshotを再試行し、確定draftがあれば再起動後も同じ終了時刻を使う。履歴保存失敗時にGPS/音声を再開しない。
- 終了条件は独立した設定キーでmanual（既定）/distance/timeの一択。START時にRunRecordへsnapshot化。ペース走設定だけでは終了しない。
- 距離は既存effectiveEdgesの品質判定・実走時計で補間し、原GPSは変更しない。日時のミリ秒表現では目標に到達した最初のミリ秒を選び、最終1kmが欠ける丸めを防ぐ（最大1ms相当の距離差）。時間はtimeModelからAuto Stop/Breakを除外し、遅延通知でも到達時刻に戻して保存。
- Android時間目標では独立したlocation foreground serviceの1秒native pulseとJS intervalを使用。音声OFF/GPS更新なしでも、JS実行環境が存続する限り共有時計で終了判定。重複pulseはcoalesce。端末/OSによるプロセス強制終了中のリアルタイム実行は保証せず、再起動で元時計から評価する。iOSのサスペンド中の正時発火は未検証で、Android Test向け実装と区別する。
- 保存成功後だけ画面を完了にし、達成音声をpriority110で送る。音声失敗は保存成功を取り消さない。履歴の追加メタデータに終了条件と到達入力を保持し、結果画面/詳細のレポートで達成理由を表示。旧履歴は追加欄なしでも読める。
- 音声更新の待機を最新snapshotへcoalesceし、RAM観測読出しをSQLite書込待ちから分離。設定I/O待ちの後に鮮度を判定。notifyBatchを非同期native APIへ変更。予告80は通常ラップ70/5分40/警告20を中断でき、確定100/達成110を優先する。TTLは延長しない。
- native再生直前にもrunId/候補有効性/状態/最新イベント番号/終了済みを確認。候補取消、再開、終了で古い待機・再生中音声を破棄。満杯時は重要通知のため低優先通知を退避せず破棄し理由を記録。古いTTS開始callbackを無視。終了後に届く旧batchも拒否。
- 終了開始/成立/保存成功/失敗/競合/手動長押しと音声状態・待ち時間・破棄理由は既存の20MB/20,000イベント/7日journalへ記録。座標を追加せず、自動外部送信もしない。

## 検証と配布

- Jest全45 suites / 405 tests成功。5km境界/最終km、60分、Auto Stop/Breakを挟む時間除外、GPS不良/遅延、native pulse、保存失敗/再試行、遅着GPS、手動STOPとの同時発生と、確定遷移による目標判定取消時の手動STOP優先を含む。
- SQLite/移行/ページ/長時間のnode:test26件、Firebase Auth/Firestore Emulator2件、救出検証Python10件成功。Emulatorはdemo-runjourneyだけを使用し、既存実走データを外部送信していない。
- Android JVM16件（journal9、既存policy2、状態/優先度5）とRelease Kotlinコンパイル成功。TTS開始/完了/エラーにutterance ID照合を追加し、割込み前のcallbackで次の発話が完了扱いされる経路を遮断。
- lint/TypeScript成功。Web export成功（既存Leaflet CSS画像・@noble/hashes解決の警告あり）。Expo Doctorは20/21成功、既存12パッケージのSDK57パッチ版との差分で1項目失敗。package.json/lockfileは今回変更せず、既存の依存状態を維持した。
- 更新済みソースで保全バックアップをさらに新規SQLiteへ復元し、全37履歴/13,701点/設定/draft/保護IDの一致とintegrity_check=okを再確認。
- Draft PR: https://github.com/yshtysht8sh10-glitch/RunJourney/pull/39 。実装f51ee6d、手動競合修正237abe1、TTS照合修正1e3f1c0、実機で判明したnative戻り値修正aadab15。先行2ビルドは取り消した。

### 最初の実機更新と追試（2026-10-25 JST）

- EAS fe4f30a3（1e3f1c0）成功、実APKはTest/versionCode18/minSdk26。署名fac61745…1033b9cが更新前と一致。APK SHA a5c6435c5767071cbdb14eba2a6c1784fa092bc1e7401111c30c279a043303b3。
- `adb install -r`成功。初回インストール2026-09-30を保持。画面でGit/EAS表示と終了条件の初期manualを確認。
- 更新後Exportの端末/PC SHA一致（d4469e89dd94cde4581ce46be338b7e004936ac42f720c75ae05570d3999c46b）、decodeBackup・隔離SQLite復元・全snapshot一致成功。当初37件の全フィールドと全設定/draft/protectedIdsは不変。保全後・更新前の00:29〜01:22に7.06km/595点の走行が追加されており、更新後は38履歴/14,296点。この追加記録の更新直前snapshotは未取得なので、前後完全一致の主張は当初37件に限る。追加記録自体の読出し・Export・完全復元は確認済み。
- Testで短い押下は取消、続く1回の1.8秒長押しで正常保存・完了画面を確認。検証記録1件（2:06:52〜2:07:34、GPS6点）は残し、全39件を改めてExport（6c1833831d6bc38779d56bdcaea3741a9ee951891665ef846f951f917a1907ca）。先の38件の全フィールド不変を確認。
- 実機でnotifyBatchのPromise戻り値に`Unknown type: android.content.ComponentName`を検出。native呼出し自体は動作していたがPromiseが失敗扱いになるため、notifyBatchとfinishClockの戻り値を明示的にUnitへ修正（aadab15）。この修正はKotlin/16 JVMテストとlint/TypeScript成功後push。
- 1e3f1c0で1分目標・Break/Resume・画面OFFの短時間試験を実施。native foreground pulseの存在、画面OFF中の達成発話開始と時計サービス停止をlogcatで確認。保存時間・停止除外・一意保存はExportで後続照合する。Auto Stop設定を試験中だけOFFに変更し、終了後に元へ戻す。
- ローカルassembleStandaloneTestは成功したが、既存生成環境がversionCode17のため導入していない。ダウングレードは行わず、最終配布・導入はEASのcloudSyncTest/versionCode18を使用する。
- 時間試験のExport照合完了: 02:12:22.192〜02:14:00.226、全経過98,034ms、Break38,034ms、実走60,000msで目標終了。到達判定は境界の77ms後、保存は約517ms後、保存後に達成通知がnativeキューへ投入され、STARTED/DONEまで確認。対象IDの履歴は1件。画面OFF中の終了を確認した短時間試験であり、60分の実走試験とは区別する。
- 既存38件の全フィールド不変、既存設定の全キー/値不変、draftなしを確認。新規終了設定だけmanualを保存。検証2件を含む40履歴/14,315 GPS点を新規Export・端末/PC hash・decodeBackup・隔離SQLite全snapshot復元で保全。SHA256 94658f9345f5f26db3f4c02afe43952058d8443be7311dd436366417bb7fb7ad。time-test-verification.jsonとtime-voice-evidence.jsonを私有保全先に保存。

### 最終APK・実機更新結果

- 最終EAS: https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/e7cb02c7-940b-430d-9b78-c7e511ec2f1c 、実装aadab15。APK内app.configと起動画面で同じGit/EASを確認。実manifestは`app.runjourney.mobile.test` / versionCode18 / minSdk26 / targetSdk36。
- APK SHA256 `52f41b0d8dc194784bb6918bf4a8959fe157feec39eff9f5d217281f4bd55e15`、署名は更新前と同じ`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。保全先のrunjourney-test-aadab15.apkを配布用とする。1e3f1c0版は最終配布用ではない。
- 2026-10-25 02:24 JST、`adb install -r`成功。アンインストール/データ消去/ダウングレードなし。初回インストール日2026-09-30、dataDirを維持。Production/Paceには操作していない。
- 修正版で1回の長押し（1.8秒接触）→保存完了画面を再確認。先行実機試験と合わせて2回の長押し成立。続いて1分目標をバックグラウンドで試験し、02:25:33.772〜02:26:33.772、実走60,000ms、判定53ms遅れで境界時刻に一度だけ保存。達成音声のQUEUED/STARTED/DONEをJSONで確認。型エラー/発話ブリッジ失敗は再発せず、終了後のforeground GPS/clock/voiceサービス停止を確認。
- Auto Stop/音声通知ON、ペース設定20km/7:30km/±5秒/60秒間隔を含む既存設定の全キー・値を保全時と照合し復元。終了条件はmanual。force-stop/再起動後もGit aadab15、EAS e7cb02c7、START待機・手動終了設定を確認。
- 最終標準Exportは42履歴/14,326 GPS点、draftなし。既存38件+先行検証2件の全フィールド不変、全設定/保護ID一致。追加は最終版の検証2件のみ（合計検証4件は削除せず保持）。端末/PC SHA、内部SHA、別SQLiteへの全snapshot復元とintegrity_check=okを確認。
- 最終Backup SHA256 `b303dfbab8a85b5faa74480c97375edea3d0b46579e3742f0ba8ef1ad6331e25`、8,976,919 bytes。backup-final.json / final-verification.json / final-restore.sqliteを私有保全先に保存。
- 最終音声ログ774行・1,763,873 bytes。元の561行が全フィールドで完全に残ることを確認。全774行を再検算しfalse0。両時間目標の達成イベントは同一IDのQUEUED→STARTED→DONE。音声ログSHA256 `68c262e47817b0b1d5a56724969974d0b1fd1f7a3f6752e515a9a6362af8a2e1`。voice-final.json / voice-final-verification.jsonに保存。聴取確認とは区別する。

長時間実走、5km/60分の実距離・実時間、停止の体感、イヤホンでの聴取、低速往復/ノイズの誤予告率は次の実走受入事項。GPS更新を意図的に止めた実機試験やOSによるプロセス強制終了、iOSサスペンド中も未検証。距離目標は合成GPSの品質・境界/最終ラップ回帰で確認したもので、実距離の5km試験ではない。自動テストや短時間の端末操作を実走完了とは扱わず、関連Issueは閉じない。
