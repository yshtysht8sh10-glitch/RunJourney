# スマホから本番Firebaseへ同期するTest v18

2026-10-17。既存バックアップのPC経由送信に加えて、スマホ内SQLiteを原本に、手動でFirebaseへ直接送るための対応版。実機へのインストール・起動・DB移行はこの開発作業には含めない。

## スマホでの操作

1. 対応版の設定 → Cloud Syncを開く。RUN完了画面の「このRUNをクラウド同期」からは、その記録だけを候補にする。
2. 本番Firebase / `runjourney-ysht-2026` を確認し、Webと同じRunJourney用メール/パスワードでログインする。アプリ再起動後は再ログインする。Google Console用パスワードは不要。
3. 「送信対象の履歴を確認」で日時・距離・GPS点数を確認し、チェックで個別選択。メタデータのみを取得し、ごみ箱・draftを除外する。読出エラーのある記録は表示して選択不可にする。
4. 「選択した履歴を送信キューへ登録」→「キューを送信 / 再試行」。ログインや候補の表示だけでは送信しない。
5. Webで同じアカウントにログインし「クラウド履歴を読み込む」。詳細のGPSはページ単位で取得する。

STOPの保存はネットワークへ依存させない。自動送信・背景同期は提供せず、保存済み記録を明示操作で送る。通信中断後は同じ接続先/所有者のSQLiteキューから再試行する。画面再作成時も同じキューインスタンスを共有し、連打を拒否する。同期成功時の原記録編集・削除は行わない。

## ビルド

Expo SDK57資料を確認し、既存Standalone Test variantを使うEAS `cloudSyncTest` profileを追加した。既存の `sqliteTest` を継承し、Productionのprofile/package/versionCodeは変更しない。

```powershell
npx eas-cli@25.1.1 build --platform android --profile cloudSyncTest --non-interactive --no-wait
```

EAS preview環境へ専用Firebase Web公開SDK構成を設定。秘密鍵やユーザー資格情報ではない。`RUNJOURNEY_REQUIRE_CLOUD=1` のビルドでは構成欠損・別Project IDを検出して失敗させ、接続先を確認できないAPKの生成を防ぐ。APKのextraにもProject IDを記録する。

成果物は `app.runjourney.mobile.test` / versionCode18 / SQLite schema2の更新用APKを想定する。**安定v17と同じpackageなので、インストールすれば更新・初回起動でschema2移行になる。未承認でインストールしてはいけない。** 別アプリとして併存する構成ではない。

## 実機適用前

- v17の最新バックアップをExportし、PCコピーの点数・SHA・復元可否を隔離DBで確認する。
- APKのpackage/versionCode/署名証明書とFirebase接続先を検証する。署名不一致時にアンインストールで回避しない。
- schema2は補助テーブルの追加であり、既存GPS行の再格納はしない。隔離移行/rollback試験は `docs/long-run-storage.md` を参照。schema2 DBへ旧APKを戻すだけでは復旧の保証にならないため、v17バックアップからの復旧手順を確保する。
- 適用承認後、短い走行→STOP→アプリ再起動→手動同期→Webの日時/点数/地図照合→通信断再試行を行う。
- このPCのReactテスト・SQLite/Firebase統合試験・APK生成は、Android実機でのGPS/ネットワーク/TLS接続・24時間記録を保証しない。

公式資料: [SDK57](https://docs.expo.dev/versions/v57.0.0/)、[EAS build profile](https://docs.expo.dev/eas/json/)、[EAS環境変数](https://docs.expo.dev/eas/environment-variables/)。

## この追加開発の検証

- Jest全体300件成功後、RUN完了導線で対象を1件に絞るテストを追加して成功（合計301件）。スマホ画面の明示送信、エラー記録の選択不可、認証失敗、連打抑止、キューインスタンスの共有と接続先/所有者分離を含む。
- lint・型チェック・Web export成功。フォーマット後も関連12件・lint・型チェック成功。
- `node scripts/production-sync-smoke.cjs --synthetic-only --sqlite-source` 成功。隔離したPC SQLiteの合成241点とSQLite保存のキューを使い、実インターネット上の本番Firebaseへ送信した。途中失敗時の未公開、キュー再構成後の再送、Web用ページリーダーでの全点一致、別UID拒否、SQLite内原記録不変を確認。検証用Authアカウントだけ削除し、immutable合成レコードは検証専用UID配下に残す。
- 実ユーザーのGPSや実機DBは使用していない。PC SQLite/Node実SDKは、Android上のFirebase実行を代替する証明ではない。
- EAS build: [533c52bb-5911-4bb0-80b6-7776b670008c](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/533c52bb-5911-4bb0-80b6-7776b670008c)、ソース `a707fd8`。以後の差分は同期画面/関連ソースの整形、テスト、PCスモーク、文書のみ。
