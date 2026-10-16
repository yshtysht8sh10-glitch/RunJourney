> 撤回済み：ユーザーの方針変更によりv16は実機導入禁止。正式保存はSQLiteへ統一する。以下は過去の設計記録。

# Test v16：今晩の計測を先行復帰するためのB案

実機へのインストール・起動・RUN・移行はこの作業で行わない。通常の計測機能を含むTest用APKを準備し、導入前で停止する。旧23履歴＋終了済みdraft1件、救出専用v15、PC保全物は保持する。

## A/B比較と採用理由

| 案 | 必要な変更 | 旧データのリスク | 今晩の復帰 |
|---|---|---|---|
| A：旧履歴と通常動作を両立 | CursorWindowを回避する読み取り、AsyncStorage初期化/migration制御、巨大履歴の書き込み、期限切れ削除の抑止、終了済み旧draftの保存待ち経路の整理 | 通常Repositoryが旧キーを書き換える経路をすべて制御する必要がある。読み取りだけの修正では再発・旧draftのSTART阻害が残る | 安全な検証範囲が広い |
| B：別領域で新規計測のみ | 保存先の分離、原子的ファイル保存、再起動・失敗・再試行の検証、履歴読み取りエラー表示 | 旧DBを開かず、旧23件/draftを参照も移行もしない | 比較的小さい変更で実現できる |

Bを採用。既存計測・停止判定・音声・STOPサマリー等を使い、新規記録だけを専用ファイル領域に保存する。旧履歴はこの復帰版の画面に表示しない。ImportはRepositoryで拒否する。位置情報許可・設定・音声設定は通常の画面で確認できるが、旧AsyncStorageの設定を自動移行しないため、復帰後の新領域の設定は初期値から始まる。

## 保存形式と旧DBの保護

Androidのファイル保存先はアプリprivate filesの `runjourney-isolated-kv-v1/`。旧 `databases/RKStorage` と、救出済み外部files出力はアクセス対象外。ネイティブモジュールにはSQLite接続・旧DB名・migration・原本削除・フォールバックがない。Testのpackage以外では保存操作を拒否する。このAndroid復帰構成をProductionへ導入してはいけない。iOS/webの既存backendは維持する。

| ファイル | 内容 |
|---|---|
| key-0.json | この復帰版の保存済み履歴 |
| key-1.json | この復帰版の計測中/終了済みdraft |
| key-2.json | 新領域のauto stop/break設定 |
| key-3.json | 新領域の音声ON/OFF |
| key-4.json | 新領域の音声項目設定 |

各ファイルは `{"schemaVersion":1,"key":"...","value":"元JSON文字列等","sha256":"..."}` の包みを持つ。valueは従来RunRecord/ActiveRun JSON v1の文字列をそのまま保存する。チェックサムはUTF-8で `S + value` のSHA-256。draftの消去は新領域だけにvalue=nullのtombstoneを保存し、そのチェックサムはUTF-8 `N` のSHA-256とする。旧ファイルは削除しない。

新しいIDは `isolated-file-v1-<Crypto.randomUUID()>`。旧23件/draftのUUIDと区別でき、将来の統合時に保存先と形式を識別できる。既存音声イベントの区切り文字であるコロンはIDに使わない。新規間の一意性は暗号学的UUIDに依存する。Raw GPSの内容を補正・移行せず、通常Repositoryの既存処理と同じ配列を保存する。将来の統合・SQLite移行は実装していない。

書き込みは同一ディレクトリの `.pending` に出力し、FileDescriptor.sync、close、`Files.move(ATOMIC_MOVE, REPLACE_EXISTING)`、再読み取り・値比較を行う。atomic moveが使えなければ例外で停止し、削除後の移動には切り替えない。失敗時のpendingは新領域内に残り、以前のコミット済みファイルを読み取り続ける。ディレクトリとファイルを初めて作るのは書き込み時。起動時の読み取りで保存領域や旧DBを作成しない。ファイル破損・チェックサム違反・権限エラーを履歴0件やdraftなしに変換しない。

STOPは新領域に終了時刻固定のdraftを保存し、履歴を保存し、draftをtombstoneにする既存の順序を使う。履歴保存後にdraft処理が失敗しても、IDで重複を除いて再試行できる。複数キーを一つのトランザクションにしたものではない。

AndroidのAsyncStorageをAutolinkingから除外し、JS側はAndroid専用storage.adapterを使う。旧DBを開くAsyncStorage/ReactDatabaseSupplier/AsyncStorageExpoMigrationがAPKに含まれないことを成果物のDEXで検証する。通常Expo/RNは含むが、旧AsyncStorageの初期化・保存経路には到達しない。

## PC検証

- Jest 27スイート241件成功。START→STOP、IDの区別、Raw GPS保持、新規記録の再起動復元、履歴保存失敗時の終了済みdraft維持、再試行時の終了時刻固定、履歴コミット後の中断と二重保存防止、巨大値、不正JSON時の停止、Import禁止、履歴エラーの画面表示を確認。
- Android API33 Robolectricのファイル保存テスト6件成功。実際のファイルIO・sync・atomic moveで大容量値の保存/再生成オブジェクトでの復元、コミット前の失敗、tombstone、破損拒否、キー逸脱拒否を確認。救出済みPCファイルの読み取りから作ったテストコピーで、23件の値とdraftを大容量保存し、保護された旧DBコピーとPC保全原本のハッシュ不変を確認。
- 既存の救出Nativeテスト7件も成功。JestのfilesystemブリッジはRepositoryの状態遷移検証用で、実機のExpo JS/native接続を代替する証明ではない。実際のネイティブファイル保存は別の6件で検証した。
- Expo lint、TypeScript typecheck成功。実機での起動、計測、画面OFF、再起動、GPS/音声許可の検証は未実施。

## ビルドと残るリスク

Expo SDK57の資料を確認し、ローカルExpo Moduleを追加した。[Expo Modules API](https://docs.expo.dev/modules/module-api/)、[Autolinking](https://docs.expo.dev/modules/autolinking/)を参照。EAS recoveryTestプロファイルでStandalone Test APKを生成する。versionCode16、minSdk26、applicationId app.runjourney.mobile.test。署名は既存Test用debug証明書と一致を検証する。[EAS設定](https://docs.expo.dev/eas/json/)のwithoutCredentialsにより別の署名鍵生成を要求しない。

ファイル方式はCursorWindowを使わないため、旧2,134,495 bytesの履歴と同じ行サイズ制限を受けない。ただし新領域の履歴・draftも各一つのJSON値であり、長期のメモリ負荷・全件再保存コスト・Diagnostics増加は解決していない。今晩の先行復帰用で、恒久対応ではない。

容量不足、Android実機でのatomic move非対応、メモリ不足、強制終了や電源断、OSのバックグラウンド制限などのリスクは残る。ファイルsyncと原子的置換を使うが、電源断に対するディレクトリエントリ永続性まで完全保証しない。実機への導入前には署名・ID・versionCode・APKハッシュを再確認し、承認後に短い走行の保存と再起動復元を確認してから今晩の使用可否を判断する。新規RUNによる実機テストにはその承認も必要。

旧23件＋draft1件と今回の新規記録は同時に存在する。旧終了済みdraftを正式履歴に登録する、旧履歴を表示する、統合する、SQLiteへ移行する、Productionへ導入することは別フェーズ。復帰用APKの署名・ハッシュ・保存先と旧PC保全物の再照合結果は成果物ディレクトリの最終報告に記録する。
