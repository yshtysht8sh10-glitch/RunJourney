# フロー・マトリクス更新比較と品質確認

2026-11-10。実装基準 `f1476f7947779b0fa4aeb28a054efd44255ef0c8`、Test v26基点 `ae701b3c79955df709bf7fef1ba7ae5c29f5267b`。専用branch `codex/docs-flow-matrix-v28`。本変更はユーザー承認を受けた資料整理であり、アプリ変更やリリース承認ではない。[索引](run-flow-index.md)から参照する。

## 変更前後

- Auto Stop正本：旧SHAを「現行」とする冒頭を更新。図Bは正式3状態に整理し候補metadataを注記へ分離。図Cは条件表への参照で簡潔化し実効値との接続を追加。検出条件表は維持。音声の詳細図は図E-1/E-2（配送と本文）へ集約。過去の全44遷移表・診断数値・実走推論・未承認改善案を維持。
- 音声正本：旧332edffの仕様＋v25〜v28追記から、指定v28の本文へ統合。共通/専用チャイム、1kmの独立目標差、START/#62/half/countdown、開始TTL/watchdog、合成後の期限再検査を本文へ反映。過去の実走件数・失敗と未実装提案は維持。
- 旧正本全文：archiveへコピー。元SHAを明記し、相対リンクだけ保存先に合わせた。元の仕様/失敗/追記/SHAを削除しない。現行の正本とは明確に区別。
- 全体構成：索引に版・Production識別、図A/D/Fを追加。図B/CはAuto Stop、図Eは音声へ参照し、6図を一枚に詰め込まない。
- 検証マトリクス：音声の機能一覧から分離。22ケース＋不足5ケース＋未実装/対象外2ケース。対象SHA、初期条件、イベント、期待結果、コード、原文テスト名、実行結果、室内/屋外の証跡、残課題を記載。
- 古い設計資料4本とREADME：本文の歴史を改変せず、最新版への入口と旧情報であることを明示。
- v27目標案内資料：旧「本文中もTTLで停止」を当時の記録とする冒頭注記のみ追加。v28の正本へ誘導し、失敗時系列・SHA・検証結果を保持。

## 根拠と判断

- コード根拠：RunService/Repository、Location Task、run-model/movement-inference、finish-goal、goal-cues、VoicePolicy/RunAnnouncerService、FinishClockService、history-list/history-groups、SQLite Backupを指定SHAで照合。
- テスト根拠：ケース内の原文テスト名とファイルを対応付け。test.eachの展開前名を用いる。自動結果はassertの範囲だけを示す。
- 資料根拠：field v26、goal-cues v27、goal-cue-screenoff v28の室内実機・保全報告。原GPS/Backup/音声私有データを再取得・再照合したという意味ではない。
- GitHub根拠：2026-11-10照合時点でPR #67/#70はDraft・未マージ。main `626f4be`を導入済みProduction APKのソースだと断定しない。
- 独立レビュー：同一HEADで本チャットのレビュー担当がJS515/Native69/SQLite15と追加5競合・2000モデルサンプルを確認済み。これは過去資料の「未実施」を遡及して書き換える理由ではなく、日付付きの追加記録として扱う。

## 品質確認

2026-11-10、アプリコードが基準SHAと一致する元worktreeで再実行。実行環境はPC、合成データ/隔離SQLite/Robolectric。ユーザー端末・実データを操作せず、実走は行っていない。

- `node node_modules/jest/bin/jest.js --runInBand --json --outputFile=...`：67 suites / 515 tests成功。ケースに紐付けたJSファイルはすべて実行済み。
- Android：`gradlew.bat :run-announcer:testDebugUnitTest --rerun --console=plain`、69 tests / failures 0 / errors 0。初回のUP-TO-DATE表示を実行扱いせず、test taskだけ強制再実行した。
- `node --test scripts/sqlite-native.test.cjs`：15 tests成功。
- `npx expo lint`、`npx tsc --noEmit`：成功。
- STOP保存テスト等に既存のfinished mock不足による警告あり。保存成功のassertと終了TTSの確認を区別し、マトリクスRUN-02へ明記。Gradleのdeprecated警告はアプリ機能成功の根拠に含めない。
- 旧正本2本は基準SHAから取得した全文と、archiveの相対リンクを元へ戻した本文が完全一致。Auto Stopの過去44遷移表・改善候補、音声の過去実走/失敗/全追記も保持。
- Markdown相対リンク・見出しanchor 198件を検査。ケースID29件の重複なし。既存テスト原文名49参照のファイル/文字列存在と、対応テストファイルの実行結果を確認。
- Mermaid CLI 12.2.0とローカルChromeで、変更ファイル中の現行/歴史資料13図をSVGへレンダリング。現行8図（A/D/F、B/C/停止予告、E-1/E-2）はPNGでも描画して目視確認。音声図を配送/本文に分け、正式3状態と候補metadataを分離した。GitHubサーバー上の個別レンダラー差は追加確認の余地がある。
- 生成SVG/PNG・検査JSON・テストログは `D:/working/RunJourney-docs-v28-qa/` にローカル保存し、PRへバイナリや原データを追加していない。文書検査のスクリプト/依存もrepoへ追加していない。
- 基準SHAとのコミット差分がMarkdownだけであることを確認。アプリコード・テスト・依存lockfile・設定は不変。


## 残る未整合・未検証

- 導入済みProduction APKの最新ソース対応は未確認。旧READMEの導入手順・旧ストレージ表記は本文を歴史説明として残し、今回の版定義で囲う。全面的な導入ガイド刷新は範囲外。
- 日付付き資料内の「正式レビュー前」「当時の現行」は当時の事実として維持。最新状態は索引/本記録/検証マトリクスを優先する。
- GAP-01〜05（half TTL/watchdog、GPS鮮度、64種類上限、全phase音声競合、preview→実RUN結合）の追加テストは未実装。優先度と既存Issue追記/新Issue提案はマトリクス参照。Issue作成/Closeは行わない。
- 実GPS/長時間画面OFF/実RUN停止再開/Bluetooth・交通騒音・ユーザー聴取の屋外受入は未確認。室内の9本文や自動515件から実走成功を推定しない。
- 正式RunState、候補metadata、保存のfreeze、Native音声状態は別の概念。図中の便宜名はAPI状態の追加ではない。

## ユーザー確認までの扱い

PR #70の指定HEADをbaseとする別Draft PRで提示し、base branchやPR #67/#70は更新しない。差分はMarkdownだけ。Production反映、アプリコード/テストの実装、merge、Issue Closeは行わない。正本更新の採否と確定はユーザー確認後とする。
