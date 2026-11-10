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
