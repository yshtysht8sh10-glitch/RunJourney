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

中間8ac611a7はwake lock昇格修正前のためCANCELED。配布・実機更新には使用しない。[EAS build a14ef9f3](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/a14ef9f3-9ba6-43b6-8285-dc42417b8451) は実装faadf6cでFINISHED。[Test v28 APK](https://expo.dev/artifacts/eas/zJgGKHeCEi7M-V5ANbYKcyMjIUJSsAYzSrryehaDch4.apk)、SHA256 `39bf3b961df3c84a65f261c71f23f328bdf932eb9481f72095b971b997e30166`。証明書SHA256は旧Test v27のfac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9cと一致、permission一覧も一致。app.runjourney.mobile.test/versionCode28へadb install -r成功。更新後照合、Bluetooth画面OFFログとユーザー聴取は以下へ追記する。実機は未合格の段階を完了扱いにしない。


### v28実機試聴の途中経過（下記の最終結果で解消済み）

更新後、距離Native pulse試聴を開始して画面OFF、24秒後に音声/時計/騒音サービス残留なし。端末はロック状態となり手動解除を依頼済み。距離本文の完了/失効はExportログ未回収のためまだ合否を付けない。ユーザー聴取回答、画面OFF時間試聴、更新後の全Backup snapshot照合も解除後に実施する。

インストール済みAPKのSHA256は上記配布品と一致、versionCode28・firstInstallTime=2026-09-30 23:40:36を保持。Production APK SHA256は更新前と同じ30a956d9b5197475c1226d10ac39a82c580c4f25e6e84218f8470b9316086d3a。Pace版未操作。


## 追加の実機検証（距離ログ回収時点の記録）

voice-v28-distance.json SHA256 `952b9109e183262dd7859cff6c2c49e79719e0fa235b883ac7e9553b1eb36a7e`。系列preview-cues-probe-1794209546838、Native pulse22件、FINISHED。

|数字|開始遅延|本文時間|生成から完了|screenInteractive（開始/完了）|結果|
|---|---:|---:|---:|---|---|
|200m|1388ms|1952ms|3340ms|両方false（画面OFF）|DONE、初回チャイム1|
|190m|237ms|2830ms|3067ms|両方false（画面OFF）|DONE、チャイム0|
|10m|241ms|1825ms|2066ms|両方false（画面OFF）|DONE、チャイム0|

200m/190mは3秒の開始TTLを跨いで本文を完了し、不当な期限中断は0。180〜20mの17数字はCOUNTDOWN_CROSSED_OLDER_SKIPPEDに列挙され、VOICE_GENERATED/本文開始はない。本文再生の完了と実際のユーザー聴取は分ける（現時点の聴取回答は未回収）。

時間のNative pulse試聴も画面OFFで実行済み、24秒後の音声/時計サービス残留なし。再ロックした端末の手動解除を依頼し、時間ログ回収と更新後Backup照合を待っている。時間3数字の合否をサービス終了だけで推測しない。

### 正式レビュー引継ぎ時に確認する点

正式レビュー依頼は、今回の実機確認と保全照合が揃うまで保留。レビュー担当へは以下の証拠を渡す。開発者の自己検証は正式独立レビューに数えない。

- v27修正前の本文中断時系列と、v28距離の開始TTL超過後DONE。時間ログとデータ照合は回収後に同じ表へ追加。
- expiresAtとbodyCompleteBy/cueWatchDeadlineの分離、watch世代番号、時間目標deadlineの上限、古いcallbackの無害化。
- 新数字・停止・終了での取消と、音声OFF→ONを実RUN終了印と混同しないこと。NativeのpauseAndRunEndCancelCountdownWithoutInformationRecovery/finishedCueMarkerRejectsLateCountdownWithoutDisablingGenericVoiceResume/timeGoalDeadlineCancelsChimeWithoutChangingRunEndState、JSのstop before pending I/O finishes prevents late cue dispatchがPASS。
- 上記の停止/終了途中取消は共有Nativeサービス/JSの自動回帰試験。実機probeでは通常終了時のサービス解放を確認したが、実GPSのAuto Stopや本当のRUN停止操作中の中断をこの合成試聴で確認したとは主張しない。
- Native pulse専用の試聴、元DBとの隔離、30秒lease、試聴→実RUNのwake lock昇格。OS GPS配送/実走受入とは別の検証範囲。
- 元の54履歴/ごみ箱18/GPS22512/設定11/グループ・保護/draftが全snapshot一致であること（更新後比較待ち）。Production/Pace未変更、PR70/67未マージ、Issue未Closeを維持。


## 最終実機検証と正式レビュー引継ぎ

### 時間の画面OFFログ

時間の初回試聴（preview-cues-probe-1794223564381）と再試聴（preview-cues-probe-1794224114128）を回収。どちらもNative pulse22件、60/50/10秒すべてSTARTED/DONE、開始・完了ともscreenInteractive=false、初回だけチャイム1、失効・中断・STALE_STATEは0、FINISHED。再試聴についてユーザーは「3つとも聞こえた」と確認済み（初回のみチャイムを含む質問への回答）。距離のユーザー聴取回答は未記録で、実機STARTED/DONEの確認と分ける。

|時間再試聴|開始遅延|本文時間|生成から完了|結果|
|---|---:|---:|---:|---|
|60秒|1361ms|1869ms|3230ms|画面OFFでDONE、初回チャイム|
|50秒|236ms|2123ms|2359ms|画面OFFでDONE、チャイムなし|
|10秒|224ms|1705ms|1929ms|画面OFFでDONE、チャイムなし|

初回時間60秒も生成+3373msでDONE。距離200/190m・時間60秒2回の計4本文が生成+3秒を越えて完了し、配送開始TTLによる不当な再生中断が解消したことを実機で確認した。3系列合計9本文STARTED/DONE、Native pulse66件、初回チャイム計3。40/30/20秒は各試聴でSKIPし本文なし。距離17数字と時間3数字×2の23数字を明示スキップし、古い数字の追いかけなし。終了後の音声/時計/騒音サービス残留なし。

### 音声資料

私有保全先のvoice-v28.json SHA256 `e1bb72a9d2576833118fd3f30663be84b9d0af8ee975cd988801ac657a9810cc`。audio-verification-v28.jsonに全3系列のイベント別状態、画面状態、開始遅延、本文時間、TTL超過後完了、スキップ、ユーザー聴取の範囲を要約。raw voice/GPS/バックアップはGit/EASへ含めない。元の失敗ログvoice-replay.jsonと比較する。レビュー担当は通常の診断Exportでpreview-cues-probe- IDを絞り、同じイベントIDのGOAL_CUE_RESERVED/VOICE_GENERATED→QUEUED→CHIME_*（初回のみ）→STARTED→DONEを追える。

直接TTSのoutputType=0は経路未測定。システム音声のbt_a2dpと、再試聴した時間のユーザー聴取を別の証拠として扱う。DONEだけで音圧・聞き取りやすさ・全実走条件の成功を主張しない。

### 更新前後のデータ保全（完了）

screenoff-after.json SHA256 `32f3fa6f10271d083128210ef74f243eb148c9615f25cdb980213985e59b2cfe`。別SQLiteへの復元snapshot一致、integrity_check=ok、外部キー違反0。screenoff-before.jsonとの全snapshot canonical比較が完全一致。54履歴・ごみ箱18・GPS22512点・設定11項目・グループ/保護・draftなしを保持。検証RUN/進捗/設定を元DBへ追加していない。元データ削除・ごみ箱/保持期限処理の起動なし。preservation-v28.jsonに比較結果とハッシュを保存。

端末のビルド表示faadf6c+cloud-sync-v28、インストール済みAPK SHAは配布品と一致。RUN開始前表示は従来の5km・自動終了ON、両新設定OFFを保持（全設定一致で確認）。Production APKは前後同一SHA、Pace版未操作。

### 検証範囲と引継ぎ

|確認事項|証拠|判定/範囲|
|---|---|---|
|距離200/190/10m・時間60/50/10秒|実機画面OFFの9本文ログ、再試聴時間はユーザー聴取|共有Native pulse→SQLite予約→通知キュー→音声経路で合格|
|開始期限後も開始済み本文を維持|実機4本文で生成+3秒超のDONE|合格。時間目標deadlineは別途Native試験で取消|
|古い数字スキップ|実機23数字SKIP、JSモデル全20/6閾値・遅延Native pulse試験|合格|
|停止・終了途中の未再生/再生中取消|Native69件中のstate/end/deadline/fence試験、JS送信前stop競合|自動回帰で合格。実機は合成試聴の正常終了・サービス解放を確認。実GPSのAuto Stop/本当のRUN停止操作は実走受入に残す|
|元RUN/GPS/ごみ箱/設定/グループ/保護|更新前後全snapshot一致、隔離SQLite復元|合格|
|通常の実RUN背景動作|共有音声経路とNative pulseは上記実機確認、Location Task/自動終了判定のコード差分なし|OS GPS配信・長時間の実走・停止再開の組合せは実走未検証|

今回の室内実機音声経路検証とデータ照合は完了。新たな不具合の再現はなく、追加のアプリ修正/再ビルドは行っていない。PR70はDraft・未マージ、IssueはOPEN、正式レビュー依頼は送信していない。正式独立レビューを経て、上表の実走受入条件をユーザーが確認するまでマージ/Closeしない。

レビュー対象の中心はsrc/services/goal-cues.ts、goal-cue-probe.ts、finish-clock.tsと、RunAnnouncerService.ktのarmCueDeadline/cueBodyStarted、FinishClockService.ktの試聴lease/実RUNへのwake lock昇格。元のRunService/Location Task/Auto Stopモデル/VoicePolicy優先度を変更していないこと、試聴sourceが本DBへ漏れないこと、期限切れ・後着callback・RUN終了印を再確認する。正式レビュー担当への送信はユーザーの進行判断を待つ。
