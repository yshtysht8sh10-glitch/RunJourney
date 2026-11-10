# 検証マトリクス：Test v28

2026-11-10作成、レビュー用Draft。[フロー索引](run-flow-index.md) / [音声仕様](voice-matrix-20261031.md) / [更新ルール](documentation-maintenance.md)。アプリコード・テストは追加していない。

## 対象と結果の定義

- 対象SHA V28：`f1476f7947779b0fa4aeb28a054efd44255ef0c8`（以下の全ケースの照合基準）。資料コミットとは区別する。
- V26：`ae701b3c79955df709bf7fef1ba7ae5c29f5267b`。履歴/共通音の過去の実機結果をv28での再確認として数えない。
- Productionは対象外。PR #67/#70は未マージ。main/variant/導入APKの区別は索引を参照。
- 自動テストで確認済み：記載したテストのassert範囲で成功。広いケースの全組合せ成功を意味しない。
- 室内実機で確認済み：E-V28の既存報告が示す条件だけ。今回の担当者が新たに実機操作した結果ではない。
- 屋外実走で確認済み：新#68/#69について該当なし。古いAuto Stop実走を新機能の実走受入に転用しない。
- 未確認：未実行、または部分集合しか根拠がない。未実装・対象外：現在機能にない組合せ。

## 実行・証跡ID

- R-AUTO：2026-11-10、V28ソースで独立再実行。JS/Native/SQLite/型/lintの最終結果は[品質確認記録](flow-matrix-update-review-20261110.md#品質確認)へ記載。テスト名の`%s`等はtest.each宣言の原文名で、実行時に値へ展開される。
- E-V28：[v28画面OFF資料](goal-cue-screenoff-20261109.md)の室内記録。配布実装faadf6c、指定HEADは記録追記込み。距離200/190/10、時間60/50/10の計9本文。時間再試聴のみユーザー聴取確認あり。原ログは私有保存でGitへ含めない。
- E-V26：[v26実機資料](field-20261107-v26.md)。通常音声と履歴操作の当時の証跡。
- 旧屋外：[10月31日実走](auto-stop-flow-20261031.md#6-10月31日12136km実走との比較)。当時のAuto Stop条件の証跡で、新機能の実走成功ではない。

## ケース

### RUN-01

- 対象SHA：V28。
- 初期条件：RUNNING/AUTO_STOP/BREAK、Auto Stop/Break各設定。
- 入力イベント：STOP操作と同時STOP呼出し。
- 期待結果：STOP導線を維持、同時処理は一つの保存へ合流。
- 対応コード：[src/services/run-service.ts](../src/services/run-service.ts) `stopRun`。
- テスト名：
  - `STOP available in %s`（[src/utils/__tests__/run-screen.test.ts](../src/utils/__tests__/run-screen.test.ts)）。
  - `concurrent service STOP calls share one save and preserve STOP time while stopping GPS`（[src/utils/__tests__/stop-service.test.ts](../src/utils/__tests__/stop-service.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### RUN-02

- 対象SHA：V28。
- 初期条件：終了要求を受けた活動中draft。
- 入力イベント：GPS停止失敗、保存再試行、凍結済み復元。
- 期待結果：凍結時刻・draftを保持し、再試行で終了を延長しない。
- 対応コード：[src/services/run-service.ts](../src/services/run-service.ts) `stopRun`。
- テスト名：
  - `GPS stop failure freezes draft and permits retry without extending its end`（[src/utils/__tests__/stop-service.test.ts](../src/utils/__tests__/stop-service.test.ts)）。
  - `restoring failed-save snapshot does not restart GPS or request permissions`（[src/utils/__tests__/stop-service.test.ts](../src/utils/__tests__/stop-service.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：finishedを欠くmockの警告あり。保存の試験であり終了TTSの成功確認ではない。

### GPS-01

- 対象SHA：V28。
- 初期条件：Standalone Testの観測バッファと保存gate。
- 入力イベント：重複・古いfix・並び替え・欠測・再起動。
- 期待結果：観測と保存を区別し、重複を再処理しない。正常時は約5秒間隔で保存。
- 対応コード：[src/utils/gps-observation.ts](../src/utils/gps-observation.ts) `GpsObservationSession`。
- テスト名：
  - `empty, timestamp order, duplicate, exact window boundary, irregular fixes, poor accuracy and null speed`（[src/utils/__tests__/gps-observation.test.ts](../src/utils/__tests__/gps-observation.test.ts)）。
  - `restart restores gate and aggregates but resets RAM; drops duplicate/stale/pre-start samples`（[src/utils/__tests__/gps-observation.test.ts](../src/utils/__tests__/gps-observation.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### GPS-02

- 対象SHA：V28。
- 初期条件：Auto Stop ON、RUNNING/AUTO_STOP/BREAK。
- 入力イベント：GPS jump・不良精度・speed欠損、静止/移動suffix。
- 期待結果：jumpだけで再開せず、正常移動は再開。BREAKはsensor再開しない。
- 対応コード：[src/utils/run-model.ts](../src/utils/run-model.ts) `detectStop`。
- テスト名：
  - `one GPS jump does not resume; later normal movement does`（[src/utils/__tests__/movement-inference.test.ts](../src/utils/__tests__/movement-inference.test.ts)）。
  - `poor accuracy cannot prove movement; missing or briefly low speed does not reset forward motion`（[src/utils/__tests__/movement-inference.test.ts](../src/utils/__tests__/movement-inference.test.ts)）。
  - `Break never auto resumes; window survives draft serialization`（[src/utils/__tests__/movement-inference.test.ts](../src/utils/__tests__/movement-inference.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### GOAL-01

- 対象SHA：V28。
- 初期条件：manual/distance/timeの排他的目標、自動終了ON。
- 入力イベント：時間境界、停止・休憩、GPS jump、不良精度。
- 期待結果：手動目標は自動終了なし。時間は停止/休憩を除外し、異常GPSで距離達成しない。
- 対応コード：[src/domain/finish-goal.ts](../src/domain/finish-goal.ts) `goalAchievement`。
- テスト名：
  - `manual is the safe default; pace goal alone never ends a run`（[src/utils/__tests__/finish-goal.test.ts](../src/utils/__tests__/finish-goal.test.ts)）。
  - `60 minute target excludes %s and continues from remaining time`（[src/utils/__tests__/finish-goal.test.ts](../src/utils/__tests__/finish-goal.test.ts)）。
  - `GPS jumps and poor accuracy cannot satisfy distance target`（[src/utils/__tests__/finish-goal.test.ts](../src/utils/__tests__/finish-goal.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### GOAL-02

- 対象SHA：V28。
- 初期条件：7km目標の活動中RUN。
- 入力イベント：12kmへ延長、到達済み目標ON、終了凍結との競合。
- 期待結果：原GPS/イベント/経過を維持。到達済みONは拒否し、凍結後の目標変更はしない。
- 対応コード：[src/repositories/run-repository.ts](../src/repositories/run-repository.ts) `updateFinishGoal`。
- テスト名：
  - `7→12km preserves GPS, elapsed, laps and events; only new goal ends run`（[src/utils/__tests__/run-goal-change.test.ts](../src/utils/__tests__/run-goal-change.test.ts)）。
  - `frozen finish wins race, failed save never changes active target`（[src/utils/__tests__/run-goal-change.test.ts](../src/utils/__tests__/run-goal-change.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### VOICE-01

- 対象SHA：V28。
- 初期条件：通常通知が共通チャイム中。
- 入力イベント：通常のより高いpriority通知、RUN終了、chime失敗。
- 期待結果：通常差だけで本文を落とさず、終了では取消。chime失敗時は有効なら本文へ。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt) `playChime`。
- テスト名：
  - `ordinaryHigherPriorityDoesNotDropCommonChimeBody`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
  - `finishDuringCommonChimeCancelsOldBodyImmediately`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
  - `expiryInCommonGapCannotStartBodyAndFailureStillAllowsBody`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：v26の室内9通知記録は参考。v28全通知/全段階の競合はGAP-04。

### VOICE-02

- 対象SHA：V28。
- 初期条件：countdownの3秒開始期限内に本文開始。
- 入力イベント：開始期限を跨いで再生継続、新数字、時間目標deadline。
- 期待結果：開始済み本文は旧期限で切らず5秒watchdog、次数字/目標deadlineは優先。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt) `cueBodyStarted`。
- テスト名：
  - `startedCountdownSurvivesDeliveryDeadlineButRemainsBounded`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
  - `startedCountdownStillStopsAtTimeGoalDeadline`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
  - `newerCountdownStillCancelsStartedOlderBodyAfterDeliveryWindow`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：室内実機で確認済み（E-V28の4本文は生成3秒超でもDONE。ただし全境界の試験ではない）。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：half専用境界はGAP-01。室内ログのDONEと聴取を分離。屋外未確認。

### VOICE-03

- 対象SHA：V28。
- 初期条件：終了印を保存したRUN。
- 入力イベント：古いcountdownの後着、Nativeサービス再生成。
- 期待結果：新2通知を拒否し、通常mute→再ONは永久終了扱いにしない。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/GoalCueFence.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/GoalCueFence.kt) `finish`。
- テスト名：
  - `finishedCueMarkerRejectsLateCountdownWithoutDisablingGenericVoiceResume`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### CUE-01

- 対象SHA：V28。
- 初期条件：距離/時間、turnaround ON、半分の手前。
- 入力イベント：50%通過、逆戻り、同じ点、停止中通過。
- 期待結果：原則1回。停止中は消費して再開時追いかけない。
- 対応コード：[src/domain/goal-cues.ts](../src/domain/goal-cues.ts) `advanceCues`。
- テスト名：
  - `halfway %s crosses exactly once`（[src/utils/__tests__/goal-cues.test.ts](../src/utils/__tests__/goal-cues.test.ts)）。
  - `pause consumes crossed levels without speaking and resume never catches up`（[src/utils/__tests__/goal-cues.test.ts](../src/utils/__tests__/goal-cues.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：大幅飛越し50m/15秒の±境界、halfのNative再生は追加確認が必要。

### CUE-02

- 対象SHA：V28。
- 初期条件：countdown ON、距離200m/時間60秒より前。
- 入力イベント：全10単位閾値、複数通過、逆戻り、異常/古い入力。
- 期待結果：各数字は最大1回、最新だけ、0や到達後は発話しない。
- 対応コード：[src/domain/goal-cues.ts](../src/domain/goal-cues.ts) `advanceCues`。
- テスト名：
  - `%s announces every countdown threshold once, initial chime belongs to native session`（[src/utils/__tests__/goal-cues.test.ts](../src/utils/__tests__/goal-cues.test.ts)）。
  - `jump selects latest crossed number, reverse/missing/abnormal input never replays`（[src/utils/__tests__/goal-cues.test.ts](../src/utils/__tests__/goal-cues.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：室内実機で確認済み（E-V28の距離200/190/10m、時間60/50/10秒の部分集合）。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：全20/6数字の実機確認ではない。GPS鮮度の厳密境界はGAP-02。屋外未確認。

### CUE-03

- 対象SHA：V28。
- 初期条件：消費済みの同一RUN/目標、永続進捗あり。
- 入力イベント：復旧、新目標、A→B→A、旧epoch後着。
- 期待結果：過去の半分/数字を追わず、旧epochを拒否。
- 対応コード：[src/services/goal-cues.ts](../src/services/goal-cues.ts) `evaluateCueSource`。
- テスト名：
  - `change already behind half and restore have no catchup; reverting consumed goal does not repeat`（[src/utils/__tests__/goal-cues.test.ts](../src/utils/__tests__/goal-cues.test.ts)）。
  - `sameGoalValueAfterTwoEditsRejectsOldEpochCountdown`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### CUE-04

- 対象SHA：V28。
- 初期条件：時間目標、#62とcountdown設定。
- 入力イベント：残60秒到達とcountdown OFFへの変更。
- 期待結果：ONの帯内は#62抑止、OFFで既存予告を維持。距離帯はコード上200mで範囲外500mを維持。
- 対応コード：[src/services/voice-announcement.ts](../src/services/voice-announcement.ts) `beforeGoal`。
- テスト名：
  - `time 60s warning is suppressed only while countdown ON in band; OFF keeps v26 warning`（[src/utils/__tests__/goal-cue-integration.test.ts](../src/utils/__tests__/goal-cue-integration.test.ts)）。
  - `countdownSuppressesExistingWarningOnlyInsideConfiguredRange`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/VoiceRecoveryTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：距離200m/範囲外500mと#62可変設定の結合試験は時間試験と区別して追加検討。

### CUE-05

- 対象SHA：V28。
- 初期条件：予約済みイベント、送信前I/O待ち。
- 入力イベント：遅延でTTL超過、またはstop。
- 期待結果：失効/終了後は送らず、消費済み予約は再生し直さない。
- 対応コード：[src/services/goal-cues.ts](../src/services/goal-cues.ts) `evaluateCueSource`。
- テスト名：
  - `reservation delayed beyond TTL is logged and never dispatched or replayed`（[src/utils/__tests__/goal-cue-integration.test.ts](../src/utils/__tests__/goal-cue-integration.test.ts)）。
  - `stop before pending I/O finishes prevents late cue dispatch`（[src/utils/__tests__/goal-cue-integration.test.ts](../src/utils/__tests__/goal-cue-integration.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### CFG-01

- 対象SHA：V28。
- 初期条件：新規/既存設定、2スイッチ、Test UI。
- 入力イベント：読取・同一UI turnの2変更・再mount。
- 期待結果：初期OFFで読取だけなら書かない。片方を上書きせず永続化。
- 対応コード：[src/repositories/goal-cue-settings.ts](../src/repositories/goal-cue-settings.ts) `set`。
- テスト名：
  - `two switch changes in one UI turn cannot overwrite the independent setting`（[src/utils/__tests__/goal-cue-settings-ui.test.ts](../src/utils/__tests__/goal-cue-settings-ui.test.ts)）。
  - `two settings persist independently across remount; old RUN/trash/settings unchanged`（[src/utils/__tests__/goal-cue-settings-ui.test.ts](../src/utils/__tests__/goal-cue-settings-ui.test.ts)）。
  - `only reservation changes checkpoint; default OFF never starts audio service`（[src/utils/__tests__/goal-cue-integration.test.ts](../src/utils/__tests__/goal-cue-integration.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### PROBE-01

- 対象SHA：V28。
- 初期条件：実RUNなし、Test限定、独立memory DB。
- 入力イベント：JS timerを動かさずNative pulseを配送、遅配。
- 期待結果：共通評価/配送で3数字、遅配は最新のみ。元DB不変。
- 対応コード：[src/services/goal-cue-probe.ts](../src/services/goal-cue-probe.ts) `runCueProbe`。
- テスト名：
  - `foreground pulse %s uses shared durable evaluator without JS timers or user data changes`（[src/utils/__tests__/goal-cue-probe.test.ts](../src/utils/__tests__/goal-cue-probe.test.ts)）。
  - `late native pulse skips crossed numbers rather than replaying the backlog`（[src/utils/__tests__/goal-cue-probe.test.ts](../src/utils/__tests__/goal-cue-probe.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：室内実機で確認済み（E-V28、画面OFFの合成9本文、pulse66件、正常終了後サービス残留なし）。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：実GPS、実RUN終了、全条件の聴取保証ではない。時間再試聴はユーザー聴取確認、距離は聴取回答未記録。

### PROBE-02

- 対象SHA：V28。
- 初期条件：preview leaseのFinishClockService。
- 入力イベント：30秒経過、previewから実RUN開始intentへ変更。
- 期待結果：previewは停止、実RUNは30秒で停止せずlockを昇格。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/FinishClockService.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/FinishClockService.kt) `onStartCommand`。
- テスト名：
  - `diagnosticClockIsBoundedButRealClockKeepsExistingLifetime`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/FinishClockLeaseTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/FinishClockLeaseTest.kt)）。
  - `realRunUpgradesPreviewWakeLockWithoutThirtySecondCutoff`（[modules/run-announcer/android/src/test/java/app/runjourney/announcer/FinishClockLeaseTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/FinishClockLeaseTest.kt)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：JS subscriber/DB閉鎖/実RUN音声を含む結合・実機切替はGAP-05。

### REC-01

- 対象SHA：V28。
- 初期条件：保存済み履歴と訂正preview。
- 入力イベント：preview、適用、undo、手動BREAKを含む再計算。
- 期待結果：原GPS・元イベント・日時を保持、明示操作のみ記録。
- 対応コード：[src/utils/run-recovery.ts](../src/utils/run-recovery.ts) `applyRecovery`。
- テスト名：
  - `apply/undo preserve raw GPS, original events, dates, stored distance and legacy fields`（[src/utils/__tests__/run-recovery.test.ts](../src/utils/__tests__/run-recovery.test.ts)）。
  - `manual Break survives replay and is not auto resumed by moving GPS`（[src/utils/__tests__/run-recovery.test.ts](../src/utils/__tests__/run-recovery.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### HIST-01

- 対象SHA：V28。
- 初期条件：100件境界をまたぐグループ、一部メンバーのみ取得。
- 入力イベント：追加ページとグループ解除。
- 期待結果：グループ1行、元RUN件数のoffset、解除後は取得済み元RUNを時刻順表示。
- 対応コード：[src/domain/history-list.ts](../src/domain/history-list.ts) `historyRows`。
- テスト名：
  - `partial and complete page show one group with stable original start`（[src/utils/__tests__/history-list.test.ts](../src/utils/__tests__/history-list.test.ts)）。
  - `unloaded group stays absent; ungroup restores loaded members in order without mutation`（[src/utils/__tests__/history-list.test.ts](../src/utils/__tests__/history-list.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：v26実機の作成/解除記録は参考。v28端末の100件境界そのものは未確認。

### HIST-02

- 対象SHA：V28。
- 初期条件：隣接RUNの空白1秒、GPS445m/31秒。
- 入力イベント：補間preview、精度不良、ゼロ/逆時間差。
- 期待結果：元GPS速度で拒否、推定はnull、記録距離/時間に加算しない。
- 対応コード：[src/domain/history-groups.ts](../src/domain/history-groups.ts) `summarizeGroup`。
- テスト名：
  - `reject 445m over 31s before scaling to the one-second unrecorded gap`（[src/utils/__tests__/history-groups.test.ts](../src/utils/__tests__/history-groups.test.ts)）。
  - `invalid observation %s remains unknown`（[src/utils/__tests__/history-groups.test.ts](../src/utils/__tests__/history-groups.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：屋外実走・実端末の同条件は未確認。

### DATA-01

- 対象SHA：V28。
- 初期条件：元RUN/Raw/イベント/ごみ箱/draft/設定/消費済み閾値。
- 入力イベント：Backup encode/decode/別SQLite復元。
- 期待結果：原本維持・閾値二重再通知なし、transaction失敗は部分適用しない。
- 対応コード：[src/repositories/sqlite-backup.ts](../src/repositories/sqlite-backup.ts) `validateSnapshot`。
- テスト名：
  - `canonical round trip keeps active/trash/raw metadata/events/overrides/diagnostics/extensions and legacy fields`（[src/utils/__tests__/run-backup.test.ts](../src/utils/__tests__/run-backup.test.ts)）。
  - `goal cue config and consumed thresholds survive backup/restore without changing RUNs`（[scripts/sqlite-native.test.cjs](../scripts/sqlite-native.test.cjs)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：室内実機で確認済み（E-V28の更新前後snapshot一致という既存報告）。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：私有Backupは今回再取得/再照合していない。成功報告の範囲は54履歴/ごみ箱18/GPS22512/設定11等。

### PACE-01

- 対象SHA：V28。
- 初期条件：ペース走の可変計画区間。
- 入力イベント：1km境界、今回遅いが累積早い、終了目標変更。
- 期待結果：区間/累積は別計算、終了目標編集でペースを遡及変更しない。
- 対応コード：[src/domain/voice-guidance.ts](../src/domain/voice-guidance.ts) `kilometerLaps`。
- テスト名：
  - `variable target integrates distance and duration segments at exact boundaries`（[src/utils/__tests__/voice-guidance.test.ts](../src/utils/__tests__/voice-guidance.test.ts)）。
  - `lap slow while total fast and rounded zero have distinct spoken meanings`（[src/utils/__tests__/voice-guidance.test.ts](../src/utils/__tests__/voice-guidance.test.ts)）。
  - `finish goal edits do not rewrite the pace target; general RUN has no target comparison`（[src/utils/__tests__/voice-guidance.test.ts](../src/utils/__tests__/voice-guidance.test.ts)）。
- 実行結果：R-AUTO、自動テストで確認済み（上記assert範囲）。
- 実機証跡：未確認。
- 屋外実走：未確認（このケース全体を満たすv28証跡なし）。
- 未検証事項：v26室内音声記録は参考。複数区間controller/編集UIはNA-02。

## 不足ケース（テスト実装は今回対象外）

### GAP-01

- 対象SHA：V28。
- 優先度：必須 / 高。
- 初期条件：TURNAROUNDの開始8秒・開始後15秒、距離側はsourceAt+5秒でも制限。
- 入力イベント：本文開始の直前/一致/直後、開始後に旧TTLを跨ぐ、合成/prepare後着、15秒watchdogと目標deadlineの競合。
- 期待結果：期限内に始めた本文は旧TTLでは切らず、15秒上限/終了/状態変更を優先。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt) `cueBodyStarted/armCueDeadline`。
- テスト名：追加専用テストは未実装。既存の部分的根拠は関連するVOICE/CUE/PROBEケースを参照。
- 実行結果：未確認（追加試験は未実装・今回実行なし）。
- 実機証跡：未確認。
- 屋外実走：未確認。
- 未検証事項：記載の全境界を通す追加試験、必要な端末受入。
- 対応Issueの必要性：既存[#68](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/68)へ追記提案。複数回の独立作業ならhalf専用回帰の新Issueを切り#68へ関連付ける。

### GAP-02

- 対象SHA：V28。
- 優先度：必須 / 高。
- 初期条件：距離案内のGPS鮮度5秒上限。
- 入力イベント：sourceAtから4999/5000/5001ms、予約時と配送時それぞれ、3秒/8秒とのmin境界。
- 期待結果：モデルの>5000ms拒否と配送のexpiresAt<=now拒否を別々に照合。古いfixを延命しない。
- 対応コード：[src/services/goal-cues.ts](../src/services/goal-cues.ts) `evaluateCueSource/cueSample`。
- テスト名：追加専用テストは未実装。既存の部分的根拠は関連するVOICE/CUE/PROBEケースを参照。
- 実行結果：未確認（追加試験は未実装・今回実行なし）。
- 実機証跡：未確認。
- 屋外実走：未確認。
- 未検証事項：記載の全境界を通す追加試験、必要な端末受入。
- 対応Issueの必要性：#68/#69（[68](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/68)・[69](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/69)）へ鮮度境界ケースを追記する提案。新Issue必須ではない。

### GAP-03

- 対象SHA：V28。
- 優先度：推奨 / 中。
- 初期条件：同一RUNの異なる目標revisionが63/64/65種類。
- 入力イベント：64種目登録、65種目、既存revisionへの復帰、Backup復元。
- 期待結果：64までは保持、65種目の新登録はGOAL_LEDGER_CAPACITY、既存消費済み閾値は再読なし。
- 対応コード：[src/domain/goal-cues.ts](../src/domain/goal-cues.ts) `advanceCues/validCueState`。
- テスト名：追加専用テストは未実装。既存の部分的根拠は関連するVOICE/CUE/PROBEケースを参照。
- 実行結果：未確認（追加試験は未実装・今回実行なし）。
- 実機証跡：未確認。
- 屋外実走：未確認。
- 未検証事項：記載の全境界を通す追加試験、必要な端末受入。
- 対応Issueの必要性：#68/#69横断の保存境界として新Issueを推奨。今回は作成しない。

### GAP-04

- 対象SHA：V28。
- 優先度：必須 / 高。
- 初期条件：half/countdown/#62/状態100/終了110/情報3種。
- 入力イベント：キュー待ち・共通音・専用音・180ms間隔・合成中・本文開始前・再生中で全競合を整理。
- 期待結果：priorityと状態/epoch/version/labelを守り、二重本文・古い数字・終了後再生なし。情報3種だけdefer。
- 対応コード：[modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt) `receiveBatch/playChime/interrupt`。
- テスト名：追加専用テストは未実装。既存の部分的根拠は関連するVOICE/CUE/PROBEケースを参照。
- 実行結果：未確認（追加試験は未実装・今回実行なし）。
- 実機証跡：未確認。
- 屋外実走：未確認。
- 未検証事項：記載の全境界を通す追加試験、必要な端末受入。
- 対応Issueの必要性：#65/#68/#69へ関連付ける競合回帰の新Issueを推奨。既存試験の部分成功と未網羅stageを分ける。

### GAP-05

- 対象SHA：V28。
- 優先度：必須 / 高。
- 初期条件：Native pulse probe実行中、途中で実RUNを開始。
- 入力イベント：実RUNの距離/時間目標各々、subscriber切替、旧I/O後着、memory DB閉鎖、30秒lease満了後。
- 期待結果：probe配送のみ停止し、実RUNのclock/音声/GPSを止めない。実RUNlock昇格、元DBに合成RUNを作らない。
- 対応コード：[src/services/goal-cue-probe.ts](../src/services/goal-cue-probe.ts) `runCueProbe / FinishClock.start`。
- テスト名：追加専用テストは未実装。既存の部分的根拠は関連するVOICE/CUE/PROBEケースを参照。
- 実行結果：未確認（追加試験は未実装・今回実行なし）。
- 実機証跡：未確認。
- 屋外実走：未確認。
- 未検証事項：記載の全境界を通す追加試験、必要な端末受入。
- 対応Issueの必要性：#69へ関連付ける画面OFF引継ぎ結合・実機受入の新Issueを推奨。Native lock単体はPROBE-02で既に確認済み。

## 未実装・対象外

### NA-01

- 対象SHA：V28。
- 初期条件：距離と時間の複合目標を想定。
- 入力イベント：同時到達/優先順位。
- 期待結果：現行FinishGoalは排他的unionで、複合判定を実装していない。合格/失敗を捏造しない。
- 対応コード：[finish-goal](../src/domain/finish-goal.ts) `FinishGoal`。
- テスト名：対象外。
- 実行結果：未実装・対象外。
- 実機証跡：対象外。
- 屋外実走：対象外。
- 未検証事項：将来仕様を承認した場合に新ケースとIssueを作る。

### NA-02

- 対象SHA：V28。
- 初期条件：複数区間ペース走の作成/編集/進行UIを想定。
- 入力イベント：UIで区間を追加・変更。
- 期待結果：複数計画区間のラップ目標積分はPACE-01で確認。複数区間controller/編集UIは提供しない。
- 対応コード：[pace-workout](../src/domain/pace-workout.ts) `validPaceState/validPaceLapState`。
- テスト名：UI/controller拡張は対象外。
- 実行結果：未実装・対象外。
- 実機証跡：対象外。
- 屋外実走：対象外。
- 未検証事項：追加する場合は別仕様として承認を得る。

## 網羅性の扱い

全設定の直積を全件確認済みとはしない。manual/distance/time、自動終了ON/OFF、正式3状態、cue2設定4組合せ、5分/ペース/現在時刻の独立性を軸として、基本組合せと高リスク境界を分ける。終了後・旧epoch後着・TTL/数字境界は重点試験、その他は組合せ試験を検討する。

OSによるprocess kill、端末時刻変更、Bluetooth route切替、長時間画面OFF、実GPSのAuto Stop/手動休憩、ユーザー聴取は一括合格にしない。機種/OS/画面/入力/phaseごとの端末ケースと証跡を追加する。既存実走報告の流用ではなく、v28の該当RUNで受入する。
