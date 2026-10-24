# #31 / #38 / #33 / #36 統合実装・実機検証

## 調査と保全

開始時HEAD bc1c9c7、作業ツリーはクリーン。fetch後mainは626f4be、HEADはmainに32コミット先行・遅れなし。既存Draft PRは#34 → #35 → #37の積上げ。本変更は#37ブランチをbaseとする別ブランチ codex/goal-finish-stop-31-38。Issueは全てOPENを維持。

Expo ~57.0.25を確認しSDK57 Location/TaskManager、Modules API、RN PressableとEAS docsを参照。追加依存なし。ProductionとPace分離環境は操作しない。

新規保全先: `D:\working\RunJourney-preservation\integrated-20261024-1f5293b5`。
Git全refsのbundleを作成・verify成功。Testの元APKを端末から保管（SHA256 cb735bb13a5f72159b0a0d8b436b50d053aff5c5c5044d9f5b24989fec67c9f3）。Testから新規標準Exportを作り、端末/PC SHA一致（86a38a546902de558aef91c2491dd8f7c0c3523be3645a14145a027d78fcb19f）。アプリと同じdecodeBackupで内部SHA・構造を検証、別SQLiteに復元し全snapshotのcanonical一致・integrity_check=okを確認。37履歴、13,701 GPS点、draftなし。全設定・ごみ箱・保護IDも比較対象。私有原本と復元DBはGitに追加しない。

## 添付実走ログ

version1、entries561行、verification561行、通知ID226個。記録範囲2026-10-22 20:08:42.134〜2026-10-23 02:05:42.877 JST（旧LEGACY音声2件を含む）。時刻が違う同一IDのQUEUED/STARTED/DONEは重複イベントではなくライフサイクルとして集約。

| 種別 | ID数 | 再生開始 | DONE | 期限切れ | その他 |
| --- | ---: | ---: | ---: | ---: | --- |
| 停止候補検出 | 14 | — | — | — | 全14候補に取消記録 |
| 停止予告 | 10 | 5 | 4 | 5 | 停止確定割込み1 |
| 予告抑制 | 4 | — | — | — | 30秒クールダウン |
| 自動停止確定 | 25 | 21 | 21 | 4 | |
| 自動再開確定 | 25 | 20 | 20 | 5 | |
| 5分 | 30 | 26 | 24 | 0 | 確定割込み2、優先通知直後抑制4 |
| 1km | 20 | 20 | 20 | 0 | |
| ペース警告 | 81 | 64 | 64 | 2 | 優先通知直後抑制15 |

確定事項: 予告は最初の1回だけではなく再検出・再生成されている。期限切れ予告5件は、JSのqueuedAt→最初のnative auditまで4,087 / 4,695 / 5,079 / 5,315 / 11,168msで、4秒TTLを既に超過。nativeキュー投入以前の遅延であり、native待機列の渋滞だけでは説明できない。再生した5予告のnativeキュー待ちは7〜1,271ms。停止/再開の未再生9件もEXPIRED。最初の予告は高優先の停止確定で中断。候補再許可フラグが永久に残る証拠や、過剰なID重複排除の証拠はない。

仮説: 保存キュー待ち、JS計算、同期native呼出し、バックグラウンドのOSスケジューリングが遅延を増幅した可能性。ログにAppState/CPUトレースがなく、寄与率やOS起因を断定しない。生成時刻は旧ログでは専用欄がなく、queuedAtはJSペイロード作成時刻として扱う。音量・イヤホン聴取は不明。DONEはTTS完了であり聴取成功ではない。

`node scripts/analyze-voice-log.cjs INPUT NEW_REPORT` で再集計可能。私有分析JSONに全IDのJS投入/native投入/開始/終端/待ち時間/期限/優先度を保存。既存verifyVoiceLogも561行全てを再計算しfalseは0。IDで集約した確認可能な貯金・停止除外・全体予測224、5分ペース/フル換算30、ラップ/ラップ貯金/発話時間20は全て整合。元GPS精度や未取得データの正しさは証明しない。

## 実装

- STOPゲージの30ms時計が1.5秒成立判定と発火を兼ねる。早いonLongPressの一度きりの判定失敗を同じ時計で再評価。コールバックは最新propsを参照。release/AppState/disabled/unmountは取消。
- prepareFinishをGPS書込と直列化。GPS停止の非同期待ちより先に終了snapshotを固定・保存。finishActiveRunとSQLite completeの既存一意ID/トランザクションを再利用。初回保存失敗もRAMの固定snapshotを再試行し、確定draftがあれば再起動後も同じ終了時刻を使う。履歴保存失敗時にGPS/音声を再開しない。
- 終了条件は独立した設定キーでmanual（既定）/distance/timeの一択。START時にRunRecordへsnapshot化。ペース走設定だけでは終了しない。
- 距離は既存effectiveEdgesの品質判定・実走時計で補間し、原GPSは変更しない。日時のミリ秒表現では目標に到達した最初のミリ秒を選び、最終1kmが欠ける丸めを防ぐ（最大1ms相当の距離差）。時間はtimeModelからAuto Stop/Breakを除外し、遅延通知でも到達時刻に戻して保存。
- Android時間目標では独立したlocation foreground serviceの1秒native pulseとJS intervalを使用。音声OFF/GPS更新なしでも、JS実行環境が存続する限り共有時計で終了判定。重複pulseはcoalesce。端末/OSによるプロセス強制終了中のリアルタイム実行は保証せず、再起動で元時計から評価する。iOSのサスペンド中の正時発火は未検証で、Android Test向け実装と区別する。
- 保存成功後だけ画面を完了にし、達成音声をpriority110で送る。音声失敗は保存成功を取り消さない。履歴の追加メタデータに終了条件と到達入力を保持し、結果画面/詳細のレポートで達成理由を表示。旧履歴は追加欄なしでも読める。
- 音声更新の待機を最新snapshotへcoalesceし、RAM観測読出しをSQLite書込待ちから分離。設定I/O待ちの後に鮮度を判定。notifyBatchを非同期native APIへ変更。予告80は通常ラップ70/5分40/警告20を中断でき、確定100/達成110を優先する。TTLは延長しない。
- native再生直前にもrunId/候補有効性/状態/最新イベント番号/終了済みを確認。候補取消、再開、終了で古い待機・再生中音声を破棄。満杯時は重要通知のため低優先通知を退避せず破棄し理由を記録。古いTTS開始callbackを無視。終了後に届く旧batchも拒否。
- 終了開始/成立/保存成功/失敗/競合/手動長押しと音声状態・待ち時間・破棄理由は既存の20MB/20,000イベント/7日journalへ記録。座標を追加せず、自動外部送信もしない。

## 検証と配布

自動テストとAPK・実機結果は後続の追記で記録する。長時間実走、5km/60分の実距離・実時間、停止の体感、イヤホンでの聴取、低速往復/ノイズの誤予告率は次の実走受入事項。自動テストや短時間の端末操作を実走完了とは扱わず、関連Issueは閉じない。
