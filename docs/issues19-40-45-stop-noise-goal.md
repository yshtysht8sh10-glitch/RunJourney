# 停止遅延診断・騒音連動音量・終了音声（#19 #40 #42 #43 #45）

## 実装と優先順位

#43を最優先に、判定アルゴリズムの閾値は変更せず区間別計測を追加した。#42は予告0.16秒、停止下降音0.32秒、再開上昇音0.32秒。#19はTest設定の初期OFF機能。#45は自動・手動の終了保存後に結果音声を送る。#40の最新値による一度だけの回復・120秒TTLを維持する。実走受入が必要な全IssueはOPENを維持する。

## 実走ログから分かったこと

入力は端末から提供されたv19の10km実走診断（2026-10-27T14:22:48Z開始）。個別GPS・履歴・音声ログ原本は私有保全先に保持しGitHub/EASへ送らない。元ログSHA256: `9f8f73c368ace0ab9eac11dbddb3da85a69f573db82546a5a3996383c7860b2d`。GPS観測3,762件、停止8回・再開8回、保持された判定720件・trace52件。保持上限のあるログなので未保持区間をゼロとは扱わない。

| 区間 | v19の観測 | 解釈 |
| --- | --- | --- |
| GPSサンプル時刻→JS callback | 平均67.5ms、最大1,622ms（3,762件） | ネイティブGNSS受信時刻ではない。時計誤差も含み得る |
| callback間隔 | 最大6,641ms、5秒超1回 | 常に1秒周期ではない |
| 停止判定の証拠窓 | narrow: 5,000 / 5,999 / 5,077 / 5,000ms、bounded: 8,999 / 8,000 / 8,000 / 9,981ms | 5秒/8秒の既存条件とサンプル境界が主な待ち時間 |
| 確定GPSサンプル→通知生成 | 中央1,046ms、最大4,276ms（16件） | v19では配送・直列処理等を完全分割できない |
| 通知生成→native queue | 中央9ms、p95 113ms、最大257ms（69件） | 通知経路の一部 |
| native queue→チャイム開始 | 中央40ms、34〜67ms（16件） | 実際の物理停止→通知時間とは異なる |
| native queue→停止TTS開始 | 中央513ms、494〜807ms（7件） | チャイム後。1件は状態変化でTTSを破棄 |
| native queue→再開TTS開始 | 中央510ms、493〜815ms（8件） | チャイム後 |
| 情報案内の待ち | Pace警告最大17,024ms、5分案内最大11,035ms | 優先通知による保留・回復を含む。停止判定遅延とは別 |

16チャイムが開始・完了。割込み抑制1件、チャイム後の古い状態のTTS破棄1件、FIVE_MINUTESの回復2件。予告が確定直前に聞こえる/聞こえない原因は、別々の候補条件・待ち窓に加え、優先度・状態遷移・音声待ちがあり、旧ログだけでは全ケースの寄与は断定できない。物理停止の真の瞬間は観測していない。

## 新しい診断

`STOP_PIPELINE`を各受理GPS観測について記録する。sampleAt、callbackAt（実際のJSタスク配送）、submittedAt、enteredAt、evaluatedAt、finishedAtを区別。GPS低速観測、候補開始サンプル、候補検出処理時刻、確定サンプル・処理時刻も区別し、同一候補IDを予告・確定・native通知まで引き継ぐ。全既存閾値、入力、窓、各gate、結果、reasonを出力。DB checkpoint時間もCOMPLETED/FAILEDで記録。音声には生成・dispatch・native受信・queue・chime・TTS・破棄・割込み時刻がある。

診断画面の「停止・通知の遅延サマリーを集計」と音声JSON Exportに分布（count/min/median/p95/max/mean）、理由別件数、候補別時系列を追加。`node scripts/analyze-stop-latency.cjs PRIVATE-voice.json NEW-report.json`でも再集計できる。旧ログの欠けた区間はunknown、逆転した時計はnull。位置座標は追加ログに含めない。既存20MBジャーナル上限を維持する。

変更前後の実測比較は未完了。旧コードc685525との全44履歴・15,544保存GPSの疎な再生比較では、219 sensor遷移の内容・確定時刻、距離・実走/停止時間は完全一致。これは閾値不変の回帰証拠であり、1Hz実走や身体停止時刻の再現ではない。次回実走の新ログで配送、直列キュー、判定、保存、通知の寄与を分割してから閾値改善を判断する。

## 騒音連動音量

- Test設定で明示ON・RECORD_AUDIO許可・画面表示中からのみmicrophone型Foreground Serviceを開始。通知と停止ボタンを表示。アプリ背景からの新規起動はしない。最大6時間、終了後40秒、プレビュー20秒の有期限。通知で停止後は自動再開せず明示再有効化を待つ。
- 端末内蔵マイクを16kHz/mono/16bit、200ms単位でRAM処理し直ちにゼロ化。保存・送信しない。UNPROCESSED対応なら使用、非対応はVOICE_RECOGNITION。RMS dBFSであって校正された周囲dB SPLではない。
- 2秒校正、相対baseline+6dBで騒音、+3dBまで戻ると解除、静音baselineは約30秒追従。gain 0.65〜1.0、attack 0.4秒・release 3秒。OSのメディア音量を変更せず、設定音量を超えない。絶対的な聴覚安全音圧は保証できない。
- 情報・終了音声を端末TTSで私有cacheに合成しMediaPlayerで200msごとにgain更新。これは生成された案内文の音声でありマイク録音ではない。完了・失敗・割込み・プロセス再起動時に自身のcacheを削除。合成3秒/準備2秒失敗で通常TTSへ一度fallback。停止予告・確定・再開は遅延を増やさない通常経路と固定gain1。
- Bluetoothの通話/SCOへ強制切替しない。再生の実routeを観測し、外部イヤホン以外・未知routeでは自己音声の測定反映を保留する。権限拒否・マイク競合・システムsilence・測定停止時は通常音声。静かな時より最大約3.74dB戻す設計で、従来のunity音量を超える増幅ではない。
- 制約: 連続マイクは電池消費増。端末をポケットに入れた場合や風、イヤホン遮音性、Bluetooth機種差、画面OFF継続、実走での聞き取りやすさは実機評価が必要。スピーカー再生中は追従保留。

根拠: [Android microphone FGS](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone)、[AudioRecord](https://developer.android.com/reference/android/media/AudioRecord)、[TTS](https://developer.android.com/reference/android/speech/tts/TextToSpeech)。Expo57/RN0.86の版別資料を確認し、追加JS依存なしで既存ローカルnative moduleを拡張した。

## ゴール音声

永続化済みRunRecordから履歴と同じrunMetrics/Pace Analysisを使用。順に終了理由、距離（km小数2桁）、実走時間、平均時速（小数2桁）、平均1kmペース、完了1kmラップ本数と最後の1km時間、お疲れさまでした。通常20〜30秒程度の文量だがTTSエンジン依存。30m未満/時間ゼロでは不安定な平均値を省略。停止・休憩を実走時間から除外し、未完了ラップは本数に含めない。

自動距離・時間ゴールと手動終了は同じ保存済み結果から生成。音声OFFなら発話しない。既存終了の一度だけ保存・freeze/retryを維持し、保存成功後にキュー投入のみ行う。音声失敗を保存失敗へ転換しない。途中の古い通知は終了時に破棄する。

## 検証と保全

JavaScript 49 suites / 442 tests成功。TypeScript・Expo lint成功。native検証・APK・端末更新は後段に追記する。

更新前TestはversionCode19 / c685525。最新標準Backup: 9,969,977 bytes、SHA256 `cb059df06e632b8daad4cc8b16a936245d36bcfef7ae9f26c4ae101639158cd4`（端末とPC一致）。44履歴・GPS15,544点・設定6件・draftなし。decodeBackup検証、PCの新しい隔離SQLiteへ復元、全snapshot一致、integrity_check=ok。端末へImport/消去/アンインストールをしない。Production/Paceを操作しない。個別データは`D:/working/RunJourney-preservation/stop-noise-goal-20261028`に保持し、EASは`.easignore`で`tmp/`も除外する。

## 次回実走受入

同一候補IDでGPS→配送→キュー→判定窓→確定→チャイム/TTSを追い、停止を人が記録した時刻と推定低速時刻を分ける。短い信号待ち、GPS精度悪化、再開直後、予告直後の確定、情報案内中の割込み、画面OFFを確認。イヤホンで静音→車両通過→静音の音量変化と過大音量がないこと、権限拒否・通知停止・通話・Bluetooth接続断・電池消費を確認。手動/距離/時間終了の履歴値と読み上げ、二重保存なしを確認する。机上テストを理由にIssueをCloseしない。

## ビルドと実機プレビュー（2026-10-28 JST）

実装SHA `9d6a52ce7bea96a6182c52ace68b165b2e85320f`、PR [#46](https://github.com/yshtysht8sh10-glitch/RunJourney/pull/46)（#44をbase）。native Robolectric 31tests全成功。Android assembleStandaloneTest成功（3分13秒）。APK実manifestは`app.runjourney.mobile.test`、versionCode20、minSdk26/targetSdk36、画面表示`9d6a52c+cloud-sync-v20`。私有APK `runjourney-test-v20-9d6a52c.apk` は112,533,287bytes、SHA256 `fbaff8bed7ff6180322ec5af5ef15d3ba12b770f16160a7eab112d2f4c3b38e3`。署名SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` は既存Testと一致。

01:42 JSTに`adb install -r`成功、19→20。初回インストール日時2026-09-30 23:40:36、dataDirを維持。Production/Paceへの操作なし。EAS cloudSyncTestも同一実装を送信済み: [build b4d19c36](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/b4d19c36-961f-4bae-913a-3a23153bcb0e)、確認時IN_QUEUE。EASの表示appIdentifier/versionはconfig基本値であり、導入判定にはAPK実manifestのTest ID/versionCode20を用いた。端末導入したのはローカルAPKで、クラウドAPKは未完成。

実機で初期OFF、権限拒否後もOFF・通常TTS STARTED/DONEを確認。許可後の20秒プレビューでは内蔵マイク(inputType15)とBluetooth A2DP(outputType8)を確認し、microphone FGS通知、RMSレベルのみ、gain0.65、MONITORINGを観測。合成QUEUED→STARTED168ms、COMPLETED520ms、adaptive-local-synthesis再生STARTED543ms、再生DONE、測定開始20,004ms後STOPPEDを確認。権限許可後に実機合成/再生経路が動作する証拠であり、騒音上昇時の実際の聞き取り・画面OFF・走行時消費電力の検証ではない。試験終了後に設定をOFFへ戻しサービス停止を確認。走行開始操作はせず、プレビューは履歴を作らない。

## 更新後データの全件照合

01:45 JSTの標準Exportを取得し、更新前BackupとdecodeBackup/canonicalで比較。44履歴の全フィールド・GPS15,544点の全値・291イベント・ごみ箱19件・保護ID24件・draftなしが一致。既存設定6キーの値も不変。意図した追加は`@runjourney/noise-volume/v1: off`の1件のみ（プレビュー試験後OFF）。欠損0・変更履歴0・追加履歴0。

更新後Backupは9,970,013bytes、端末とPCのSHA256一致 `c4c18becb1b3e8d70a12393ab7f72e435a97aa4ed9220ad40391a91d30360e96`。内部SHA検証成功。PCの新しい隔離SQLiteへ復元し、全snapshot一致、integrity_check=ok、foreign_key_check違反0。更新前BackupのSHA不変も再確認した。端末にRestore/Importを行わず、データ消去・アンインストールなし。証跡は私有保全先の`backup-after.json`、`restore-after.sqlite`、`verification-after.json`、`voice-after-preview.json`に保持。
