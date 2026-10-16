# Web Review / Cloud Analyzer 実装報告

検証日: 2026-10-17（Asia/Tokyo）。親テーマ #29、関連 #2 / #3 / #9 / #10。

> 長時間走行の追加要件に対応した最新の保存構造・ページ同期・試験・移行手順は [長時間走行データ基盤](long-run-storage.md) を参照。この文書の初期同期形式（RunRecord全体のJSON化）とWebメモリ保持の説明は旧方式であり、通常のWeb/同期画面はschemaVersion 2のページ方式へ置き換えた。

## 1. Git・データ保全

開始時はmain `626f4be`、origin/mainとの差分0。SQLite v17移行・復旧作業が未コミットだった。
`preservation/sqlite-v17-before-web` の `d6d4535` へコードを保全してpushし、その上に指定の `feature/web-cloud-analyzer` を作成・pushした。
既存rescueツールのソースも `0383e4f` で保全した。生成Androidディレクトリ、APK、SQLite、診断ログ、救出原本は追加していない。

Production / Test v17の実機へインストール、実データの読み込み・同期、本番Firebase接続、公開デプロイ、課金設定、mainへのマージは行っていない。TaskMemoは参照のみ。

## 2. TaskMemo調査・再利用

対象はローカル `D:/working/TaskMemo/TaskMemoApp`（HEAD `7f2123c`）。別の推測リポジトリは使用していない。

| 分類 | 確認したファイル（同リポジトリ内） | RunJourneyへの適用 |
| --- | --- | --- |
| A: パターン再利用 | `src/services/firebaseClient.web.ts`, `firebaseClient.native.ts`, `firebaseConfig.ts` | Firebase JS SDKのmodular API、名前付きapp、Emulator接続、Auth/Firestoreの分離。実設定・Project ID・認証アカウントは流用しない |
| A: パターン再利用 | `src/sync/stateMachine.ts` | pending/retrying/errorと受領済みの区別。空キューだけを送信完了と表示 |
| B: 移植・改修 | `src/sync/outbox.ts`, `syncEngine.ts`と各test | 永続化後の送信、検証受領後の削除、指数バックオフ、再試行、失敗情報。RunRecord単位の所有者固定SQLiteキューとして実装。保存失敗時にメモリだけ先に変えないよう改良 |
| B: 方針再利用 | `src/sync/firebaseSyncAdapter.ts`, `firebaseSyncAdapter.integration.test.ts`, `firebaseEmulatorV2.e2e.test.ts`, `firebaseOnboardingConnect.test.ts`, `src/services/firebaseOnboarding.ts`, `firestore.rules` | 所有者検証、トランザクション、同一操作の再送安全性、Emulatorでのルール確認。TaskMemoのonboarding callableや互換gateは移植しない |
| B: 参考調査 | `src/sync/ownershipReconcile.ts`, `ownershipSortKeys.ts`, `ownershipSortKeys.test.ts`, `recoverySortKeyRepair.ts`, `recoverySortKeyRepair.test.ts` | 別領域の順位をそのまま結合すると衝突する問題を確認。TaskMemoは採用するlocal側だけを再順位付けしaccount側を保持する設計。RunJourneyにはsortKey/parentId/ツリー/順位検証を導入しない |
| C: 専用 | RunJourney `src/domain/review.ts`, `src/sync/protocol.ts` | GPS不変、Run ID、SHA-256、GPS点数、分割送信、Effective Run、Journey、Streak |

TaskMemoには永続Outbox、再試行、revision、所有権調整、セキュリティルール、Emulatorテストが存在することをソースで確認した。ただし今回TaskMemoのテストを実行しておらず、本番の稼働状況まで確認したわけではない。Cloud Storage利用の全体監査は未実施。共通ライブラリ依存は作らず、必要な同期パターンをRunJourneyへ移植・適合した。Native Authは今回はセッション内認証で、認証情報のSQLite保存は行わない。

## 3. アーキテクチャ・実装結果

Expo SDK 57 / Expo Router / React DOM / Leaflet / Firebase JS SDK 12.4.0。
Viteを別に追加せず、既存React/TypeScriptと型・計算を共有する。Firebase最新版のNode要件が既存Node22環境と合わなかったため、Expo公式の対応範囲である12系に固定した。

```text
Native: GPS → 既存SQLite確定保存（従来のまま）
                       ↓ 手動プレビュー・明示登録
                 所有者別SQLite同期キュー
                       ↓
            Firebase Auth / Firestore Emulator
                       ↓ ハッシュ・点数検証
Web: JSON / Cloud → 共通Effective Run → 統計 / 地図 / Journey / Streak
```

Webルートは `src/app/*.web.tsx`。Nativeのrouteとlayoutは維持する。Metroのplatform限定resolverでRouterの明示拡張子importを対応platformへ解決し、WebへGPS task/SQLiteを混入させず、Nativeへブラウザ用画面を混入させない。WebからNative専用URLへ移動した場合はReviewへredirectする。画面切替はExpo RouterのURLパラメーターで行う。

| Issue | 実装 | 制約・未完了 |
| --- | --- | --- |
| #29 | PC Dashboard、期間7/30/90日/全期間、日/週/月集計、履歴50件ページ分割、詳細、距離/実走/全経過/ペース/速度、5分ラップ、停止区間、JSON取込、認証とクラウド閲覧、空/エラー/読込状態、診断画面 | 本番接続と編集・双方向同期は未実装。実機での新画面動作は未検証 |
| #2 | 累計Effective距離からJourney再計算、月までの全体進捗 | Web試作。NativeのJourney画面は未実装 |
| #3 | Leaflet地図、保存GPSの軌跡、START/STOP、zoom、全軌跡fit、ON/OFF、診断点の選択連動 | ラップ地点・Stop地点の専用マーカーは未実装。Native地図は未実装 |
| #9 | 静岡→モルディブ→地球一周→月、現在地、次の目的地、残り実走距離、到達表示 | ルート地点は設定データ。地理経路の実測値と混同しない演出用ロードマップ |
| #10 | 日別合算、現在/最高Streak、今日の残距離、35日カレンダー、タイムゾーン、ON/OFF | NativeのStreak画面は未実装。Freezeや報酬なし |

### 共通計算の契約

- `RunRecord`と `effectiveRun` / `timeModel` / Pace AnalysisはNative既存ロジックをそのまま使用し、GPSから独自の別総距離を作らない。詳細には元の保存距離も併記する。補正結果は原GPS・recovery・stopOverridesから導出する。
- ごみ箱は統計・Journey・Streakから除外。不正な距離・日付は取込検証で拒否し、集計関数でも無効履歴を除外する。
- Streakは設定値1000m/日。開始日の選択タイムゾーンへ全距離を計上する。日を跨いでもGPSの欠損から日別距離を推測分割しない。今日が未達でも昨日までの連続記録を残す。浮動小数誤差の許容は1マイクロメートルのみ。
- Journey倍率は100。実走距離は変えない。中間地点7200/40075kmは演出値、月384400kmは平均距離を基準にした目標値。設定値は `JOURNEY` に集約し、履歴から再計算する。
- 日別集計は開始日、週別は月曜日起点。タイムゾーン選択はTokyo/UTC/Los Angeles/London。

### JSON・診断・地図

JSON v1バックアップ、SHA-256付SQLite v2バックアップ（completedだけ表示。draft/設定は書き込まない）、RunRecord単体/配列、Auto Stop診断schema2に対応。ファイル上限50MB。同一ID・異なる内容は拒否。失敗時は表示中データを維持する。読込データはメモリ内だけで保持し、ページ再読込時は再取込する。永続化するのは表示ON/OFFのみ。

GPS速度、accuracy、保存点間隔、GPS点間算出累計距離を表示。グラフは最大900個のbucket最大値へ描画量を制限し、元インデックスを保持する。速度12.5m/s超・accuracy50m超・間隔15秒超を強調。選択した元GPS点と地図位置を対応付ける。記録されたイベント・診断はそのまま表示し、buildHash等がRun内にない場合は「データなし」。GPS保存点間隔と高頻度Observationは明確に区別する。GPS点間累計グラフは停止補正前の派生計算で、Effective総距離と区別する。

地図表示は初期OFF。ON後も初期はローカル座標グリッドで軌跡を描画し、「背景地図を読み込む」の明示操作後だけOSMタイルを取得する。LeafletはBSD-2-Clause、APIキー不要。OSM attributionを表示し、タイルを事前取得・一括ダウンロード・独自キャッシュしない。タイルはbest effortで商用SLAはない。位置情報を背景タイル取得先へ送ることをUIに記載。無効な座標、逆順時刻、60秒超の欠測、日付変更線横断では線を分割し、架空の点で埋めない。

## 4. クラウド同期

**現時点で本番クラウドとして完成していない。ローカルEmulator専用で一方向同期の縦断経路を実装・検証した。**

- Auth: Firebase Email/Password。専用 `demo-runjourney` プロジェクトのEmulator以外は設定しない。TaskMemoの認証・プロジェクト・コレクションは共有しない。
- Metadata: `runjourney/{uid}/runs/{encodedRunId}`。schemaVersion=1 / revision=1 / ownerUid / SHA-256 / GPS点数 / chunk数 / complete。
- Payload: `runjourney/{uid}/payloads/{encodedRunId}_{hash}_{index}`。巨大なGPS配列を一文書へ入れず、canonical原Run JSONを最大64000文字のchunkへ分離。UTF-16 surrogate pairを分割しない。メタデータは全chunk送信後にトランザクションで作成し、受信時は再結合後のSHA-256・点数・Run IDを確認する。
- Cloud Storage案はStorage/課金設定が未承認のため採用を保留。今回の分割FirestoreはEmulator用の代替実装。実環境での料金・read回数・Storage方式の評価は次段階。
- 同一ID・同一hashは再送安全。同一ID・異なる内容は衝突として保持し上書きしない。中断したchunk送信は再実行で再開する。欠損・不正schema・不一致hashは表示や受領を拒否する。
- Outboxは所有者UID固定、SQLite設定領域にrun snapshotを永続保存する。1/2/4秒…最大300秒の次回retry時刻を記録し、手動flushで再試行する。UIの「再試行」は時刻を待たず実行する。恒常的なバックグラウンド自動retryやSTOP直後の自動enqueueは今回接続していない。
- Native専用Cloud Sync画面で対象件数/GPS点数を確認してからキュー登録する。ログアウトしても所有者別キューを保持し、別UIDで開くことは拒否する。記録・STOP処理は同期の成功を待たない。
- Rulesは所有者だけが読み取り・作成可能。元payload/metadataの更新・削除は禁止し、TaskMemoなど他パスはdefault deny。Webは読取APIだけを利用する。現在のrulesはemulator用設定ファイルにのみ登録し、外部へdeployしていない。
- revision1は不変snapshotのみ。Native側の後日補正・trash変更の再送は同ID衝突になる。将来のEdit Operations/revision更新・競合解決・アカウント削除ポリシー・初回実履歴大量送信は未実装/未承認。

## 5. 検証

| コマンド | 結果 |
| --- | --- |
| 開始時 `npm test -- --silent` | 27スイート / 240成功 / 0失敗 |
| 実装後 `npm test -- --silent` | 29スイート / 269成功 / 0失敗 |
| `node --test scripts/sqlite-native.test.cjs` | PC SQLite回帰13成功 / 0失敗 |
| Emulator起動後 `npm run test:sync:emulator` | 実SDK・実rulesの統合テスト1成功 / 0失敗。内部で複数の拒否条件を検証 |
| `npx tsc --noEmit` | 成功 |
| `npx expo lint` | 成功 |
| `npm run web:build` | 静的Web export成功 |
| `npx expo export --platform android --output-dir .expo-export-check/android` | JS/Hermes bundle生成成功。APK作成・実機インストールとは別 |

同期テストは正常送受信、再送、通信断、再試行、途中失敗、無効データ、未来schema、同一ID衝突、ローカル成功/remote失敗、欠損/改ざん、所有者固定、永続化失敗、Unicode分割を含む。実EmulatorではPCのアプリ共通SQLiteコードから確定保存→Outbox→Firebase→Web readerを実行し、元記録不変、他UID読取/書込拒否、上書き/削除拒否、他パス拒否を確認した。PERMISSION_DENIEDは拒否テストの期待結果。

ブラウザでは空画面、サンプル、履歴/詳細、地図とzoom、Journey、Streak、診断、JSON v1/v2、壊れたJSON後の保持、機能ON/OFF、Emulatorログインと同期履歴7件取得を手動確認した。Desktop 1440pxと狭い幅の表示を確認。UIを通した自動E2Eテストではない。

途中で検出して修正した問題: Native SQLite依存のWeb混入、React Compiler lint、1km境界の浮動小数誤差、Unicode chunk分割、Router画面背景色、リンクのコントラスト。最終結果は上表の最終再実行結果で判断する。

未検証: 実機START/STOP/GPS/音声/背景/復元・新Native同期画面、iOS実行、本番Firebase、実履歴大量同期、長期運用、モバイル実端末ブラウザ。実機Test v17には触れていない。

既知の保留: `npm audit --json` は73件（moderate17/high55/critical1）を報告。既存Expo/RN/JestおよびFirebaseの推移依存を含む。提示される自動修正にはSDK非互換のmajor変更/ダウングレードが含まれるため、`audit fix --force` は実行していない。公開前の依存監査・修正は別途必要。

## 6. 起動方法

Node 22.14系（最低22.13）/ npm。新規checkoutは `npm ci`。Java 21はEmulatorテスト時だけ必要。

Web開発サーバー:

```powershell
cd D:\working\RunJourney
npm run web
```

静的ビルドをローカルで確認:

```powershell
npm run web:build
npm run web:preview
# http://127.0.0.1:4173
```

既に4173が起動している場合はそのURLを開く。別ポートは `$env:RUNJOURNEY_WEB_PORT='4174'` で選べる。外部公開はしない。

サンプルボタンだけで全画面を試せる。地図/Journey/StreakはSettingsでON。バックアップはJSONを選んで読み込む（アップロードしない）。

同期を試す場合は別ターミナル:

```powershell
npm run sync:emulators
# Auth :9099 / Firestore :8080 / UI :4000、すべて127.0.0.1
```

さらに別ターミナル:

```powershell
npm run sync:demo
npm run test:sync:emulator
```

WebのSettings→Emulatorに接続→ `runner@example.test` / `synthetic-pass-123` →ログイン→クラウド履歴を読み込む。これはコードに明示した**ローカルEmulator専用の架空資格情報**で、実サービスの秘密情報ではない。seedは固定日付の架空7RunをPC内の一時SQLiteで確定保存して同期する。再実行しても同一Runを二重登録しない。Emulator終了後のデータ永続exportは設定していない。

Firebase用環境変数・秘密鍵・実アカウントは不要。`firebase.runjourney.json` だけを使い、TaskMemoの `.firebaserc` や設定をコピーしない。Native Android Emulatorの `10.0.2.2` 接続はコードで対応するが、CLIはloopback bindのためホスト設定次第で接続できない場合がある。今回Android Emulator/実機接続は未検証。実機導入・LAN開放は行わない。

## 7. 次に本人が判断すること

1. WebのUIとDraft PRをレビューする（Issueは未Close）。
2. 本番利用へ進む際、RunJourney専用Firebaseプロジェクト、認証、Storage/課金、保持・削除ポリシーを決める。設定や実走データ初回大量送信は本人の明示承認後。
3. Native側を検証する際、安定Test v17を守る別の開発ビルド・端末での導入方法を承認する。実機への更新は今回未実施。

## 参照した一次資料

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)、[LLM向け索引](https://docs.expo.dev/llms.txt)、[platform別module](https://docs.expo.dev/router/advanced/platform-specific-modules/)、[Metro resolver](https://docs.expo.dev/guides/customizing-metro/)
- [Expo Firebase](https://docs.expo.dev/guides/using-firebase/)、[Firebase transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)、[Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore)、[Email/Password Auth](https://firebase.google.com/docs/auth/web/password-auth)
- [Leaflet API](https://leafletjs.com/reference.html)、[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
