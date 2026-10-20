# Issue #24 ペース走モード

## 基準とブランチ

2026-10-20に最新Issue #24、および #5 / #6 / #18 / #21 / #29 を確認。
作業開始時の `feature/web-cloud-analyzer` は `c329069`、変更なし・未pushコミットなし。
`origin/main` は `626f4be`。#29のPR #34で追加されたSQLiteページ保存・同期を前提に、
`feature/pace-workout` を作成。PRのbaseは `feature/web-cloud-analyzer` とし、#34への依存を明示する。
mainへはマージしない。Issue #24はPhase 2と実機検証が残るため閉じない。

## 実装した範囲

- Phase 1の一定ペース走：設定ON/OFF、距離、直接ペース、距離＋時間入力、許容幅、独立した音声ON/OFF、最小通知間隔。
- 設定は既存SQLite settingsへ保存し、START時に目標をスナップショットする。走行中の設定変更は次回STARTから適用。
- 距離は0.1〜200km、ペース120〜1800秒/km、許容幅0〜120秒/km、音声間隔60〜600秒、目標時間48時間以内。
- ペースと時間は最後の入力を正とする。計算の内部値は丸めず、表示だけ秒に丸める。設定を開き直して保存しても内部ペースを丸めない。
- 記録中は目標、現在、差、判定、距離進捗、目標到達を表示。目標到達は既存START/STOPを変更しない。
- 終了後の概要・履歴・長時間履歴で目標比較と評価割合、判定保留区間を確認できる。1kmラップは操作時にページ単位で解析。

## 再利用と判定

新規依存なし。SDK 57のバージョン別Location / TaskManager / SQLiteのドキュメント、Router、Module API、EAS variantsを確認した。

`analyzePoints` / `calculateDistance` の既存フィルタと `inferMovement` / `usableObservation` の移動・精度判定を再利用。
直近30秒の保存済みGPSを使用し、追加のRaw GPS補正を作らない。#18の高頻度観測を全保存せず、同じ記録経路が確定した点を使う。
瞬間speedはペース計算に使用しない。

最低5点・25秒以上の窓、精度20m以内、点間隔10秒以内、最終点の古さ10秒以内、
既存のcoherent movement、20m以上の有効距離が必要。位置飛び・jitter・観測不足・曲がり角等で移動が不確かなら保留。
30秒間隔で評価し、同じ結果が2回続くまで表示・警告状態はUNKNOWN。FASTとSLOWの切替も再確認する。
FASTは `pace < target - tolerance`、SLOWは `pace > target + tolerance`、両境界をON_TARGETに含む。

Pause/Auto Stopのイベント変更を検知した窓は保留し、再開時刻（sensor確定時刻を含む）から新しい窓を要求する。
プロセスの新しい判定セッションも30秒の観測を要求する。40秒超の評価ギャップは成功に数えない。

## 音声

Androidの既存RunAnnouncerService、TTSキュー、Audio Focusを使用。
ペース走の音声設定は#6の定期通知とは独立する。Android以外では画面案内を提供する。
通常の状態変更・ラップを優先し、ペース音声は発話中・キュー待ち・直前発話から20秒以内・ラップ境界付近では捨てる。
期限20秒の案内をキューに蓄積しない。native側でもキーを重複排除。音声OFF・停止・休憩中は保留案内を無効化する。
設定された60〜600秒の最小間隔で警告し、ON_TARGET内は沈黙。警告後に戻ったときに一度だけ復帰案内。
目標到達は音声間隔の例外だが、競合時は音声を捨て、画面上の到達表示を保持する。
発話失敗はcatchし、GPS保存へ伝播させない。既存バイナリに新bridgeがなければ音声呼出しを省略する。

## 保存と割合の定義

既存RunRecordへ任意の `paceWorkout` v1メタデータを追加。SQLiteスキーマの変更なし。
目標、評価集計、到達状態、最後の通知・評価状態はdraft/historyに保存され、既存のバックアップ・復元・ページ同期に含まれる。
任意データが不正なら読み出し・保存時に除外し、本体のRaw GPSと通常履歴は維持する。
判定処理の例外は元のRunRecordを返す。GPSのappend/距離計測/STOP経路の置換はしていない。

割合 = ON_TARGETとなった有効評価時間 / ペースを計算できた全有効評価時間。
評価ごとの直前評価からの実走時間増分を集計するため、停止・休憩時間は含めない。
窓が不適格、イベントをまたぐ、40秒超の評価遅延の場合は実走時間増分をunknownへ計上し、分母・分子から除外する。
通知用の連続判定待ちでも、ペースを計算できた窓は有効評価として集計する。これは移動窓による推定で、全GPS瞬間の分類ではない。
判定保留は時刻範囲と理由を保持。連続する同じ理由は統合し、128区間を上限にし、それ以降の件数と合計時間は保持する。
保留区間の表示時刻は壁時計の範囲で、unknown集計時間はその範囲に含まれる実走時間のみ。
任意メタデータは48KiBの文字数上限で保護する。GPS点列をここへ複製しない。

平均ペース・1kmラップは既存effective clock/edgesを使う。ラップ境界は距離に比例して時刻を補間する。
ページ解析は最大128行＋前ページ最後の1点を保持し、巨大GPSを新たに一括読み出ししない。
既存の履歴補正で平均やラップが変わっても、走行時に収集した評価割合は変えない。その旨を画面に表示する。
既存ページ解析と同様、2048イベント超・制御メタデータ128KiB超・走行へ含める停止補正は解析保留。原本は保持する。
#29の既存metadataストリームを使うため同期形式の変更不要。Webの目標比較UIは今回の範囲外。

## Phase 2

PaceWorkoutは順序付きSegment配列。warmup/steady/cooldown、区間ごとのペース・許容幅、距離/時間ターゲットを表現し、検証・到達判定・ペース分類を共通化。
複数Segmentと距離/時間指定の単体テストを追加。Phase 1は必ず1 Segmentで実行する。
Phase 2では現在区間indexと区間開始時の実走距離・実走時間を状態へ追加し、差分からSegmentを進める。
区間境界で候補判定・観測窓をリセットし、同じ分類・音声経路を使う。移行時は状態versionを拡張する。
**複数区間の編集UI・実行・切替音声・interval/repeat機能は未実装。Phase 2の完成とは扱わない。**

## 検証

- `npm test -- --silent`: 40 suites / 370 tests passed（新規62件）。隔離Application IDの生成と判定例外の隔離を含む。
- `npm run lint`、`npm run typecheck`: passed。
- `npm run test:pages`: 7件passed。
- `npm run test:long`: 5件passed（30分×11、10h、12h、24h@5s、24h@1s）。合成データ・ローカルfixtureのみ。
- `npx expo-doctor`: 20/21。既存SDK57依存12個のパッチ版が現在の推奨より古いため失敗。今回依存変更はしていない。
- `npm run web:build` / `npx expo export --platform android --output-dir .expo-export-check/pace-android`: passed。
  既存の@noble/hashesのexports解決、Web LeafletのCSS画像importに警告が出るが、export自体は成功。
- EAS隔離APK: [ビルド結果](https://expo.dev/accounts/yshtysht8sh10/projects/RunJourney/builds/5ed4c1d2-20e4-40f7-a2c4-770a924a30c3)。ソースは `8c27ece`。結果はPR/作業報告へ記録する。
- [Draft PR #35](https://github.com/yshtysht8sh10-glitch/RunJourney/pull/35)。追加テスト以外の実装コードはAPKソースと同じ。

## 安全な実機テスト

`paceWorkout` EAS profileは新しいbuild typeを使い、APKのApplication IDは **app.runjourney.mobile.pace**。
Productionの `app.runjourney.mobile`、Testの `app.runjourney.mobile.test` と別領域で、名前はRunJourney Pace。
既存Testのビルド番号・Application ID・保存先は変更しない。

1. `npx eas-cli@latest build --platform android --profile paceWorkout` で隔離APKを作る。
2. APKのmanifest/applicationIdが `app.runjourney.mobile.pace` であることを確認する。
3. インストールは今回行わない。ユーザーが隔離テストを実施するときは当該APKだけを追加インストールし、既存アプリを削除・上書きしない。
4. 救出原本や実機DBの移行を使わず、空のDBで合成/新規テスト走行を作成。クラウド同期は実行しない。
5. 設定OFF/ON、精度不足、Pause、信号待ちAuto Stop、再開、目標到達後の記録継続、STOP保存、強制終了後の復元を確認。
6. 音楽再生中の音声、通常5分通知との競合、音声OFF、画面OFF・foreground・backgroundを確認。
7. 30〜60分と4〜5時間の電池・発話遅延・OS制限をSO_51Bで実走評価する。疲労・痛みがある場合は中止/休養する。

実機へのインストール、画面OFFでの発話、実際のOS省電力下での復元・長時間電池評価、iOSビルドは未検証。
実機Test/Production、実機DB、救出原本、本番Firebaseのデータは変更しない。
