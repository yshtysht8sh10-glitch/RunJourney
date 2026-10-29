# 2026-10-29 実走フィードバック：#19 #43 #47 #48 #49

## 入力と保全

2つの音声Export（1793257566773 / 1793257585292）は同一15,538,407bytes、SHA256 `bb06f341dd86429a5337e376efb1a3cd7aff049e052f106d3138a5a7ab3b3691`。二重計上せず7,510行から対象RUNのみを抽出した。対象RUNは約13.25km、実走87分2秒。個別位置・履歴・案内原文はGit/EASに送らず、私有保全先 `D:/working/RunJourney-preservation/field-20261029` のみに保持する。

更新前Test v20 / 9d6a52cの標準Backupは45履歴・GPS16,512点・設定7件・draftなし。11,058,962bytes、端末/PC SHA256一致 `f95ecd942a5c4e520b50a94e7f4a5e6e16411e1c08e6c7740eba26f44ca70073`。内部SHA検証、隔離SQLite復元全snapshot一致、integrity_check=ok、foreign_key_check違反0。Production/Pace操作、端末Import、消去、アンインストールは行わない。

## 確認済み・可能性あり・未確認

| 判定 | 原因/観測 | 対応 |
| --- | --- | --- |
| 確認済み | GPS観測処理の直列キュー内で全checkpoint完了をawait。保存が約5秒を超えると次の観測が累積して滞留 | 観測処理から保存待ちを分離し、1 in-flight + 1最新累積snapshotへcoalesce |
| 確認済み | 1秒超の待ち3,220サンプル中3,219が実際のcheckpoint実行区間と重なる。22の停止/再開確定も保存と重なり、確定時処理待ちはp50 27,246 / p95 60,211 / max67,736ms | 全観測を順序どおり検出。間引くのは中間保存要求だけであり、GPS点や判定入力ではない |
| 確認済み | EXPIRED41件中40件は生成時点で既にTTL超過。停止7/再開8件も失効 | TTLを延長して古い案内を鳴らすのではなく、原因の保存待ちを除去 |
| 確認済み | ペース音声ON・最小間隔60秒の保存済み実走設定。Paceは33DONE、17EXPIRED、最後にもDONEが存在 | 「最小間隔・状態により省略」と開始前表示、生成/非生成理由診断を追加 |
| 可能性あり | 全GPS検証/メタデータ/診断再書込とnative SQL往復がcheckpoint時間を増やす | コード上の全走査は確認。ただし実端末の各SQL・fsync・JSスケジューリングの個別所要時間は旧ログでは未計測。ディスク単体の故障/速度と断定しない |
| 未確認 | DONEなのに実際に聞こえなかった原因、出力端末/音量/環境音、OSの配送の内訳 | DONEは聴取証明ではない。#19の音量/route/画面OFF診断を追加し次RUNで照合 |
| 対象外 | 今回の騒音連動機能の効果 | ユーザー未操作・OFF・native状態OFF。機能不良の証拠にはしない |

## 区間別の変更前値と改善後の検証値

単位ms。実走と仮想時計は混同しない。

| 区間 | v20実走p50 | p95 | 最大 | 修正後 |
| --- | ---: | ---: | ---: | --- |
| GPS sample→JS callback | 77 | 1,667 | 5,186 | OS配送は変更しない。次RUN実測待ち |
| 内部観測キュー待ち | 2,740 | 103,125 | 151,610 | 95分・保存遅延注入シミュレーターはp50/p95/max=0。仮想時計上の値で、実機改善率ではない |
| 停止判定計算 | 3 | 4 | 89 | 閾値・算法不変。仮想時計の計算時間0は実CPU時間ではない |
| checkpoint全処理 | 4,846 | 6,161 | 6,645 | 非同期coalesce。保存自体の端末実測短縮は未主張 |
| native受付→TTS開始 | 273 | 2,329 | 17,241 | 優先度・保留を含む。次RUNで種類別評価 |
| native受付→チャイム | 47 | 73 | 73 | 7件。変更なし |

全受理観測5,012点、checkpoint985件。GPS sample時刻は物理停止時刻ではなく、JS callbackはnative GNSS受信時刻ではない。確定サンプル→判定処理完了22件はp50 27,359 / p95 60,592 / max67,977msで、上記キュー待ちにほぼ支配される。旧ログの同一候補ID・sample/callback/entered/finishedとcheckpoint区間を照合した因果証拠を私有`field-analysis-final.json`へ保存。

停止窓5秒/8秒、速度・精度・spread等の閾値は変更しない。古い音声のTTLも延ばさない。終了・状態変更・draft置換・消去操作はcheckpoint flushバリアを通し、古いsnapshotの後着上書きを防止。保存失敗はRAMに最新累積snapshotを残して次の保存で再試行し、終了時バリアは失敗を呼出元へ返す。プロセス強制終了では未保存RAM分が失われ得る制約は残る。ディスク完了前に保存成功とは表示しない。

## #48 音声のID単位集計

| 種類 | QUEUED | STARTED | DONE | EXPIRED |
| --- | ---: | ---: | ---: | ---: |
| PACE_WARNING | 34 | 33 | 33 | 17 |
| FIVE_MINUTES | 12 | 12 | 12 | 5 |
| KILOMETER_LAP | 10 | 10 | 10 | 3 |
| AUTO_STOP_CONFIRMED | 4 | 4 | 4 | 7 |
| AUTO_RESUME_CONFIRMED | 3 | 3 | 3 | 8 |
| WORKOUT_GOAL | 0 | 0 | 0 | 1 |
| RUN_GOAL_FINISHED | 1 | 1 | 1 | 0 |

JSTで最初のPace DONE10:23:28。11:10:23〜11:38:38の範囲に期限切れが続き、その後再びDONE。最後のPaceは11:51:29受付/開始→11:51:33DONE。恒久的なTTS停止を示さず、対象RUNにTTS ERROR/INIT_FAILEDや割込み失敗の記録もない。1件はQUEUED後の失効、残る40件は生成時点で古い。元の設定は「毎分必ず読み上げる」タイマーではなく、FAST/SLOW/ON_TARGET復帰等の条件付き最小60秒間隔。無イベント区間を全て欠落とは扱わない。新しい`PACE_EVALUATION`でVOICE_OFF/PAUSED/UNKNOWN_QUALITY/INTERVAL_OR_STATE_CONDITION/CREATED、`VOICE_GENERATED`で元時刻・生成時刻・TTL・IDを追跡する。

再解析: `node scripts/analyze-field-run.cjs PRIVATE-voice.json NEW-private-report.json`。元データを変更せず、全run混在/二重Exportを避ける。

## #47 未保存設定と開始UX

保存済み値と編集値を分け、意味上同じ値へ戻せばdirty解除。保存成功後だけ保存済み/次START適用と表示する。タブ切替、設定内の各リンク、beforeRemove、Android戻るで「保存して移動」「破棄して移動」「編集に戻る」を提供。保存失敗なら移動せず編集を保持。破棄時は保存済み値へフォームも戻す。背景化は離脱扱いにせず編集中を保持し、再起動は保存済みから復元する。

開始画面に保存済みペース設定（距離・ペース・許容幅・音声ON/OFF・最小間隔）と騒音連動ON/OFFを表示。進行中RUNには開始時snapshotを使い、編集中の次回設定を遡及適用しない。既存の設定キー/形式を変更しない。

## #19 診断

初期OFFを維持。RUN開始/復元時の設定とAppState、開始結果、マイク権限、測定状態、RMS dBFS min/max/mean/count、baseline、gain、画面非点灯サンプル数、測定RUN IDを記録。ON時はAppState変更を記録。各native音声イベントに適用有無・適用gain・fallback理由・media音量/最大目盛・出力route/既知か・画面点灯状態を追加。直接TTSの実routeが取れない場合はunknownであり、接続機器から実routeを推測しない。RUN終了summaryと測定STOPPED時の最終summaryをExportに含める。

生マイク音声・会話は保存/送信しない。音量上限1.0/端末設定は維持、絶対音圧SPLの保証ではない。画面OFFでの採取継続は`screenOffSamples`と時刻/状態で確認する。騒音の平均は校正済みdB SPLや会話認識ではなくデジタルRMS dBFSの算術集約。

## #49 開発専用GPSシミュレーター

PC専用 `npm run simulate:gps -- 49 NEW-private-report.json`。アプリにシミュレーション切替/書込APIを組み込まず、Production/Test実データへの接続経路を作らない。CLI/Jest環境だけでExpoの実タスクと共有する`ingestLocationBatch`へ合成LocationObjectを供給し、実RunRepository・GpsObservationSession・detectStop・距離/実走時間/Pace Analysis・VoiceAnnouncement・SqliteStoreのSQLを共用する。DBはNode SQLiteの`:memory:`、native GPS/音声はfake。通常履歴・同期・統計には混入しない。

再現seed・仮想時計・pause/stepと真値timelineを持つ。一定速、25秒停止、再開、低速、ジッター、精度60m、10秒欠測、20秒バッチ遅延、背景相当を95分再現。保存には6秒の最低遅延を注入（協調的な仮想時間進行により完了はさらに遅れる）。停止の真値と確定時刻、誤停止なし、観測キュー上限、音声期限切れなし、Pace50件超/90分以降継続、全点の最終保存・隔離を自動検証。fake音声の受付はnative DONE/聴取とは別。別途Robolectricの実nativeキューで100分/136イベントを完了させ、既存の割込み・TTL・古いcallbackテストを維持する。

## 自動検証

JS449tests/52suites、型チェック、Expo lint（警告なし）成功。native32tests成功（100分キュー含む）。95分シミュレーターは約40〜50秒のPC実時間。端末の電池消費はこのPC時間から推定しない。既存GPS/距離/時間/停止・再開/終了二重保存/保存障害回帰を含む。実機とAPKの結果は追記する。

## 次回RUN受入と提出物

1. 設定でペース走を保存し、開始画面の保存済み値を確認。最小60秒は条件付きで毎分定時とは異なる。
2. 騒音連動を試す場合は明示ON→マイク許可→20秒プレビュー。通常はOFFのまま。端末/イヤホンの安全な設定音量で開始し、OS音量は自動変更しない。
3. 停止/再開、短い信号待ち、車両通過、画面OFF、長時間後も案内が戻るかを確認。人が停止した時刻/聞こえた時刻もメモする。
4. RUN終了後「設定→Auto Stop Diagnostics（Test）→最新情報に更新→停止・通知の遅延サマリーを集計→音声ログJSONをExport」。対象RUNを選択していることを確認。標準「データ / Export・Import→Backup JSONをExport」も私有保存し、診断と合わせて提出する。GPSを含むBackupは公開Issueへ添付しない。
5. 比較対象はGPS配送・キューp50/p95/max、候補/確定/通知時刻、TTL失効と非生成理由、音量/route/画面OFF/RUN終了summary。新ログ欠損はゼロ扱いしない。

全IssueはOPEN維持。実装完了と実走受入完了を分ける。実走でp95/最大キューが悪化していないこと、誤停止・距離/時間・保存・音声の退行なし、騒音連動の聴取/電池影響を確認するまでCloseしない。
