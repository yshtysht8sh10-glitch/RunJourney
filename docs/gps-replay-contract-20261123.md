# #49 PC受信順リプレイと最新PACE契約の補完

基点main `116af45`（#88統合）。本差分は`src/test/`とJest専用であり、製品のGPS入口・取得要求・判定・保存・Native音声を変更しない。既存シミュレーター95分と長時間保存の成功は[#47/#49照合](issues47-49-acceptance-20261123.md)を再利用する。

## 追加した範囲

`GpsBatchReplay`は`{receivedAt, appState, locations}`の配列を受け、**受信順・batch境界・fix順・重複・遅延fixを並べ替えず**返す。受信時計は非減少、開始時刻以上であることを要求する。fixの品質判定は実adapterに委ねる。最大20,000 batch/100,000 fix、入力と出力のコピーにより呼出し側との参照共有を防ぐ。pauseで時計を進めず、stepで次の受信時刻へ進む。

これはtypedなPC入力部品で、未検証JSONのparser/ファイルCLIではない。実ログの壁時計逆転を補正する実装でもない。今回は合成入力だけを使い、原GPS・経路・鍵・backupの取得/送信は行っていない。将来private CLIを追加するときは入力制限/匿名化/座標を出さないエラーとreportを別途検証する。

## 検証

`gps-simulator-contract.test.ts`:

1. 6分seed49の通常走行→25秒停止→低速再開を、active/backgroundの受信状態付きbatchとして生成し、replay→`ingestLocationBatch`→実repository/detector/Pace Analysis/VoiceAnnouncement/PC Native SQLiteへ通す。初回設定handshakeと最新`pacePeriodicVersion=1`/cursor契約をfake Nativeで受理する。5区間以上、境界固定、連続slot受理、重複なし、READYあり、旧20秒TTLなし、保存済み履歴隔離・入力不変をassert。
2. fix順が逆/重複の入力をそのまま返すこと、pause時計、input/outputの独立コピー、終了、開始より古い受信時計の拒否を確認する。

このNativeは**非永続の受理cursor fake**で、Android ledgerの永続ACK/再生/音声フォーカス/聴取を検証していない。PACE ledgerのAtomicFile永続化と#72の暗号診断を区別する。6分試験も自然なOSバックグラウンドやDozeではない。新契約を通ったJS→SQLiteの合成証拠として、旧capability fallbackだけだった従来95分試験を補う。Nativeの既成功fixtureをこのfakeで置き換えない。

実行：`npx jest --runInBand gps-simulator-contract.test.ts pace-periodic-voice.test.ts --silent`。型/Lint/diff-checkも実施する。製品全体/95分/Nativeの不要な再実行はしない。

結果：上記2 suites/9 tests、型/Lint/diff-check PASS。独立レビュー担当integration_reviewが固定SHA `0538543`を限定承認し、新規2 testsも独立再実行PASS。追加P1/P2なし。これはNative永続化/実機受入/Issue全体のClose承認ではない。

## Open維持する条件

#49は今回もCloseしない。数秒停止/再開・数時間GPS一貫試験、匿名入力private CLI、品質別/停止・再開・見逃しの統一メトリクスとメモリ計測が残る。最新Native ledgerとの長時間統合と実音声は別の検証段階。PC helper追加だけで元Issue全体の要件を満たしたとは扱わない。

#47の実Android操作/START適用受入もOpen維持。本人操作は最後の一括評価まで依頼しない。次は#49残条件を小さく補完し、履歴表示設定#4等のAndroid不足を依存順に進める。サイクリング、未承認判定変更、外部AI送信、Production配布は対象外。
