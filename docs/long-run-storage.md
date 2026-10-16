# 長時間走行データ基盤（Issue #29追加要件）

検証日: 2026-10-17 / 開発ブランチ `feature/web-cloud-analyzer`。
対象: #29 / #2 / #3 / #9 / #10。Production、安定Test v17実機DB、PCへ救出した原本にはアクセス・変更・適用していない。すべて合成データ・隔離SQLite・ローカルFirebase Emulatorによる検証。

## 過去の障害とv17の調査結果

`rescue/README.md` と `docs/isolated-recovery-v16.md` の調査記録では、旧AsyncStorage 2.2の `RKStorage/catalystLocalStorage(key,value)` に複数履歴が巨大な単一valueとして保存され、Androidの `multiGet` / `SELECT key,value` がCursorWindowへ結果行を展開するときに失敗した。救出調査には2,134,495 bytesの値と、6MB合成値の `Row too big` 再現が記録されている。SQLiteの任意の1セルに一律2MB上限がある、という結論ではない。

v17ソースの `sqlite-store.ts` は既に以下の物理分割を実装していた。

- `runs`: 開始・終了・保存距離・補正後距離 `effective_distance` / 実走時間 `effective_time`・状態。
- `gps_points(run_id,seq,payload)`: **1 GPS点=1行**、1 payload最大32,768 bytes。`gps_order(run_id,position,seq)` が表示順序を保持。
- `run_events`: 1イベント=1行。
- `run_metadata` / `run_operations` / `run_diagnostics`: 8,192文字で分割したテキスト断片。GPS配列を含まない。
- WAL / `synchronous=FULL`、コア書き込みのトランザクション、GPS原本の更新・削除禁止トリガー、STOPスナップショットの確定と再試行。

したがって巨大GPSセルへのスキーマ置き換えは不要だった。一方、`readRun()` は分割行を全取得して配列へ戻し、旧Web読込・初期同期OutboxはRun全体のJSONを組み立てていた。物理保存だけを分割しても、ブリッジ・JSメモリ・表示・再送の一括処理が残る。この経路を今回の主要対策とした。

| 過去/将来のリスク | 対策 |
| --- | --- |
| 全履歴の巨大value / CursorWindow失敗 | メタデータ一覧。GPS payloadを一覧SQLで取得しない |
| 1 Runだけ巨大化 | 点別の既存行を維持し、最大128行・64KiBのページAPIを追加 |
| 一括JSON・Outboxスナップショット | ページmanifest + SHA-256参照。再試行時も1ページずつ |
| 読出失敗を0件と表示 | エラー表示と既存表示の維持。破損Runを個別隔離 |
| 書込中の終了/容量不足 | 既存WAL/原本不変/原子的STOPを維持し、hash・件数も同一コアtransactionに含める |
| 欠損・重複・ページ順序異常 | 期待件数、連続位置、seq一意性、時刻境界、行hash、manifest順序/hashを検証 |

## 採用方式と選定理由

候補は「1 RunのJSON」「固定GPSチャンクを新テーブルへ再格納」「既存点別テーブルをページ化」の3つ。既存v17が点別保存であるため、原本行を書き直さず、最後の方式を採用した。重複した新GPSストレージへの移行・二重管理を避けられる。

物理schemaは `user_version=2`。原本テーブルに以下を追加する。

```text
runs (metadata / effective metrics)
  ├─ gps_order → gps_points (既存・原本不変)
  ├─ run_events / metadata / operations / diagnostics (既存)
  ├─ run_stream_state (GPS/イベント期待件数・個別検証エラー)
  └─ run_row_hash (stream, seq, SHA-256)

SqlitePagedStore
  ├─ list(limit<=200,offset) → RunSummary[] (GPS payloadなし)
  └─ source(id)
       ├─ summary() → メタデータ・件数/順序検証
       └─ read(stream,start) → 最大128行、公開ページ最大64KiB
```

`summary()` はSQLのcount/min/max/distinctで件数と順序を照合するため点数に応じたDB処理時間はあるが、GPS本文はJSへ渡さない。1回の候補SQLは最大128行。極端に大きい各行が既存上限32KiBの場合、候補のブリッジ量は最大約4MiBになり得る。返すページは64KiBに再分割するため、**SQL結果も常に64KiB**とは主張しない。今回のGPSでは最大ページ19,121 bytesだった。

各行のhashは保存時に記録。移行時hashはその時点の旧行に対する検証基準であり、過去の救出原本との同一性を証明するものではない。旧メタデータの不正JSON・null・件数不一致はRun単位のエラーとして隔離する。I/O失敗は握り潰さず、移行全体をrollbackする。

## 読み出し・表示・エクスポート

- Web Dashboard / Journey / Streak / 月間集計は `RunSummary` だけで計算。Nativeの既存履歴一覧もメタデータページのまま。STOP完了画面はGPS全取得からsummary読込へ変更した。
- Web詳細・デバッガは開くだけではGPSを取得しない。GPS・イベント・メタデータ・補正・診断を選んで先頭/次ページを取得する。通常保持するGPSは選択中の1ページ。
- 地図はページの元indexを表示。全体概要は順次読み、保存された点から約1,500点を抽出して表示する。概要は間引きであり、完全な軌跡ではない。GPSページで原点を確認する。背景地図は初期OFF。
- Native詳細は2,048点超でページ表示へ切り替え、従来の `getRun()` を呼ばない。巨大GPSをText/JSONで全展開しない。大きいRunの編集・削除UIはこの画面から提供しない。
- 5分ラップは1ページ+前ページ最後の1点で共有Effective Run計算を実行し、全GPSを保持せず合算する。停止補正で走行に含めた区間、制御情報128KiB超、イベント2,048件超は安全に解析を保留し、保存済み総距離・時間を表示する。原本は変更しない。
- Nativeの大きいRun用NDJSON共有はFileHandleへ行単位で書く。manifest / page / end-runをhash検証する。実機共有ダイアログの動作は未検証。
- Web NDJSONは `File.stream()` で読み、ページをタブ専用IndexedDBへ保管する。全データの `JSON.parse` やGPS配列の再結合をしない。最大512MiB、1行700,000文字。全ページとend-runを検証してからそのRunを一覧に公開。
- 従来v1/v2 JSONは5MiB以下に限定して互換取込する。それより大きいファイルは原本を保持してNDJSON形式を案内する。Nativeの旧JSONバックアップ等の互換API自体は残してある。
- IndexedDBはタブごとの一時領域。異常終了やタブを閉じた後に残る可能性があり、画面内にその旨と「ローカルデータを消去」を表示。消去対象は作成した一時DBだけ。元ファイル・端末DB・クラウドは消さない。

## クラウド同期とTaskMemoの整合性

認証・名前付きFirebase client・所有者固定キュー・永続化後の状態更新・指数再試行・受領検証・競合検出はTaskMemo調査に基づく既存実装を再利用。Run全体のスナップショットをOutboxへ入れる部分をページmanifestへ置き換えた。Tree / sortKeyは導入していない。

```text
/runjourney/{uid}/pagedRuns/{runId}   ← 小さいメタデータ、manifest hash、complete
/runjourney/{uid}/pageBlobs/{sha256}  ← 1ページ、またはmanifest
local durable queue                 ← runId、manifest参照群、試行回数、次回時刻
```

1. 全ストリームを順次検証してmanifestを作成。キューにはdescriptorだけを保存。
2. 各ページを内容hashのIDで送信。同一内容の重複は冪等。再試行では既存ページのhashを確認してskip。
3. 全ページ確認後にmanifest、最後にcompleteメタデータを公開する。完了前のRunは通常のクラウド一覧に出さない。
4. 通信断後は永続キューを開き直して継続。同一Run IDの異なるmanifestは競合として上書きしない。
5. Webはメタデータ一覧だけ取得し、詳細はmanifestと必要なページを取得。欠損・hash不一致はそのRunのエラーとして表示する。失敗してもローカル原本に戻り書きしない。

ページ最大64KiB、manifest最大4,096ページ（さらに600,000 bytesのtransport上限）。上限超過は原本を保持して停止する。24時間1Hzの690 blobs、Outbox約80KBで確認した。全体が無限に増えても定数メモリ、という保証ではなく、descriptorはページ数に比例する。

今回の選択は**ローカルEmulator上のFirestore分割ドキュメント**。Firestoreの1文書1MiB上限を避け、TaskMemo由来のAuth/transaction/rulesをそのまま検証できる。一方、Storageは大きいbinary payloadの費用/転送に適するが、利用設定・Blaze課金の確認が必要。Storage有効化・ルール配備・本番接続は行っていない。`PagedRemote` を分離しており、将来Blob部分だけStorageへ置換可能。

本番採用前には、ページごとの読取・transaction読取・書込・再送確認に伴うFirestore従量料金、保持期間、孤立した未完了blobの回収、Storageのオブジェクト操作/転送料を比較する必要がある。再試行も読み取り回数を消費する。費用ゼロや本番readyとは判断していない。新ルールは別ユーザーのread/write、公開済みheaderのupdate/deleteを拒否する。TaskMemoのnamespaceには触れない。

公式資料: [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)、[Firestore pricing](https://firebase.google.com/docs/firestore/pricing)、[Storage plan changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)、[Expo SDK57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)。

## 合成データ量・負荷試験

`src/services/run-service.ts` の通常設定5秒、Standalone Testは1秒。OSが厳密に等間隔で配信する保証はない。合成GPSは時刻/緯度経度/accuracy/speed/altitudeを含み、毎時停止/再開、720診断entries・最大4,096 traceも含めた。停止イベントは経過時間に応じて増える。GPS bytesはcanonical JSONの点ごとの行サイズ合計であり、SQLite/索引/診断/WALを含まない。

点数の試算: `floor(走行秒数/観測間隔秒)+1`。5秒なら10h=7,201、12h=8,641、24h=17,281。1秒なら24h=86,401。表は同一PCの1回測定であり、性能保証値ではない。

| 合成ケース | GPS点数 | GPSページ | GPS bytes | SQLite本体 bytes | 保存 ms | 一覧 ms | 全GPS逐次読込 ms | peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30分×11・5秒 | 3,971 | 33 | 586,465 | 3,026,944 | 244 | 16 | 82 | 123.2 |
| 10時間・5秒 | 7,201 | 57 | 1,064,029 | 3,670,016 | 326 | 17 | 114 | 142.8 |
| 12時間・5秒 | 8,641 | 68 | 1,276,825 | 4,366,336 | 392 | 17 | 137 | 149.9 |
| 24時間・5秒 | 17,281 | 136 | 2,554,022 | 8,544,256 | 759 | 23 | 276 | 173.5 |
| 24時間・1秒 | 86,401 | 676 | 12,848,066 | 41,185,280 | 3,538 | 61 | 1,239 | 291.3 |

環境: Windows / Node 22系、実際の `node:sqlite`、ケースごとに独立子プロセス、V8 old-space上限128MiB、手動GCによる段階測定。peak RSSはSQLite/native/runtimeと**合成配列の生成・保存を含むプロセス全体の最高値**。128MiB以下の総メモリという意味ではない。GC後のGPS逐次読込終了時JS heapは全ケース約25.7MiB。負のmetadata heap差はGCによるもので、一覧メモリが負という意味ではない。端末Hermes/SQLiteやブラウザのheap実測ではない。

各ケースで保存→DB close/reopen→metadata-only一覧/集計→全ページ点数/順序/SHA照合→途中失敗した同期の永続キュー再開→冪等再送→cloud逐次読込→破損検出を確認した。GPSを読むSQLが一覧/集計経路に出た場合はテストが失敗する。最大候補128行、出力ページ最大19,121 bytes。24h1Hzは13,638,797 bytesのNDJSONを逐次exportした。

ディスク実装の模擬transportでのsync時間は順に43 / 425 / 503 / 1,003 / 4,654ms。これはネットワークやFirebase本番の測定ではない。別途、**実際のAuth/Firestore Emulator**で24h5秒17,281点を途中送信失敗→キュー再開→全GPS照合し、実ルールのユーザー分離・update/delete拒否も検証した（約6.9秒）。

## 再現コマンド・検証範囲

```powershell
npm test -- --silent
node --test scripts/sqlite-native.test.cjs
npm run test:pages
npm run test:long
# 別ターミナルで npm run sync:emulators
npm run test:sync:emulator
npm run lint
npm run typecheck
npm run web:build
npx expo export --platform android --output-dir .expo/long-run-android-export
```

結果: Jest270件 / 実SQLite13件 / ページ移行・破損・解析7件 / 長時間5件 / 実Firebase Emulator2件、計297件成功。lint / typecheck / Web export / Android Hermes export成功。Android exportはAPK生成・インストール・実機検証ではない。`@noble/hashes` の内部 `crypto.js` exportに関するMetro fallback警告はあるが、両exportは成功した。

`npm run test:long` は毎回一時ディレクトリへ新DBを生成する。救出パスや実機DBは参照しない。詳細測定JSONと合成NDJSONはignoredの `artifacts/web-review/` に出力し、Gitへ大量データを追加しない。以前のlifecycleテストにあった救出ファイル依存も合成fixtureへ置き換えた。

ブラウザでは24h1Hzの約13.6MB NDJSONの取込、86,401点メタデータ表示、GPS初期0点、128点のページ切替（#0–127→#128–255）、保存点1,491点の地図概要、287ラップの段階解析、診断のページ切替（#0–5→#6–11）、破損NDJSONのhash拒否と既存表示維持を確認した。320px幅と1440px幅で確認。地図は背景タイルをOFFのままテストし、架空座標を外部タイルサーバーへ送っていない。

個々の生測定値は [long-run-benchmark.json](long-run-benchmark.json) に記録した。

新ページ形式のEmulatorデモ7件について、WebでGPSを0ページのまま一覧取得し、詳細manifestを開いてGPS #0–127 / 241点を遅延取得できることも確認した。

## v17からの移行と復旧手順

**このブランチを実機で起動するとschema2移行が動くため、現時点では安定Test v17へインストールしない。** 今回移行したのはテストが新規作成した隔離DBだけ。

1. 将来の実機適用前に別途承認を取り、現行アプリを止めて、WALを含む整合したSQLiteバックアップを既存backup APIで取得する。開いたままの本体ファイルだけをコピーしない。救出原本とは別の作業コピーを作り、バックアップのhash・件数・読込を確認する。
2. 最初はそのコピーを隔離DBへ復元してv1→v2移行する。`BEGIN IMMEDIATE` 内で補助テーブル作成・128行ずつhash backfill・期待件数照合・user_version2変更を行う。既存rawテーブルを書き換えない。
3. 正常Run、空Run、補正済みRun、ごみ箱、STOP済みdraft、巨大diagnosticsを含め、元行のcanonical比較・件数・順序・summary・従来互換readを照合する。移行テストは原本各テーブルの全行snapshotがbyte単位で不変であることを確認する。
4. 不正なRunはerrorを表示し、正常Runを開けることを確認する。全体I/O失敗を注入した試験ではDDL/補助行/user_versionがすべてv1へrollbackし、再実行で成功した。
5. 成功後の挙動に問題があれば、アプリを停止して**検証済みの移行前SQLiteバックアップを別の隔離パスへ復元**する。復元できることを確認してから適用計画を見直す。user_version2のDBへ旧v17バイナリをそのまま向けない。単にPRAGMAだけ1へ戻す手順は採用しない。移行後に増えた記録は復元前に別途保全が必要。

移行中クラッシュの原子性は既存SQLiteプロセスkill試験と、今回の移行I/O rollback試験で確認した。特定端末で移行中killを行う試験は未実施。

## 実機適用前の確認・現時点の限界

- 本変更は保存/ページ読込/同期/表示の基盤。**Native走行中の既存 `ActiveRun.points` と再起動時draft復元は全点配列を保持する互換経路が残る**。書込側の過去GPS検証もhash索引・数値seqの件数比例メモリを使う。走行中RAM/append処理コストの24時間プロファイルが必要で、今回のページ読込試験で解消したとは判断しない。
- legacy `getRun/getRuns` / JSON一括backup/補正の互換APIは残っている。大きいRunの新詳細・新同期・新Webでは呼ばないが、すべての旧管理画面がストリーミング化されたという主張はしない。巨大記録の移送には新NDJSONを使う。
- 実機の10/12/24時間の連続記録、画面OFF、OS kill、端末再起動、電池低下、ストレージ不足、GPS断続・順不同配信、共有export、バックアップからの復元、Hermes heap/ピークRSS/発熱/電池消費を別々に測定する。
- 正常記録が失敗したRunと併存する状態、古い補正操作、diagnostics削除と同期の競合、元データを保った競合解決、繰り返し移行失敗後の復旧を端末コピーでも確認する。
- Firestore/Storageの本番費用・保持/回収ポリシー・セキュリティ運用・バックアップ、TaskMemoとは別のProject/namespaceでの運用設計を確定する。未完了blobの自動回収や本番同期は今回有効化していない。

合成データの成功は実機24時間走行の安全性の保証ではない。mainへのmerge・実機移行・Production配備は行っていない。
