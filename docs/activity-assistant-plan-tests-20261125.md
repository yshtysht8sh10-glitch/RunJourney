# Phase計画・変更予定ファイル・テスト（未実装）

親 #97、関連構想 #13。Phase0だけが今回の作業対象。以下は実装計画であり、実装成功や将来Phaseへの着手許可ではない。[設計入口](activity-assistant-phase0-20261125.md)。

## Issue・依存関係・完了条件

| Phase / 子Issue | 目的・対象 | 対象外 | 開始依存 / 完了条件 |
|---|---|---|---|
| 0 / #98 | ソース調査、TOP/汎用/競技/保存/排他/集計/更新/試験/図・独立レビュー | アプリ本体実装、APK、実機、main統合 | 起点固定。設計と提案を分離、固定SHA独立承認・マスター判断事項を提出して停止 |
| 1a・1b / #99 | 先に所有権/旧draft認識とTOP設定のportを整備、次にTOP階層/タブ/Running入口 | 新用途のGPS稼働・Cycling保存、Running UI刷新 | Phase0承認・マスター実装開始指示後。既存draft優先・mode変更禁止・設定保持・既存Running挙動維持。未実装用途START不可 |
| 2 / #100 | 汎用距離/任意時間/開始停止reset、非保存checkpoint、排他 | 運動履歴/音声/目標/cloud | #99の所有権後。運動DB/音声呼出し0、2重開始/途中終了/復旧/失敗時fence、数値の根拠/欠落表示 |
| 3 / #101 | Cycle DB/設定/計測/速度/背景/履歴/軌跡・用途backup | Running schema変更、追加指標、新cloud | #99/#100の共通基盤後。45km/h超対応・同ID分離・保存先固定・削除等の非干渉・Running regression |
| 4 / #102 | Cycling Auto Stop/5分音声/専用profile | Running閾値変更・PACE移植 | #101後。各速度/停止/坂/欠測/競合/再試行/終了試験とRunning同入力不変 |
| 5 / #103 | TOP読取専用統合履歴/期間summary/filter/詳細 | 二重保存・全GPS展開・統合編集 | #101のmetadata契約後、#102とは独立可能。0件/大量/同ID/時刻/削除再集計/部分失敗を検証 |
| 6 / #104 | 全体回帰・長時間合成・保存照合・Testビルド/署名・独立レビュー・受入計画 | Production、無断install/移行/復元 | #99～#103の実装/指摘修正後。新規版の受入と#93/v38受入を区別しmain可否を判断 |

Owner案からの変更は、Phase1の最初に排他・復旧・独立設定の接続口を置くこと。UIだけ先行してgeneric/cyclingを開始可能にしない。1回1～3 Issueを原則とし、各Phaseは小PRへ分割する。今回の複数子Issue作成は計画登録だけで、並行実装を意味しない。

Phase0設計の概算は調査/文書/独立レビューで1～2作業日相当。後続は1=3～5日、2=3～5日、3=5～8日、4=3～5日、5=3～5日、6=3～5日を粗い目安とする。既存snapshot/factoryの抽出量・実端末復旧・マスターの仕様判断で変動し、確約ではない。全体を書き直す工数は含めない。

## 変更予定ファイル（アプリ本体は今は変更しない）

| Phase | 新設候補 | 既存の限定変更・理由 |
|---|---|---|
| 1 | `src/domain/measurement-profile.ts`、`src/services/session-coordinator.ts`、`src/repositories/top-settings.ts`、`modules/measurement-session/` | `src/app/_layout.tsx`はroot Stack、`top/*`を追加。旧native routeを`(running)/*`へ移動、旧indexだけrunへ。相対import/route修正とTop戻りを最小限追加。既存Web root/互換gate維持 |
| 1～2 | `src/services/measurement-service.ts`、`src/tasks/measurement-tasks.ts`、`src/domain/generic-measurement.ts` | `run-service.ts`開始/停止adapter・task配送fence。Running既定API/動作を維持。新global可変保存先を作らない |
| 3 | `src/repositories/activity-database.ts`、`activity-repository.ts`、`activity-settings.ts`、`src/app/cycling/*` | `run-repository.ts`のstate/queueを必要最小限factory化、`database.ts`はRunning互換facade。`SqliteStore`計算policy引数の追加のみ、schema文字列/version変更なし |
| 3～4 | `src/domain/cycling-profile.ts`、`src/services/activity-voice.ts`、`src/domain/cycling-voice.ts` | `distance.ts/run-model.ts/movement-inference.ts/gps-observation.ts`等へ既定Running引数を追加、全定数経路を照合。Native queue変更を避けprofile-aware recovery境界だけ追加検討 |
| 3 | `src/repositories/activity-backup.ts` | Runningの`sqlite-backup.ts`互換を保持。Cycling envelope/対象検証だけ新設。`sync/*`のremote schema変更なし |
| 5 | `modules/activity-metadata-reader/`、`src/services/activity-history.ts`、`activity-summary.ts`、TOP履歴UI | 新Native read-only port。既存DDL/indexを変更しない。既存更新後のinvalidate接続のみ追加 |
| 全Phase | `src/utils/__tests__/activity-*.test.ts`、Native coordinator/metadata tests、文書 | 既存649件の基準を消したり、失敗を理由なく期待値変更しない。schema変更の必要が出たら先に承認 |

この表は予定のseamであり、列挙した全ファイルを最初に作る指示ではない。既存の小さいcomponent/計算/ページ処理を再利用する。画面関数の全面複製・計測ロジックのUI依存・不要な依存package導入を避ける。

## 合成・単体・統合テスト計画

| 分類 | 重点ケース | 合格基準 |
|---|---|---|
| TOP | OFF2/ON3タブ、時間ON固定、初期化/更新/破損/保存失敗、再起動/OFF再ON | 設定ACK前に画面だけ切替えない。Running/Cycle設定/履歴hash不変。OFFのdeep linkで機能を起動しない |
| route | 全旧URL/relativeリンク/通知入口、Top戻り、Android戻る、PACE dirty/保存失敗 | 旧詳細ID/タブ/操作維持、画面離脱で計測停止しない。Webは従来UI、iOS互換gateを迂回しない |
| 排他 | 3用途の全組合せ、2JS runtime、二重START、STOP中START、旧callback、設定同時変更 | active所有者最大1、保存先誤選択0。cas/generation不一致は明示拒否、誤保存を成功にしない |
| 故障復旧 | 各ACK前後kill、GPS起動失敗、disk full/IO/鍵/不明version、両draft/不整合 | 元draft保全、finish再試行は同ID/同用途のみ。未知状態で新用途へ進まず、欠測の数値補完なし |
| 汎用 | timeOFF/ON、停止/reset、静止/逆順/欠測/受信遅延/品質低下、背景 | 運動DB open/write、運動音声/統計/cloud、既存診断変更が各0。新checkpointは有界、終了後結果はRAMだけ |
| Running | 649件を基準にGPS/Test観測/Auto Stop/PACE/保存/backup/cloud/診断 | 同一入力で既存値・イベント・保存header・音声予定を維持。#93の実走は別未受入 |
| Cycling GPS | 0/0.2/0.7/5/12.5/15/25/30/30.01m/s、teleport、15秒前後gap、1/5秒配信、batch遅延 | 45km/h超の有効走行を保存。候補上限/品質を適用し異常辺は除外、Running出力不変 |
| Auto Stop | 信号/3・5・10秒停止、発進/加速、Uターン、低速登坂、精度不良/速度null | 停止/再開の遅延/誤判定/見逃しを別集計。極低速の限界を隠さず、合成結果を実走正解率にしない |
| 音声 | 5分境界/設定OFF/他音声競合/割込み/再試行/recovery/終了、同ID別競技 | Cycling全経路でkm/h表現、汎用発話0、旧Running優先/ACK/終了取消維持 |
| DB/backup | 同ID両DB、draft/履歴/設定/グループ/trash/保護、誤競技import、型偽装 | 操作対象以外のDB/設定/backupは不変。旧Running backup互換。UI以外のAPIでも競技不一致拒否 |
| 一覧 | Runningのみ/Cycleのみ/0件/混在、同時刻ID衝突、offset付き日時、不正header、片DB故障、編集中refresh | 実時刻順とcompound identity、表示/詳細誤競技0、SQL read-only、GPSロード/期限削除0 |
| summary | 同日2競技、週/月/年/DST/zone変更/日跨ぎ、ゴミ箱/補正/復元、group | 設計の開始日帰属/実走時間と一致。個別指標を単純平均しない。部分結果はcomplete=false |
| 性能 | 10万件header、巨大GPSを持つRUN、順次ページ/中止/WAL、24時間相当GPS | 原GPS読込0、JSページ128/64KiB、可視cache約500、checkpoint32KiB、過大入力/時間budgetで明示中止。性能値は測定後に提出 |

独立レビューで追加した必須故障試験：新規判別evidence前/後・gate空DB作成後・TOP設定ACK前killでも新規/更新が変わらないこと、2runtimeで最終generation検証直後にSTOP/STARTを挿入してもlease drain前に所有権が移らないこと、AutoGoalが自身のlease待ちでdeadlockしないこと、checkpoint ticketの置換/失敗で二重解放しないこと。metadata readerは既承認AndroidX read-only方式とし、破損/WAL/SHM/sidecar/途中失敗でmainと既存WALを削除・変更しないことを合格条件にする。

PC合成試験は一時的な専用DB/アプリsandbox/匿名生成GPSだけを使う。旧データの復元や保持期限起動を手軽な後片付けに使わない。private CLIは既存の正規`ingestLocationBatch`経路をRunning回帰に再利用し、Cycling/Genericにはbindingを持つ新adapterを追加する。シミュレーション記録は通常RUNへ混ぜない。

## 実機受入計画（今回は未実施）

マスターの指示後だけ、使用端末/装着/設定/version/SHAを固定して実施。更新前のRUN/GPS/設定/グループ/trash/保護/診断を非破壊backup・hash照合し、applicationId/署名/version/hash確認後に更新だけを行う。uninstall/clear data/無断復元なし。

画面ON/OFF、背景/Doze、権限喪失、強制終了/再起動、別用途画面への移動、停止保存失敗、Bluetooth音声/物理操作を、自動/ADB合成と別欄に記録。GPS時刻と受信時刻、開始/保存ACK、実音声、CPU/メモリ/I/O/電池/温度を取得可能な範囲で比較する。USB充電中の測定を電池効率の証拠にしない。危険な走行条件の試験を依頼しない。

Test v38は別系統で凍結：ソース`256cea14d8f0afe2bf3c7675b0ed62eb29ee6c44`、APK SHA256 `91d21a12ed9c8a6c711f648dd6cc5723dabd2da48e3de24b10f7f70b2a5b7d34`。#93はその版の実走音声受入までOpen。v38成功を今回の設計/新規版/main全体の受入へ転用しない。

## 段階のゲート

各Issueに実装/テスト/独立レビュー/main/実機/Productionを分けて記録する。固定SHAで独立レビューしP1/P2を修正後に再レビュー。主要統合点だけ全体回帰/Androidビルド、軽微差分はfocused中心。実機未実施を成功扱いせず、Production成果物ガードとデータ保護を維持する。

Phase0は設計の独立レビュー結果とマスター判断事項の提出で停止し、機能実装へ進まない。親#97・Phase1～6はOpen、Phase0 #98もマスターの設計判断待ちと明示する。
