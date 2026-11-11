# PR #73 初回レビュー後のTest端末検証計画（2026-11-11）

対象：第1段階 f364d008。実停止マーカー、削除、raw Export、F比較は追加しない。音声マトリクスおよびPR67/70/71/74/main/Productionを変更しない。初期測定用のTest限定人工入力ハーネス、統計、seal/再現別表示だけを追加する。元RUNを作らず、Keystore/Native暗号化ファイルだけを検証する。

## 検証前に固定する基準

1. 実端末AndroidKeyStoreの非export鍵で採取→Native SEALED→認証付き復号が成立する。short/pacedの現行判定再生はmismatches=0。Native sealとJS再現一致を別判定する。
2. 人工入力のOFF/ON/受付拒否で観測数・判定・GPS選択の最終digestが一致する。診断拒否後も全入力を判定する。通常SQLite保存/OS GPSの非干渉は既存テストと実機の元DB前後照合を別証拠にする。
3. 1HzのNative pulseでJS引渡しp95<=10ms、処理p95の増分<=max(5ms,OFF p95の20%)を暫定閾値とする。shortのバルク入力値と実時間1Hzを混同しない。最大値、件数、pending高水位、Native暗号化+fsync/待ちのp50/p95も出す。ヒストグラムは0.1ms刻み、200ms以上はoverflow、最大は正確。
4. 95分相当5700入力を欠損なく採取できることを暫定の連続採取目標とし、保存容量/採取可能時間を推定する。上限時の安全停止が成功しても、この連続採取目標が成功したとは扱わない。Native worker待ちはハーネスだけで明示throttleするため実時間95分の電池/温度/OS GPS遅延の試験とは扱わない。64MiBが先に達した場合は通常の判定を継続し、診断をINCOMPLETEとする。時間/件数/容量を結果に残す。
5. ページごと全再走査するreaderはまず60秒予算で測る。完走しない場合は未完了として読み出せた件数・ページ数・時間を記録する。認証読出し完了と現行判定一致を混同しない。
6. 画面OFFのON/OFF各25回Native pulse採取が進み、sealと再現が成立する。アプリ強制終了後は自動ONでなく、既存暗号文の再読出しができる。ENDなしの記録は不完全。端末本体再起動/強制Doze/屋外実走は実施の有無を明示する。

## 方法と安全

診断画面のTest専用操作からshort（240秒相当）、paced（ON/OFF各25秒/1Hz、ON時のAppState列をOFFにも適用、JSタイマーで駆動しない）、long（95分相当）、failure（25番目のoffer拒否）、crash（途中でadb force-stop）を実行する。通常RUNがある場合は拒否する。緯度は人工の0付近、経度0、RUN IDも固定の人工識別子。入力・暗号鍵・復号ページはShare/console/CIへ出さない。結果は座標を含まないDETECTOR_DEVICE_PROBE診断のみ。長時間入力は通常RUNリポジトリを呼ばず、共通GpsObservationSession/detectStop/recorderを使用する。このためOS受付・Repositoryキュー・checkpoint性能まで測れたとは扱わない。容量推定の分母は判定を継続した入力数ではなくNativeの書込成功INPUT件数を用いる。

新しいNative検証clockは既存FinishClockServiceのpulseを利用し90秒上限。通常RUN clockと音声previewの30秒上限は維持。計測のためだけに診断の容量やNative workerを変更しない。集計自体のコストもON測定に含む。

更新前Backup/全保持音声/旧Test APKをPC私有フォルダーへ保存し、隔離SQLite復元と整合性を確認してから上書き更新する。診断試験終了後に全Backup snapshot、RUN/GPS/ごみ箱/設定/グループ・保護、Production APK SHAを比較する。検証RUNの削除・ごみ箱・保持期限処理は起動しない。

結果と制約は実施後追記する。自動テスト/室内人工入力/屋外実走を別扱いにし、初回レビューをIssue72全体・製品採用の承認としない。Draft/未マージ/Issue OPENを維持する。


## 実施前の準備・待ち条件（2026-11-11）

- 初回レビューPRR_kwDOUxawB88AAAABXGOgLwを確認。実施前に[測定方法・暫定基準](https://github.com/yshtysht8sh10-glitch/RunJourney/pull/73#issuecomment-6772766736)をPRへ記録。
- 専用worktree/branchでTest測定操作・0.1ms固定ヒストグラム・Native保存成功INPUT件数・失敗分類・seal別表示・JS_SUBMITTED_ONLY表示を追加。runtime実装SHA e200ead899f58227cc3911c48c07d2bca9a867c8。追加の試験/資料はその後のcommit。判定条件・通常RUN保存処理はf364d008から変更なし。
- 最終JS69 suites/534 tests PASS、Native82 tests PASS、実SQLite15 PASS、型/Lint成功。追加試験はNative pulseのみのON/OFF同一入力、受付拒否後の全処理継続、固定ヒストグラム、書込成功時だけINPUT件数を増やすことを確認。自動成功を実端末成功に読み替えない。
- 接続中にSO-51B/Android13、USB給電、電池100%、温度27.0℃を記録。before.json SHA256 f3d7facd044afdf04c7993b73bb25b12aba2fcfcaa73f76890e114d98500e0d7、54履歴/ごみ箱18/GPS22512点/設定11/draftなし。隔離SQLite roundtrip一致・integrity=ok・外部キー違反0。
- 旧Test APKと全保持音声ログを私有保存。voice-before.json SHA256 3f0b34dbdb56ab94dbf25a1cc0e74eba68bd4cb150b969b1399914977def4d84。Production APKの更新前SHAも私有記録。原GPS/Backup/音声ログはGit/EAS/CIへ追加しない。
- 私有証跡先：D:/working/RunJourney-preservation/issue73-device-20261111/。
- 配布予定Test v29の[EAS build aa7f778b](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/aa7f778b-5d4a-448e-b05a-63facfeec546)はIN_QUEUE。保存件数の測定修正前のf85d7526はCANCELED・未配布。APK導入はまだ行っていない。
- 途中でADB接続一覧からTest端末が消え、2回確認して接続なし。ユーザーへUSB再接続・必要時のロック解除/デバッグ許可を依頼済み。接続再開後は実RUNがないこと、更新前データの変化を確認し、新しいpreinstall Backupを取得する。ユーザーの新しい走行を古いsnapshotへ戻さない。

### 現時点の未実施

実端末Keystore作成/復号/seal、実機ON/OFFのp50/p95、高頻度長時間負荷/容量上限、reader実時間、画面OFF・背景、アプリforce-stop後のOFF/復号、更新後snapshot比較は未実施。端末本体再起動・強制Doze・実GPSのOS受付/Repositoryキュー/保存失敗再試行・長時間実走・電池/温度/PSSの影響は別受入。いずれも合格扱いにしない。

接続とビルドが揃ったらshort→long→failure→crash/reopen→paced（無音、ON/OFF各25秒）を実行し、位置を含まない集計のみPRへ追記する。readerの60秒予算はページ境界の目安で、実行中ページは強制中断せず実測時間を報告する。履歴・GPS・ごみ箱・設定・グループ/保護の全snapshot、APK署名/ID/versionCode/ハッシュ、Production SHAを更新後に照合する。

PR73はDraft・未マージ、Issue72は未Close。Production配信なし。PR67/70/71/74および音声HTMLの並行作業は変更しない。

## 実端末の途中結果

EAS待機中に、同じKotlinストレージを組み込んだ別パッケージの計測用Instrumentationで、Android 13のTest端末を検証した。位置は人工入力のみ。

- AndroidKeyStoreのエクスポート不可鍵で暗号化し、seal後に2レコードを認証・復号。アプリプロセスの強制終了後にも同じファイルを復号できた。END前に終了した別セッションは18件を認証でき、未完了のまま復元され、新規入力の受付はOFFだった。
- 画面OFFのNative試験では、テスト用wake lockで1Hzの25件すべてを画面OFF中に処理し、sealに成功した。
- 16KiBの人工ペイロードで4,026件、67,095,042バイトを保存・認証した。次の書込みを容量上限で拒否し、未完了と記録。書込みは50.510秒、append p50 12.2ms、p95 15.0ms、最大35.19ms。全件認証を伴う最初の読取りページは58.021秒。後続ページを含む再生時間、実GPSの容量、電池負荷は別測定。
- Native workerに意図的なI/Oエラーを発生させると、失敗分類は WRITE_OR_CRYPTO、状態は INCOMPLETE、保存成功INPUTは0件。通常RUNの継続はJS統合テストで確認済み。端末のアプリ内経路は別途測定する。
- Native試験後・v29更新前のバックアップを正規化して照合し、元のRUN・GPS・ごみ箱・設定・グループと保護情報を含む全snapshotが一致。実行中のRUNドラフトなし。
- EASが完了し、既存Testと同じ署名・パッケージであることを確認してv29を上書き更新した。初回インストール時刻は維持。APK SHA-256 e0e36f42560fe6b356c2a2d1675c7d40221e0a48cf68ef22559321699f48b277。アプリ内検証と更新後の全snapshot照合は端末の再ロック解除待ち。

## v29アプリ内の検証と読取り改善案

- 更新後の全バックアップを更新直前と正規化照合し、RUN 54件（ごみ箱18件）、GPS 22,512点、設定11件、グループ・保護情報を含む全snapshotが一致。ドラフトなし。復元・削除操作なし。
- 短時間試験（人工入力240件）。判定処理OFF p50/p95/最大は0.59/0.89/1.60ms、ONは1.84/2.65/5.16ms。JS引渡しp50/p95/最大は0.2/0.4/1.72ms。結果digest一致、Native保存240件、拒否0件、seal成功、全240件の再生に不一致なし。バースト時のNativeキュー最大481.35ms、p50/p95は測定ヒストグラム上限200msに到達。1Hzでの合否は別測定。
- 25番目のJS引渡しを拒否した試験では、診断は入力6件を保存してINCOMPLETE、判定処理は全240件を継続しOFFと結果digest一致。OFF p50/p95/最大0.60/0.90/1.43ms、失敗注入ON 0.99/1.77/2.17ms（失敗前後を含む全件集計）。再生はMISSING_ENDとNATIVE_NOT_SEALEDを報告。この拒否はJS側で注入しており、Native書込み障害は先行試験で別に確認した。

### 読取り方式の提案

現行のreadJournalは返却ページが埋まった後も、末尾まで各フレームをKeystoreで復号し、連番とハッシュチェーンを検査する。次ページでも先頭からやり直すため、全読取りはページ数×フレーム数の復号・検証となる。58.021秒は約67MBを認証して最初のページを返した実測で、全ページ完了時間とは異なる。

Native側の逐次カーソルにセッションID、セグメント位置、次の連番、直前のハッシュを保持し、各フレームを一度ずつ認証する案を推奨する。既存のページ件数・バイト上限を維持し、完了判定は末尾到達、END検査、sealハッシュ一致の後に限定する。読取り中の書込み・削除との排他、キャンセル・期限切れ・プロセス終了時の解放を設計する。カーソルはプロセス内の不透明な識別子とし、失効時は先頭から再開する。ジャーナル形式・暗号・容量上限の変更は提案範囲外。

テストは現行readerとの順序・件数・再生結果の一致、ページ境界のフレーム欠落・重複、セグメント欠番、暗号文改変・切断、END欠落、seal不一致、キー不一致、取消・期限切れ・再起動、読取り中の並行操作を含める。実端末で短時間・95分相当・上限近傍の人工データを使い、初回ページと全ページ完了時間、復号件数、メモリを比較する。
