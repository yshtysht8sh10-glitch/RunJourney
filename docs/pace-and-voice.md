# Pace Analysis / Total・Lap・Voice

2026-10-04、Issue [#17](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/17) / [#6](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/6)、Standalone Test versionCode 6。

UXと原データ保護は [Design Principles](design-principles.md)、状態・検出・時間・履歴訂正は [Auto Stop / Break](auto-stop-break.md) を参照する。今回GPS頻度・Auto Stop初期値・設定DEFAULTは変更しない。

## 同じEffective Runを使う

Raw GPS → Stop / Break Events → Include / Exclude Overrides → Effective Run → Effective Distance / Pace Analysis → Total・Lap・History・Voice。

`run-model.ts` の `effectiveEdges` が共通の辺を作る。既存GPSフィルタ、停止中の除外、再開時segment切断、訂正区間のjitter抑止を `effectivePoints` に委ね、Raw GPS時刻で辺の距離を検証する。START〜STOPへ時刻をclipし、辺の距離を時間比で配分した後、active clockへ配置する。境界間の移動速度一定という補間上の仮定であり、未観測の動きを復元するものではない。

|利用先|内部source|
|---|---|
|RUNNING画面のtotal|Repositoryが更新する `distanceMeters = effectiveDistance(run)`、共通edgesの合計|
|STOP保存total|`effectiveDistance({...run, endedAt})`、STOP境界を適用|
|履歴一覧・詳細total / 平均Pace|`effectiveRun(record)`|
|履歴5分Lap・端数Lap|`effectiveRun(record).laps()` / `timeLapRanges`|
|Voice total|`completedLapAnalysis(run, confirmedActiveMs).total`、0〜通知対象境界|
|Voice lap / Pace / km/h / フル換算|同じanalysisの `lap` / 共通 `analyzePace`|

完全な5分Lap + 最後の端数Lap = Effective Runの総距離。各辺をactive時刻との重なり比で配分するので、境界の二重加算や抜けがない。浮動小数点誤差はテストでepsilon比較する。表示値を個々に丸めた後の和は内部合計と異なり得る。走行画面は現在、音声は対象5分境界の値なので、遅れて聞いた音声totalと現在画面の差は時点の違いとして説明できる。

## 境界と遅延

- START前のcached GPS・STOP後の点はRawのまま保持するが、距離はSTART〜STOPの辺部分だけ加算する。STOPが最後のGPSより後でも距離を外挿しない。端数Lapの時間はSTOPまで、距離は観測分まで。
- AUTO_STOP候補中はまだRUNNING。確定後は候補開始timestampまで遡及し、時間と距離を共通モデルで再評価する。再開も最初の有効移動へ遡及する。停止候補中の未確定5分通知は既存announcementClockで保留する。
- AUTO_STOP / BREAK除外中の距離を加算せず、再開の前後を直接結ばない。BREAKは手動再開のみ。Include / Excludeは原イベント・Rawを残し、同じ共通辺と時間からtotal / lapを再計算する。
- `DEFAULT_LAP_MS` は5分。配送が5:05 / 5:10でも初回analysisは0:00〜5:00であり、5:00以降を含めない。10分対象はtotal 0〜10分 / lap 5〜10分。
- Android Serviceは対象intervalと一致するJS分析payloadが届くまで待つ。従来の「payload未着なら現在のtotalをnative側で読み上げる」fallbackを除いた。Auto Stop OFFの既存10秒grace、ONの確認済みactive clockは維持する。payloadが来なければ通知も待つ。

## 計算精度と読み上げ精度

計算に読み上げ用の丸め値を渡さない。`PaceAnalysis` はmeters / millisecondsの内部値を使用し、`voice-format.ts` だけがpresentationを担当する。

内部826.73mなら、5分のseconds/kmは `300000 / 826.73`、km/hは `826.73 * 12 / 1000`、フル換算secondsは `300 * 42195 / 826.73`。距離発話だけ0.83kmになる。

- 5分Lap距離: 小数第2位、10m単位へ四捨五入。例 826.73m→0.83、824m→0.82、825m→0.83、1000m→1.00。
- `lapDistanceSpeech` は「れいてんはちさんキロメートル」のように小数桁を日本語かなへ変換。0 point 83 / 83だけ / 0.830000に解釈される入力を避ける。整数部分は通常の日本語TTS数値読み、0は「れい」。既存Voice Testのサンプルも内部826.73mに変更し、Lap項目ONで0.83を試聴できる。実機TTSの自然さは別途試聴する。
- 総距離は従来どおり小数第1位。Pace / km/h / フル換算は従来の発話表示精度を維持する。
- 30m未満のLapは従来どおり派生通知を抑制。formatter単体の0mは0.00だが通常通知の短距離Lapは発話しない。NaN / Infinity / 不正なdurationは発話しない。
- AUTO_STOP / BREAKを跨いでも同じformatterを使う。音声OFFと項目DEFAULTは変更しない。

## Issueの扱いと残作業

#17: 前回実走の真因を証明する新しい実データはない。前回のtotal=payload作成時点 / lap=5分境界という構造的不整合に加え、START/STOP距離境界とnative fallbackを修正し、再発を検出するテストを追加した。未解決の計算不整合がないことをコードとテストで確認して完了判定する。実際のGPS品質と読み上げの聴感を保証するものではない。

#6: 実走で小数第1位ではペースアップを感じにくく、フル換算との印象差も大きかったためLapのみ10m単位に変更。既存の6項目個別ON/OFF、5分通知、native共通TTS / Audio Focus経路のVoice Testを再利用する。

未完了は通知間隔カスタマイズ、換算目標距離選択（現在42.195km）、音量調整、音楽/画面OFF/BTイヤホンでの実機Voice Test、TTS自然さ・聞こえ方の確認。#6はOPENを維持する。車の通過等の騒音で聞こえないフィードバックは [#19](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/19) へ関連付け、今回マイク・騒音検出は追加しない。[#18](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/18) の高頻度GPSも対象外。

## 検証と次回実走

`lap-consistency` は0〜5 / 5〜10 / 10〜15 / 端数、内部合計、5/10秒遅延、START/STOP、候補・遡及停止/再開、BREAK、include/exclude、GPS不良、legacy、微小/非有限値、History / Voice派生値を検証する。`voice-precision` は10m丸め境界、かな、内部Pace / km/h / フル換算の精度と従来totalを検証する。RepositoryのSTOP保存値とRaw保持、Voice Serviceの5/10秒遅延も回帰テストする。

自動検証: focused 6 suites / 54 tests、full 14 suites / 114 tests PASS。typecheck / lint（警告なし）、`:run-announcer:compileReleaseKotlin`、`git diff --check` 成功。#7の状態・永続化・画面・長押し・背景・Diagnostics・遡及補正の既存回帰テストを含む。実機での聴感は自動テストの対象外。

- Lapが「0.8」ではなく「0.83」のように聞こえ、10m程度の変化を認識できるか。
- 距離・min/km・km/h・フル換算が同じLapとして自然か。TTS、音楽のduck/resume、BT、画面OFFも試す。
- 音声の対象5分Lapと履歴の同じLapを比較する。内部の完全Lap + 端数が総距離と一致するか。丸め差と通知時点差を区別する。
- AUTO_STOP / BREAKの境界と履歴訂正後にも距離jump・Lap異常がないか。
- 差があれば通知対象時刻、実際の読み上げ、履歴Lap、Build hash、Diagnosticsを残す。
