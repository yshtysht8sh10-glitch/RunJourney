# Test v32 診断ON操作の修正

## 原因と変更

v31のDetectorJournalControlsは暗色画面上のTextに文字色を指定せず、ON操作より前に試験結果JSONと検証ボタンを表示していた。スクロール位置と長いJSONによって操作が見つけにくくなっていた。

v32では画面上部のスクロール領域外に「実GPS診断」の操作パネルを固定し、白文字・オレンジのONボタン・緑の状態表示を設定した。OFF/ARMED/RECORDINGを現在のRecorderから反映し、SEALEDは対応するNativeセッションの保存状態を確認して表示する。不完全保存はOFFと明示する。

検証機能は「診断詳細・検証を表示」に折りたたみ、結果の初期表示は6行、展開時も12,000文字まで。元の保存データやExport内容は削除・変更しない。

## 検証

- JS72 suites/546件、型チェック、Lint成功。UI試験でOFF→ARMED→RECORDING→Native確認後のSEALED、初期折りたたみ、文字色を確認。
- SO-51BでTest v32を上書き更新し、上部ONボタンを実際に押して「診断状態：ARMED（START待ち）」へ切替成功。RUN開始・音声試聴は行っていない。
- 本文をスクロールしてもONラベル位置[128,422][968,483]が不変。確認画面はPC私有領域に保存した。
- 更新前・後・ARMED確認後の履歴54件（ごみ箱18件）、GPS22,512点、設定11件、グループ・保護情報が正規化snapshotで一致。更新前にユーザーが変更した手動終了・ペース走20km/6:00/音声60秒等の最新設定を基準に保全した。
- 既存診断の29ファイル、計105,092,539バイトについて暗号文・状態ファイルのSHA-256が更新前後で全件一致。照合はTest UIDの読取り専用Instrumentationを使用し、原GPS・暗号文・鍵を外部へ送っていない。ARMED操作により新しい待機セッションが追加される。
- Production APK SHA-256 30a956d9b5197475c1226d10ac39a82c580c4f25e6e84218f8470b9316086d3a が一致。

## 配布と操作

APK実装SHA 3dc5d83f384eb6fa8cff327920ea450cb5240752、versionCode32、package app.runjourney.mobile.test。
APK SHA-256 0f4668ca96249889feabb29e5fbb9f272e4034c64e6284652535968c4d28906c。
署名は既存Testと同一のfac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。

APK https://expo.dev/artifacts/eas/Hc8QMkgYLAvrkHuA38223cwqXhj5IGVnNhyEYc_s0xk.apk

「設定」→「Auto Stop Diagnostics（Test）」を開く。画面の最上部、「実GPS診断」の緑の状態表示のすぐ下にあるオレンジ色の「次のRUNの診断をON」を押す。ARMEDならONボタンは無効になり、そのままラン画面へ戻ってSTARTできる。再起動するとOFFになるため、明日のSTART前に再確認する。

明日の実時間150分・実GPS95分の検証は未実施。収集・95分締め・既存RUN保存・Auto Stop判定の仕様は今回変更していない。PR #73はDraft、Issue #72はOpen。
