# Test v14 読み取り専用救出 — PC検証報告（2026-10-09）

この文書は未署名のPC検証段階の記録。後続承認による署名済みAPKと実機導入前手順は [PREINSTALL.md](PREINSTALL.md) に記録した。実機操作は引き続き未実施。

承認範囲である設計・実装・PC上の検証を完了した。実機への接続、APKインストール、アプリ起動、保存再試行、実機での救出、DB変更、移行、削除、既存Exportのインポートは行っていない。通常アプリのソースと構成は変更していない。

## 保存構造とCursorWindowの回避

インストール済み依存 `@react-native-async-storage/async-storage` は2.2.0。Android実装は `RKStorage` の `catalystLocalStorage(key TEXT PRIMARY KEY, value TEXT NOT NULL)` を使う。`AsyncStorageModule.multiGet` はキーを分けても `key,value` の全体をSELECTし、`cursor.getCount()` でウィンドウを充填する。そのため単一値が巨大な場合、getItemやmultiGetのキー数を減らしても解決しない。

参照元: `node_modules/@react-native-async-storage/async-storage/android/src/main/java/com/reactnativecommunity/asyncstorage/AsyncStorageModule.java` の103–138行、同ディレクトリ `ReactDatabaseSupplier.java` の25–38行。SupplierのensureDatabase再試行には削除処理があり、ModuleのコンストラクタにもExpo migrationがあるため、救出側では両方を使用しない。

`src/repositories/run-repository.ts` で履歴は `@runjourney/runs/v1` の単一JSON配列、draftは `@runjourney/active-run/v1` の単一JSONオブジェクト。その他にrun-features、voice-announcement、voice-itemsのv1キーがある。救出は既知キーだけに限定せず、テーブルの全行を対象とする。履歴のTrashも元配列のまま保持する。期限切れ削除、GPS補正、Effective Run再計算、二重保存解消を実行しない。

原本はSQLiteで開かない。DB本体と存在する `-wal`、`-shm`、`-journal` をFileInputStreamで新規領域へコピーし、その保全コピーからさらに作業コピーを作る。作業コピーだけをAndroid SQLiteDatabaseの `OPEN_READONLY | NO_LOCALIZED_COLLATORS` で開く。全値をSELECTせず、数値だけの行一覧を取得してから、次のSQLを64 KiBずつ実行する。

```sql
SELECT rowid, length(CAST(key AS BLOB)), length(CAST(value AS BLOB)), typeof(value)
FROM catalystLocalStorage ORDER BY rowid;

SELECT substr(CAST(value AS BLOB), ?, ?)
FROM catalystLocalStorage WHERE rowid = ?;
```

パラメータは「1から始まるバイト位置」「最大65536バイト」「rowid」。SQLiteのsubstrはBLOBでは文字数ではなくバイト数を使う。CursorWindowに入る結果行を64 KiBに抑えるため、巨大な単一値にも適用できる。SQLite内部での式評価に必要なメモリ・I/Oまで消す方式ではない。キーも上限8192バイトを確認してから読む。さらに巨大なキーは原本コピーに保持して名称未分類とする。

各断片をUTF-8文字列に変換せず、そのまま連結して `.bin` に保存する。多バイト文字、絵文字、NUL、未知フィールドも維持する。JSON解釈はPC側で連結済みの全バイトに対して行う。仕様根拠: [SQLite substr](https://www.sqlite.org/lang_corefunc.html#substr)。標準Android SQLiteで作られたAsyncStorage 2.2.0のテーブル構造に対応する。未知の暗号化・別スキーマ・破損DBを自動修復するものではなく、失敗時もコピーと部分出力を保持する。

## 起動時の書き込み防止

通常アプリへ救出画面を追加する方法を避け、`rescue/android` に独立した小さなAndroidプロジェクトを作った。元の生成済みandroidディレクトリは編集していない。Applicationはsuper.onCreateのみ、Activityは画面生成のみ。開始ボタンを押すまではDBパス取得・コピー・SQLite接続・出力を行わない。

releaseRuntimeClasspathは依存なし。Expo、React、AsyncStorage、通常アプリのRepository、SQLiteOpenHelper、migration、測位タスク、初期化Providerを含まない。マージ済みrelease ManifestはApplicationと単一Activityのみで、Provider／Service／Receiver／権限はない。起動時に自動救出や自動保存を行わない。明示開始後の失敗でも通常保存へのフォールバックはない。

出力は将来承認された実行時に `getExternalFilesDir("read-only-rescue")/rescue-<時刻>-<UUID>/` に作られる。通常は `/storage/emulated/0/Android/data/app.runjourney.mobile.test/files/read-only-rescue/` 以下となるが、端末の実パスは実行結果で確認する。原本DBディレクトリ内への出力を拒否し、新規作成のみで上書き・削除しない。

## 検証結果

PC上のRobolectric API33 / NATIVE SQLiteモードで7件成功、失敗・スキップ0件。単なるAsyncStorageモックではなく、ネイティブSQLiteとCursorWindowを使用した。

- 6,000,000バイトの単一値: 2 MiBのCursorWindowに通常SELECTを入れるとSQLiteBlobTooBigException / Row too bigを再現。同じ行を救出すると全バイト一致。日本語・絵文字・NULを含む。
- JSON履歴12,000,729バイト（4件）とdraft3,000,181バイト、未知キー11バイト、空値0バイト: 全行のサイズ・SHA-256・元バイトが一致。Raw GPS、イベント、未知フィールドを保持。
- 開いた書き込み接続のWALにあるコミット済みデータをコピーから読め、元DBとWALのハッシュが変わらない。
- コピー中の外部変更は失敗として停止し、部分コピーを保持。
- 欠損DBを作成せず、破損DBを削除・修復せず、原本ディレクトリへの出力を拒否。
- Application／Activity起動で既存DBのハッシュが変わらず、Provider／Service／Receiverが存在しない。

独立したPython検証テスト10件成功。大容量JSON、履歴0件と履歴キー欠損の区別、draftと履歴のID重複検出、切り詰め、原本コピーの破損、キー改ざん、パス逸脱、失敗manifest、不正JSON／重複JSONメンバー／非有限数、不正UTF-8、重複走行IDを確認。拒否時にも全出力を保持する。PC検証は履歴/draftのID・時刻文字列・GPS/イベント配列の基本構造を検査するが、全ドメインフィールドの完全妥当性や復元可能性を保証するものではない。

Java救出が生成したセッションを独立したPython SQLiteで再検証し、4件とdraftを確認、サイズと全バイトSHA-256が一致した。履歴とdraftの件数を報告し、GPS／イベント／全フィールドの補助ハッシュも記録する。原本値のSHA-256が主たる一致判定であり、JSONの補助ハッシュで原本を再生成しない。

追加確認: release APKビルド成功、Android lintは0エラー・7警告（target SDK、新版テスト依存、バックアップ設定、アイコン、表示文字列）、通常アプリのExpo lint／TypeScript型検査成功、既存Jest 26スイート234件成功。release APKは未署名・非debuggableのPC検証用成果物で、実機導入可能な署名済みAPKは用意していない。

PC合成データと成果物の保存先: `D:\working\RunJourney-preservation\2026-10-09-rescue-pc`。

- `synthetic-session/`: raw-source、working、values、manifest。実機データではない。
- `pc-validation.json`: 独立検証結果。
- `app-release-unsigned.apk`: 10,164バイト、SHA-256 `50cd9b08ad7d2bd48f8b9bd51b6990ae1cc9c88378d1d599aec4d0558a48e1c5`。

検証ログと起動テスト結果は同保存先へ保全した。未署名APKのPC確認用ビルドコマンドは既存wrapperから `gradlew.bat -p ..\rescue\android :app:testDebugUnitTest :app:assembleRelease :app:lintRelease`。Pythonは `python -m unittest discover -s rescue/tests -v`。実機操作用スクリプトは作っていない。

## 原本保全の保証範囲と限界

救出コードの原本アクセスはFileInputStreamによる読み取り、サイズ・更新時刻参照のみ。原本へのSQLite接続、書き込み、削除、checkpoint、migration、ファイル名変更はない。コピー前・直後・救出後のファイル集合、サイズ、更新時刻、SHA-256を照合し、コピー内容も元のハッシュに照合する。コピーのquick_checkに成功しても、実機の原本が不変だったことを将来の実行前に断言することはできない。

読み取りによるOSのアクセス時刻更新、インストールによるパッケージ管理情報変更、別プロセスやOSの動作までは保証できない。複数ファイルのコピーは原子的スナップショットではない。観測間に内容が変化して元に戻る競合などを数学的に除外できず、ハッシュとquick_checkは競合・破損を検出する安全策であって完全な証明ではない。hot journalの回復等が読み取り専用でできなければ停止し、rawコピーを残す。作業コピーの補助ファイルはSQLite実装が更新する可能性があるが、原本とraw-sourceはSQLiteで開かない。

現時点では実機の最新DBを取得できていない。残存履歴数や直近2件の復旧可否は未確定。永続化されずv14プロセスのメモリだけにあるデータは、この方式では救出できない。特に更新インストールは既存プロセスを終了させるため、メモリ内の未保存データを失う可能性がある。

## 導入リスクと次の承認

別applicationIdの救出APKでは既存Testのprivate DBにアクセスできない。想定導入方法は、Testと同一applicationId・同一署名の更新APKである。本プロジェクトのversionCodeは15。署名不一致で拒否された場合もアンインストールに切り替えてはいけない。Productionのpackageにはアクセスしない。

同一ID更新でも、インストールの無影響を保証できず、プロセス終了による揮発データ喪失、OS/OEM動作、署名設定間違い、空き容量不足、将来の通常アプリ復帰時のmigration等が導入リスクとなる。原本コピーと作業コピーと値の出力が必要なので、DB容量の数倍の空き領域が必要。外部files領域の出力はアンインストール等で失われ得るため、救出後はPCへ保全し検証が済むまで他操作をしない。バックアップ設定に関するlint警告も実機導入判断前に確認する。

次に個別承認が必要なのは、既存v14署名との照合・導入候補の署名、同一ID更新APKの実機インストール、救出アプリ起動、明示的な救出実行、結果のPCコピーと検証である。これらを今は実施しない。通常アプリへの修正・復元・インポート・履歴移行・削除・再試行はさらに別承認の対象。この報告時点で停止する。
