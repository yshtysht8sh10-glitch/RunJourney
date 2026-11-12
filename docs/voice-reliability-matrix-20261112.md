# 音声通知全種別：v32現行と信頼性改修案

2026-11-12設計調査。基準APK `3dc5d83`。現行の事実と未承認案を分離する。●=通常必須、△=設定/データ条件付き、－=発話しない。現行実走集計は[解析報告](field-20261112-analysis.md)、新設計は[設計書](voice-reliability-design-20261112.md)。

## 現行の生成・情報・優先度・配送期限

P=通常5分音声ON、W=有効なペース走＋ペース音声ON、C=時計ON。P/W/Cは独立。Android現行batch経路が対象。期限は通常、本文を開始できる期限であり、本文の長さそのものではない。

|正式イベント|現行の生成条件・ON/OFF|本文の情報・対象範囲・表現|優先度 / expiresAt|状態による主な取消|
|---|---|---|---|---|
|RUN_STARTED|START/復旧START。P/Wの共通許可判定を経ず生成|開始、終了目標(km/分)・自動終了・Auto Stop・時計設定|60 / RUN開始+30秒|別RUN/終了。遅い復旧では期限超過|
|PACE_WARNING|W、RUNNING、約30秒評価、同raw分類2回確認、最小間隔60～600秒。ON_TARGET継続は生成しない|前回本文開始PACEからの増減→累計km(小数2桁まで)→累計貯金/遅れ(分秒)。初回/比較元無効は増減なし。時間はsample.at差、貯金=目標秒/km×累計km−実走秒|20 / notice.at+20秒|単独state規則は常にtrueだが、停止/重要通知でdeferされ最新サマリーへ変換され得る|
|CURRENT_TIME|C、RUN開始基準5/10/15/30分。Native 1秒tick|再生要求時に午前/午後・時・分へ更新。対象は現在の壁時計時刻|30 / 生成+5秒|境界5秒超遅延、非RUNNING、TTS未準備、再生中、キューありで生成後即skip|
|KILOMETER_LAP|W、1km到達、confirmedActiveMs以内|整数km、今回1kmの目標差＋RUN累計目標差。目標値が取れないとき今回ラップ時間。距離境界補間、実走時計、停止/休憩除外|70 / 距離境界の壁時計+30秒|同種最新で旧通知削除。停止時defer/中断後retry1回→最新復旧サマリー化|
|FIVE_MINUTES|P、確定実走5分単位。現在は遅いcallbackで最新完了区間だけ生成|実走経過△、累計距離△、直近5分距離△、同区間ペースmin/km△・速度km/h△・同ペース42.195km換算△。すべて読み上げ項目設定に従う。距離30m未満等ではペース類省略|40 / 実走境界の壁時計+20秒|同種最新で旧通知削除。停止時defer/中断後retry1回→復旧サマリー化|
|STOP_CANDIDATE_ANNOUNCED|PまたはW、Auto Stop ON、RUNNING、良好GPS3fix/2秒以上・小変位/低速等の音声専用stopHint。30秒cooldown|「停止を確認しています。」。判定本体とは別|80 / 生成+4秒|候補取消、正式停止、再開、別RUN/終了。候補チャイムは中断制限あり|
|AUTO_STOP_CONFIRMED|PまたはW、Auto Stop ON、センサー停止イベント|「走行タイマーを一時停止しました。」＋停止チャイム|100 / confirmedAt等+15秒|最新eventIndexと一致しAUTO_STOPであること。古いbatch上書きでも誤って取消され得る|
|AUTO_RESUME_CONFIRMED|PまたはW、センサーRUNNINGイベント|「走行再開を検知しました。走行タイマーを再開します。」＋再開チャイム|100 / confirmedAt等+15秒|最新eventIndex一致かつRUNNING|
|BREAK|PまたはW、休憩機能ON、ユーザーBREAK|「休憩します。」|100 / イベント+15秒|最新eventIndex一致かつBREAK|
|RESUME|PまたはW、ユーザーRUNNING|「走行タイマーを再開します。」|100 / イベント+15秒|最新eventIndex一致かつRUNNING|
|GOAL_WARNING|有効な終了目標、到達前、auto終了ON、残距離/時間が設定閾値以内。P/Wなしでも生成。countdown範囲内は抑制|残りm/秒（切上げ）、目標変更の案内。実効距離/実走時間。目標revisionごと原則1回|60 / 生成+15秒|RUNNING、目標revision一致、countdownによる抑制|
|WORKOUT_GOAL|W、RUNNING、ペース走目標を初めて達成。分類UNKNOWNでも到達通知可|「ペース走の目標に到達しました。記録は継続します。」|60 / notice.at+20秒|現行の終了目標revision検査はなくRUN/終了共通規則が中心|
|TURNAROUND|独立設定ON(初期OFF)、有効な自動終了目標、半分到達、RUNNING。距離50m/時間15秒超の遅い横断はskip。予約台帳あり|目標半分のkm/分＋折り返しの目安|60 / sample+8秒、距離source+5秒/時間目標deadlineの早い方|設定version/目標epoch不一致、停止、到達、RUN終了。8秒は本文開始期限、本文watchdog15秒|
|GOAL_COUNTDOWN|独立設定ON(初期OFF)、距離残り200～10m/時間60～10秒、10刻み。跨いだ旧数字はskip、同目標1数字1回|「残り○メートル/秒」。チャイムは開始時のみ|60 / sample+3秒、距離source+5秒/時間目標deadlineの早い方|最新labelでない、停止、目標変更、到達、終了。開始済み本文watchdog5秒は配送TTLと別|
|RUN_GOAL_FINISHED|保存成功後、PまたはW。手動終了でも同名イベント。achieved補助入口も同ID|終了/到達、保存RUN全体の距離・実走時間、平均km/h(小数2桁)・平均min/km△、完了1kmラップ数/最終時間△、労い|110 / 生成+30秒|終了後に許される唯一の通常通知。別RUN/サービス破棄等|
|LEGACY|旧bridge互換/音声テスト。v32通常RUNはnotifyBatch使用|旧時間ラップ・遷移・テスト文。固定の単一内容ではない|40 / 生成+20秒|終了。旧updateWorkoutは再生中・lap接近・最小20秒等で無通知になり得る|

補足：チャイムは多くが共通、停止候補/停止/再開は専用。BREAK/RESUMEは共通チャイム対象外。騒音連動合成は情報通知等に適用し、失敗時はdirect TTSへfallback。音量上限を変更する提案ではない。

### 音声ではないイベント・状態

`STOP_CANDIDATE_DETECTED`、`STOP_CANDIDATE_CANCELLED`、`STOP_CANDIDATE_SUPPRESSED`は空本文の観測で、NativeはOBSERVATION_ONLY。`CLOCK_CONFIGURATION`は設定記録。`PACE_EVALUATION`、`GOAL_CUE_RESERVED/DECISION`、STOP_PIPELINE等も診断のみ。

`DEFERRED`/`RESUMED`は正式な独立通知種別ではなく、FIVE_MINUTES/KILOMETER_LAP/PACE_WARNINGが最新の`recoveryGuidance`へ置換される状態。公開表の「情報復旧」列はこの説明用であり、実イベントtypeと分離する。

## 現行の共通破棄・取消・失敗経路

|経路|現在の振る舞い|設計上の問題|
|---|---|---|
|JS予約/送信|sentNotices/warningSeen/cue台帳を配送ACK前に消費。bridge失敗後も自動再投入しない|生成しただけで配送済み扱い|
|受付|seenに先に登録→INIT_FAILED/STALE_STATE/EXPIRED/QUEUE_LIMIT。上限16、重要通知は低優先1件を追出せる|後の同IDを拒否し、回復不能になる|
|同種到来|情報通知はDISCARDED_NEWER_INFORMATION、countdownはDISCARDED_NEWER_COUNTDOWN|距離ラップや区間実績も最新化される|
|状態更新|batchState/latestEventIndex無条件上書き→CANCELLED_STATE_OR_CANDIDATE / INTERRUPTED_STATE_CHANGED|古い非同期文脈が現在通知を取消|
|通常再生順|優先度降順。同点は現行list順。deferredは一律75|復旧情報が通常70の距離ラップより先になる|
|割込み|次が80以上かつ現通知より高優先なら割込み。情報通知のみretry1回、それ以外DISCARDED|候補→正式停止で本文再開前にretryを消費。状態通知の失敗回復なし|
|defer|期限を+120秒に変更し、再開時に最新サマリーへ置換。ほかのdeferredも統合|元区間の本文が失われ、過去データ保持と別物|
|チャイム後|状態/期限/高優先でDISCARDED_STATE_AFTER_CHIME。失敗/2秒timeout時は本文へ進む|音は鳴ったが本文が消える場合がある|
|本文開始前|EXPIRED、EXPIRED_OR_INVALID_BEFORE_BODY、CUE_START_EXPIRED_OR_INVALID|合成や待機で配送期限超過|
|TTS/音声focus|INIT_FAILEDはqueue全消去。focus拒否はその通知を落とす。focus変化listenerは空|一時的失敗でも回復なし・原因追跡不足|
|合成/再生|合成失敗/timeout/prepare失敗はdirect fallback。direct ERROR/SPEAK_FAILED、adaptive再生error、30/45秒watchdog等は終端|DONE以外でも共通finishで通知が消え、retryなし|
|終了/別RUN/サービス死|RUN_ENDED、DISCARDED_RUN_CHANGED、SERVICE_DESTROYED。実行queueはRAM、seenだけ永続|未完了の復元台帳なし|

## 提案する通知別の処理契約（未承認）

|分類|対象|保持・統合・取消・復旧|
|---|---|---|
|状態が最新である間に個別完了を目指す|停止確定/再開確定/BREAK/RESUME|優先100維持。現在の正当な状態epochが有効なら時間で捨てず再試行。次の正当な遷移で旧通知をSUPERSEDED_STATEにして取消。古いbatchでは取消しない|
|各実績を個別保持|距離ラップ、通常の5分通知、PACE区間|スナップショットを保存し通常は個別再生。割込みで最新サマリーに置換しない。大量滞留だけ未開始の連続区間を明示的なグループへ統合（後述設計）。RUN終了で旧案内は取消|
|最新1件へ統合|現在時刻|時間だけでは失効しない。次の境界が来たら未開始同種を1件へ統合し、全対象slot IDを記録。本文は再生開始に使う最新時刻。次の周期は不変|
|意味が残る間のみ|停止候補、残量予告、カウントダウン、折り返し、開始設定|状態/数値/設定の意味で検査。古い数字や到達後予告は取消。単なるexpiresAtは削除。折り返しは「地点です」の現行文を遅く読まない範囲を別レビュー|
|独立した事実|ペース目標到達|到達事実を保存し1回。RUN終了時は終了サマリーへ統合可能。設定変更前後の目標epochを区別|
|終端|RUN終了|優先110。保存完了済みデータのみで1回。旧RUNの定期通知を再生しない。新RUN開始時は古い終了案内も取消|
|検証のみ|LEGACY/preview|本番RUNとnamespace/leaseを分離。previewの制限時間は試験終了制御として維持|

## 公開インタラクティブ表の更新案

現時点で`voice-spec-interactive.html`やGitHub Pagesは変更しない。既存「機能×情報項目」の向き、●/△/－クリック、v28/v31確定版、localStorageの`runjourney-voice-spec-versions-v1`を維持する。

新しい`voice-reliability-proposal-20261112`版を追加し、対応Test版は「未実装」、実走評価は「未実施」とする。PACEのFAST/適正復帰/SLOWは表示上1列へ統合するが旧3列の保存インデックスを移動しない。既存列2をPACE表示し列3/4は過去版比較用に残す。

追加する情報階層：

|階層|PACE案|距離ラップ|5分通知|時計|
|---|---|---|---|---|
|区間：予定開始/終了・壁時計/実走時計|●（詳細）|距離境界/実走●|実走5分●|RUN開始壁時計周期●|
|区間：貯金増減|△（データ完全時）|今回1kmの目標差△|－|－|
|区間終了：累計距離km|△（データ完全時）|整数km●|設定△|－|
|区間終了：累計貯金/遅れ・分秒|△|△|－|－|
|区間：ペースmin/km・速度km/h|－|－（現在の本文維持）|それぞれ設定△|－|
|本文開始：現在時刻・時分|－|－|－|●|
|データ不足の説明|△|△|△|－|

旧「前回PACEからの実経過時間/貯金増減」2行はv31/32で残し、新版に「予定区間の時間/増減」を新規IDで追加する。過去版の意味を変えない。詳細展開へ生成設定、snapshot式、優先度、意味による取消、統合/再試行、検証状況を配置する。

JSONはschema1の従来importを受け、新schema2では情報/通知の安定IDを持たせる。旧matrixをそのまま保持し、追加行は－で拡張する。移行は別キーへcopy-on-write、事前JSON export、失敗時は旧データを残す。未知版や同ID異内容は競合表示し上書きしない。変更理由/対応Test/実走結果を版ごと保存する。これらもレビュー後に実装する。

根拠：`src/services/voice-announcement.ts`、`src/domain/pace-workout.ts`、`src/domain/run-notices.ts`、`src/domain/voice-guidance.ts`、`src/services/goal-cues.ts`、`src/domain/goal-cues.ts`、`src/domain/finish-voice.ts`、`src/utils/run-model.ts`、`src/utils/voice-format.ts`、Native `RunAnnouncerService.kt/VoicePolicy.kt/CurrentTimePolicy.kt`。
