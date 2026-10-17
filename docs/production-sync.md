# 実走データの本番Firebase同期

2026-10-17。ユーザーの本番同期・専用プロジェクト新規作成の指示に基づく後続開発。従来のEmulator限定から、本番Firebaseにも明示接続できるようにした。TaskMemoのプロジェクトや安定Test v17実機は変更していない。

## 現在の接続先

- Project ID: `runjourney-ysht-2026`（RunJourney専用）
- Firestore: `(default)` / Standard / Native / `asia-northeast1`（東京）、DB削除保護ON
- Authentication: Firebase Authentication / Email-Password有効、匿名ログインは使わない
- 請求先: **billingEnabled=falseを確認**。Blaze、Cloud Storage、有料バックアップ/PITR、Functions、公開Hostingは有効化していない。無料枠の上限に達した場合は同期エラーとして扱い、ローカル原本を保持する。
- 所有者別の既存rulesを配備済み。未認証・別UIDのread/writeを拒否し、公開済みGPSページ/manifestの上書き・削除を許可しない。
- [Firebase Console](https://console.firebase.google.com/project/runjourney-ysht-2026/overview)

GoogleアカウントでのAuthentication初期化はユーザーが実施。その後にEmail/Password有効化と`FIREBASE_AUTH` subtypeを確認した。請求先の追加やIdentity Platformの有料アップグレードは行っていない。

## 安定v17を更新しない利用手順

1. 走行終了後、v17の **設定 → データ / Export・Import → Backup JSONをExport** で保存する。バックアップを消さず、PCにコピーする。進行中のdraftは今回の送信対象外。
2. PCのWebを再読み込みしてSettingsを開く。同期先に **インターネット経由の本番Firebase** が選ばれ、Project IDが上記と一致することを確認する。
3. **本番Firebaseに接続**。初回はRunJourney用のメール/パスワードを決めて **RunJourneyアカウントを作成** する。以後は同じアカウントでログイン。Firebase ConsoleのGoogleログインとは異なるアプリ用アカウントであり、Googleのパスワードを入力する必要はない。
4. **v17の実走バックアップを同期** 内の **実走バックアップを選択（まだ送信しません）** からPCのコピーを選ぶ。ファイルの検証とローカル保管だけを行い、この時点でネットワークへ送信しない。
5. 候補のRun ID・日時・GPS点数・選択チェック・送信先・UIDを確認し、**選択した実走記録を送信キューへ登録**。
6. **実走データを同期／再試行**。完了後、**クラウド履歴を読み込む（GPSなし）** で一覧を取得し、履歴詳細のGPS先頭/次ページで地図を表示する。

ごみ箱・draft・端末設定は送らない。通常の走行メタデータと原GPS、停止イベント、補正情報、診断は送信対象。位置情報を含むことを同期画面に表示する。Webでは原GPSの編集は行わない。

### 大きい旧JSON

ブラウザで一括解析する旧JSONは5MiBまで。より大きいv17 JSONは、このPCで次のコマンドを実行して新しいNDJSONを作成する。

```powershell
cd D:\working\RunJourney
npm run prepare:v17 -- --input "$env:USERPROFILE\Downloads\backup-copy.json" --output "$env:USERPROFILE\Downloads\runjourney-upload.ndjson"
```

`backup-copy.json`は実際のコピー名に置き換える。元ファイルと同じ出力先、既存出力への上書きは拒否する。v17形式v2はSHA-256を検証し、変換前後で入力ファイルのhashが同じことを確認する。ごみ箱・draft・設定は除外し、新しいページファイルだけを書き出す。BOM付きUTF-8も受け付ける。

この旧形式互換変換はPCで50MiBまでを解析する有限の一括読込であり、無制限ストリーミング変換ではない。50MiB超を強引に読むことはしない。新しいNDJSONのWeb取込は最大512MiB、1ページ128行/64KiBで処理する。SQLite原本ファイルを直接指定して移行・上書きする機能ではない。

## 永続キューと安全性

- 同期用IndexedDBは、production/emulator・Project ID・UIDで分離する。再読み込み・ログアウト後も、保管済みページと未完了キューを保持する。
- 同じアカウントで接続し直すとキューを復元する。既送信のhash一致ページは再利用し、未完了分を再試行する。原本ファイルを再度編集する必要はない。
- キューにはmanifestと状態のみを保存し、巨大GPS JSONを入れない。ページの実体は別のblob領域へ保管する。
- Web Locksにより同じアカウント/プロジェクトの同期画面を別タブで同時操作できない。作業中のPromise完了とDB closeを待ってロックを解放する。接続先またはアカウントが変わったら旧データ表示をクリアする。
- 完了したPC内コピーは専用消去ボタンで削除できる。未完了キューがある間は消去を無効にする。実機、元ファイル、クラウドを削除しない。
- 同一IDの異なる内容は競合として停止する。現在はimmutable revision1の一方向同期であり、更新・双方向編集の統合は提供しない。古いキューのrevision更新や自動的な競合上書きも行わない。
- 送信失敗でv17 DBやPC原本へ戻り書きしない。サーバーの受領と整合性を確認してからキューを完了にする。

## Nativeから直接送る場合

同期対応コードにも、本番FirebaseとEmulatorの選択・送信先表示・所有者別キューを実装した。新規ビルドの識別はTest versionCode18 / `cloud-sync-v18` / SQLite schema2とし、v17と誤認する表示を修正した。ProductionのversionCodeは変更していない。

**この作業ではAPK生成・実機インストールを行っていない。既存v17のバイナリへ同期ボタンが自動で追加されるわけではない。** 実機から直接送信するには新しい同期対応ビルドが必要で、その起動時にschema2への移行も走る。安定v17への更新は、事前バックアップ・隔離コピーでの移行/復旧確認・実機適用の明示承認を経て別途行う。今すぐv17実走データを同期する方法は上記のバックアップ経由。

Native Authはセッション内認証で、再起動後は再ログインが必要。GPS/STOP処理は同期に依存しない。STOP後の自動登録・背景自動同期は未実装で、手動プレビュー→登録→送信とする。

## 設定と再現

このPCは `.env.local` の `EXPO_PUBLIC_RUNJOURNEY_FIREBASE_CONFIG` に専用Webアプリの公開SDK構成を設定済み。Firebaseの秘密鍵・サービスアカウントJSON・ユーザーのパスワードは不要。`.env.local`と取得したSDK構成ファイルはGit対象外。別PCではFirebase ConsoleからWeb用firebaseConfigを取得して同じ変数へJSON文字列を設定し、再ビルドする。`authDomain`/Project IDの不一致・demo-project・秘密鍵形式は拒否する。

```powershell
npm run web:build
npm run web:preview
# http://127.0.0.1:4173/?view=settings
```

Emulator検証は引き続き別モードで利用可能。CLIは `npm run sync:emulators` と `npm run sync:demo`。本番アカウント/データとは別領域になる。EASで将来ビルドする際は、同じ公開構成を該当EAS environmentにも設定する必要がある（Git対象外の`.env.local`が自動で送信されると仮定しない）。

ルール再配備時の明示コマンド:

```powershell
npx --yes firebase-tools@15.34.0 deploy --only firestore:rules --config firebase.production.json --project runjourney-ysht-2026
```

## 検証結果

- Jest: 設定検証・所有者分離・ページ再試行・一時staging読出失敗からの復旧を追加し296件成功。
- v17形式変換: 合成SQLiteバックアップを使い、SHA検証、原本不変、点数、除外対象、上書き拒否、破損拒否を確認。
- 実Firebase Emulator: 既存2統合テスト成功。24時間17,281点・途中失敗後の継続と所有者ルールを含む。ページ基盤7テストも成功。
- **本番Firebaseの実SDKスモーク成功**: 合成241点を本番へ送信。途中の送信失敗→キュー再構成→再送完了→全GPS点数照合、別UID読取拒否、ローカル合成原本不変を確認。未認証readの拒否も別途確認。実走データはまだ送信していない。
- 本番スモーク用のランダム生成アカウントは検証後削除。immutable合成レコードは専用UIDの領域に残し、実ユーザーの履歴とは混在しない。テストスクリプトは `.env.local` と明示の `--synthetic-only` が必要で、通常のJest/CIから本番へ接続しない。
- ブラウザ: v17形式の合成361点バックアップを取り込み、未送信状態、キュー1件の再読込後復元、送信完了、クラウドメタデータ8件取得/GPS0ページ、別タブの同期拒否を確認。本番プロジェクト名とアカウント作成/ログイン画面も確認した。
- lint / typecheck / Web export / Android Hermes exportを実行。Android exportはAPK生成や実機検証ではない。

実走ファイルの場所を推測して読み込むことや、実走GPSを自動送信することは行っていない。ユーザーが送信画面で自分のコピーと対象を選んで初回同期する。

公式資料: [Firebase Email/Password](https://firebase.google.com/docs/auth/web/password-auth)、[Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)、[Expo環境変数](https://docs.expo.dev/guides/environment-variables/)。
