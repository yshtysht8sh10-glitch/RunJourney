# Auto Stop：現行フローと設計レビュー資料（#43）

対象：Test v28 / PR #70 HEAD `f1476f7947779b0fa4aeb28a054efd44255ef0c8`、照合日2026-11-10。図B/CとAuto Stop条件の正本。Test v26 `ae701b3`から検出モデル・Location Task・自動終了判定は不変。PR #67/#70は未マージであり、Production導入済みAPKの仕様を示さない。

全体と版の識別は[フロー索引](run-flow-index.md)、図Eと通知数値は[音声正本](voice-matrix-20261031.md)、確認範囲は[検証マトリクス](verification-matrix-v28.md)。旧正本全文は[archive](archive/auto-stop-flow-before-v28.md)。旧実走の72f82b4/332edffの記録と改善候補は下記に保持し、最新版の受入結果と混ぜない。

## 1. 図C：GPS入力から確定・実効値まで

根拠：[ingestLocationBatch](../src/tasks/location-task.ts)、[RunRepository.appendActiveObservations/appendActivePoints](../src/repositories/run-repository.ts)、[GpsObservationSession.ingest](../src/utils/gps-observation.ts)、[detectStop](../src/utils/run-model.ts)、[inferMovement](../src/utils/movement-inference.ts)。

```mermaid
flowchart TD
  A[Expo Locationバッチ / JS受信時刻] --> T{Standalone Test}
  T -->|はい| B[時刻順・重複除外 / 10秒RAM観測・原則5秒保存]
  T -->|いいえ| P[保存GPS入力]
  B --> Q[Repository直列キュー]
  P --> Q
  Q --> F{終了凍結済み}
  F -->|はい| X[凍結RUNを返す / 更新しない]
  F -->|いいえ| Gate{Auto Stop ONかつBREAK以外}
  Gate -->|いいえ| CP[RAM snapshot / 保存要求をまとめる]
  Gate -->|はい| Quality[時刻・精度・jump・gap判定 / 条件は3節]
  Quality -->|不良・古い入力| Reject[SKIP・HOLD・RESETを区別 / 3節]
  Quality -->|良好| Window[原則10秒 / 疎な入力は最大15秒末尾3点]
  Window --> Suffix[正式状態に応じ最早成立suffixを探索 / 3節]
  Suffix --> Confirm{静止または移動が成立}
  Confirm -->|はい| TR[先頭時刻へ遡及transition / confirmedAtを別保存]
  Confirm -->|いいえ| Meta[候補metadataを開始・維持・取消 / 正式状態は不変]
  Reject --> CP
  TR --> CP
  Meta --> CP
  CP --> EF[保存GPS・イベント・訂正からeffectiveEdges]
  EF --> MET[実効距離・実走時間・ラップ・履歴 / 目標は図D]
```

注：5秒は窓の観測期間であり、「5秒候補を作った後にさらに5秒待つ」実装ではない。RUNNING中のstillSince、AUTO_STOP中のmovementは候補metadataで、正式RunStateの追加状態ではない。サンプル時刻とJS受信・計算時刻は区別される。

### 音声の停止予告は別判定

[stopHint](../src/domain/voice-guidance.ts) と [updateGuidance](../src/services/voice-announcement.ts) は、正式detectStopとは別に直近RAM観測を調べる。正式停止の前提条件ではない。

```mermaid
flowchart TD
  A[VoiceAnnouncement.updateState / updateRun] --> B{既存5分音声またはペース音声ON
RUNNING / Auto Stop ONか}
  B -->|いいえ| C[予告候補なし / 既存予告を取消]
  B -->|はい| D[直近4秒・最大6点の連続低速suffix]
  D --> E{3点以上 / 2秒以上
accuracy 12m以下 / speed 0〜0.35m/s
全点間spread 2m以下
隣接gap 2秒以下 / 最終点age 3秒以下}
  E -->|不成立| C
  E -->|新規成立| F[STOP_CANDIDATE_DETECTED：空文 / 観測のみ]
  F --> G{前回予告から30秒以上か}
  G -->|はい| H[停止を確認しています。
priority80 / TTL4秒 / チャイムあり]
  G -->|いいえ| I[STOP_CANDIDATE_SUPPRESSED：観測のみ]
  C --> J[activeだった候補をCANCELLED
native cancelCandidate=true]
```

## 2. 図B：活動中の状態遷移

```mermaid
stateDiagram-v2
  [*] --> Running
  state "RUNNING（正式）" as Running
  state "AUTO_STOP（正式）" as Stopped
  state "BREAK（手動・正式）" as Break
  Running --> Stopped: stationary suffix成立 / 先頭時刻へ遡及
  Stopped --> Running: moving suffix成立 / 先頭時刻へ遡及
  Running --> Break: ユーザーの休憩操作
  Stopped --> Break: ユーザーの休憩操作
  Break --> Running: ユーザーの再開操作のみ
  note right of Running
    stillSinceは停止候補metadata
    根拠消失やgapでRESET
    候補だけでは正式状態を変えない
  end note
  note right of Stopped
    movementは再開候補metadata
    根拠消失でRESET
  end note
```

BREAK中のsensorイベントでは再開しない。正式transitionは同一状態、無効時刻、最後のイベントより古い時刻、機能OFFの遷移を拒否。確定時刻と有効開始時刻を分け、停止区間を距離・実走時間から除く。Raw GPSは削除しない。

## 3. 閾値・成立・取消（現行）

| 対象 | 条件・継続 | 不成立/取消・注意 |
|---|---|---|
| GPS品質 | 有限時刻/座標、緯度±90/経度±180、accuracy 0〜20m | 不良fixは15秒以内HOLD、超過RESET。GNSS speed欠損や0自体は正式判定の拒否条件ではない |
| 古いfix | 最終イベントのconfirmedAt以上、前良好fixより新しい | 古いfixはSKIP |
| jump | 隣接変位速度12.5m/s以下 | gapでないとき超過fixはHOLDし、前良好位置を置き換えない |
| 窓 | 原則10秒、疎な入力は最大15秒末尾3点、最大256点 | Testのlive RAM自体は10秒。15秒超gapは1点に戻す |
| 共通coverage | 5秒以上、2点以上、全edge有限かつ12.5m/s以下 | 不成立なら確定しない |
| 狭い静止 | spread≤3m AND 始終点変位/期間≤0.35m/s | 先頭edge≤0.5m/sも必要。speedMedianをAND条件にはしていない |
| bounded dwell | 8秒以上、5点以上、spread≤8m、変位速度≤0.35m/s、coherence≤0.35、movingではない | 先頭edgeの低速制約は免除。往復する小範囲の位置ぶれも静止の証拠にする |
| moving | 5秒以上、3点以上、変位速度≥0.7m/s、coherence≥0.7、0.5m/s以上のedgeがceil(edge数×0.7)以上 | 先頭edge≥0.5m/s。GNSS speed/中央値の下限、停止アンカーからの絶対10m移動は要求しない |
| 停止候補metadata | RUNNING窓spread≤3m、または窓のstationary推論 | 根拠消失はDISPLACEMENT_TOO_LARGEでRESET |
| 再開候補metadata | AUTO_STOP窓中、後続edge≥0.5かつsuffix coherence≥0.7となる先頭点 | 候補消失はMOVEMENT_TOO_SMALLでRESET |
| 音声予告 | 2〜4秒suffix、3点以上、accuracy≤12、speed≤0.35、spread≤2、最終age≤3秒、隣接gap≤2秒 | 正式停止より厳しい別条件。30秒cooldown、成立解除でcancel |

coherence = 始終点距離 / 総edge長。spread = 全点対の最大距離。移動速度は座標由来、GNSS speed中央値は診断値。`RUN_CONTROL.resumeDistance=10`・resumeSpeed=1.2・resumeFixes=2等は残存する旧detectStopV3用であり、現行v4の再開AND条件として読まない。旧版再現テストと現行テストは別。

## 4. 音声は図Eへ分離

[音声仕様マトリクスの図E](voice-matrix-20261031.md#図e音声通知ライフサイクル)を正本とする。検出確定、音声予告の成立、実際の発話は別の出来事。音声完了をRUNの保存や正式停止判定の前提にしない。

- Test v26以降は通常通知に共通チャイム300ms＋間隔180ms。共通チャイムは状態/終了/割込みで取消できる。
- 停止候補・自動停止・自動再開の専用チャイムは従来どおり完了待ち（準備/再生失敗・最大2秒timeoutを含む）で、完了後に本文の状態・期限を再検査する。手動BREAK/RESUMEはチャイムなし。
- Test v28のTURNAROUND/GOAL_COUNTDOWNは本文開始期限と開始後watchdogを分離する。数値・priority・再試行・情報復旧の規則は音声正本に集約した。
- [旧音声フロー・詳細説明](archive/auto-stop-flow-before-v28.md)は当時の記録として保存。下記の実走イベント・失敗・遅延値はその時点の証跡でありv28で再測定した値ではない。

## 5. 停止中に再開を誤判定し得る経路（現行からの推論）

1. 停止中でも座標が同じ方向へ滑ると、5秒以上で変位速度≥0.7・coherence≥0.7・移動edge比≥0.7を満たせる。accuracyは各fixの許容値であり、変位が位置誤差を有意に上回ることを検定しない。GNSS speed=0でも再開を拒否しない。
2. 再開を確定すると窓は現在点へ戻る。その後の座標が狭い範囲に静止すれば、再び5秒の静止でAUTO_STOPとなる。停止/再開後の専用cooldownや最小RUNNING継続時間はないため、座標ドリフト→静止を繰り返すと正式状態も往復し得る。
3. 音声予告はaccuracy≤12/spread≤2/speed≤0.35という独立ゲートなので、正式停止（accuracy≤20、dwell spread≤8）に達しても予告自体が成立しない。成立しても30秒cooldown、取消、TTL、上位通知、Audio Focus/TTS障害で聴こえない可能性がある。

これらはコード上の到達可能性。各実走時の身体の動きをログだけで確定するものではない。

## 6. 10月31日12.136km実走との比較

原ログは私有保全先のみ。JST 06:38:59〜08:06:29、保存GPS968点、正式イベント44件（停止22/再開22）。停止はnarrow-stillness15件、bounded-dwell7件。予告候補10件、予告音声7件、cooldown抑制3件、候補取消10件。予告7件は全てCHIME_STARTED/COMPLETEDを記録し、TTSは6件が状態変化で中断・1件DONE。停止チャイム22/再開チャイム22も全件開始/完了を記録。これは物理的に聴こえた証拠ではない。

GPS→JS配送p50/p95/max=66/391/1,831ms、Repositoryキュー0/1/7ms、判定3/5/55ms。保存checkpoint5393/7074/7646msは長いが、今回キュー滞留は支配要因ではない。nativeキュー→チャイム51/82/100ms（51件）。停止TTS528/786/869ms、再開535/769/772ms。物理停止時刻は不明で、GPS低速を代理値とする。

特に06:59:56、07:54:12、07:54:38は、GNSS speed中央値0でも座標条件が成立して再開。例07:54:38は5.001秒/6点、変位5.143m、座標速度1.028m/s、coherence0.962、moving edge比1.0。現行条件どおりの再開だが、ユーザー報告の停止中ドリフト疑いと照合すべき箇所。身体が停止していたと断定しない。

### 実記録の全正式遷移（座標は掲載しない）

| JST | 判定 | 窓秒 | 点数 | GNSS速度中央値 m/s | 座標変位速度 m/s | coherence | 静止証拠 |
|---|---|---:|---:|---:|---:|---:|---|
| 6:42:29 | STOP_CONFIRMED | 8.999 | 10 | 0.24342001974582672 | 0.281 | 0.324 | bounded-dwell |
| 6:42:39 | RESUME_CONFIRMED | 5.003 | 6 | 1.3299375772476196 | 2.732 | 0.999 | none |
| 6:42:54 | STOP_CONFIRMED | 5.001 | 6 | 0.08112013339996338 | 0.081 | 0.815 | narrow-stillness |
| 6:43:24 | RESUME_CONFIRMED | 5.059 | 6 | 1.807193398475647 | 2.551 | 0.982 | none |
| 6:44:47 | STOP_CONFIRMED | 5.000 | 6 | 0.4699999988079071 | 0.301 | 0.495 | narrow-stillness |
| 6:44:52 | RESUME_CONFIRMED | 5.000 | 6 | 0.6600000262260437 | 0.900 | 0.976 | none |
| 6:44:57 | STOP_CONFIRMED | 5.000 | 6 | 0.41999998688697815 | 0.271 | 0.512 | narrow-stillness |
| 6:45:02 | RESUME_CONFIRMED | 5.002 | 6 | 0.7900000214576721 | 0.857 | 0.736 | none |
| 6:45:11 | STOP_CONFIRMED | 8.998 | 10 | 0.3700000047683716 | 0.073 | 0.099 | bounded-dwell |
| 6:45:35 | RESUME_CONFIRMED | 5.000 | 6 | 2.1583917140960693 | 2.918 | 0.714 | none |
| 6:52:41 | STOP_CONFIRMED | 5.000 | 6 | 0.75 | 0.134 | 0.534 | narrow-stillness |
| 6:52:48 | RESUME_CONFIRMED | 7.002 | 8 | 0.699999988079071 | 0.874 | 0.874 | none |
| 6:53:02 | STOP_CONFIRMED | 5.001 | 6 | 0 | 0.296 | 0.521 | narrow-stillness |
| 6:53:09 | RESUME_CONFIRMED | 5.999 | 7 | 0 | 0.963 | 0.762 | none |
| 6:53:17 | STOP_CONFIRMED | 8.000 | 9 | 0.6700000166893005 | 0.220 | 0.201 | bounded-dwell |
| 6:53:22 | RESUME_CONFIRMED | 5.000 | 6 | 2.2300000190734863 | 2.475 | 0.990 | none |
| 6:58:12 | STOP_CONFIRMED | 5.061 | 6 | 0.5075204968452454 | 0.023 | 0.153 | narrow-stillness |
| 6:58:25 | RESUME_CONFIRMED | 7.000 | 8 | 0.4300000071525574 | 0.708 | 0.889 | none |
| 6:59:40 | STOP_CONFIRMED | 6.000 | 7 | 0.24906940758228302 | 0.281 | 0.981 | narrow-stillness |
| 6:59:56 | RESUME_CONFIRMED | 8.002 | 9 | 0 | 0.715 | 0.827 | none |
| 7:00:04 | STOP_CONFIRMED | 5.001 | 6 | 0 | 0.217 | 0.614 | narrow-stillness |
| 7:00:09 | RESUME_CONFIRMED | 5.000 | 6 | 2.200000047683716 | 2.015 | 0.928 | none |
| 7:32:18 | STOP_CONFIRMED | 8.038 | 9 | 1.9154757261276245 | 0.276 | 0.126 | bounded-dwell |
| 7:32:24 | RESUME_CONFIRMED | 6.000 | 7 | 2.184061050415039 | 2.515 | 0.999 | none |
| 7:45:15 | STOP_CONFIRMED | 5.001 | 6 | 0.8220860958099365 | 0.190 | 0.878 | narrow-stillness |
| 7:45:38 | RESUME_CONFIRMED | 5.000 | 6 | 2.1700000762939453 | 2.195 | 0.994 | none |
| 7:46:53 | STOP_CONFIRMED | 8.001 | 9 | 0.5179446339607239 | 0.138 | 0.183 | bounded-dwell |
| 7:47:08 | RESUME_CONFIRMED | 5.061 | 6 | 0.0551459826529026 | 1.657 | 0.962 | none |
| 7:47:15 | STOP_CONFIRMED | 6.000 | 7 | 0.3700000047683716 | 0.299 | 0.587 | narrow-stillness |
| 7:47:35 | RESUME_CONFIRMED | 7.001 | 8 | 0.5199999809265137 | 0.867 | 0.919 | none |
| 7:49:48 | STOP_CONFIRMED | 5.000 | 6 | 0 | 0.167 | 0.506 | narrow-stillness |
| 7:50:04 | RESUME_CONFIRMED | 8.001 | 9 | 1.2100000381469727 | 0.723 | 0.707 | none |
| 7:53:29 | STOP_CONFIRMED | 6.000 | 7 | 0.11566092073917389 | 0.095 | 0.667 | narrow-stillness |
| 7:53:37 | RESUME_CONFIRMED | 6.000 | 7 | 0.4099999964237213 | 0.895 | 0.775 | none |
| 7:53:45 | STOP_CONFIRMED | 8.000 | 9 | 0 | 0.266 | 0.227 | bounded-dwell |
| 7:54:12 | RESUME_CONFIRMED | 5.000 | 6 | 0 | 0.896 | 0.790 | none |
| 7:54:20 | STOP_CONFIRMED | 8.000 | 9 | 0 | 0.197 | 0.231 | bounded-dwell |
| 7:54:38 | RESUME_CONFIRMED | 5.001 | 6 | 0 | 1.028 | 0.962 | none |
| 7:58:31 | STOP_CONFIRMED | 5.000 | 6 | 0.33482739329338074 | 0.221 | 0.794 | narrow-stillness |
| 7:58:41 | RESUME_CONFIRMED | 5.000 | 6 | 1.7780870199203491 | 2.391 | 0.954 | none |
| 7:59:26 | STOP_CONFIRMED | 5.000 | 6 | 0.10181182622909546 | 0.194 | 0.673 | narrow-stillness |
| 7:59:36 | RESUME_CONFIRMED | 5.000 | 6 | 1.7893829345703125 | 3.118 | 0.996 | none |
| 8:00:07 | STOP_CONFIRMED | 5.001 | 6 | 0.3519379198551178 | 0.183 | 0.581 | narrow-stillness |
| 8:00:13 | RESUME_CONFIRMED | 5.999 | 7 | 0.6561736464500427 | 2.055 | 0.981 | none |

## 7. 改善候補（未実装・設計レビュー待ち）

| 候補 | 狙い | トレードオフ / 判断点 |
|---|---|---|
| A. 再開へGNSS speed/複数fixの一致を追加 | 座標だけの一方向ドリフトを抑制 | speed欠損/0に強い現行の利点を失い、低速歩行や再開検出が遅れる。速度の信頼性・取得可能なspeedAccuracyをどう扱うか |
| B. 停止アンカーと位置誤差に対する有意な変位を要求 | 4〜6mの偽移動を抑制 | 都市部でaccuracyが広いと真の再開も遅れる。固定距離か精度連動か、実ログで評価が必要 |
| C. 再開確認窓/最小状態継続/ヒステリシスを追加 | 短周期の往復を抑制 | 真の短停止・再開を潰し、距離/実走時間の遡及にも影響。チャイムだけの抑制とは分離して判断 |
| D. 予告と正式停止の根拠・取消理由をUIで一体表示 | 「予告なしで確定」の理由を理解しやすくする | 判定を揃えると予告増加/誤予告。確定は遅らせず、予告が間に合わない場合は省略する案との比較 |
| E. チャイムとTTSの通知設計を簡素化 | 予告→確定の連続音声を減らす | 状態の分かりやすさと案内量の交換。予告はチャイムのみ/確定はTTSのみ等はユーザー承認後に検討 |

レビュー事項：停止中と判明している実走時刻の指定、許容する再開遅延、歩行の扱い、短停止を記録したい最短時間、予告を必須にするか、予告と確定の音の分担。数値の採用や通知変更は一切行わず、ここで設計レビュー待ちとする。


## 履歴：Test v24（11月5日実走向け）の同期

以下は当時の旧正本とTest v24の差分であり、現在のv28本文と同一という意味ではない。旧版の通知文言・情報構成・優先度・TTL・GPS判定を維持し、チャイムの再生準備CHIME_PREPARING、現在時刻のGENERATED診断を追加。情報音声の騒音補正は連続カーブへ変更、fallback通常TTSには開始時の相対音量だけを指定し、発話中の追従はできない。疲労PoCは履歴での明示ONのみで音声通知は追加しない。変更と検証限界は[field-20261105-readiness.md](field-20261105-readiness.md)を参照。設計候補は引き続き未承認。
