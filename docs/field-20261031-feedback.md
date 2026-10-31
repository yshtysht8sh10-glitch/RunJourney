# 2026-10-31 Test v21 約12km実走

## 順序・依存・保全
PR #50（Draft/OPEN）のhead 72f82b4を基点にcodex/field-20261031-feedbackを作成。#50は#46のブランチをbaseとする。mergeしない。Production/Pace、既存履歴を変更せずTestのみ更新する。

## 1. #19 騒音連動
実機TestのDiagnostics→音声ログJSON Exportから取得。原ログ23,969,519 bytesと標準Backup12,222,437 bytesは私有D:/working/RunJourney-preservation/field-20261031/に保存。Backup端末/PC SHA256一致8f2c1cde6d1e893a5fb798cf8787c7f59b3866520bd6a177bb6a44d047a0600a。原音声は保存していない。

対象RUNは開始設定ON/マイク許可、内蔵マイクtype15、終了時24,032サンプル（画面OFF23,701）、dBFS min -74.77/max -11.43/mean -43.63。dBFSは校正された音圧ではない。NOISE_LEVEL 1,046件中1,023件はgain約1.0。補正は静音0.65→騒音1.0で、通常TTSの1.0を超える増幅ではない。上限張付きを確認したが、体感不良の原因をこれだけで断定できない。端末stream音量は開始14/30→終了12/30、アプリは変更しない。

STARTED 123件：adaptive58件（Pace42、km12、5分3、終了1）、通常TTSは状態/予告52件とWORKOUT_GOAL1件、5分13件。5分の合成SYNTHESIS_TIMEOUT14件あり（再試行を含む）。通常TTSへのfallbackは音声自体を保つが騒音追従しない。出力経路STARTED時type0なので本体/Bluetoothを断定できない。

修正：再生中gain/routeを変化時と5秒ごとに同一通知IDでADAPTIVE_APPLIEDへ記録。fallback理由を発話レコードに保持し、gain上限・端末stream上限・通常再生超過なし・聴取未確認を別欄に記録。閾値/上限/音声内容/優先度は変更しない。静音→騒音→静音の既存JVMテストと実サービスfallback回帰を検証。聴取効果は次回実走受入。

## 2. 現在時刻 #56

初期OFF/10分。5/10/15/30分。RUN開始の壁時計経過時間で境界を判定し、端末ローカル時刻を発話直前に生成する。Androidの既存音声foreground service内で1秒tick。停止（Auto Stop/Break）中はその境界を消費し、再開後の追い読みなし。別音声・初期化待ち・5秒超遅延時も破棄。TTL5秒、優先度30、割込み後の再試行/情報復旧への混入なし。既存の5分通知/ペース通知のON/OFFと独立し、現在時刻だけをONにしても既存通知を有効化しない。Androidの既存native音声基盤を使用し、iOS/web音声は未実装（既存と同じ）。

コード：ClockSettingsRepository、CurrentTimeSettings、VoiceAnnouncement.updateGuidance、RunAnnouncerService.clockTick、CurrentTimePolicy。設定は@runjourney/current-time/v1に保存。48時間の境界、5/10/15/30分、午前/午後/正午/午前0時、停止再開・競合・失効経路をJS/JVMで検証。デフォルト変更や期限延長で古い時刻を読み上げない。

## 3. RUN中の目標変更 #55 / 既存 #38

既存#38はfinishGoalをeffectiveEdges/timeModelで判定し、prepareFinishで直列化して凍結・保存する。ペース走の到達通知と、GPS停止/再開のAuto Stopは別経路。

RUN画面→RUN中の目標を変更→距離または時間・自動終了ON/OFF→確認→保存して適用。入力中は旧目標で計測し、適用確認まで終了を保留しない。適用時に既に終了処理が凍結されていれば変更を拒否する。終了より先に変更が直列キューへ入れば、新目標で終了条件を再確認。到達済み目標へのON変更は拒否し、OFFで保存/未来の目標を促す。無警告の即終了を避ける境界仕様として採用。目標を越えるまで編集を待つ救済猶予は追加していない。

GPS/距離/経過時間/ラップ/イベント/ペース集計/目標ペースは維持。ペース走がある場合は単一segmentの到達目標だけも更新する。自動終了OFFでも目標を保持（finishAutoEnabled=false）。次START用の保存設定は変えない。保存成功後だけRAM状態とUIを更新する。変更前後の終了目標/自動終了/ペース到達目標・変更時刻をgoalChangesとRUN_GOAL_CHANGEDへ保存（1RUN最大256回、超過は明示拒否）。旧履歴の未設定フィールドは従来動作を保持する。

コード：RunGoalEditor、RunService.updateFinishGoal、RunRepository.updateFinishGoal、goalAchievement、RunRecord.goalChanges。7→12kmの連続性、7kmで未終了/12km到達判定、時間目標、ON/OFF、到達済み拒否、終了凍結競合、保存失敗時不変、SQLite再読込、履歴への変更履歴保持、確認ダイアログ/失敗表示を検証。

## 自動検証

最終実装332edff。JS55 suites/457 tests成功、native36 tests成功、SQLite実ファイル13 tests成功、TypeScript/Lint成功。95分GPSリプレイ（seed310、6秒保存遅延、画面状態変化相当）は12停止/再開、135音声/Pace71、失効0、90分以降の案内を確認。GPS観測キュー仮想p50/p95/max0ms。native100分136件の既存サービスキュー回帰も成功。fake/native DONEは実際の聴取の証明ではない。

## 更新前保全

46履歴/17,480 GPS点/設定7キー/draftなしを新しい隔離SQLiteへ復元し、全snapshotのcanonical一致。integrity_check=ok、foreign_key_check=0。署名一致したv21 APKと私有ログを保管。Production APK SHAを更新前に保存、Pace packageは今回端末に存在しない。Production/Paceのビルド配布・更新・データ操作は行わない。

## 実機検証・最終導入（2026-11-01 JST）

ユーザーのロック解除後に未完了作業を再開した。中間Test v22/187af15で開始した検証RUN（私有ログでID管理）は05:12:49.530開始、05:47:49.530終了。有効35分ちょうど、283 GPS点、距離0mの室内静止試験。交通騒音・実走と混同しない。

### 現在時刻

05:17/22/27/32/37/42の6境界でQUEUED→STARTED→DONEを確認。最初の5分案内は05:17:50.700、Dozingと音声foreground service継続を確認した画面OFF状態。35分境界05:47はRUN終了と競合し、STARTED後にINTERRUPTED_STATE_CHANGED/DISCARDEDとなり再試行なし。発話の完了callbackは聴取の証明ではない。

### RUN中の目標変更

7kmのペース到達目標から12km/自動終了OFFへ適用し、32分以上の背景継続後も保存・適用表示と12km目標を保持。既に到達済みの1分/自動終了ONは説明を表示して拒否し、旧目標を維持。続いて35分/自動終了ONを確認・保存し、背景で35分ちょうどに自動終了。保存履歴には2回の変更前後（終了目標・自動終了・ペース到達目標）があり、距離・時間・GPS・ラップをリセットしていない。次STARTの7km/7:00/km/±5秒/音声60秒設定は不変。終了到達時刻との差は検出213msで、遅れても保存終了境界は目標時刻。

### 騒音・最終APK

実機操作で別の再開阻害も特定した。通常の音声ライフサイクル停止がnoiseControl(stop)を経由し、マイクの明示ユーザー停止と同じ永続フラグを立てていた。JS騒音設定ONでも以降USER_STOPPEDとなり得る。今回12kmでは計測済みなので、その体感不良の原因とは扱わない。332edffでpause（サービス停止だけ、設定/ユーザー停止フラグは維持）と明示OFF/通知STOPを分離し回帰を追加。既存の明示停止フラグは無断解除せず、今回の試験では騒音OFF→ONの明示操作で再有効化した。

最終EAS [e4375ebc](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/e4375ebc-cef6-4db7-8bd8-99cc7c556270) はFINISHED、commit `332edff30fbe2ff6e31ce9438899be8d1c48a711`。実APK package `app.runjourney.mobile.test` / versionCode22 / minSdk26 / targetSdk36。署名SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` は更新前Testと一致。adb install -r成功、実画面で `332edff+cloud-sync-v22` / `EAS: e4375ebc` を確認。初回インストール日を維持。Production APK SHA不変、Pace未操作。

- **導入したクラウドAPK SHA256**：`01342855a53e7364fb04891362f2f084b025113581ee39ed4cffbfb4c1123f21`。
- 同じ332edffのローカル検証APK：`66e264433002497d17291c56bf674988f20d9c1b24ffd56ab5320c0ebee0647e`。クラウドAPKと区別する。

最終APKで20秒プレビューを実行し、背景のマイクservice起動、内蔵マイクtype15、34有効サンプル、dBFS min -78.20/max -55.86/mean -70.64、合成再生STARTED/DONE、再生中ADAPTIVE_APPLIEDを確認。出力type2（本体スピーカー）、適用gain約0.857、静音基準比約1.318、端末media音量14/最大30。speakerFeedbackHoldで自分の音を補正へ取り込まない。20秒後STOPPED・測定service停止。生マイク音声保存なし、端末stream音量の変更なし。これは自然な室内環境での機能確認であり、制御された交通騒音/聴取比較ではない。

### データ保全・検証記録の片付け

最終導入後Backupは、既存46履歴・GPS17,480点・全既存設定7キー・保護IDが更新前と完全一致し、追加は検証RUN1件と現在時刻OFF/10分の新設定キーのみだった。検証RUNと変更履歴・音声ログを私有保全先へ保存後、その検証RUNだけをID照合して削除。

**検証中の問題と回復**：ごみ箱画面の既存7日保持処理により、元の古いごみ箱記録1件（28 GPS点、元は保護対象外）が自動削除されたことを全件照合で検出した。片付けでこの画面を通した判断ミス。更新前Backupからその1件だけのSHA検証済み復元ファイルを作成し、標準Importで1件のみ追加した。既存45件・設定・draft・保護フラグを上書きせず、元のごみ箱状態/日時/全GPS/全フィールドを復元。保持ポリシーや保護対象は勝手に変更しない。

**最終結果**：46履歴/17,480 GPS点、全記録をID単位でcanonical比較し全フィールド完全一致、既存設定7キーと保護ID完全一致、draftなし、検証RUNなし。追加キーは `@runjourney/current-time/v1={"enabled":false,"minutes":10}` のみ。復元した1件がBackupの配列末尾に移ったため、配列順そのものは一致しない。履歴画面の `started_at DESC` 順序と記録内容は不変。これをsnapshot全体完全一致とは表現しない。

最終Backupは12,222,504 bytes、端末/PC SHA256一致 `7c6b1ce78a993c4be6af86f15ceb2caf3a26558dc239b99b7c82e1c27a5f1f17`。decodeBackupで内部SHA/構造検証、新しい隔離SQLiteへ復元して最終snapshot全一致、integrity_check=ok、foreign_key_check=0。`backup-final-restored.json` / `verification-final-restored.json` / `restore-final-restored.sqlite` を私有保全。削除直前の検証RUNを含むBackupも別途保持している。

Auto Stop ON、Break ON、5分音声ON、騒音ON、現在時刻OFF/10分、次STARTの元7km/7:00/km設定へ復元。TestをSTART待機へ戻し、音声/マイク/終了時計service停止、試験のため一時変更した端末stay-awake設定も元の7へ戻した。

### 実走受入に残る事項

交通騒音下の聴取差、Bluetoothでの最終版の実効音量、風/装着/電池影響、GPS移動を伴う7→12kmの実走自動終了、長時間の実機動作は次回実走で確認する。PC95分/native100分や室内35分試験を屋外実走と同じ証拠とは扱わない。全Issueは実走/設計受入までOPEN維持。

## 第4・5件の成果物

1. [Auto Stopフローチャート・状態遷移・実走比較](auto-stop-flow-20261031.md)
2. [全音声マトリクス・FAST/適正/SLOW比較・改善候補](voice-matrix-20261031.md)

第4・5件は現行資料と候補提示まで。閾値・状態遷移・既存通知仕様の変更は行わず設計レビュー待ち。
