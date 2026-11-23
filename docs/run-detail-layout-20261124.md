# #32 走行詳細の指標・情報階層

対象はIssue本文の保存済み「走行詳細」。計測中のSTART/STOP画面は変更しない。基点main `fc24d0c`。

設計レビューを先行し、独立レビュー担当の条件付き承認後に実装した。構成：上部の戻る→総距離を最優先とするサマリー→走行分析/Paceレポート/実走5分ラップ→停止区間・補正→データ/Export→管理操作。小容量/大容量とも共通`RunDetailSummary`を使用する。

- 平均ペース、平均時速、実走時間、全経過時間、開始/終了日時を明示。平均速度は保存済み表示用の補正後距離÷補正後実走時間、一覧と同じ定義/小数1桁。ペースは既存`analyzePace`を使用。距離/時間不足では数値を捏造しない。
- 小容量は既存`effectiveRun`、大容量は保存済み`RunSummary.distanceMeters/activeRunningTime`（SQLiteのeffective_distance/effective_time）を使用する。originalDistanceではない。元GPS/日時/補正記録を変更しない。
- 通常案内/区間補正ボタン/Export/ごみ箱を目的別に分離する。既存のtrash確認、busy/recovery等の補正制限、再解析の遷移は維持。大容量詳細の補正/削除未提供という従来制限も変更しない。
- 主要指標は折返し、ScrollView、本文16px以上、操作領域48〜52dp以上。実端末の小画面/大きな文字設定での成立は未検証。

focused：run-detail-summary、stop-correction-ui、trash-ui、history-uiの4 suites/24 tests成功、型/Lint成功。共通指標の定義一致、ゼロ/不正値、補正/ごみ箱の既存動作、大容量のメタデータのみの初期表示、情報/操作順序を確認する。すべて合成/React rendererであり、既存端末データには触れない。

**#32は実機スクリーンショット比較が明示受入条件のためOpen維持する。** コードレビュー/統合と実機受入を区別し、本人操作は最後の一括評価まで依頼しない。Production配布、APK更新、GPS/判定/SQLiteの仕様変更なし。

独立レビュー：integration_reviewが設計案を先行承認し、固定SHA `4fa9eda10f43ad1d4c5e45daa03597c39f681b2e`を限定承認した。P1/P2なし。summary/stop-correctionの7 testsを独立再実行成功、diff-check成功。main統合可、Issue Closeは実機受入まで保留という判断である。
