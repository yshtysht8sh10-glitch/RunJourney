# #4 履歴の日時/経過時間切替

基点main `6cb1328`。開始・終了日時を保持したまま一覧表示だけを切り替える。既存記録への移行・再保存・再計算は行わない。

- 初期値OFF：従来の開始時刻→終了時刻。設定キーがない場合も読み取りだけで、初期値を書き込まない。
- 設定「履歴を経過時間で表示」ON：`endedAt − startedAt`を`35:00` / `1:12:34`で表示。日跨ぎ/年跨ぎ対応、無効/逆転日時は「経過時間不明」。休憩/Auto Stopを含む壁時計の差であり、既存の「実走○分」は変更しない。
- 履歴画面のfocus時に設定を読み直し、既存RUN/グループへ表示適用。設定保存ACK後だけスイッチを更新、保存失敗は警告し旧値維持。読み取り失敗中は保存を無効にし再試行を表示する。
- 新キー：`@runjourney/running/history-time-display/v1`。既存設定は変更しない。`createHistoryDisplaySettings(store, key)`で将来の運動種別プロファイルが別store/keyを渡せる。サイクリングモード/DB自体は未実装。

変更：`repositories/history-display.ts`、`components/history-display-settings.tsx`、既存history/settings画面。保存スキーマ・RUN日時・GPS・音声・Auto Stopは不変。

検証：history-display/history-ui/history-list/history-groups-uiの4 suites **27 tests PASS**、型/Lint/diff-check PASS。既存日時初期表示、切替後の32分経過と29分実走の区別、raw履歴不変、設定再open、既存設定非干渉、別key非干渉、保存/読取失敗、年跨ぎ/長時間/無効時刻を確認。PC SQLite/React rendererの自動試験であり、実Android画面の視覚確認ではない。本人操作は延期し、必要な実機受入が残るとのレビュー判断ならOpen維持。

Expo SDK57/Routerの公式資料を確認し、既存Switch/useFocusEffectパターンを使用。依存追加なし。APK更新・端末データ操作・Production配布なし。固定SHAの独立レビュー後、条件を満たす場合のみ#4をCloseする。
