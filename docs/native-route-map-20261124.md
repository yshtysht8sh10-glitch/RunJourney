# #3 Android保存済みRUNの地図・軌跡

基点は#32の詳細UI（main `2ca976c`）。履歴→走行詳細→「地図・軌跡を見る」の導線。設定「履歴の地図・軌跡を有効にする」は初期OFF、新key `@runjourney/running/route-map/v1`だけに保存する。OFF時は入口を表示せず、地図を直接開いてもGPSを読み出さない。保存形式・日時・生GPS・通常RUNの取得/保存/判定には変更を加えない。

## 端末内描画と背景地図

- 既存の128行/64KiBページを検証しながら読み、最大約514点の描画サンプルと全有効点のboundsだけを保持する。保存済みGPSを変更しない。新しい位置計測や権限要求はない。
- 元点の不正座標/時刻、60秒超gap、時計逆転、日付変更線越えで線を分断する。Web Mercator範囲外の極域は表示除外件数に明示し、原本を修正しない。大容量も全GPSをJS配列へ展開しない。画面離脱でページ読込みを中止する。
- 自己完結HTML/SVGをWebView内で描画し、外部JS/CDN/telemetryは使用しない。拡大/縮小/全体/ドラッグ、開始/終了マーカー。地図が必要な場合だけ別スイッチで背景通信をONにする。
- 背景OFFは画像要求ゼロ。ON時だけ表示viewportのOpenStreetMapタイルを最大24枚ずつ取得する。IP/表示範囲の通信を事前に説明し、原GPS一覧/RUN IDを送信しない。帰属表示、HTTPS、アプリUser-Agent、WebView標準HTTP cacheを使用し、prefetch/bulk取得/強制cache回避はしない。[OSMタイルポリシー](https://operations.osmfoundation.org/policies/tiles/)を確認済み。OSMは外部サービスで可用性保証はなく、通信失敗時もローカル軌跡は残る。
- ファイルアクセス/新規位置取得/DOM storage/第三者cookie/外部ページ遷移を制限。CSPは外部スクリプト/接続を禁止し、タイル画像だけを許可する。著作権ページの明示リンクのみNativeで開く。閉じると背景通信のON状態を引き継がない。

## 依存・検証

Expo package major57と[SDK57 WebView資料](https://docs.expo.dev/versions/v57.0.0/sdk/webview/)を確認し、`expo install`で推奨互換版`react-native-webview 13.16.1`を追加。lock差分は同packageのみ。新しいSDK/APIキーは不要。Android/iOS生成ディレクトリは手編集していない。

- route-preview/route-map-html/route-map-ui/stop-correction-ui/trash-ui：5 suites **13 tests PASS**。10,000点のストリーミング/有界描画、分断、取消、ごみ箱拒否、OFF導線/読込みなし、ON遷移、保存ACK失敗、設定再表示、旧RUN/ごみ箱/設定/保護情報不変、SVGとタイル上限/帰属を確認。
- HTMLはJSDOMで合成データのみ実行。画像の実ネットワーク取得やAndroid WebViewでの視覚確認ではない。
- TypeScript、Expo Lint、diff-check PASS。Web static exportとTest設定のAndroid JS/Hermes export成功。新Native依存を含むAPKのコンパイル/署名/インストール/実描画は未実施。Web側のnative routeは既存方式でhomeへredirectし、既存Web地図を変更しない。
- 製品全体/長時間GPS/Native音声の成功済み試験は不要に再実行しない。#48/#78の多数DATA_INSUFFICIENT評価やAuto Stop閾値には触れない。

## 未受入とIssue状態

**#3はOpen維持。** 新Native moduleを含むTest APKビルドとAndroid実表示、地図通信/キャッシュ/操作/小画面の一括評価を最後に実施する。コード統合と受入済みを区別し、本人へ新たな操作を依頼しない。Production配布・OTA・APK更新・既存データ操作・サイクリング開発は行っていない。
