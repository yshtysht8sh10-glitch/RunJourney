# PR #70：画面OFFカウントダウン調査・修正

## 対象と変更範囲

基点4d59f24 / Test v27、修正実装faadf6c2e618091ac21b63b2f88c44196bb2d28d / Test v28。PR70へ追加、Draftのまま。RUNのAuto Stop判定、RunServiceの目標達成・自動終了、Location Taskの配信設定、RunRepositoryのGPS処理、VoicePolicyの優先順位は変更なし。Production/Pace APKを配布・更新しない。正式独立レビューとユーザー実走受入までマージ/Issue Closeしない。

## 修正前の実機再現

私有保全フォルダー D:/working/RunJourney-preservation/goal-cues-20261109/、voice-replay.json SHA256 2b6468e291c26bf82a62dfebd19f4f56794113b9438d343457a9e13b0c181860。

系列 preview-cues-1794206508489：

|段階|生成からの経過|結果|
|---|---:|---|
|200m生成|0ms|VOICE_GENERATED|
|Native受信|15ms|QUEUED|
|チャイム開始|250ms|CHIME_STARTED|
|チャイム終了|618ms|CHIME_COMPLETED|
|本文要求|934ms|BODY_REQUESTED_AFTER_CHIME|
|本文開始|1532ms|STARTED / screenInteractive=false|
|生成後3秒|3000ms|INTERRUPTED_CUE_EXPIRED→DISCARDED。本文開始後は約1468msしか残らない|
|190m生成|約299467ms|4秒JSタイマーが数分遅延、STALE_STATE|
|10m生成|約651349ms|さらに遅延、STALE_STATE|

原因A：speakNextがexpiresAtを本文中にも使うwatchdogを設定していた。配送待ち/チャイム/TTS起動と本文の完了時間が同じ3秒に混在した。この部分は試聴だけでなく実RUNのGOAL_COUNTDOWNにも共通するため修正対象。

原因B：旧previewはsetTimeoutで次の合成入力を作る。画面OFFでJSタイマーが止まり、30秒のNative preview leaseが先に満了してGoalCueFenceが試聴IDを終了扱いにした。後着の190m/10mが拒否された。実RUNにはpreviewLeaseMsを付けず、preview-cues-で始まらないIDなので、この試聴用終了印の経路は適用されない。実RUNの時間目標はFinishClockService→Expo module event→FinishClock→RunService.checkGoal→GoalCues、距離はLocation Task→ingestLocationBatch→RunRepository→checkGoal/updateRun→GoalCuesを通る。実GPSのOS配送遅延・古いfixのスキップは別条件であり、この再現だけで実RUNのバックグラウンド動作を合格とはしない。

## 修正

expiresAtは生成から本文STARTEDまでの期限（countdown3秒/half8秒）とする。キュー待ち・チャイム後・合成後・直接TTS onStartで期限と状態を検証する。期限内に始まった本文は、開始からcountdown最大5秒/half最大15秒の別watchdogで監視する。時間目標の終了deadlineは常に上限。watchdog更新に世代番号を付け、古い開始期限のcallbackが有効な本文を切らない。

最新labelの更新、goal epoch/config、停止・RUN終了の取消は従来どおりで、長い本文枠の間も古い数字を保持しない。優先順位やキュー容量、10単位・最新1数字だけ・重複防止を変更しない。単純な配送期限の延長や古い数字の再試行はしない。ログにexpiresAt、bodyCompleteBy、cueWatchDeadline/Reason、CUE_START_EXPIRED、INTERRUPTED_CUE_BODY_TIMEOUT、INTERRUPTED_CUE_GOAL_DEADLINEを区別して残す。

## 画面OFFを検証する方法

Test診断画面に「画面OFF 距離/時間カウントダウン（実RUN音声経路・履歴なし）」を追加。実RUNと共通のFinishClockServiceの1秒Native foreground pulseを使用し、JSのsetInterval fallbackを試聴時だけ無効にする。Nativeイベント以外では合成入力を進めない。共通evaluateCueSourceでcueSample/timeModel/effectiveDistance→SQLite予約→鮮度/設定再照合→同じnotifyBatch→同じNativeキュー/チャイム/TTSへ渡す。実RUN側は元のdatabase/RunRepository/settingsを使い、検証側だけ別の:memory: SQLiteと合成ActiveRunを渡す。元DBへRUN/GPS/設定/ledgerを追加しない。

距離は200→190→10m、時間は60→50→10秒、約22秒。入力は合成で時間を短縮しており、実走速度やGPSを模倣するものではない。遅れたpulseは壁時計の最新入力だけを評価し、過去の数字を順に追わない。試聴のforeground clock・音声leaseとwakelockはいずれも30秒上限、終了後は取消/閉鎖する。実RUN中の試聴は拒否し、途中で実RUNが開始したら検証データの配信を止めて実RUNのサービスを停止しない。旧JSタイマー方式のcountdownボタンは画面から外した。

検証できる範囲は、Native pulseによるJS起床、共有の通知判定/SQLite/配送/キュー/再生/取消である。Expo Location OS配送や実RUN保存・Auto Stop検出そのものをこの合成試聴で検証したとは扱わない。実走受入では実GPS Taskと停止再開との組合せも確認する。

## 自動検証

- JS67 suites/515 tests PASS。Native eventを手動配送しJSタイマーを一度も進めず、距離/時間3数字、初回チャイムだけ、遅延時の最新10のみ、元DB全snapshot不変を確認。
- Native69 tests PASS。開始後に旧配送期限を跨いでも有効な本文を維持し、完了watchdogで必ず停止。時間目標終了deadlineは例外なく取消、新数字で旧本文取消、診断foreground lease30秒満了、通常foreground clockの既存寿命を維持。試聴→実RUNではwake lockを無期限の従来RUN用へ昇格。実RUNの新しい通知は310秒後でも試聴leaseで拒否されない。
- SQLite15 tests PASS、型チェック/Lint成功（警告なし）。
- 95分GPS seed1109 PASS。実Location adapter/Repository/SQLiteをPC内で使用。元データ/実音声の証明とは別。

Nativeの追加試験は当初新しい開始処理が存在しないため2件FAIL、実装後はRobolectricの自動TTS完了を明示制御してPASS。修正前の実動作の証拠は上記実機音声ログであり、テスト追加時のNoSuchMethod例外を動作再現の証拠とは扱わない。

## 保全と実機結果

更新前screenoff-before.json SHA256 a60d0117a6c09ce64b15cb9f2cf8a0d35ad7e562c553cfc06c78c9c0d1c1e151。隔離SQLite roundtrip/integrity/外部キー検証成功、前回after.json全snapshotと一致。54履歴・ごみ箱18・GPS22512点・設定11（旧10+両OFF新設定）・draftなし。

中間8ac611a7はwake lock昇格修正前のためCANCELED。配布・実機更新には使用しない。[EAS build a14ef9f3](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/a14ef9f3-9ba6-43b6-8285-dc42417b8451) は実装faadf6cでビルド中。完成後にAPK/ハッシュ、更新後照合、Bluetooth画面OFFのログとユーザー聴取を追記する。実機は未合格の段階を完了扱いにしない。
