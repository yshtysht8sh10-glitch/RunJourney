# #49 開発用GPSシミュレーター：private CLI・短停止・3時間検証

実装コードSHA `ed117ef3abd313914edc3a76bce1779777b8bf53`。`src/test/`とPC/Jest CLIのみ。アプリのルート・設定に実入力/合成切替を追加せず、通常の履歴・同期・統計・端末DBへ接続しない。

## 再現手順（PC専用）

既存の`npm run simulate:gps -- 49 NEW_REPORT`は95分の旧経路検証として保持する。新しいCLIは最新PACE契約・受信順入力に対応する。

```powershell
# 出力先ディレクトリは事前に用意。どのGitリポジトリ内も指定不可。
node scripts/gps-private.cjs synthetic 180 D:/private-runjourney/new-180min-report.json
node scripts/gps-private.cjs replay D:/private-runjourney/anonymized-input.json D:/private-runjourney/new-replay-report.json
```

- syntheticは1〜240分を入力可能（測定済みは下表）。同一seed49、初15分は1Hz、その後5秒間隔。アプリのGPS要求頻度を変更するものではない。
- replayは32MiB以内のschema1 JSON：`{schema:1, startedAt:数値ms, batches:[{receivedAt:数値ms, appState:"active"等, locations:Expo LocationObject配列}], stops?:[{start:数値ms,end:数値ms,quality:"good"|"poor"}]}`。
- 最大20,000 batch/100,000 fix、受信時計は非減少で開始以降、fix時刻が受信時刻より未来の場合は拒否する。バッチ/各fixの受信順・重複は変更しない。生データに時計逆転がある場合は勝手に補正せずエラーとし、別調査する。
- 経路を匿名化した**ローカル私的ファイルだけ**を明示指定する。今回実データは使っていない。相対/実パスと親ディレクトリのrealpathを確認し、どのGitリポジトリ内の入出力も拒否する。
- 既存reportへ上書きしない（`wx`）。子Jestのstdout/stderrは転送せず、座標入りの失敗assertが出てもCLIから漏らさない。失敗時は固定コード。中断等で不完全reportが残った場合も自動削除/上書きせず、新しい出力名で再実行する。
- CLI成功表示は件数/時間等だけ。reportも集計のみで、座標・経路・元RUN ID・絶対時刻・鍵・入力パスを含めない。出力自体も非公開で保持する。アップロード/同期機能はない。

## 共用経路と測定の意味

`GpsBatchReplay.step` → 実`ingestLocationBatch` → `GpsObservationSession/RunRepository/detectStop` → 共通距離/時間/Pace Analysis → `VoiceAnnouncement` → PC Native SQLite（`:memory:`）。Nativeは`pacePeriodicVersion=1`/設定handshake/連続cursorをfakeで受理する。

**合成成功はNative永続ACK・Android音声再生・実聴取ではない。** 旧95分fixtureと新3時間fixtureはfakeのcapabilityが異なる。Nativequeueは別の既存証跡を使用する。

- ground truthはシナリオ作者が指定した3/8/25/30秒停止。GPSやAuto Stopの出力から正解を作らない。900秒周期で繰り返し、低速0.8m/s、精度60m/ジッター、10秒欠測、20秒batch遅延、active/background入力も含む。
- 逐次処理は受信時点までのbatchだけを渡す。後から正解ラベルに照合することと、未来の入力を用いた判定を分離する。
- `availableAt`はSTOP_PIPELINEの判定終了時計。遡及onset/sample時刻から検出遅延を測らない。停止ラベル中に利用可能になった最初の確定を「期間内検出」とし、その後のRUNNING区間で再開を照合する。ラベル終了後の遅い停止確定等は未対応イベントに残す。
- p50/p95はnearest-rank。停止/再開遅延、good/poor品質別、停止長別、候補/キュー/評価等のpipeline段階、配信入力遅延、PC CPU/実時間/サンプルRSSを集計する。ラベルがなければaccuracyはnull。ラベルが不完全な場合、未対応イベントを「誤判定」と断定しない。
- pipeline段階は仮想時計の値であり、0msでも端末/PCの実処理待ちゼロを意味しない。実時間/CPU/RSSは別のPC測定として記録する。
- 再開見逃しは「停止を期間内検出できたラベルの後」に限定して集計し、停止見逃しを分母に混ぜない。品質別区分は作者のラベルで、計測accuracyからの正解生成ではない。

## 自動テストと既存証跡

- 新parser/統計/runner＋既存contract：3 suites/6 tests PASS。短停止長・3時間の入力構造、未来fix拒否、未ラベル時の推定抑制、受信時刻遅延、実adapter/SQL/新PACE境界・隔離を確認。
- `node --test scripts/gps-private.test.cjs`：3 tests PASS。私的合成JSONのCLI再生、元ファイルhash不変、匿名集計のみ、既存report非上書き、repo内出力拒否、壊れた入力とファイルエラーの非漏洩。
- 型/Lint/diff-check PASS。製品全体テストは再実行しない。#85の95分/保存・Native証跡を再利用。
- Native既存証跡：`VoiceRecoveryTest.hundredMinuteInformationQueueKeepsAcceptingAndCompletingEvents`の100分/136通知＋割込み/TTL/古いcallback試験。module tree `7805039ff87407af8315b420ea7f98c4715ba6db`は#85/#89から同一、既成功169件とroute関連16件は重複があるため合計しない。今回再実行していない。新PACE ledgerは別のPacePeriodicLedger等の既成功試験であり、100分legacy通知fixtureが新ledgerの同時長時間検証済みという意味ではない。

### 固定SHAの最終180分試験

`ed117ef`で新規private reportへのCLI実行が成功した（後のmergeは既承認#4のみ）。原本reportは端末backupと同様にリポジトリ外へ保全し、以下の匿名集計だけを記録する。

| 項目 | 結果 |
|---|---|
| 期間/入力/SQLite保存GPS | 180分 / 2,849 fix / 2,137点（通常保存間引きと終了flushを通過） |
| 最新PACEのfake受理 | 179連続slot、重複0。READY 7、DATA_INSUFFICIENT 172。数値案内179回の意味ではない |
| 最後の180分境界 | 15秒確定猶予前に試験を終了するため、未確定slotを推測して発行しない |
| 停止正解ラベル | 48。3秒×12は期間内検出0、8/25/30秒は各12/12 |
| 停止/再開 | 期間内停止検出36、未検出12。検出停止後の再開見逃し0。未対応STOP/RESUME各0 |
| 停止遅延p50/p95/max | 5/25/25秒。goodは5/5/5秒、poorは25/25/25秒 |
| 再開遅延p50/p95/max | 7/10/10秒 |
| PC実時間 / CPU user+system | 128.546秒 / 128.062+0.719秒 |
| サンプルRSS最大 | 316,395,520 bytes（約301.7 MiB）。絶対peak/端末メモリではない |

品質不足を累計へ伝播する現在のPACEモデルに従い、測れなかった区間を後から数値で埋めないため不足slotが多い。正常動作と誤認させず、実走での不足通知の頻度/有用性は#48/#78の評価へ残す。12件の3秒停止未検出はこのアルゴリズムの合成結果であり、実走の見逃し率へ一般化しない。

## 残存制約・Issue境界

実音声、Bluetooth、自然Doze、端末電池/温度/CPU、Native durable ACKとGPS長時間の同時実機評価は未実施。PC CPU/RSSから端末の電池負荷を推測しない。開発用toolを完成しても、実通知欠落#40/#48、Auto Stop改善#28/#43、最後の一括実機#78はOpenのまま。

3秒停止の見逃しや品質劣化時の遅延が再現しても、現在の判定アルゴリズムの観測結果であり、本作業で閾値を変更しない。#49のCloseはtoolの独立承認・最終長時間結果を条件とし、実機受入の代替にしない。Production配布・既存データ操作なし。

独立レビュー：integration_reviewがコード`ed117ef`を限定承認し、最終`ef47c5a6b9cb3abbc4001aea6c8b87f5e431816b`の文書・private最終集計との一致を確認して承認。P1/P2なし。main統合後の#49 Closeを開発toolscopeに限り承認した。レビュー側は3時間試験を再実行せず集計を読取確認した。実機・聴取の承認とは区別する。
