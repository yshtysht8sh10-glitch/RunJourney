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

## 実機・APKの現状（未完了事項を含む）

- 導入確認済み：Test v22/187af15。112,558,619 bytes、SHA256 88d357c1d9111b627fb7f4c69bc3ea2194c118bc1079f82dd130e16c633cae74。同一署名fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c、package app.runjourney.mobile.test。adb install -r成功、画面にGitを表示。
- 検証用RUNを2026-11-01 05:12:50頃JSTに開始。開始前にAuto Stopを一時OFF、既存5分音声を一時OFF、現在時刻をON/5分へ変更。元の設定はBackupに保持。ペース走設定7km/7:00/km/±5秒/音声60秒と騒音ONは表示値を維持。
- RUN中7→12km/自動終了OFFの確認ダイアログと適用操作を実施。保存後のExport照合はまだ行えていない。
- 画面OFF/Dozingと音声foreground service継続を確認。05:17:50.700 JSTにnative logcatの「現在、午前5時17分です」を取得。背景でのTTS開始の証拠であり、聴取/DONEを証明しない。
- セキュリティロックに戻ったため、ユーザーへロック解除を依頼。**検証RUNは継続中。RUN終了・設定復元・更新後Backup取得は未完了。** 元46件の消去/Import/復元はしていない。検証記録は既存実走と区別して扱う。
- この操作で既存の別問題を特定：VoiceAnnouncementの通常停止がAdaptiveAudio.stop→noiseControl(stop)を呼び、マイクの明示的なユーザー停止と同じ永続フラグを立てていた。騒音JS設定ONでもその後USER_STOPPEDとなる経路。今回12kmの計測失敗原因ではない。最終332edffでライフサイクル用pause（マイクサービスだけ停止、設定/ユーザー停止フラグは維持）と明示OFFを分離。通知上のユーザー停止は引き続き尊重。既に停止フラグがある場合は騒音設定を明示的にOFF→ONする必要があり、無断で解除しない。
- 最終APK：332edff / Test v22、SHA256 66e264433002497d17291c56bf674988f20d9c1b24ffd56ab5320c0ebee0647e、同一署名確認済み。私有test-v22-332edff.apk。build/native成功。**端末へは未導入**（上記RUNの終了待ち）。
- 最終EAS：[e4375ebc](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/e4375ebc-cef6-4db7-8bd8-99cc7c556270)。旧候補3件は取消し、実装332edffのクラウドビルドを依頼。最終状態/クラウドAPKは別途確認。

### ロック解除後に残る実機検証

1. 現在の検証RUNの時刻/IDを確認し、目標12kmの保存状態・距離/時間継続を照合。到達済み時間目標ONの拒否、未来の時間目標ON/OFF、自動終了を試験して検証RUNを正常保存。
2. 最終332edff APKへ署名/ID再確認のうえ更新。騒音設定ONと通常ライフサイクルpauseからの再開、20秒マイク/音声テスト、出力route/gain/fallback欄を実機で確認。
3. 元のAuto Stop ON、5分音声ON、騒音ON、現在時刻OFF/10分へ復元（新しい現在時刻設定キーだけ追加され得る）。次STARTの元7km/7:00/km設定は変更しない。
4. 標準Backupと音声Exportを私有保存し、元46履歴/17,480点/全既存設定/保護IDのcanonical比較と隔離SQLite復元を実施。検証用新規記録はIDで明確に分離。
5. Production APK SHA/更新日時とPace未操作を確認。今回のTest検証記録を既存実走ログと混同しない。

実走で未検証：交通騒音下の聴取差、Bluetooth/本体ごとの実効音量、風/装着/電池、長時間の実機新機能動作、GPS上の7→12km終了実走。これらとロック解除待ちの実機項目が残るため、第1〜3件の作業完了条件を全て達成したとは報告しない。全IssueはOPEN維持。

## 第4・5件の成果物

1. [Auto Stopフローチャート・状態遷移・実走比較](auto-stop-flow-20261031.md)
2. [全音声マトリクス・FAST/適正/SLOW比較・改善候補](voice-matrix-20261031.md)

第4・5件は現行資料と候補提示まで。閾値・状態遷移・既存通知仕様の変更は行わず設計レビュー待ち。
