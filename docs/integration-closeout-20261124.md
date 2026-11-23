# 既存成果物のmain統合整理（2026-11-24、#78）

## 現在の決定と状態

マスターは「既存Issueの全完成」を着手条件から撤回した。今回の目的は既存成果物を棚卸し・必要な統合・重複整理し、サイクリングの起点mainを確定すること。未着手機能や実機受入を管理都合で完了にしない。サイクリング用ブランチの作成・実装はマスターの次の指示待ち。Ownerは方針/進捗管理、開発担当はCodex、独立レビュー担当は固定SHAの品質検証を担う。

棚卸し基準はmain `256cea14d8f0afe2bf3c7675b0ed62eb29ee6c44`（#94）。承認済みTest v38 APKもこのSHAに固定する。今回のmain整理でAPKを差し替えず、端末更新もしない。Issue #93はこのAPKによる実走音声受入までOpen。

## 未マージPR：追加コードなし、管理終了候補

次の13 headは基準mainの祖先で、mainに対する未統合コミット0。これだけを動作完了の根拠とせず、#85の依存/保存境界・Native tree一致・テスト/独立レビューと、後続#86/#87/#94の置換記録を照合する。各PRへ統合先・残受入・管理終了理由を残して**closed-unmerged**とする。元PRのマージ表示を偽らず、Issueや枝は連動削除しない。

| PR | 固定head | 内容/残条件の追跡 |
|---|---|---|
| #35 | `136cb38` | ペース走基盤。周期/本文は#82/#94へ更新。#24/#36/#48/#93等は別管理 |
| #37 | `bc1c9c7` | 停止予告/ラップ差分。#33/#36/#41/#66の受入は未完了 |
| #39 | `20685df` | 目標終了/長押し/状態連動。#31/#38の実機受入は未完了 |
| #44 | `8a5fb40` | チャイム/復旧。#40～#43の既存残条件はOpen |
| #46 | `3ab1b6a` | 遅延診断/騒音/終了結果。#19/#45等の実聴取は未完了 |
| #50 | `72f82b4` | GPS受付/保存待ち分離、95分tool。#49はtoolscopeで完了済み、実機は#48へ |
| #57 | `ecbbe6a` | 時計/騒音/目標変更。時計は#82で置換、#54/#55/#56等Open |
| #59 | `508253b` | 開始前確認/回復PoC。#58の分析品質・AI未実装を完了としない |
| #63 | `31f3a6a` | 開始/終了予告/グループ。#60～#64の未受入を維持 |
| #67 | `ae701b3` | v26履歴/音声修正。#65等の物理受入を維持 |
| #70 | `f1476f7` | 折返し/カウントダウンとv28修正。#68/#69の実走受入を維持 |
| #76 | `2bd3bd6` | OpenComm2 PoC。#72の独立マーカー受入は別管理 |
| #77 | `e273833` | センサー採取確認/保存ACK後feedback。#72の物理押下・画面OFF・聴取は未完了 |

既にclosed-unmergedの#71/#73/#74/#75/#81/#82/#83は再マージしない。#73は6コミットすべてpatch-equivalent、#75は4コミット同等・旧状態依存PACEを#82/#94へ意図的置換、#81～#83は#85へ統合済み。#71/#74の独自原本は#87の16 blob保全/現行正本へ整理済み。#84はTest統合候補へマージされ、#85経由でmainにある。

## 作業枝・歴史資料の残差

全ローカル/remote枝と既存24 worktreeを確認した。先行作業の未追跡293ファイルと追跡差分は、リポジトリ外のローカルmanifestへパス/サイズ/ハッシュを記録して保持。原本・枝・worktree・バックアップは削除しない。3 worktreeのpackage差分は既存Test prebuildのexpo-location source-build設定で、別の未統合製品機能ではない。未追跡は検証用tmp、export出力、ログであり、自動コミット/公開しない。

| 非祖先の枝/成果物 | 方針と具体的根拠 |
|---|---|
| `codex/native-route-map-20261124` / `7ed2887` | PR未作成の実装残差1件。既存実装をmain `256cea1`上の`940a4c5`へ取り込み、独立PRで検証・レビュー。機能を新たに広げない。初期OFF/明示通信ON・保存非改変。#3は実機未受入のままOpen |
| `codex/integration-test-v37-20261122` / `fc05582` | 独自非mergeコミット`76fa312`はpatch-equivalent。別のNative/保存/音声機能は残らない。枝は保持 |
| `codex/issue73-device-validation`、remote issue72 / `03015cc` | 全6 patchがmain同等。診断実装を再取り込みしない。実機残条件は#72へ |
| `codex/pace-announcement-20261112` / `59b5581` | 旧警告方式`f23eab3`だけ非同等。固定周期へ置換済みのため巻戻さない |
| `codex/docs-flow-matrix-v28` / `a1fc246`、remote matrix / `199acde` | #87の原本manifestと元blob比較で保全済み。現行正本を旧仕様で上書きしない |
| `codex/pages-pace-v31`、remote `gh-pages` / `f755653` | 公開履歴。v28/v31原本と現行HTML/script互換を保全済み。配信枝をmainに強制マージ/再配信しない |
| `codex/analysis-run-20261112` / `ae6a98b` | [旧解析の固定commit](https://github.com/yshtysht8sh10-glitch/RunJourney/tree/ae6a98ba1a5727093c3ef92711e68d740780d1b2/docs)。集計文書/評価CSVの2ファイル。元枝/commitを保持し、個人由来の集計をmainへ重複コピーしない。現行品質仕様は#94を優先 |
| `codex/voice-reliability-design-20261112` / `d42362d` | [旧設計の固定commit](https://github.com/yshtysht8sh10-glitch/RunJourney/tree/d42362d85e4b67f61ce66e8f87608aa01f7314d1/docs)。上記解析2件＋設計3件。旧提案を新仕様へ戻さず、[現音声正本](voice-current.md)、[PACE契約](pace-periodic-implementation-20261122.md)、[品質修正](pace-quality-93-20261124.md)、[v36実装記録](sensor-reliability-v36-20261116.md)を優先。固定参照で歴史を保持 |

その他の枝headはmainの祖先で未統合commitなし。祖先であっても未実装の将来機能や実機受入は完了にならない。

## #78の新完了条件と検証

1. 未マージPR・枝・未追跡成果を棚卸しする。
2. 必要な既存実装をテスト/固定SHAレビュー後にmainへ統合する。
3. 重複/置換PRを参照付きで整理する。
4. 保存互換・統合main回帰を確認する。
5. 未実装/実機未受入のIssueが統合の障害でないこと、安全境界/残リスクを記録する。
6. 最終main SHAをGitHubの#78/PRコメントと最終報告で確定する。そのSHA以降からのサイクリング枝作成は次の指示待ち。

検証結果と独立レビューの固定SHAを本書末尾へ追記する。mainの必要な機能/依存がまとまった時点で全体Jestを1回実行し、同じ成功試験を文書変更のたびには繰り返さない。保存は既存PC SQLite合成20ケース/Android reader48ケースと、更新/rollback/再起動/空DB限定・iOS/Web安全遮断の検証を再利用する。今回新規に実データを移行・削除・復元していない。

## 非blockingの残リスクと対応

- Test v38は`256cea1`のまま保管。#93実走受入待ちでOpen。更新はマスター指示後、RUN停止確認→非破壊backup→署名/version/hash確認→`adb install -r`→既存データ照合。今回端末操作なし。
- Android Testは既存`runjourney.sqlite`/schema2を継続。今回の地図は読み取り専用・初期OFF。実機描画/通信cacheは#3、詳細配置は#32に残す。
- Production legacyコピーは明示確認・空DB・原本読み取り専用・transaction/照合で保護される。実端末driver/旧形式更新は未検証。Production成果物ガードを維持し、今回移行/配布を行わない。iOSは互換未対応のため計測UI前で安全停止。Androidの次開発を妨げないが、Production/iOS出荷準備完了とは扱わない。
- センサー/マーカーの物理ACK・実聴取/画面OFF、非定期音声TTL/TTS復旧、Auto Stop精度/正解データ等は各IssueでOpen。実装済み/テスト済み/統合済み/受入済み/Production反映済みを区別する。
- #3/#32/#11/#12/#25や他の未着手機能は統合を妨げない限り着手条件にしない。Openを管理都合でCloseしない。未承認Auto Stop閾値変更・外部AI送信なし。

## サイクリングへ引き継ぐ既決仕様（未実装）

入口のRunning/Cycling分離、競技別計測/履歴/設定。Runningの既存DB/設定/データを変えず、Cyclingは`runjourney-cycling.sqlite`。GPS/時間/距離/音声/保存を共有し競技プロファイルで調整する。両競技Auto Stop、Cyclingはkm/h中心・5分音声初期ON。同時計測禁止、STARTで競技/保存先を固定し復帰でも維持。将来Wear OSを妨げない責務分離。今回はサイクリングのコード・枝を作成しない。
