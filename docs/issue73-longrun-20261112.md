# 11月12日の実GPS診断収集

2026-11-11のユーザー指示により、短時間の段階A〜Dを実走前の必須条件から外し、11月12日の150分RUNを優先する。診断の採取目標はRUN開始から95分。実GPS件数はOS依存であり、5,700件とは仮定しない。

## Test限定変更

a6c64df / 9cf9acdで、RUN開始時刻からの経過を加味したmonotonic期限をRecorderに追加した。95分経過後、最初に完了したGPSバッチの後でBOUNDARY（DIAGNOSTIC_LIMIT_95_MINUTES）とENDを出し、Nativeをstopしてsealする。バッチを途中で切らない。RUNのendedAtを変更せず、RUN終了処理・GPS停止・SQLite終了保存を呼ばない。

診断だけが終了し、その後も通常のGPS受付・Auto Stop・SQLite checkpointは継続する。GPS/JS停止中は次の配信まで締めが遅れる。容量64MiB/セッション・256MiB合計、暗号認証、連番・チェーン・END・seal、旧形式読込みは維持する。容量や受付障害では従来どおり診断をINCOMPLETEとして停止する。

再起動で診断は自動再開しない。START直前に、診断画面で「次のRUNの診断をON」→ARMEDを確認する。「診断をOFF」は通常の中断扱いであり、95分の正常完了とは異なる。

## 事前確認

- 実GPSはTest v30時点で通常タスクのingestLocationBatch→Repository直列処理→観測/判定→SQLite checkpointに接続されている。今回この通常経路は変更していない。
- 自動試験で95分に診断が終了し、同じRUNが150分のGPS点を受け付けてSQLiteへ通常終了保存されることを確認。採取部分はリプレイ一致。
- Test限定の人工入力limit試験を追加し、時間を短縮して同じ診断終了境界・Native暗号保存・seal・通常判定継続を実機で検証できるようにした。実GPSの代替評価には使わない。
- 通常ラン画面・終了結果・ページ化履歴はごみ箱の期限削除を呼ばない。getRuns/getActiveRuns/getTrashedRuns・復元API・ごみ箱画面は期限処理を含むため、今回の操作・照合では使わない。
- 更新前の全Backup・保持音声ログ・旧Test APKをPC私有領域へ保存。今回の基準は54履歴（ごみ箱18）、GPS22,512点、設定11、ドラフトなし。グループ/保護情報を含む全snapshotが前回v30検証後と一致。
- 現在の終了条件は5kmの自動終了ON。ユーザーはSTART前に手動終了へ変更するか、予定に合う終了目標に変更する必要がある。今回の更新では設定を変更しない。

## 実走後

95分の採取部分と、それ以後の通常RUN継続部分を分けて評価する。採取件数・暗号認証・seal・再現、SQLiteの5秒点選択と終了flush、Auto Stopの記録、容量/遅延/障害、取得可能な電池/温度/メモリ、元データの不変性を照合する。ユーザーが今回変更した設定と新規RUN追加は別に説明する。

診断95分未達でも通常RUN継続を独立して評価する。実停止/再開の観察を聞き取り、正解ラベルがなければ正確率とは報告しない。実時間150分・実GPS95分・Doze・電池負荷は未検証。原GPS/経路/鍵/BackupをGitHub/CIへ出さない。既存RUNの復元・削除は行わない。PR #73 Draft、Issue #72 Openを維持する。

## Test v31の実機準備結果

実装SHA15f487bの統合Test v31をSO-51Bへ上書き更新。既存Testと同じ署名・package、versionCode31を照合した。更新直前/直後/無音試験後の全snapshotが一致し、Production APKハッシュも一致。

時間短縮したlimit試験で、Native保存1入力/7フレーム→END・seal→全認証・リプレイ一致を確認。その後の判定は240入力まで継続して診断OFFとdigest一致。実GPS95分・実時間150分の検証は明日のRUNで行う。

配布APKの試験補助フィールドfirstFailureAtStepは正常な期限終了を失敗位置と誤分類するが、Native failureCode空・拒否0・SEALED・再現一致で正常終了を確認した。78f27b1でソースを修正し、追加回帰試験・型チェック成功。この表示修正は配布APK15f487bに未収録。実RUNの診断処理は当該フィールドを使用しない。

統合APKと操作手順 https://github.com/yshtysht8sh10-glitch/RunJourney/blob/codex/longrun-test-20261112/docs/longrun-20261112-operator.md
