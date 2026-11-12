# OpenComm2 / 11月14日マーカーPoC — 実機受入記録

PR #76。音声キュー全面改修とは分離。**v34実機の短時間受信ゲート完了。スマホ単独接続で実走評価に使用可能。正式独立レビュー・実走受入は未完了**。基点はTest v32統合7ce9609、現行RUN実装は3dc5d83。通常RUN保存、GPS頻度、Auto Stop、目標達成、既存音声条件/優先度は変更していない。

## 実装

- Android Test package完全一致、明示開始、初期OFF。試し押し（10件/15分）と実走（最大3時間）は別の暗号化ファイル。
- RUN開始前にマーカーのみ開始し、RUN終了後にマーカーのみ終了。RUN保存へリンクを書かず、別セッションのwall/elapsed/uptimeとRUN時刻をローカルで対応させる。
- STOP/RESUMEは本人のボタン押下を交互に記録。GPS/Auto Stopから選択しない。実際の身体停止、押下、Bluetooth配送、端末受信は同時刻と保証しない。
- 実開始チャイム1回とpaused MediaSession。無音トラック、虚偽PLAYING、強制経路変更、マーカーからのfocus取得、RUN操作/音声停止への転送なし。
- Native worker、別Keystore alias/AES-GCM、連番/ハッシュ鎖/END、1セッション2MB・合計10MB。既存記録を押し出さず、上限でマーカーのみ失敗にする。プロセス死/切断/上限は不完全。
- MARKER後にACKを記録。ACK.elapsed−MARKER.elapsedは受付～暗号化/書込み完了の指標。物理押下前の通信遅延は含めて測定できない。
- Testの通常音声ログは`voice-log-marker-v33`へ新規保存。v34でも同じ新規側を使用する。旧`voice-log-v2`・11/12診断は削除/移行せず保持。従来20MBの保持方式そのものは変更しない。
- UIはマーカー画面にfocusがある間だけ状態をpollし、ラン画面へ戻ると停止する。Test限定のbounded wakelockを使用し、電池増分は未測定。

## 途中結果と修正

|試験/観測|結果・扱い|
|---|---|
|隔離helper、初回無音|1押下に対し記録0。標準音楽アプリが配送先だった。採用不可|
|開始音後の隔離helper|配送先はTestへ変わるが未受信例あり。安定としない|
|画面OFF、初期重複除外|物理10回のDOWN/UP 10組が届くが採用1。全キー時刻0を同一とするPoCバグ|
|時刻0修正|UPで押下状態を解放、時刻0はseenへ登録しない。JVM 2,084 assertions成功。受信時刻のみと明記|
|修正後3分枠|6回受信後に枠終了。残りを機器欠落とは数えず、15分へ延長|
|修正後・画面ON/無音|実押下10→採用10、keyup10は不採用、重複0。本人は別再生なしと回答|
|修正後・画面OFF/隔離プロセス|実押下10の回答に対し未受信。通常foreground serviceと同じ条件で再検証が必要|
|ADB合成control|受信器の確認として1回だけ注入。物理押下の受入件数へ含めない|
|Test v33通常サービス|開始前の暗号初期化でFAILED/0件。`InvalidAlgorithmParameterException: Caller-provided IV not permitted`。RUNやGPSへ波及なし|
|v34修正|`Cipher.init(ENCRYPT_MODE,key)`のprovider生成IVを使用。randomized-encryption設定は維持。JVM file roundtrip/認証/欠落/容量/END、実機Keystore roundtripと改変拒否に成功|
|v34保存系の実機確認|別ファイルでソフトウェア入力2件。MARKER/ACK各2、START/ENDを含む6レコードを保存し、プロセス再起動後に実機Keystoreで認証/復号。連番/ハッシュ鎖/END一致。物理ボタン受入には含めない|

v33のCrypto失敗はJVM用SecretKeyでは再現しなかった。JVM成功とAndroid Keystore成功を区別する。v34は暗号修正を含む別候補で、保存/受信/聴取の実機ゲートはこの修正後APKで確認する。

## 実機ゲート（途中結果）

1. **v34合格・前景/無音**：スマホ単独接続、実10回→MARKER/ACK各10、重複0、別の音声開始なし。認証/連番/ハッシュ鎖/END一致。
2. **v34合格・画面OFF/無音**：実10回→MARKER/ACK各10、重複0。全10件の受信uptimeが端末の画面OFF時刻以後、回収時Dozing。認証/連番/ハッシュ鎖/END一致。
3. **v34合格・画面OFF/音声中**：実10回→MARKER/ACK各10、重複0、認証/連番/ハッシュ鎖/END一致。全10件が画面OFF後かつ本文STARTED〜DONE内。既存Nativeキューのsimulation通知1件はQUEUED→チャイム→STARTED→DONE、本文28,046ms、中断/失敗なし。本人も10回操作・最後まで聴取を確認。実RUN音声との同時動作は未検証。
4. **v34合格・非メディア画面切替**：本人がAndroid設定画面で実10回操作、MARKER/ACK各10、重複0、認証/連番/ハッシュ鎖/END一致、別再生なし。実走モードで本人が2回操作しSTOP→RESUME、MARKER/ACK各2を認証。OpenComm2電源OFF後はHEADSET_ROUTE_REMOVEDでEND、storageComplete=true/complete=false。切断を正常完了とは扱わない。別の音楽/通話が配送を奪う条件は安定と扱わない。
5. 端末Keystoreでファイルを認証/復号し、MARKER/ACK各10、連番/ハッシュ鎖/END/件数一致、余分なマーカー0を確認。

短時間の受信・保存・音声非中断ゲートは完了。実GPS/通常RUNの長時間同時動作は実走評価として扱う。失敗時は受信条件を無理に偽らず観察試験へ縮小する。ユーザー確認待ちや試験枠外は、機器欠落/成功へ数えない。

## 保全・回帰の途中結果

- 更新直前55 RUN、GPS 23,866点、ごみ箱18件、進行中RUNなし。中断前からの全snapshot一致。
- v33上書き直後も全snapshot一致。RUN/GPS/設定/グループ/保護情報の削除・復元なし。
- v33失敗とKeystore検証後、診断39ファイル・旧音声78ファイルは同一集合/同一bytes/SHA256、変更0。
- v34ソース：JS72 suites/546件、Native96件、SQLite15件成功。型/Lint成功。原GPS/経路/鍵/Backup/端末生ログはGit/CIへ追加していない。
- v34更新前後・全実機ゲート後の照合は継続する。Production APKは変更していない。

## v34実走評価用Test APK

- APK実装SHA：`c035fa9`。署名は既存Testと同一（SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`）。package `app.runjourney.mobile.test` / versionCode 34を実APKから確認。
- APK SHA256：`0847c50888aff6c2dfe810332c7ff9d003d848e7fefcc7b94bd64803532afae6`。
- EAS：[検証ビルド](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/a98b455d-5c71-4988-b215-972daa1d1c95)。端末へ保全・署名照合後に上書き導入済み。実走用の受入完了を意味しない。
- v34更新直後の全snapshotが更新前と一致、進行中RUNなし。物理ボタンの前景/画面OFF/音声中テストは各10件成功。非メディア画面切替とSTOP/RESUME・切断のゲートも完了。
- 受信の実機試験はスマホ単独接続を基本とし、PCとのmultipoint接続の有無も確認する。条件が不明なら「スマホ単独で合格」とは扱わない。
- `complete`/`SEALED`はファイルを閉じた結果であり、すべての身体停止や物理ボタンを採取できた証明ではない。押下数・受信数・聴取結果・時刻誤差を別に評価する。

## 7km用操作手順

入口は **設定 → Auto Stop Diagnostics（Test）→ 実停止マーカー（OpenComm2 Test PoC）**。

1. 開始前に「試し押し」でボタン受付と保存件数を確認する。試し押しは実走とは別記録。
2. 「実走マーカー開始（START前）」を押し、開始音と「ボタン受付中」を確認。ラン画面へ戻って通常START。
3. 安全な1km付近で実際に止まったら1回、走り出すときに1回。停止/再開音声をボタンの基準にしない。
4. 7kmは目安、RUNは手動終了。最後の再開後に通常STOPし、保存成功後にマーカー画面で「マーカーのみ終了」。
5. データを消さず解析へ。押し忘れ/通話/切断は申告し、その区間を正解扱いしない。

OpenComm2はスマホだけへ接続し、他の音楽アプリや通話を併用しない。切断後は記録が終了するため、その区間以後を連続した正解ラベルにしない。現在の切断試験ファイルはそのまま保持し、実走前には新規の実走マーカーを開始する。PACE定期化・時計待機・音声キュー全面改修は本APKに含めない。正式独立レビュー/実走受入前はDraft・未マージを維持する。

### v34物理試験の保存遅延（参考）

MARKER受付から当該レコードfsync後ACK時刻まで：前景15〜18ms（中央値15）、画面OFF16〜30ms（29）、画面OFF/音声中17〜32ms（25）。ACK自体のfsync時間と物理押下からBluetooth配送までの時間は含まない。原記録はローカルのみ保管し、公開資料には集計のみ記載。

### 4条件終了後の保全確認

全snapshotは更新前と一致（55 RUN、GPS 23,866点、ごみ箱18件、進行中RUNなし）。設定/グループ/保護情報も含む。診断39ファイル・旧音声78ファイルは集合/bytes/SHA256すべて一致。削除・復元なし。Android設定画面試験の保存遅延は14〜17ms（中央値15ms）。40回の物理操作を4本の別ファイルで認証したが、実GPS/通常RUNとの同時動作や長時間電池負荷は未検証。

### 最終保全・残る評価

切断試験後の全snapshotも更新前と一致。55 RUN/GPS 23,866点/ごみ箱18件、進行中RUNなし。診断39・旧音声78ファイルも不変。型チェック/Lint再確認成功。身体停止から押下までの本人反応時間、Bluetooth配送遅延、実GPS/通常RUN同時の長時間安定性、電池増分は未検証。マーカーをAuto Stopと独立した参考ラベルとし、押し忘れ/誤操作を確認して評価する。

[実走評価用Test v34 APK](https://expo.dev/artifacts/eas/-WJWz3YObIKVvKTiKwDI1g9h0Rj4qEUKvHI8duuYcbY.apk)。導入済みと同一ビルドのため再更新不要。
