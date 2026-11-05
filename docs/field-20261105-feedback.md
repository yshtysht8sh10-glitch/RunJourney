# 11月5日実走：Test v25 対応記録

基点はTest v24実装29e822c、PR #59 head508253b。新PRは#59へ積み重ねる。対象#60/#61/#62/#56/#19。Production/Pace、Auto StopのGPS閾値/状態遷移、既存音声の優先順位は変更しない。

## 保全と調査資料

実機から標準Backupと診断Exportを取得し、私有フォルダ `D:/working/RunJourney-preservation/field-20261105-run` に保管。51履歴（ごみ箱18）/21,084GPS点/設定8キー/draftなし。Backupは18,181,837 bytes、端末-PC SHA256 `0e8700d67d9aced5303090199ed12478b22b028bea8c34a524daa116aacef1d5`。内部SHA検証・新規隔離SQLite復元全一致、integrity_check=ok/FK違反0。音声ログは23,533,184 bytes、SHA256 `3bd1862b5cf28c83c533d77bbf9e5f276e613b977438cc3f31847aacd5c5547a`。原GPS/音声ログ/端末画像はGitやEASへ追加しない。

再集計：`node scripts/analyze-field-session.cjs PRIVATE-backup.json PRIVATE-voice.json 2026-11-05 > NEW-private-report.json`。保持ログとバックアップの正確なRUN境界を使う。個別RUNの詳細/IDは私有レポートへ保存。

## #61 START設定案内

`RunService.startRun`の同時呼出しは同じPromiseに合流し、永続化・位置情報開始成功後に`RUN_STARTED`を送る。設定はRUN自身のfinishGoal/finishAutoEnabled/featuresと、新規RUNに保存したstartClockSettingsから読む。距離/時間/手動終了、自動終了ON/OFF、Auto Stop、現在時刻ON/OFF・間隔を含む。開始処理失敗では案内しない。再試行時も同一RUN IDのnative永続重複排除を使い、元開始時刻+30秒の期限を更新しない。

文言例：「RUNを開始しました。目標10キロメートル、自動終了ON、Auto Stop ON。現在時刻案内は10分ごとです。」既存5分音声のスイッチとは独立。priority60/TTL30秒で、停止/再開100・終了110を妨げず、割込み後の自動再読はしない。生成/投入/開始/完了/中断/失効は同一IDで記録。Androidの既存foreground TTSキューを使い、iOS/Webの音声基盤は追加しない。

## #62 終了直前予告

初期値は残距離500m/残時間60秒。設定画面で50〜5000m、10〜600秒へ変更可能。初期値は読取り時の既定値で、保存操作前に既存設定を書き換えない。自動終了ONのみ、実際の残量を切り上げて読む。手動終了/OFF/終了済み/到達済みは抑制。距離は既存effectiveDistanceの受理edgeを使い、GPS飛びをそのまま残量へ算入しない。

目標種別/数値/自動終了状態の正規化キーで一度だけ生成。同じ目標の再保存では重複しない。目標変更直後にnativeへ新しいrevisionを送り、旧予告を取消。単調なgoalChanges件数で旧batchが新revisionを上書きしないようにする。設定読出し後に最新RUNを再確認し、古い目標や終了後の生成を防ぐ。I/O中のコールバックは最新だけへまとめ、予告のI/Oを待って自動終了を遅らせない。

`GOAL_WARNING`はpriority60/TTL15秒、停止中は無効。元の終了時刻・距離を延期せず、古い予告の再試行なし。生成/抑制理由（OFF、閾値前、到達済み、同じ目標へ生成済み）とnativeの失効/中断を記録。予告を聞いてから目標変更が間に合う保証はない。

主なファイル：`src/domain/run-notices.ts`、`src/repositories/goal-warning-settings.ts`、`src/components/goal-warning-settings.tsx`、`src/services/{run-service,voice-announcement}.ts`、native `RunAnnouncerService/VoicePolicy`。

## #56 現在時刻：原因分類

各RUNの10分境界、CURRENT_TIMEの生成/開始/完了・見送りを照合した。

|RUN|保持ログで確認した境界|結果・分類|
|---|---|---|
|05:08開始・10km|50/60/70分|50/60分は完了。70分はKILOMETER_LAPの再生中に生成し見送り。距離案内は見送り1.866秒後に完了。仕様どおりの競合抑制|
|06:26開始・10km|10〜70分|10/20/30/40/50/70分は完了。60分境界はAUTO_STOP状態で見送り。停止TTS自体は約32秒前に完了。仕様どおりの停止中抑制|
|07:44開始・1.69km|10分|生成→開始→完了|

最初のRUNの10〜40分はログ保持範囲外で未確認。Export時設定はON/10分で、保持中の境界も10分に一致するが、過去すべての時点の設定不変をExportだけで証明しない。本人の「身体は止まらなかった」という申告とAUTO_STOP推定状態は区別し、今回禁止されているGPS判定変更はしない。

保持範囲内の時刻STARTED間隔の最大は、同一RUN内で約20.00分。RUN間では最大約28.52分で、競合見送りと新RUN開始基準への時計リセットが重なっている。既存仕様の帰結であり、未生成を断定して古い時刻を後追いさせない。

改善は診断の細分化：予定時刻、生成時刻、間隔、飛ばした境界数、正式状態、競合type、キュー長、LATE/PAUSED/TTS_NOT_READY/SPEAKING/QUEUED_AUDIO/ELIGIBLEを記録。旧SKIPPED_CLOCK_BUSY_PAUSED_OR_LATEは維持する。終了済みRUNの後着batchがclock設定を復活させる到達可能経路をnativeテストで再現し、終了済みガードをclock設定前へ移した。

未承認案：競合終了後5秒以内の空きで「その時点の新鮮な時刻」を案内する方法、次境界までの長時間見送りへの別表示。既存の再試行なし契約を変えるため今回は採用しない。音声全体の優先順位は不変。

## #19 騒音：実測と修正

1本目は終了時22,495サンプル（すべて画面OFF）、校正/自己音hold除外の計測4,497秒。保持MONITORING 368行のgain min/median/max=0.6503/0.7657/0.9378、上限0行。2本目は保持903行で0.6500/0.7031/0.9412、上限0行。v24の連続カーブは作動し、旧版の1.0張付きとは異なる。ADAPTIVE_APPLIEDでA2DP/type8を確認、media14/30。dBFSは校正されたdB SPLではなく、gainやDONEから聴取効果を断定しない。

**確認した不具合**：3本目開始時、2本目のNoiseMonitorが終了後の40秒leaseでまだ動いていた。worker存在時にSTARTを無視するため、新RUN ID/leaseを更新せず旧expiryが約9秒後に測定を止めた。3本目の設定はON/権限許可でも、その後は計測なしの通常TTS経路となった。合成失敗fallbackが0件でも、計測なしの直接TTS化は別に起きる。

修正：稼働中の新RUNのSTARTでは旧expiryを解除し、新RUNへ診断の計測ID/カウンターを切替え、要求leaseを更新する。明示ユーザー停止を解除しない。active RUN中のpreviewは既存leaseを短縮しない。実サービスの40秒→新50秒lease回帰で、40秒時点で停止せず50秒で停止することを検証する。

さらに合成済みTTS WAVだけへ、弱い部分を最大1.6倍に持ち上げる20msブロックの上向きダイナミックレンジ圧縮を追加。元音声のピークを超えず、処理時のデジタル上限0.9、RMS改善1%未満/無音/非対応形式は原音維持。PCM16 mono/stereo・2MBまで、マイクPCMは対象にしない。一時ファイルを新規作成し直さず、割込み・timeout後の遅延callbackでも削除済みファイルを復活させない。実行は音声合成callback内、処理時間/RMS/ピーク/適用・見送り理由をログへ追加。音声の平均デジタルレベルを測るもので、耳元の音圧や聴取の測定ではない。

|方式|実効性/Bluetooth|電池・音質|聴覚保護・今回の扱い|
|---|---|---|---|
|既存gain改善|A2DPでも実適用を記録。通常音量以上にはならない|常時マイク、音色は変えない|0.65〜1.0維持。lease不具合を修正|
|上向き圧縮|再生経路へ渡す前に処理するためA2DPも同じPCM。弱い音の埋もれを軽減する候補|合成時だけ計算。強弱感の変化あり|最大1.6倍・元ピーク不増・0.9天井。騒音ONの合成経路へ実装。聴取は未受入|
|帯域/EQ|交通騒音と声の重なる帯域では改善保証なし。イヤホン差が大きい|追加計算・音色の変化|今回未採用。本人の聴取評価と選択UIを検討|
|端末メディア音量制御|TTSだけでなく他アプリ・A2DP全体にも影響し得る|音量変化・他アプリ競合、復元競合の管理が必要|未実装。明示同意・上限・元値記録・中断/route変更/プロセス終了時の復元設計を先にレビュー|

Android一次資料：[DynamicsProcessing](https://developer.android.com/reference/android/media/audiofx/DynamicsProcessing)、[AudioManager.setStreamVolume](https://developer.android.com/reference/android/media/AudioManager#setStreamVolume(int,%20int,%20int))。今回はシステム音量/端末effect設定へ介入しない。通常TTS fallbackは開始時gain指定のみで、WAV圧縮や発話中追従はできない。fieldSummaryへ合成失敗fallbackとは別のadaptiveUnavailable件数を追加した。

## #60 表示グループ

グループは別設定 `@runjourney/history-groups/v1` にid/memberIds/順序/作成時刻/本人の連続走行確認だけを保存。元RUN/GPS/ラップ/診断/保護IDを書き換えず、新しい派生RUNも作らない。Test版の履歴→「表示グループを作成・解除」で本人が2〜20件を選び、プレビュー後に保存。隣接END→STARTの0〜300秒を全リンクで検査し、301秒/重複所属/時刻重複は拒否する。自動確定なし。

一覧はグループを1件として時刻順に配置し、メンバーは個別行から除外する。管理画面から内訳と元RUN詳細へ移動でき、解除で元表示へ戻る。GPSは先頭/末尾の各最大128点と要約だけを読み、長時間RUN全体をメモリへ読み込まない。位置欠落/accuracy不明または20m超/境界から15秒超/不自然な速度は推定不可。許容される場合も端点間直線モデルをGPS時刻からRUN境界へ補間し、記録済み側の時間を二重加算しない。未記録区間の時間は本人の連続走行確認とGPS両端の移動根拠が揃う場合だけ加算する。

### 11月5日3件による結果（内部精度）

|項目|結果|
|---|---:|
|元の記録距離合計|21,685.449270m（表示21.69km）|
|第1空白|69.968秒 / 直線モデル49.849265m / 推定走行時間は根拠不足|
|第2空白|44.838秒 / GPS精度不足で距離・走行時間とも推定不可|
|推定可能分を加えた距離|21,735.298535m ＋ 推定不可1区間（全距離は不明）|
|全空白を含む推定距離合計|推定不可。未測定を0mに置き換えない|
|元の実走時間合計|9,618,373ms（160.306分）|
|空白の推定走行時間合計|推定不可。本人の申告だけでGPS根拠不足を補わない|
|全体の経過時間|10,110,688ms（168.511分）|
|将来ランキング用の距離|21,685.449270m。補間・グループ操作を加算しない|

実データを復元した隔離SQLiteで、グループ化後の元51件/保護情報の完全不変、グループ付きBackupの新規DB復元一致、解除後snapshot全体の元との完全一致を確認。合成テストで299/300/301秒、3本中1リンク超過、GPS欠落/位置飛び、時刻逆転、二重所属、UIでの選択/保存/解除・旧ごみ箱非purge・一覧二重計上なしを検証。

Backupは既存schema2のsettingsへ追加するため形式変更なし。復元時はグループ設定を統合し、ID競合/重複所属では全体transactionをロールバックする。他の既存設定を上書きしない。クラウドRUN同期は従来どおり元RUNのみで、グループ設定は送らない。別端末へは標準Backup/Importで移す。ランキング機能自体は追加しない。

主なファイル：`src/domain/history-groups.ts`、`src/repositories/history-groups.ts`、`src/app/history-groups.tsx`、`src/components/history-group-card.tsx`、history一覧、SQLite Backup/restore。

## 検証・APK・次RUN

型チェック/Lint、JS/native/実SQLite、開始/予告を含む95分GPSシミュレーションを実施。実機では履歴を作らないSTART設定/終了予告のテスト操作を診断画面へ追加し、実RUNの保存成功・GPS到達そのものの検証と区別する。最終SHA・APK・実機結果・更新前後照合は完成後に追記する。

次RUN：STARTで適用目標・自動終了・Auto Stop・時刻間隔が正しく聞こえるか、距離500m/時間1分予告と目標延長の操作、現在時刻の見送り理由、連続RUNの計測lease継続、Bluetooth/交通騒音下の圧縮音声の明瞭度/違和感/電池を確認する。屋外実走・聴取は未受入。Auto StopのGPS判定、全体音声優先順位、時刻の再試行、端末音量自動変更は設計レビュー待ち。
