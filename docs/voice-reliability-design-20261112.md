# 音声通知信頼性：設計レビュー用、2026-11-12

**未実装・未承認の設計**。ユーザーの完全版指示を正本とする。以前の「PACEは再生時に最新化」「時計は10秒で失効」「PACE配送30秒」の案を撤回する。アプリ/公開HTML/既存PRのコードは変更しない。

成果物：[現行全通知マトリクス＋公開表更新案](voice-reliability-matrix-20261112.md)、本設計、[11/14マーカー・実走計画](autostop-field-20261114-plan.md)。基準はTest v32 `3dc5d83`。前回の[解析](field-20261112-analysis.md)は観測結果として保持し、古い未承認案で今回の指示を上書きしない。

## 1. 現状と実発生経路の切り分け

前回保持ログの203 PACE評価は同じコード/保存GPSで203件一致。確認待ち100件等による生成前抑制、時計のSPEAKING skip 1件、PACE期限切れ1件、距離ラップretry消費1件を確認。正式停止2件はRUNがAUTO_STOPの間に中断しており、身体再開による正当取消ではない。

停止通知について追加で送信元を静的に追跡した：

|送信元|現在の文脈取得とawait|逆行可能な位置|
|---|---|---|
|`queueGuidance/updateGuidance`|呼出時のimmutable runを保持→設定/時計/観測/発話項目のawait→send|coalesceは同送信元だけ。最後の送信直前にrun状態を読み直さず、GoalCues等と順序保証なし|
|`GoalCues.evaluateCueSource`|run取得→DB atomic→latest再取得→freshSettings await→send|latest取得後のawait中に停止確定できる。goal/cueのversion fenceはあるがRUN状態fenceはない|
|`goalChanged` / `started` / `beforeGoal`|`noticeContext(run)`で観測取得をawait、引数runはそのまま|旧runのstate/eventIndexを後から送る余地|
|停止/終了制御|`stopRunning`がended/muted空batch、その後保存成功でfinish通知|endedは終端として扱う必要がある。通常の状態versionと独立した終端fenceが必要|

Nativeは全送信元についてbatchState/latestEventIndexを無条件で上書きする。これが現在通知のvalidInStateをfalseにし、INTERRUPTED_STATE_CHANGED→DISCARDEDへ至る。前回の人工Native試験2件はこの経路を再現。実走ログにbatch受信時のproducer/state/eventIndexがないため「2件の犯人はGoalCues」といった断定はできない。追加計測が必要である。

## 2. PACE：固定周期と区間スナップショット

### 2.1 周期と時間軸の提案

指示の0～1分/1～2分を文字どおり守り、**RUN開始からの経過時間（壁時計に対応する単調経過時間）をslot軸とする案を推奨**する。実走時間軸へ勝手に読み替えない。I=`voiceIntervalSec`×1000、予定境界T(k)=RUN開始+kI。設定キー/保存値/60～600秒の現行検証は維持し、UIのみ「通知間隔（秒）」へ変更する。

実際の再生/生成/再試行時刻はT(k+1)へ影響させない。FAST/SLOW/ON_TARGET/分類確認待ちUNKNOWNから独立して、予定slotを必ず台帳へ作る。正常GPSで停止なし・競合なし・RUNが継続する1時間なら60秒設定で60区間。終了ちょうど60分の同時発生は終端契約で別検証する。

各区間の運動量は既存`timeModel/effectiveEdges`を使い、停止/休憩時間を除外した実走秒で貯金を計算する。時刻軸と実走時計は別々に記録する。例：経過1～2分内で20秒停止なら区間長60秒、実走40秒。通知本文の「この1分」は対象の経過区間長を指す。停止を除いた周期が望まれる場合は代替として設計変更できるが、今回の固定区間例とは異なるため承認点とする。

実行中はRUN開始のepochとNative elapsedRealtimeの対応を持ち、deep sleepでも基準をずらさない。壁時計の大幅修正/端末再起動はclockEpochを分け、区間データの整合が不明ならCLOCK_DISCONTINUITYとして数値を保留する。既存RUNの開始/終了時刻や時間モデルを書き換えない。時計の本文は常に実際の現在時刻を使う。[Android時計資料](https://developer.android.com/reference/android/os/SystemClock)

### 2.2 数値の定義と境界補間

区間i=[T(i−1),T(i)]について、確定した同一RUNのイベント/有効GPSを読むだけで次を計算する：

```
A(t) = timeModel(run, t).activeRunningTime / 1000
D(t) = effectiveEdgesを既存の実走時計上でtまで積分した累計m
B(t) = 目標秒/km × D(t)/1000 − A(t)
増減(i) = B(T(i)) − B(T(i−1))
```

将来点をRUNへ追加したり、保存距離/判定を修正しない。境界をまたぐ既存有効edgeの距離だけを時間比で配分し、距離ラップの補間規則と一致させる。数値の丸めはv32に合わせ、発話増減は`round(Bend)−round(Bstart)`、距離はkm小数2桁、累計は分秒。正の累計でも差が負なら「貯金が減りました」。負の累計では「遅れ」、跨いで正負が変わる例も固定テストにする。

**補間には境界の両側の入力が必要**。片側しかないときは未来の移動を外挿しない。品質ガード案：境界の両側が有効、raw timestamp差10秒以下、停止境界をまたぐ架空edgeなし、区間内10秒超の未説明GPS欠測なし。これらは音声数値の信頼性ガードであり、通常RUNの距離採用やGPS取得頻度を変更するものではない。

累計にも欠測フラグを伝播し、不完全な累計を厳密な貯金として読むことを避ける。品質不十分なら対象区間をDATA_INSUFFICIENTとして保持し、「この1分は区間データが不足しています。」を1回読む案とする。確かな項目だけを続けるか、全文をデータ不足案内にするかは承認点。UNKNOWN分類自体はデータ不足の根拠にしない。GPS欠測を止まっていた時間として補完しない。

初回はD(0)=0/B(0)=0と実際の境界までの観測が十分なら0～I区間を報告できる。開始付近の観測不足、設定の途中ON、目標ペース変更を跨ぐ場合は増減を捏造せず、不完全区間を明示する。前回の「本文開始済みPACE baseline」は定期区間計算に使わない。

### 2.3 Auto Stopの遡及確定とsnapshot確定

現行event.timestampは推定開始、confirmedAtは確定時刻であり、後から過去の実走時間が減る。`announcementClock.confirmedActiveMs`をそのまま壁時計slotの完成判定にしてはいけない。予定slotはまずSCHEDULED→WAITING_DATAとして作り、数値確定と分離する。

音声側だけの確定watermarkを設ける案：現行v4が参照する最大15秒窓より前で、入力処理完了・境界の両側GPS・未解決候補がない時点までを確定可能とする。新たな入力のtimestampがT+15秒を超え、候補によるT以前への遡及がないことを確認してsealする。候補が残る/欠測中は待機し、15秒経ったという理由だけで捨てない。現行v4以外/再起動で確定性が証明できないときは再計算かデータ不足とする。

この安全な確定には通常でも最大15秒程度の待ちが生じ得る。周期の**予定時刻は固定**だが本文開始が常に境界ぴったりになる保証ではない。15秒窓と既存stillSince/flushの境界を人工リプレイで検証し、証明できる前に出荷しない。通常判定の窓/閾値を変更する提案ではない。

seal後はsnapshotを不変とする。epoch/slot/start/end/activeStart/activeEnd/distanceStart/distanceEnd/target/savings/quality/sourceWatermarkを座標なしで保存。1分通知が1:30に始まっても0～1分、2分通知は1～2分を読む。1:30の数値を混ぜない。

設計用の人工数値例（目標360秒/km、停止なし、GPS品質十分）：

|対象|距離|累計貯金|期待する増減|
|---|---:|---:|---|
|0:00|0m|0秒|比較元|
|1:00区間終了|180m|4.8秒→発話5秒|0～1分は5秒貯金が増えた|
|1:30実際の再生時|260m|3.6秒|この値を1分通知へ混ぜない|
|2:00区間終了|340m|2.4秒→発話2秒|1～2分は3秒貯金が減った。累計は正の2秒|

別ケースとして1:00=150mなら累計−6秒、2:00=300mなら累計−12秒なので「遅れが6秒増えました」。増減は境界値の丸め差であり、前回実再生時の値との差ではない。

### 2.4 停止・設定変更・復旧

- slotは停止中も予定として記録。全区間が停止ならCANCELLED_NO_RUNNING。部分的に走行したslotはsnapshotを保持し、停止中はWAITING_STATE、正当な再開後に順に読む案。停止/再開の重要通知を先に完了させる。
- 音声OFFは明確な設定取消。再ONは次の完全な固定区間から再開し、OFF中を追読しない。間隔変更は新configEpochとRUN開始起点の新しい倍数境界を使い、過去slotを再生成しない。部分区間はCONFIG_CHANGEDとして残す。
- 目標距離変更は周期を動かさない。目標ペース変更を跨ぐslotはTARGET_CHANGEDで増減省略。通常RUN/目標到達ロジックは既存のまま。
- 同IDの生成/配送を冪等化し、アプリ復旧で重複しない。前回play時刻から次slotを算出しない。
- Native側の小さなschedule tickを唯一の予定元とし、JSはGPS更新でsnapshotを完成させる。既存の音声サービスへRUN存続中のpulseを接続し、manual終了目標・通常音声OFF・時計OFF・PACEだけONでも稼働できる契約を追加する。`FinishClock`の目標自動終了サービスを代用/改変しない。既存GPSは追加取得しない。

## 3. 時計：遅延許容、最新時刻、境界統合

T(k)=RUN開始+k×既存分間隔。5秒遅延判定、speaking/queue/TTS未準備による即skip、時計の配送TTLを削除する設計。10秒上限も置かない。

未開始時計は最大1件。20分slotが25分に読めるなら25分時点の現在時刻を読む。次は30分のまま。20分分が未再生のまま30分が来たらpendingにslot20/30を結合し、**時計1回で両slotを充足**したことをMERGED_INTO/coveredSlotsで記録する。本文開始済みのものへ後から統合しない。

時計は他通知で忙しいだけなら待機する。Auto Stop/休憩中はWAITING_STATEとして再開後へ保留する案。RUN終了/時計OFF/別RUN開始は明確な取消。時計ON時の過去境界の追読はしない。

本文の時刻はチャイム/キュー投入時ではなく、direct TTSへ送る直前に確定し、onStartとの差を記録する。TTS APIでは発話文字列を渡してからonStartが来るため、**厳密なonStart瞬間に文字列を変えることはできない**。分境界を跨いだらonStartでそのattemptを停止し、新しい現在分で再試行する案。既に聞こえたか不明な場合は不確実な開始として記録し、延々と再試行しない。開始遅延が1秒程度以内でも同じ分であることを実機で確認する。実際のonStartと「現在分」が合わない場合は未受入とする。

## 4. キュー・優先度・統合・再試行

### 4.1 一つの音声処理台帳と明示的状態

`SCHEDULED → WAITING_DATA → GENERATED → ACCEPTED → WAITING_STATE/WAITING_ENGINE/QUEUED → CHIME → BODY_START_REQUESTED → BODY_STARTED → COMPLETED`。終端はCOMPLETED、CANCELLED(reason)、MERGED_INTO(id)、FAILED(reason)。中断は即破棄とせずattemptのINTERRUPTEDを記録し、通知本体は待機/再試行/取消のいずれかへ必ず遷移する。

JSのsentNoticesは生成済みの最適化だけにし、配送成功の根拠にしない。Native永続受付ACKが出て初めてACCEPTED。同ID再送は既存状態ACKを返す。単なるseen setで未完了を消費しない。通常RUN保存用DBには新しい列/レコードを書かず、音声専用ストアと単一workerを使用する。

### 4.2 再生順

|順|優先度|対象|同順位|
|---|---:|---|---|
|1|110|保存後のRUN終了|1件/終了epoch|
|2|100|有効な停止確定/再開確定/手動遷移|現在状態epochだけ。新遷移で旧通知取消|
|3|80|まだ有効な停止候補|正式遷移には即座に譲る|
|4|70|距離ラップ|境界順|
|5|60|開始設定/目標予告/到達/折り返し/最新countdown|予定順、意味の検査|
|6|40|5分実績|区間順|
|7|30|時計（統合1件）|単独|
|8|20|PACE|区間順|

情報復旧だけ75へ昇格する現行特例は廃止案。重要状態通知は下位の本文/共通チャイムを中断できる。正式状態通知を候補やPACE/時計で中断しない。候補チャイムの割込みブロックも正式停止/再開には解除する案とし、短いチャイム待ちが正式通知を遅らせないようにする。

通常は区間通知を個別再生。未開始のPACE/5分/距離ラップがそれぞれ8件を超えたときだけ同一種別・連続区間を集約descriptorへ置換する案。元のsnapshotは全件保持しMERGED_INTOを記録する。単一境界の報告を偽らず「未報告の3区間をまとめて…」と対象範囲を明示し、始終snapshotから集約する。型/目標epoch/品質を跨いで混ぜない。**この例外文言と8件閾値は承認点**。直ちに最新1件へ捨てる方式ではない。

in-memory再生候補は最大32、残りは専用台帳のiterator/range descriptorで扱う。溢れた低優先通知を無言で追い出さない。極端な長期混雑/容量不足はログと状態表示でFAILED_RESOURCE_LIMITを明示し、通常RUNを継続する。時間の古さだけで失効させない一方、無限の個別発話も約束しない。

### 4.3 割込み・TTS・focus

- 通常本文は既存の文区切り単位に分け、完了した文は繰り返さず未完了文だけを復旧する。PACEは同じ区間snapshotのまま。途中の一文の部分重複はあり得るため音声のexactly-onceは主張しない。本文開始前の割込みで再試行予算を消費しない。
- focus取得拒否/一時lossはWAITING_FOCUS。backoffとfocus復帰で再試行しbusy loopにしない。loss/gain/duck/routeを記録。正当な状態更新は待機中にも評価する。[Android音声focus資料](https://developer.android.com/media/optimize/audio-focus)
- 合成失敗時は既存direct fallbackを維持。TTS初期化失敗はqueue全消去せず再初期化。回復試行案は0.5/1/2/5秒の最大4回、その後はFAILED_ENGINEを理由付き終端にして他通知/通常RUNを巻き込まない。focus待ちの単なる時間経過とは分離する。
- 配送TTLは原則廃止するが、再生のハングwatchdogは維持。watchdogはTIMEOUTとしてattemptを終了し再試行可否を判定し、配送期限を超えたから本文を切る制御にしない。countdownの目標到達/最新labelとRUN終端は意味上の取消として維持する。
- id+attempt+playbackTokenで古いcallbackを拒否。プロセス死でBODY_STARTED後/DONE前なら状態はUNKNOWN_COMPLETION。無条件の全本文再送をせず、不確実性を表示する。永続化と実音声出力は不可分トランザクションではないため、完全な無欠落・無重複の同時保証は不可能。

### 4.4 RUN終了

既存prepareFinish/freeze/保存成功の順序を変更しない。音声側へ先に終端fenceを送り、未開始・待機中・開始中の旧通知をRUN_ENDEDで取消。ちょうど境界のPACEもslot記録は作るが、終了と競合したらCANCELLED_RUN_ENDEDで明示する。保存成功後の終了サマリーだけは許可。保存失敗で成功したと読まない。次RUNに前RUNの終了/未報告区間を持ち越さない。

## 5. 停止・再開の文脈逆行を防ぐ

音声用`VoiceContextPublisher`を一つにし、観測callbackの確定RUN状態を同期的に登録する。全送信元は自分の古いrunからstateを再構成せず、このpublisherから最新文脈を得る。revisionをawait後の送信順に採番してはならない（古い状態に新番号が付くため）。

文脈にはrun/sessionEpoch、stateEpoch（event index＋イベント内容fingerprint）、observationSeq/sourceAt、candidateEpoch、goalEpoch、terminalを持たせる。Nativeは各軸を検証し古い状態更新をREJECTED_STALE_CONTEXTへ。新しい目標設定だけのbatchが状態を逆行させない。省略フィールドは「変更なし」で、RUNNING/-1等の暗黙値へ初期化しない。終了fenceは通常batchから解除不可。

過去のラップpayloadは有効な独立実績として受付可能にし、古い文脈拒否と過去実績の保存を混同しない。状態通知は一致する最新stateEpochに結び付ける。再開済みなら旧停止をSUPERSEDED_STATEで取消し、再開通知を優先する。中断にはbefore/after epoch、通知/競合type、producer、attempt、チャイム/本文段階を記録する。GPS座標は記録しない。

## 6. 長時間ログ・専用台帳

### 6.1 記録とプライバシー

通知ごとにランダムなローカルRUN alias、slot/range、種別、config/state epoch、予定/生成/受付/キュー/本文要求/開始/完了時刻、attempt、取消/統合/失敗理由と参照IDを保存。壁時計＋単調時刻＋boot/clock epochを持つ。数値snapshotは一度だけ保存し、各statusへ全文/巨大GPS診断をコピーしない。

生GPS、経路、位置由来の住所、暗号鍵、音声PCM、Bluetooth MACは含めない。速度/距離は必要な集計値だけ。任意object spreadを禁止したallowlist schemaと、座標キー/巨大payload拒否テストを使う。公開用exportはaliasとRUN相対時刻、個人データを含まない集計を標準にする。

### 6.2 容量・保存・障害

音声v3専用の暗号化ストア（Keystore、診断とは別key alias/ディレクトリ/worker）を提案。現在のv2は自由形式の詳細payloadを持つため、v2の削除・再書込み・自動移行はしない。11/12データをそのまま保護する。旧`VoiceLogJournal.read()`もpruneを呼ぶので、新版の保全読取りはそのメソッドを使わず読み取り専用の経路にする。v2が残る期間は旧容量に新プールが加算されることを明示し、空き容量を事前確認する。

新プール上限案20,000,000 bytes：進行RUNのcompact台帳12MB、直近完了集計4MB、詳細観測ring4MB。6時間・2,048通知・32,768 lifecycle・各event256bytes以内・snapshot512bytes以内を受入負荷とする（計算上約9.5MB＋暗号/索引余白）。STOP_PIPELINE/NOISEの高頻度観測は1分集計へ分離し、開始/予定/音声終端を押し出さない。通知数/bytesとも上限を持つ。

active台帳を循環削除しない。閾値接近は詳細記録停止→集計化。上限では予約済みmanifest枠にLOG_INCOMPLETE、連番欠落範囲、拒否件数を残す。IO自体が使えない場合は永続化できないため、RAM/診断画面に縮退を表示し、再起動後に詳細を回収できると約束しない。容量不足でも通知/通常RUNの保存を壊さない。ただし音声台帳が永続化できない場合は音声保証を縮退と明示し、再起動後の重複防止を保証しない。

Native単一workerで暗号化/append、main/JSには小さなenqueueのみ。RUN checkpointを待たず、重要イベント受付bufferは256件/64KiBを初期上限案とする。通知の初回受付/進捗とlogを同じ音声ストアで扱い二重書込みを抑える。focus/完了等の重要記録と高頻度statsは別queueにする。process kill後の末尾破断は検出し、不明を成功扱いしない。完全性連番は持つがPR #73の既存journal形式/鍵/95分制限を変更しない。

完了RUNの自動削除/期限処理は今回は追加しない。空き容量が足りなければユーザーへ停止理由を表示し、新収集を拒否する。古いRUN履歴や11/12診断を容量確保のため削除しない。

## 7. 実装候補・PR分離

|ファイル/領域|承認後の変更|
|---|---|
|新`src/domain/pace-report.ts`|slot、品質、固定区間計算。既存分類/目標達成と分離|
|`src/domain/pace-workout.ts`|定期音声だけ新reportへ委譲。分類、目標到達の計算維持|
|`src/services/voice-announcement.ts`、新voice-context/report service|一元文脈、配送ACK、slot状態、意味別通知契約|
|`src/services/goal-cues.ts`|文脈publisher利用、期限による取消を意味検査へ。古い数字skipは維持|
|`src/tasks/location-task.ts`、`src/services/run-service.ts`|既存確定snapshotを音声へ渡す/音声driver起動終了の非待機hookのみ。GPS options・保存順序・Auto Stop変更なし|
|`src/components/pace-workout-settings.tsx`|最小間隔→通知間隔の表示。key/値の互換|
|Native `RunAnnouncerService/VoicePolicy/CurrentTimePolicy/RunAnnouncerModule`|意味別queue/状態fence/pulse/ACK/focus/時計分境界|
|新Native voice ledger、JS型・diagnostics UI|長時間ログ、欠落/待機の表示、互換export|
|`docs/voice-spec-interactive.html`|承認後の新案追加、旧版/ユーザー編集保存|
|新Test専用marker module/service/UI|OpenComm2受信。音声PR/診断PRとは分離|

音声は新Draft PR、マーカーは別Test限定Draft PRとする案。PR #73（診断）/#75（v31本文）は現状Draftを維持し、そのブランチを更新しない。Issue #72はOpen維持。v32からの統合Testのみ別ブランチで管理し、未マージ依存SHAを記録する。

## 8. テスト計画・合格条件

|段階|具体例と合格条件|
|---|---|
|純粋単体|60/120/180秒で60/30/20 slot毎時。全分類/分類UNKNOWNでも予定同数。正/負/ゼロ増減、正累計の減少、初回、目標変更。1:30再生でも0～1分、2分は1～2分の期待値を人工座標/時間で照合|
|境界/品質|遅延・逆順・重複・10秒超欠測・不良精度・停止境界・遡及確定・clock jump。未確定値をsealしない。架空の外挿/欠測0距離補完なし。snapshotと既存時間モデル一致|
|Native queue|20分時計が25分開始なら現在25分の時刻、次30分固定。20/30分pending統合1回。旧文脈2再現ケースが修正後は拒否。正式停止を下位で中断しない。満杯時に無言dropなし|
|障害|focus loss/deny、TTS初期化/合成/再生失敗、古いcallback、サービス死、再起動、不確実開始。全生成IDが完了/明示取消/統合/失敗/未完了へ収束。単なるTTL終端なし|
|長時間|人工6時間上記負荷・150分競合・95分GPSシミュレーター#49。頭から末尾まで予定/音声追跡、byte上限内、queue上限内。未完了/mergedの件数収支が一致|
|性能/非干渉|同一入力でRUN/GPS/events/時間/SQLite結果一致。新処理enqueue p95目安1ms以下・max5ms以下、実機で旧版比判定p95増分5ms以下を暫定ゲート。安定した比較を3回、失敗時縮退も測定。基準は実機で再評価|
|実機|OpenComm2、画面OFF、通常音声/時計OFF+PACE ON、停止/再開、1:30遅延、5分競合、focus割込み、終了境界。ログだけで聴取成功にせず本人確認を分ける|
|保全|更新前後のRUN/GPS/ごみ箱/設定/グループ/保護情報、11/12診断全file hash一致。通常RUN経路を使用し旧期限削除APIを呼ばない。無断削除/復元なし|

## 9. 11/14までの優先順位・作業量の目安

見積りはレビュー後の集中開発時間で、実機待ち/クラウドビルド待ちは別。未承認の現時点で配布日を保証しない。

|順|作業|目安|11/14の扱い|
|---|---|---|---|
|1|OpenComm2の実ボタン/画面OFF受信の技術検証、marker時刻契約|2～4時間|最優先の実現可否ゲート。届かなければ厳密な正解ラベル取得は不可と早期報告|
|2|compact全区間ログ、状態逆行fenceと停止/再開取消理由|4～8時間|マーカーと音声欠落を照合するため優先|
|3|PACE固定slot/確定snapshot、時計pending統合|6～10時間|承認条件と単体/Native試験が揃った範囲のみ|
|4|全種別retry/区間統合/永続復旧・HTML版追加|4～8時間|全体回帰まで必要。急いで省略せず、未搭載なら明記|
|5|統合Test build、保全、実機screenOFF、独立レビュー用資料|3～5時間＋build待ち|11/13中の候補確定を目標。通らなければv32継続/評価縮小|

先に11/14マーカーと欠落しない記録を成立させ、音声全部の変更を無理に同時出荷しない。音声新版が未受入なら旧音声の観察とAuto Stop評価を分ける。7km後の停止は自動終了と競合し得るため[実走計画](autostop-field-20261114-plan.md)の手動終了案をレビューする。

レビュー事項：壁時計slotと停止時保留、データ不足文、8区間超の明示統合、時計onStart分境界の再試行、OpenComm2自己申告マーカーと誤差の扱い。本設計提出後にレビューを受け、実装へ進む。

今回の検証：現行ソースの全発話入口・Native状態/期限/失敗経路を読取り調査。既存の停止文脈逆行Robolectric再現2件を根拠に使用（新仕様のテストではない）。`npm run typecheck` / `npm run lint`成功。アプリ/設定/公開HTML/端末データは変更していない。新仕様・OpenComm2の実機動作は未検証。
