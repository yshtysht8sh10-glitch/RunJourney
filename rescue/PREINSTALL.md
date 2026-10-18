# 署名済み救出APK・実機導入直前報告（2026-10-09）

今回はPC上の署名・APK検査・手順準備まで完了した。ADBによる接続確認も実行していない。実機インストール、アプリ起動、実機DB読み取り、救出、復元、移行、インポート、削除は未実施。以下の実機コマンドは次の明示的承認後の手順であり、今回実行していない。

## 成果物と一致確認

署名済みAPK:

`D:\working\RunJourney-preservation\2026-10-09-rescue-signed-v15\RunJourney-Test-Rescue-v15.apk`

| 項目 | 保全済みTest v14 | 救出APK |
|---|---|---|
| applicationId | app.runjourney.mobile.test | app.runjourney.mobile.test |
| versionCode | 14 | 15 |
| versionName | 0.1.0 | 0.1.0-rescue |
| targetSdk | 36 | 36 |
| minSdk | 24 | 26（SO-51B API33に対応） |
| 証明書SHA-256 | fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c | 同一 |

救出APKは16,975バイト。APK SHA-256:

`0a690ee4af754ad60472075b06f764bd6bd6e823feedb2ffdd6c91ff30131304`

比較対象は先の実機調査で取得・保全した `D:\working\RunJourney-preservation\2026-10-09-v14-626f4be\installed-test-v14.apk`。今回、端末上の現在のパッケージを再確認したものではない。626f4be/v14の取得時の調査記録に基づく。導入承認後に現在のTestが依然v14か確認し、異なれば停止する。

元の `android/app/debug.keystore` の既存androiddebugkeyで署名した。鍵は新規作成・変更・別領域への複製をしていない。zipalign後にapksignerで署名し、署名後のAPKで検証成功、v2/v3署名有効、証明書一致を機械比較、zipalign検査成功。同一ID・署名、versionCode増加により通常の更新構成になっているが、端末上のインストール成功は未検証。拒否時にアンインストール・強制ダウングレード・署名回避を行わない。

証拠は同じ成果物フォルダの `v14-signature.txt`、`rescue-signature.txt`、両badging、`signed-manifest.txt`、`apk-inventory.json`、`zipalign-check.txt` と検証ログに保存した。

## APK内容と原本への書き込み防止

署名済みAPKの全DEX class_defは8クラスで、すべて `app.runjourney.rescue` 内（R、Application、Activity、Engine、Activityの合成lambdaクラス）。assetsなし、native libraryなし、通常RunJourney、Expo、React、AsyncStorageの実装はない。releaseRuntimeClasspathは依存なし。マージ済みManifestと署名済みAPK内Manifestは独自Applicationと単一Activityのみ。Provider、Service、Receiver、権限、debuggable指定はない。通常アプリのJS bundle、migration、自動保存、計測タスクは含まれない。

ApplicationのonCreateはsuperのみ。Activity起動は画面と開始ボタンを作るだけで、DBの読み取りも出力も行わない。開始操作で初めて処理を行う。操作先packageはTestの文字列と照合される。原本のアクセスはFileInputStream、サイズ・更新時刻・ハッシュ計算のみ。SQLite接続は別領域のworking/RKStorageのみでOPEN_READONLY。SQLiteOpenHelper、VACUUM、checkpoint、migration、インポート、原本書き込みAPI、削除処理、再保存へのフォールバックはない。

## DB・WALの保全と停止条件

1. 原本RKStorageと存在する-wal、-shm、-journalを一組として、ファイル集合・サイズ・更新時刻・SHA-256を記録する。
2. 新しいUUIDセッションのraw-sourceへファイル読み取りだけでコピーする。既存ファイルの上書きをしない。
3. コピー直後の原本集合・ハッシュ・サイズ・更新時刻がコピー前と一致し、raw-sourceの内容ハッシュも一致することを確認する。一致しなければ、この時点で解析を止める。
4. raw-sourceからworkingを作り、workingだけを読み取り専用で開く。WALも同じファイル名で隣接させる。原本もraw-sourceもSQLiteで開かない。
5. workingでquick_checkを実行し、okでなければ値の解析に進まない。substr(CAST(value AS BLOB),位置,65536)で分割し、values/row-ID.binとして元バイトを連結する。サイズとSHA-256を再検証する。
6. 救出後に原本集合とハッシュ等を再比較する。疑義があればfailedを記録し、部分成果物も削除せず停止する。

コピーは複数ファイルを同時取得する原子的スナップショットではない。旧Testプロセスが更新で終了し、救出側に通常タスクがなく、他の書き手がいない状態を導入後に確認することが前提。ハッシュ照合とquick_checkは強い検出策だが、観測間の変更と復帰、WALの取りこぼし等をあらゆるケースで排除する証明ではない。疑義があれば自動再試行・修復・checkpointに進まない。読み取り専用でhot journal回復が必要なケースは停止する。作業コピーの補助ファイルをSQLiteが変更する可能性はあるが、原本とraw-sourceは対象外。

PC上で開いたwriterのコミット済みWALにある行を救出でき、元DB/WALのハッシュ不変を確認済み。native SQLite/CursorWindowの7テストとPython検証10テストを再実行して成功。起動時DB不変、コピー中の変更時停止、破損DB不変、欠損DB非作成、出力重複拒否も確認済み。Android lintは0エラー・7警告、通常アプリのExpo lint・typecheck成功。今回、救出Engine自体は変更していない。

## 承認後のチェックリスト

### インストール前

- [ ] ユーザーの明示的承認があり、その範囲にインストール・起動・救出・出力転送が含まれる。
- [ ] 未保存メモリが更新で失われ得ることを承認判断に含める。RUNや保存再試行で解消しようとしない。
- [ ] 対象はSO-51B、先のserialはQV782FZB8R。ADBで端末を照合し、以後すべてのコマンドにserialを指定する。
- [ ] 現在のTest package/versionCodeを読み取り専用のパッケージ情報で確認。v14以外なら中断。
- [ ] PC上の既存v14 APKと救出APKの証明書を再比較し、救出APKのSHA-256を上記と照合。署名不一致なら導入不可。
- [ ] 空き容量・電池・接続を確認。raw-source、working、valuesのためDB容量の数倍と余裕が必要。DBサイズ未確認なら容量不足の可能性を残す。
- [ ] インストールは同一IDの通常更新（-r）だけ。削除・データ消去・ダウングレード・権限回避は行わない。Productionは照会・起動・更新しない。
- [ ] PCに新規の保全先を用意。既存Export、以前の証拠、成果物を上書きしない。

### 救出中

- [ ] 承認済みの更新インストールが成功し、旧Testプロセスが残っていないことを確認。残っていれば追加の停止操作を勝手に行わず中断・報告。
- [ ] 救出Activityを起動し、通常RunJourneyが起動していないことを確認。起動直後は開始を押さない。
- [ ] 救出実行の承認範囲を確認後、開始ボタンを一度だけ押す。バックグラウンド化・再起動・繰り返し操作を避ける。
- [ ] 完了または失敗に表示されたセッションパスを記録。アプリを入れ替えず、出力を削除しない。
- [ ] failed、コピー変更、quick_check失敗、短いchunk、空き容量不足等があれば停止・報告。修復・再保存・自動移行へ進まない。

### 救出後・PC保全

- [ ] raw-source、working、values、manifestをセッション単位でPCへコピー。失敗時も存在する全ファイルを保全する。
- [ ] 端末出力ファイルのSHA-256一覧とPC側一覧を照合。これは救出出力の読み取りであり、原本DBを再度読み取らない。
- [ ] 最初のPCコピーを保存し、Python検証にはその別コピーを使う。raw-sourceにSQLiteを接続しない。
- [ ] PC verifierで全行のサイズ・SHA-256・独立SQLite分割ハッシュ、履歴件数、draft、ID重複、JSON基本整合性を確認。
- [ ] 読めないデータを0件と扱わない。failedや不正JSONでも生バイトと保全コピーを残して報告する。
- [ ] 件数・最新ID/時刻・直近2件の存在を報告して停止。通常アプリへ戻す、インポート、移行、修正、削除は別承認。

## PC転送の具体的手順（未実行）

救出出力の想定パスは `/storage/emulated/0/Android/data/app.runjourney.mobile.test/files/read-only-rescue/rescue-<時刻>-<UUID>`。実際にActivityに表示されたパスを使い、パスを推測して別領域を読まない。以下はPowerShellで、承認後にのみ実行する例。

```powershell
$deviceSerial = 'QV782FZB8R'  # 承認後の端末照合で確定
$remoteSession = '/storage/emulated/0/Android/data/app.runjourney.mobile.test/files/read-only-rescue/rescue-実際の時刻-実際のUUID'
$pcRoot = Join-Path 'D:\working\RunJourney-preservation' ('device-rescue-' + [guid]::NewGuid())
if (Test-Path -LiteralPath $pcRoot) { throw '新規保全先が必要' }
New-Item -ItemType Directory -Path $pcRoot | Out-Null
adb -s $deviceSerial pull $remoteSession (Join-Path $pcRoot 'session-original')
if ($LASTEXITCODE -ne 0) { throw '転送失敗。権限回避をせず停止' }
```

`adb pull` がAndroidの外部filesアクセス制限で拒否された場合は停止し、出力を端末に保持して報告する。run-as、root、権限変更、アンインストールには切り替えない。転送可否は今回の実機操作禁止により未確認。

承認後、表示されたセッション内だけについて端末で `sha256sum` を取得する例（入力パスは表示された時刻とUUIDのみを含むパスとして確認する）:

```powershell
adb -s $deviceSerial shell "find '$remoteSession' -type f -exec sha256sum {} \;" |
    Set-Content -LiteralPath (Join-Path $pcRoot 'device-output-sha256.txt')
if ($LASTEXITCODE -ne 0) { throw '端末側ハッシュ取得失敗。停止' }
Get-ChildItem -LiteralPath (Join-Path $pcRoot 'session-original') -Recurse -File |
    ForEach-Object { Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 } |
    Export-Csv -LiteralPath (Join-Path $pcRoot 'pc-output-sha256.csv') -NoClobber -NoTypeInformation
```

端末側とPC側の相対ファイル名・全SHA-256を一致確認後、新規の検証用コピーを作る。検証時SQLiteがworkingの補助ファイルを更新し得るので、PC保全原本では実行しない。

```powershell
Copy-Item -LiteralPath (Join-Path $pcRoot 'session-original') -Destination (Join-Path $pcRoot 'session-validation') -Recurse
python D:\working\RunJourney\rescue\verify_rescue.py (Join-Path $pcRoot 'session-validation') --report (Join-Path $pcRoot 'validation.json')
if ($LASTEXITCODE -ne 0) { throw '検証失敗。生データを保持し報告' }
```

manifestのraw-sourceとvaluesのハッシュに加え、未知キーを含む全行を確認する。workingは解析専用、raw-sourceがDB関連ファイルの保全コピー、valuesが分割読み出しされた各キーの元バイト。どちらも出力対象となる。

## 残るリスク・停止点

更新インストールは元プロセスを終了させるため、永続化されなかったメモリ上の走行記録は失われ得る。SQLite原本をコードで書き換えなくてもOSのパッケージ情報、アクセス時刻等まで不変とは保証できない。複数ファイルコピーは原子的ではなく、未知の破損・暗号化・スキーマ・容量・外部filesアクセス制限によって救出や転送ができない可能性がある。allowBackup=false設定はあるがOEMの転送等の動作まで保証しない。出力はアプリ専用外部filesなのでアンインストール等で失われ得る。

Testの更新構成は確認できたが、実機の現在状態・DB残存件数・直近2件の復旧可否は未確認。署名済みAPKと手順は準備済みで、次は実機導入・起動・救出・PC転送についての明示的承認待ち。ここで停止する。
