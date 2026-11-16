# Test v36：センサー診断・5条件マーカーの採取成立確認

対象Draft PR #77。11月16日の欠落原因は未特定。ユーザーはセンサーON・マーカー開始・物理20押下を実施した認識であり、操作ミスとは扱わない。

## 確定事実と再現可能な欠陥

- 元RUN 5.2208km、GPS入力2,697件、10,793レコード認証/seal。加速度/ジャイロの新規ファイル0、実走protocolセッションのMARKER0。
- v35の「終了」ボタンはマーカーサービスのSTARTING/RECORDING/CLOSINGだけを参照。センサー受付条件とは独立していた。
- protocolの押下はセンサーRECORDINGでなければ理由を記録せずreturnしていた。拒否、未配送、保存失敗を事後に区別できなかった。
- v35のRECORDINGはregisterListener成功で設定され、実サンプル未受信でも表示できた。
- ARMEDはプロセス内状態。画面遷移自体では消えないがプロセス再起動で消失する。元実走には永続遷移ログがなく、再起動・開始要求未成立・登録失敗等を特定できない。
- 回収先sensor-diagnostic-v1/run-markers-v1は実装保存先と一致。元ファイルの削除/移動/破棄処理はなく、未sealファイルも回収対象に含めた。最終センサー参照は前回のADB合成試験で、今回の実走へ混入していない。

## 修正方針

センサーが実採取中であることをprotocolマーカー受理条件とする依存関係は維持。別モードのSTOP/RESUME・trialも維持。未採取でも正解ラベルを採用する仕様変更は行わない。

1. Native登録後はSTARTING、両センサーの実受信後にRECORDING。開始要求から10秒以内に成立しなければFAILED。片方の受信が10秒超途切れた場合もFAILED。再ARM/RUN間で前回サンプルを再利用しない。比較用センサーOFFはMETRICS_ONLYと明示。
2. RUN画面・センサー画面・マーカー画面へTest限定の採取表示。受信数/実Hz/最終受信経過時間/GPS状態/受付可能性/保存・拒否数/最後の理由を表示。長いJSONとは別に上部で確認できる。
3. NativeのTest警告通知と画面警告。既存音声キューへ警告を投入しない。通知権限なしの場合も画面警告を維持。通常RUN/GPS/SQLite/音声は継続。
4. MediaSession受信、キーの重複/リピート判定、センサー未準備による拒否、queue待機後の状態変化、MARKER+ACK保存成否を追跡。拒否はBEGIN/END番号を進めない。KEY_UPは物理1押下の拒否数に加算しない。
5. 起動時に専用最終状態checkpointを読み、前プロセスのARMED/STARTING/RECORDING/CLOSINGを成功として復旧しない。PROCESS_RESTARTED警告を残す。自動再ARM/既存RUN復元はしない。

終了writerがstateを確定してからcache/checkpointを更新していた競合可能性も修正。完了反映をセンサーactorで一括実施し、新しいARMEDでは前回件数をリセットする。これを元実走の原因と断定する証拠はない。

## 保存と失敗処理

- 新規noBackupFilesDir/diagnostic-lifecycle-v36、別Keystore alias RunJourney.Test.DiagnosticLifecycle.v36。
- AES-GCM、連番/ハッシュ鎖/START/END。プロセス死でENDがなければ不完全と判定。既存記録は移動/削除/上書きしない。
- RUN ID/センサーsession/マーカーsession/process token、wall clockとelapsedRealtimeNanos、理由を関連付ける。座標・経路・キー・生サンプルはこのログへ入れない。
- 専用writer、128件待機上限、2MB/file・10MB/store、最大1,000イベントでseal/分割。上限到達・保存失敗はauditFailureとして表示し、ログ欠落を成功扱いしない。自動削除なし。
- 状態遷移と押下だけの疎な書込み。監視は既存2秒tickと開始期限1回を利用、UI表示中のみ1秒poll。追加のセンサー要求/GPS要求/wakelock/音声フォーカスはない。
- Test v36の音声保存先だけvoice-log-sensors-v36へ分離し、v35実走音声の保持期限処理を起動しない。優先順位・再生条件・通常音声文言は維持。

## 主な変更ファイル

- Native SensorDiagnostics.kt / SensorReadiness.kt：成立確認・watchdog・checkpoint・警告・状態スナップショット。
- Native RunMarkerService.kt / MarkerAcceptance.kt：実受付状態・受信/拒否/保存・相関ID。
- Native DiagnosticAudit.kt / RunAnnouncerModule.kt：独立暗号化ログと認証読取り。
- VoiceLogStorage.kt：Test新規出力先のみ。
- src/components/test-diagnostic-status.tsx、src/app/index.tsx、sensor-diagnostics.tsx、marker-poc.tsx：Test表示と故障注入。
- src/services/sensor-diagnostics.ts、modules/run-announcer/index.ts：診断状態API。通常RUN保存・GPS取得条件・判定計算は変更しない。
- app.config.js / plugins/with-android-build-variants.js：Test識別v36。

## 検証ゲート

自動テストと実機を区別する。最終結果は追記する。

| 実機試験 | 合格条件 | 現在 |
| --- | --- | --- |
| ARMED→通常START | 両実サンプル増加後にRECORDING、START/登録/初回/成立ログを認証 | 未実施 |
| OpenComm2実押下 | MediaSession受信→受理→MARKER+ACK、BEGIN/END・件数一致 | 未実施 |
| 画面OFF・画面遷移 | 収集/受付継続、復帰時状態一致、独立再読取り一致 | 未実施 |
| 開始失敗・途中停止・保存失敗 | 警告・拒否理由・不完全性が残り、通常RUNがGPS/SQLite保存を継続 | 未実施 |
| RUN/マーカー終了 | 暗号認証・seal・受信/保存/拒否数を回収可能 | 未実施 |
| 保全 | 更新前後に全元RUN/GPS/ごみ箱/設定/グループ/保護情報と元診断hash一致 | 未実施 |
| 負荷 | USB接続のON/OFF参考比較、GPS間隔/CPU/PSS/温度/I/O/音声完了を記録 | 未実施 |

USB接続を維持するユーザー指定を継承し、非充電時の電池増分と自然Dozeは未検証とする。物理押下をADB合成で代替合格にしない。室内短時間RUN・記録回収・警告・画面OFF・物理押下のゲートが通るまで再実走を依頼しない。

## 実走操作案（現時点では実走案内保留）

GPS診断ARMED→装着位置選択/センサーARMED→5条件マーカー開始→通常START。
RUN画面で両件数増加/RECORDING/受付可能を確認してから行動する。未成立や警告時は診断試験を成立扱いしない。通常RUNを中止する必要はない。
各区間BEGIN/ENDでShokzを短く1回。歩行/Uターンで停止しない。RUN通常終了・保存確認後にマーカー終了。GPS・センサー・マーカー・新状態ログを回収して照合する。

Draft維持。Production配信、マージ、Issue Close、既存データ削除・復元は禁止。

## 端末確認で見つかった通知権限の補完

最初のda1a274 APKで実サンプル増加/RECORDING/受付可能は確認できた。一方、Android13のPOST_NOTIFICATIONS未宣言が判明し、無音警告通知は未成立だった。Test限定config pluginで宣言し、明示的な許可ボタンと通知ON/OFF表示を追加。拒否時も通常RUNを継続し、画面内警告を維持する。許可/実通知の端末確認が終わるまで通知合格とはしない。

再ビルド時間を抑えるためsensorTestだけarm64-v8aを対象とする。対象SO-51Bがarm64-v8a対応であることを確認済み。Production/Pace/その他Test profileのABIは変更しない。今回のAPKは32bit専用端末・x86 emulatorを対象としない。

コールド起動のバックグラウンドGPS入口でもcheckpointを確認し、失われたARMED/RECORDINGを警告する。前景の画面表示だけに初期化を依存させない。通常GPSの判定入力は変更しない。実端末でのプロセス再起動検証は残件。

ユーザーから今回Test限定のローカルビルド例外承認を取得。EAS無料枠上限のため既存署名でローカルGradleを使用する。中断前の候補v36ログも保全するため、最終修正版の音声出力先をvoice-log-reliability-v36へ分離し、候補のvoice-log-sensors-v36へ保持期限処理を起動しない。
