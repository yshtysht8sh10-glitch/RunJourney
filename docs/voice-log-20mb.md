# 音声ログ20MB対応（2026-10-22、PR #37追加）

## 上限と保存方式

音声ログの容量上限を20,000,000 bytes、件数上限を20,000イベントへ拡張。保持期間は7日。複数走行の合計で、上限に達したら古い256KB以下のチャンクから削除する。削除単位の都合で最大1チャンク分の余裕を残す場合がある。ログ量・通知頻度に依存するため時間数は保証しないが、以前の512件による2時間30分走の序盤欠落リスクを解消する。

SharedPreferencesの全JSONを通知ごとに書き直す方式から、アプリ専用filesDir/voice-log-v2内の最大256,000バイトの追記ファイルへ変更。保存・保持期間/容量/件数制御・読込を専用の単一ワーカースレッドで実行。待機は最大128処理で、保存障害/待機上限はAndroidログへ記録し、GPS/履歴保存の経路には影響させない。

旧SharedPreferencesのentriesは最初の読込/追記で移行。ステージングフォルダへコピーしてから同じfilesDir内でrenameし、完了フォルダの存在で再移行を防ぐ。途中失敗は次回再試行し、元のPreferencesは復旧用に保持。途中で途切れた行は次回初期化時に末尾から除外して完全な行を残す。通常書込失敗時は書込前の長さへ戻して再初期化する。

走行中に全20MBをJSへ取り込まない。Diagnosticsは非同期で直近12件のみ取得。全ログはExportボタンを押した時に取得し、既存と同じentries/verificationを含むJSONを出力する。Export中の二重操作を抑制。JSONは整形による増量を避けてcompact形式にするが、検算結果を付加するためExportファイル自体は保持容量20MBより大きくなり得る。

GPS、走行履歴、正式停止判定、音声通知の条件/優先度は変更していない。Native変更のため同一署名のTest APKで更新する。

## 検証

- lint / TypeScript成功。Jest 42 suites / 383 tests成功。
- Android JVM: VoicePolicy 2件 + 実ファイルを使うVoiceLogJournal 9件、計11件成功。
- 2時間30分相当の900イベント（各約2.1KB、旧512件/1MBを超える）を全保持し、先頭/末尾/順序/再読込を確認。
- 約24MB分の8,000イベントを書き込み、実ファイル合計が20,000,000 bytes以下で最新を保持することを確認。実ファイルでUTF-8、件数上限、7日経過、途中行、過大/複数行レコード拒否、移行の再実行防止/失敗再試行も検証。
- JVMテスト中にAndroid compile APIのDeque.reversed呼出しがJDK17で非互換になることを検出し、古いAndroidにも対応するdescendingIteratorへ修正して全件再実行済み。
- 自動テストは実機2時間30分走の代用ではない。実走音声/検算受入条件は引き続き未完了。

## 保全とTest更新

更新前に新規フォルダ D:\working\RunJourney-preservation\pre-voice-20mb-update-20261022\ へ標準Backupと更新前APKを保管。

更新前Backup: 7,723,090 bytes、端末/PC SHA-256一致 60e34ef703f9d4b537db4db228ae37429131423836351f2068833c07e2bbc8d4。アプリのdecodeBackupで内部SHA/構造検証成功。通常21+ごみ箱15=36件、GPS11,953点、draftなし。ユーザーが変更した最新ペース設定は20km/7:30km/±5秒/音声ON/60秒。以前の10km設定へ戻さず、この最新設定を維持する。

ビルド/署名/インストールと更新後の全データ・旧音声ログの比較は完了（下記）。

## ビルド・上書き結果

- EAS成功: https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/69d121f1-61ca-4881-85b2-f1fa831d0306
- 実装9a8b347、cloudSyncTest profile。実APKはapp.runjourney.mobile.test/versionCode18、APK内Gitも9a8b347+cloud-sync-v18。新しい20,000イベント/20MB表示文字列をHermes bundleで確認。
- APK 112,455,631 bytes、SHA-256 cb735bb13a5f72159b0a0d8b436b50d053aff5c5c5044d9f5b24989fec67c9f3。既存Testと同じ署名SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9cを照合。
- 更新前標準Backupに加え、音声ログ2件（STARTED/DONE）もpre-update-voice-log.jsonへ保全。端末/PC SHA一致 a7f4060a880f6bc60a42b2c21cd5cea341d214bb34a61bbe5a78566c0dd7c409。
- 2026-10-22 21:06 JST、adb install -r成功。アンインストール/データ消去なし。更新済みプロセス起動、初回インストール日維持、AndroidRuntime/ReactNativeJS/RunAnnouncerのエラーなし。
- 端末の再ロック解除後、以下の実機確認を完了。

## 20MB版の実機検証完了

- Diagnosticsに「最大20,000イベント / 20MB / 7日」を表示し、旧ログ2件を再読込できた。
- 既存の音声テストを1回実行し、新しいSTARTED/DONEを記録。force-stop/再起動後も旧2件+新2件の4イベントを保持した。GPSのSTARTや疑似走行は行っていない。
- 再起動後のJSON Exportを端末Downloadに保存してからPCへコピー。post-update-voice-log.jsonは2,924 bytes、端末/PC SHA-256一致 bfa1588ff099c285a5f01a36ccb8bd23d9bcd8e3ed5a2c46b7c901a9d3b139ec。pre-update-voice-log.jsonの2件が全フィールドで完全に含まれることをcanonical比較し、新2件の同一通知ID・開始時刻・STARTED/DONEとverification4件を確認。比較結果voice-log-migration-verification.jsonも保管。
- 更新後の標準Backupを端末Downloadへ保存完了してからPC保管。post-update-backup.jsonは7,723,090 bytes、端末/PC SHA-256一致 ead07b1cc43fc58a793f7ce4fe296ec2ea66f5959c7378e5b093fb4eabab7956。アプリと同じdecodeBackupによる内部SHAと構造検証成功。
- 通常21+ごみ箱15件、GPS11,953点、draftなし。全runs（GPS/イベント/補正/診断/ペース情報を含む）・全settings・draft・protectedIdsが更新前と完全一致。post-update-verification.jsonを保管。
- 再起動後の設定画面でも20km/7:30km/目標2:30:00/±5秒を確認。履歴一覧と既存10.08km走行詳細（GPS681点）、Git表示9a8b347も確認。
- START・疑似GPS・設定保存・履歴追加・Production/隔離Pace版の更新は行っていない。TestをSTART待機へ戻した。

音声テストはLEGACYのテスト発話であり、実走のラップ/貯金入力は未取得（検算値null）。実走による画面OFF音声、ラップ/貯金検算、2時間30分連続走行は未検証。900イベント全保持・20MB超過時の制御はPC上の実ファイルテストで確認した結果として区別する。両Issueは実走受入確認までOPENのまま。
