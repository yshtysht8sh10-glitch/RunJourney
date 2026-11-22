# Issue #72 — Test限定・Auto Stop診断ジャーナル（第1段階）

## 基準と承認範囲

- 設計条件の正本：[Issue #72の条件付き承認コメント](https://github.com/yshtysht8sh10-glitch/RunJourney/issues/72#issuecomment-6768243491)。本資料はその初回実装を説明する。
- 基点：未マージのTest v28、PR #70 HEAD `f1476f7947779b0fa4aeb28a054efd44255ef0c8`。
- `run-model.ts` の現行v4判定条件は変更しない。Productionの実装・配信状態を表す資料ではない。
- PR #67・#70・#71を更新せず、専用ブランチ `codex/issue72-diagnostic-journal` のDraft PRでレビューする。
- 今回は記録、欠損検出、現行方式の再現、機能上の非干渉確認まで。次工程は利用者レビュー後。
- 実停止マーカー、訂正UI、原データExport、確認付き削除UI、新アルゴリズム/Fモデルの比較、実走受入は未実装。

## 起動・終了と責務

1. Androidかつapplication IDが**完全一致で** `app.runjourney.mobile.test` の場合のみ診断UIとNative保存を許可する。Production、debug、pace、iOS、Webは対象外。
2. 設定は永続化しない。JS起動ごとにOFF。RUN開始前に診断画面で明示的にONにし、Native初期化の完了を待つ。計測中のONはUIで拒否する。
3. 初期化は暗号鍵取得・容量確認・保存先作成を非同期で行う。失敗時はUNAVAILABLEとなりRUN操作を変更しない。
4. RUN保存時にSTARTを記録する。最初のGPS時点が開始点になる経路では、その時点の状態をベースラインとして記録する。過去の入力を埋めたと主張しない。
5. JS入口のバッチ、入場判定、各detectStop出力、バッチ完了、末尾保存、手動操作、目標変更、RAM観測セッション再作成、終了を別レコードにする。
6. 終了履歴の保存成功後にENDを送る。Native workerが残りを保存し、末尾がENDで失敗がない場合だけSEALEDを記録する。JSの送信完了表示だけで完全とみなさない。
7. OFF・記録拒否・bridge例外・容量超過・Native書込失敗・プロセス死は診断を止める。RUNは既存経路を継続する。再起動後に記録を自動継続・自動ONにしない。
8. Nativeモジュール破棄時も診断だけを停止する。残留したNative記録は診断画面のOFFで停止できる。

## データと順序

実装：[契約・リプレイ](../src/domain/detector-journal.ts)、[JS記録制御](../src/services/detector-journal.ts)、[RUN側の観測点](../src/repositories/run-repository.ts)。

- START：schema=1、algorithm=`v4-f1476f7`、判定コード基点SHA、実際のbuildGitHash、RUN開始時刻、設定、イベント、detector状態、観測・永続化watermark。
- INPUT：受け取ったままのraw配列、バッチ境界、AppState、評価直前の状態。重複、順序逆転、無効値も残す。NaN/±Infinityはタグ付きで表現し、JSONのnullに変換しない。
- ADMISSION：バッチ内の評価処理順に、元配列のordinalと `STALE_OR_INVALID` / `INVALID_COORDINATES` / `EVALUATED` を記録する。
- OUTPUT：実際にdetectorへ渡したpoint、window、persistフラグ、受信時刻、および判定後のevents・detector・diagnostics。
- BATCH_END：全評価完了後の状態。評価されなかった入力にもADMISSIONが必要。
- FLUSH：停止・終了時などの末尾GPS保存で、永続化gateを進めた時刻。
- BOUNDARY：手動BREAK/再開、目標変更、save/restore、観測セッション再作成、終了準備、履歴保存後の境界。前後状態とreset条件を記録する。
- END：入力・評価・バッチの総数、終端状態、JS側で測定した最大引渡し時間。
- JSレコードにはseq、wallAt、monoAtを付与する。Native暗号化フレームには独立seq、前フレームSHA-256、enqueue時のwall時刻とelapsedRealtimeを持たせる。
- AppStateは画面ON/OFFそのものではない。Native elapsedRealtimeはジャーナルenqueue時刻であり、OSがfixを生成・配信した瞬間の時刻ではない。
- detectorの唯一のwall-clock記述フィールドであるdiagnostic receivedAt、およびpipelineの実行遅延注記は再現比較から除外する。判断に使うGPS時刻、入力順、窓、設定、イベント、候補状態、判定理由は比較する。
- RUN全体のpoints・pace/audio状態を毎回複製しない。必要なrawとdetector状態だけを別保存する。通常RUN、履歴、Backup、同期、既存音声ログには追加しない。

## 暗号化・容量・保全

実装：[Native保存](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/DetectorJournalStorage.kt)。新しい外部依存は追加しない。

- 保存先：`Context.noBackupFilesDir/detector-journal-v1/<random UUID>/`。通常RUNのSQLite・音声ログ・shared storageと分離。
- 鍵：Android Keystore内の非export AES鍵。AES-GCMでレコードごとに新しいnonceを使用し、セッションUUIDをAADとして認証する。
- ディスクに書くのは暗号文と座標を含まない状態表示だけ。平文GPSの一時ファイル、console/logcat出力、共有、GitHub添付は作らない。
- Native producerはメモリ予約とenqueueのみ。暗号化、ファイル操作、fsyncは専用single worker。detector経路からそれらをawaitしない。
- 未処理payloadはUTF-8で**2 MiBまたは2048レコード**まで。workerで書込中のpayloadも予約に含める。古いレコードを押し出さず、新規受理を拒否して診断を不完全にする。
- 1セグメント**8 MiB**、1診断セッション**64 MiB**、全体**256 MiB**。暗号化frameのサイズを含み、状態管理用の予約領域を残して上限未満で停止する。
- status更新時刻から7日超はexpired候補として表示するだけ。自動削除しない。総容量が上限に達したら新規開始を拒否する。利用者確認付き削除UIは次段階で、今回はアプリ内に削除機能を公開しない。
- 保存時に領域・暗号化等のエラーが起きたらINCOMPLETE。状態ファイルの更新も失敗した場合はCAPTURINGのまま残り、完全判定にはならない。
- Androidバックアップからはno-backup配置で除外する。アプリ削除・鍵消失時の復号不能は保全保証の対象外。
- 2 MiBは予約した未処理UTF-8 payloadの上限。JSのsnapshot/JSON化、bridgeの一時コピー、暗号処理・読出し用領域まで含めたプロセス総メモリ上限ではない。

## 「完全」の条件とリプレイ

- Native読出し時にGCM認証、segment連続性、frame seq、previous hashを検証する。途中切断・改ざんは読出し失敗。
- SEALEDのchain tipと実際の終端hashが一致しなければstorageComplete=false。正常なENDが途中に存在しても、未seal・切断・書込失敗なら不完全。
- JS側でSTART、seq、入力→ADMISSION→各OUTPUT→BATCH_END、前後状態、FLUSH、境界、ENDと総数を照合する。
- rejected inputを含む入場判定、受理順、窓、persist結果、状態遷移、判定出力を同じ現行関数で再計算する。入力件数と保存件数の一致だけでは完全としない。
- **記録ストリームをGPS時刻で並べ直さない。** INPUTの配列をそのまま現行GpsObservationSession.ingestへ渡す。現行関数自身のバッチ内sortは現行動作として再現する。
- BREAK/再開や目標変更など外部状態変更は明示的なBOUNDARYとして適用する。プロセス死を連続したRAM状態として再構成せず、そのセッションを不完全として扱う。
- replay不一致はseqと固定の原因コードで返す。端末UIには整合・不完全の件数だけを表示し、raw payloadを出力しない。
- 端末内リプレイは診断OFF後のみ許可する。Nativeで認証して最大128レコードのページを渡し、JSで順次検証して破棄する。全rawをJS配列として保持しない。
- 初期readerはページごとにセッションを再走査・認証する。メモリを抑える一方、長時間記録の読出し時間・CPUコストは未最適化。計測中の実行はNative側で拒否する。
- 「完全」は**JS入口に渡された範囲の再現整合性**。OSが配信しなかったfix、記録開始前のfix、実際の身体停止、真の正解率を保証しない。
- 記録対象は活動中の観測処理。pendingFinish/endedAtによる既存の早期return後のGPS callbackは、detectorへ投入されないため対象外。終了後のOS配信まで記録済みという意味ではない。
- buildGitHashがunknownの場合は実行ビルドの同定不足として扱い、実走証跡の採用前に確認する。基点SHAはProductionの現行HEADを意味しない。

## 非干渉と性能の確認方法

- OFF時はsnapshot/JSON化/Native offerを行わない。通常のdistance/time/Auto Stop条件、5秒保存gate、音声通知条件は変更しない。
- ON時は既存値を読み取り、診断専用cloneを作る。診断情報をRUNオブジェクトに加えない。observer例外は通常のingestを中断しない。
- JSでsnapshot作成・JSON化・Native bridge offerまでをperformance.nowで計測し、最大値を端末表示とENDに保存する。Native workerの暗号化・fsync待ち時間は含まない。
- 非同期初期化中にOFFになった場合は遅れてONへ戻さない。OFF・END後に新しい判定出力を記録しない。
- 実機のp50/p95、画面OFF・Doze・高負荷時の観測遅延、電池、温度、総メモリは未測定。機能上の同一性テストを性能非干渉の証明として扱わない。

## 第1段階の自動検証ケース

JS/SQLite：[detector-journal.test.ts](../src/utils/__tests__/detector-journal.test.ts)。データはすべて人工データ。過去の個人GPSログは使わない。

- DJ-01：OFF/ON、bridge拒否、bridge例外、途中から拒否で、GPS・events・detector・診断集計・履歴保存結果・実効距離・時間が同一。
- DJ-02：バッチ内順序逆転、同時刻、古いfix、NaN、範囲外座標、BREAK/再開、目標変更、RAMセッション再作成、末尾flushと終了を再現。
- DJ-03：INPUT/ADMISSION/OUTPUT/BATCH_END/BOUNDARY/ENDの欠落を、seqを振り直した場合でも不完全として検出。
- DJ-04：順序入替え、出力重複、設定改変、END総数不一致、ENDなし、途中OFFを拒否。
- DJ-05：初期OFF、Production/pace/debug/iOSの実際のgate、非有限値の往復、RUN開始前ON・GPS未配信での終了、非同期arm中OFF、ENDのhandoff失敗。

Native：[DetectorJournalTest.kt](../modules/run-announcer/android/src/test/java/app/runjourney/announcer/DetectorJournalTest.kt)。Robolectric/JVM、テスト用AES鍵。実端末Keystoreの成功を意味しない。

- DJ-N01：nonce再利用なし、AADの別セッション拒否、暗号文改ざん拒否、平文を保存しないこと。
- DJ-N02：2048件/2 MiBの受理境界、既存payloadを押し出さないこと。
- DJ-N03：Production/pace/debug拒否、Testのno-backup保存先。
- DJ-N04：暗号化ページ順序、segment分割、END後未sealとseal後の区別。
- DJ-N05：ENDなし、failureフラグ、切断・終端segment欠落、順序違反、path traversal拒否。
- DJ-N06：session/total/segment容量制限、file write failure、7日超の表示で既存captureを削除しないこと。

実行コマンド・実績はDraft PRの検証記録に記載する。テスト名との対応は各ファイルのtest/@Test名を参照する。自動テスト合格を室内実機・屋外実走確認済みへ読み替えない。

### 2026-11-10 初回実装の実行記録

- `npx expo lint`：成功、警告なし。
- `npx tsc --noEmit`：成功。
- `npx jest --runInBand --silent --json --outputFile=.expo/issue72-jest-results.json`：68 suites / 531 tests成功。うち新設のdiagnostic journal suiteは16 tests。
- 最初の全体実行では既存run-summaryの1件が5秒timeout。該当suite単独は8件成功し、通常の5秒設定の全体再実行も全件成功。製品・テストのtimeout設定は変更していない。環境負荷による可能性はあるが、原因を断定しない。
- `android/gradlew.bat :run-announcer:testDebugUnitTest`：Native単体・Robolectric 80 tests成功（新設11 tests）。
- `npx expo export --platform android --output-dir .expo/issue72-export`：Android Hermes bundle生成成功。既存@noble/hashesのexports fallback等の警告あり。APKの端末導入・配信ではない。
- Native保存先はExpo prebuildで生成した別worktreeのAndroid projectからコンパイルした。生成android/、バンドル、ログ、JUnit/Jestの生成結果はGit対象外。
- 原GPS、実RUN履歴、バックアップ、端末にはアクセス・変更していない。実端末の成功証跡は今回ない。

## 初回レビュー後に必要なこと

- 必須：Test端末でKeystore作成・再起動後復号、終了seal、強制終了、write failure/容量超過、RUN保存失敗再試行、OFF後の遅延イベントを確認。
- 必須：画面ON/OFF、Doze、バックグラウンド復旧、高頻度バーストでの引渡し時間・欠損・電池・温度・メモリを計測し、採用基準を合意する。
- 必須：確認付き期限超過削除UI。原データExportは鍵配送・受取先・一時ファイル清掃を別途安全レビューし、承認されるまで追加しない。
- 推奨：readerのcursor化、snapshot重複削減、ON/OFF状態の画面反映、長時間ログでの読出し性能測定。
- 次段階：Native実停止マーカーとappend-only訂正、身体停止と操作時刻の区別、Fモデル比較。同一入力再現が確認できる前に精度評価へ進まない。

## 更新ルール

- detector/ingest/flush、設定反映、RUN lifecycle、Native storage契約が変わるPRは本資料とDJケースを確認する。
- detectorの挙動を変える場合はalgorithm IDと基点SHA、golden入力・期待出力を更新し、過去記録を新方式で現行再現と誤表示しない。
- 記録スキーマ変更はversionを上げる。未対応versionは明示的に拒否し、自動補完で完全扱いしない。
- 実測結果には対象ビルドSHA、端末/OS、条件、証跡の保管場所を付ける。GPS原データと鍵はGit/PR/CIへ置かない。

## 参照したAPI仕様

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)、[Expo Module API](https://docs.expo.dev/modules/module-api/)：sync Functionはenqueue、AsyncFunctionは初期化・読出し。
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)、[Context.noBackupFilesDir](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir())。
