# #47/#49 非実機条件の照合

> #88時点の履歴。#47の実機待ちは維持。#49のPC側不足は[後続補完・最終長時間結果](gps-private-cli-20261123.md)を参照し、当時のOpen条件と最新状態を区別する。

基点main `7ed65e0`。本人の端末操作なし、実データ操作なし。今回の製品差分はPACE設定の文言2箇所のみ（「最小間隔/秒以上」→承認済み固定周期の「PACE通知間隔/秒間隔」）。設定キー・型・値域・保存処理・RUNスナップショットは変更しない。

## #47 未保存設定の離脱警告

既存実装：`pace-workout-settings.tsx`のpersisted/draft比較、`pace-edit-guard.ts`、`use-pace-leave-guard.ts`、`app/_layout.tsx`のtabPress。初回実装は`d3b2cf7`以前からmainへ統合済み。

| 条件 | コード/非実機証拠 |
|---|---|
| dirty・元に戻す・保存済み表示 | 既存pace-workout-uiの入力変更/復帰/失敗テスト。今回のUIラベルも現周期へ同期 |
| 編集に戻る/破棄/保存して移動 | 既存pace-edit-guard 3件。失敗で離脱せずdirty維持、保存ACK後にだけ移動。保存中再登録で二重プロンプトを出さない |
| Android戻る | 新pace-leave-navigation。cleanならハンドラー不介入、dirtyで阻止、キャンセルは留まり、破棄確認後だけ戻る/exitApp |
| 画面離脱 | 実hookのbeforeRemoveハンドラーを呼び、preventDefault、非同期保存ACK待ち、元actionの一度だけdispatchを確認 |
| タブ切替 | 実TabLayoutのscreenListeners/route=historyを呼び、dirtyで阻止、破棄後のnavigateを確認 |
| focus解除/再入場 | 新テストで登録解除・古いdirty binding消失・再登録を確認。UI remountは保存済み値を読み、未保存draftを暗黙保存しない |
| 再起動・次START・計測中編集 | 既存pace-workout-persistenceのSQLite reopen、START snapshot、後続設定変更/restoreで稼働中目標不変を再利用 |
| 履歴/GPS/保存精度 | 同persistence suiteの旧履歴・通常START・raw points/metadata保持・合成backup検証。実端末の復元は行っていない |
| background復帰 | host re-renderで入力が維持されるテストと、コンポーネントがAppStateでreload/保存しないコードを確認。OS停止/プロセス死/Android画面操作の実試験ではない |

関連実行：`pace-leave-navigation / pace-edit-guard / pace-workout-ui / pace-workout-persistence`の4 suites **27 tests PASS**、型/Lint/diff-check PASS。navigationは実ハンドラー＋mock navigator/BackHandler、保存はPC Native SQLiteまたはUI境界mockを明確に分ける。実Androidの戻る/タブ/OS backgroundを操作した成功証拠ではない。独立レビューで非実機条件と残受入の境界を判断し、必須実機条件が残る場合はIssueをOpen維持する。

## #49 開発専用GPSシミュレーター

既存成功証跡：#85の79 suites/609 tests内に95分seed49の2ケース、同じシミュレーター/テストblobを今回変更していない。長時間保存5ケース、Nativeの100分/136通知テストも既存証跡を利用し、再実行しない。

| 要件 | 確認結果・不足 |
|---|---|
| GPS入口→通常主要経路 | PC test→`ingestLocationBatch`→観測adapter/repository/detector/Pace Analysis/VoiceAnnouncement/本番SQL。別判定ロジックを複製しない |
| 実データ隔離 | `src/test/gps-simulator.ts`はPC testからのみ使用、CLIはJestを起動。SQLiteは`:memory:`、OS GPS/Native音声はfake、通常APKに切替UIを追加していない |
| シナリオ | 95分、900秒周期で25秒停止/再開/0.8m/s/精度60mジッター/10秒欠測/20秒batch遅延/背景相当。6秒保存待ちを注入 |
| seed/仮想時計/pause/step | 同seedの1000step一致、pauseで時計不進行、stepで再開。timeline/イベント/真値停止遅延/キュー段階統計を新規private reportへ保存可能 |
| 真値と判定 | 合成STOP真値と確定fix/計算時刻を対応、誤停止なし・停止10秒以内をassert。OS配信遅延や身体の正解率ではない |
| 音声生成継続 | 50件超のPACE・90分以降・expiryゼロをfake受付でassert。Native100分queueは別fixture。聴取・電池・自然Dozeの評価にしない |
| **新PACE経路との統合不足** | GPS simulatorのfake Nativeに`pacePeriodicVersion`がないため旧fallback経路。新固定周期ledgerまで同時に通った証拠ではない。専用PACE/Native試験の成功で代用せずOpen条件として残す |
| **シナリオ不足** | 数秒の短停止/再開、数時間のGPS→判定→通知の一貫シナリオが未網羅。24h保存試験はGPS検出の数時間試験とは別 |
| **リプレイ/統計・負荷の整理不足** | 匿名化batchの受信順リプレイCLI/手順、見逃し/誤判定/再開遅延・品質別p50/p95の統一report、メモリ計測を条件別に固定する必要あり。暗号診断の現行リプレイ機能は#72側であり、このPC simulatorの入力経路完成と混同しない |

したがって**#49は今回Closeしない**。次の独立差分でPC-onlyの受信順リプレイと短停止/長時間/最新PACE契約対応・メトリクスを補う。実GPS座標/鍵/backupをGitHubやCIへ送らず、合成fixtureのみを使う。実機音声の評価は#40/#48/#78等の最後の一括評価へ残す。

## レビュー・統合・Closeの扱い

実装・テスト・main統合・Issue Closeは別段階。固定SHAで独立レビューし、#47も条件未達との判断ならOpenのまま追跡する。今回#49の不足を過去の全体成功で埋めた扱いにはしない。サイクリング、Auto Stop変更、外部AI送信、Production配布へ進まない。

独立レビュー：integration_reviewが固定SHA `a9967df`を限定承認、追加P1/P2なし。新navigationとguardの6 testsを独立再実行し成功。**#47は非実機条件のみ承認、実Androidの戻る/タブ/背景復帰/START適用確認を一括評価に残すためOpen維持**。#49も上記不足によりOpen維持。main統合可だがIssue Closeの承認ではない。
