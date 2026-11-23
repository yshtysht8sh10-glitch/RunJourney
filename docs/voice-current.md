# 音声仕様の正本：main 2026-11-23

対象コード：main `a822da8`（製品コードは`7abd4cd`と同一）。Android Nativeの現行実装を記述する。インストール済みTest v37の`9a9ee26`とは区別する。正本であることは、実機受入済み・全通知の欠落解消済みを意味しない。

**現在の仕様を確認する入口は本書。** [対話型マトリクス](voice-spec-interactive.html)の組込みTest v28/v31は歴史的仕様・希望編集用であり、現在mainの周期・TTLを表す版ではない。[歴史資料と原本](voice-history-index.md)を参照。将来の変更は新しい版・対象SHA・変更理由・実走評価を記録し、過去版を上書きしない。

## 1. 情報項目・対象区間・計算

| 情報 | 範囲・単位・計算の正本 |
|---|---|
| 累計距離 | 対象境界までの有効GPS辺の合計。発話はkm。生座標を削除せず、停止除外・異常辺除外は既存モデルを利用 |
| 実走時間 | `timeModel`の活動時間。Auto Stop・手動休憩を除外。RUN開始からの壁時計経過と区別 |
| ペース/速度 | 共通Pace Analysisの区間時間÷距離（sec/km、表示min/km）／距離÷時間（km/h）。ゼロ距離等は数値を捏造しない |
| 時間ラップ | 完了した5分実走区間。直近5分の距離・ペース・速度・42.195km換算を設定に従って発話。RUN全体平均と区別 |
| 距離ラップ | 完了した1km区間。ラップ時間と、目標が有効な場合の直近/累計差分。累計距離はその境界の値 |
| 貯金 | `目標sec/km × 距離km − 実走秒`。負値は「遅れ」。PACE増減は区間始終の丸め済み累計差分。累計正でも減少なら「減りました」 |
| フル換算 | 対象区間のペースを42.195kmへ換算。予測保証ではない。RUN全体の実績タイムとは別 |
| 時計 | 実際に本文を要求する時点の端末ローカル時刻。「現在、午前/午後○時○分です」。OS出力開始コールバックとの微小差はあり得る |

根拠：[run-model](../src/utils/run-model.ts)、[pace-analysis](../src/utils/pace-analysis.ts)、[voice-format](../src/utils/voice-format.ts)、[voice-guidance](../src/domain/voice-guidance.ts)、[finish-voice](../src/domain/finish-voice.ts)。設定の選択項目は`VoiceAnnouncement.items()`を使用する。

## 2. 機能×読み上げ情報・生成/取消マトリクス

●固定、△設定/品質/目標等の条件付き、－なし。優先度は高い値が先。TTLは配送/本文開始期限であり、再生開始後の完了期限と同義ではない。**「原則捨てない」は設計方針であり、旧経路に残る失効を隠さない。**

| 正式イベント名 | 主な情報（発話順） | 条件・周期 | priority / 期限・主な取消 |
|---|---|---|---|
| PACE_WARNING（新周期） | △区間増減→●累計km→●累計貯金/遅れ。品質不足は不足文のみ | ペース音声ON、RUN開始基準の60秒以上固定周期。分類状態で省略しない | 20 / 旧20秒TTL対象外。停止中保持、OFF/終了/設定epochで明示取消、永続化失敗はその系統を抑止 |
| CURRENT_TIME | ●再生要求時点の時刻 | 独立ON、5/10/15/30分。RUN開始基準 | 30 / 5秒/busy破棄を撤廃。未再生最大1件へ統合、停止中保持、OFF/終了/設定変更取消 |
| KILOMETER_LAP | ●通過km→△直近ラップ時間/目標差→△累計差 | ペース走有効時の完了1km境界 | 70 / 境界壁時計＋30秒。旧情報defer/recovery対象 |
| FIVE_MINUTES | △実走時間→△総距離→△直近時間ラップ距離/ペース/速度/フル換算（選択順） | 通常音声ON、完了5分実走境界。実走時間も項目設定で省略可 | 40 / 境界壁時計＋20秒。旧情報defer/recovery対象 |
| RUN_STARTED | ●開始確認→△適用目標/主要設定 | 通常START時に生成 | 60 / RUN開始＋30秒。RUN/状態変更等で取消あり |
| WORKOUT_GOAL | ●ペース走目標到達・計測継続 | ペース走目標達成。自動終了そのものとは別 | 60 / notice.at＋20秒とNative有効性検査 |
| GOAL_WARNING | ●自動終了前の残量 | 自動終了ON、距離/時間目標。独立カウントダウン有効時の重複を抑止 | 60 / 15秒、RUNNING/目標revisionを検査 |
| TURNAROUND | ●目標半分のkm/分→折返し目安 | 独立初期OFF。目標ごと原則1回、既通過/遅すぎる交差/停止はスキップ | 60 / sample.at＋8秒とGPS鮮度/目標deadlineの最小値。目標変更/終了/非RUNNINGで取消 |
| GOAL_COUNTDOWN | ●残りm/秒 | 独立初期OFF。距離200→10m、時間60→10秒、10刻み。跨いだ古い数字は飛ばす | 60 / sample.at＋3秒とGPS鮮度/目標deadlineの最小値。最新の有効値のみ、開始期限と本文watchdog分離。RUN停止/終了で取消 |
| RUN_GOAL_FINISHED | ●終了/労い→△保存済みRUNの距離・実走時間・平均・ラップ | 通常終了/目標自動終了の保存成功後の経路 | 110 / 30秒。終了済みRUNの旧通知は捨て、このイベントのみ許可 |
| STOP_CANDIDATE_ANNOUNCED | ●「停止を確認しています。」 | 通常音声またはペース音声ON、Auto Stop ON、stopHint成立・30秒cooldown | 80 / 4秒、候補消失/正式状態変更で取消 |
| AUTO_STOP_CONFIRMED | ●タイマー一時停止 | sensor由来AUTO_STOP、対応音声ON | 100 / confirmedAt（なければ有効時刻）＋15秒、最新eventIndex/状態との不一致で取消 |
| AUTO_RESUME_CONFIRMED | ●再開検知→タイマー再開 | sensor由来RUNNING、対応音声ON | 100 / 同15秒、最新eventIndex/状態不一致で取消 |
| BREAK / RESUME | ●手動休憩/タイマー再開 | user由来状態イベント、対応機能/音声ON | 100 / 同15秒、最新イベント/状態不一致で取消 |
| STOP_CANDIDATE_DETECTED / CANCELLED / SUPPRESSED | －（空文の診断イベント） | 候補成立/解除/30秒抑制 | 80/100/80、4秒。OBSERVATION_ONLY。発話欠落と数えない |
| DEFERRED（ログ/復旧表現） | ●保留説明→●最新実走/距離→△平均/累計差 | 旧情報通知の割込み後。独立の発火設定/新予定ではない | 元通知を最大1回保留、120秒に更新し最新recoveryへ統合。旧文の全件FIFOではない |
| LEGACY | ●呼出し側の文面 | 旧互換API/テスト等。定期PACE/時計とは別 | 40 / 20秒、通常有効性/キュー制限 |
| TEST_DIAGNOSTIC_FEEDBACK | ●センサー開始/停止、マーカー開始/終了/記録不能 | Test限定。両センサー実受信、保存ACK成功等を根拠にする | 25 / 時間TTLなし、RUN/sessionと終了状態を検査、独立32件上限・限定再試行。既存音声を自ら割り込ませない |

Test診断のfeedbackKindは`SENSOR_STARTED / BEGIN_SAVED / END_SAVED / MARKER_FAILED / SENSOR_STOPPED`。BEGIN/ENDは保存済み順序から決定し、拒否で進めない。実押下4回と音声/ACKの一括実機受入は未完了。

## 3. PACEの分類と固定区間

FAST/SLOW/ON_TARGET/UNKNOWNは[pace-workout](../src/domain/pace-workout.ts)の既存分類（目標ペース・許容幅・連続確認・品質ガード）として残る。**現在mainの新周期は分類に依存しない**。旧Native capabilityでは旧通知経路が残るため、旧版の「適正復帰だけ通知」を現Nativeの仕様として読まない。

paceが有限の正値でない場合UNKNOWN。目標sec/km−許容幅より小さい場合FAST、目標＋許容幅より大きい場合SLOW、境界を含む範囲内はON_TARGET。同じraw分類が2回続くまでstatusはUNKNOWN。休止・設定変更・評価間隔40秒超・window品質不足もUNKNOWNになり得る。新PACEはどの分類でも同じ発話形式であり、速い/遅いで読む項目を切り替えない。

区間nはRUN開始＋(n−1)×設定間隔からn×設定間隔。再生遅延で境界を動かさない。境界の有効GPS辺を補間し、未着データは最大15秒確定待ち、欠測/不良品質はDATA_INSUFFICIENT。全休止区間はCANCELLED_NO_RUNNING、設定変更に跨る区間はCONFIG_CHANGED。READY以外の数値を捏造しない。現在停止中の有効snapshotは再開待機する。永続ACK、32slotのbackpressure、epochと計算の詳細は[実装契約](pace-periodic-implementation-20261122.md)。その文書末尾の当時未完了リストは履歴であり、最終結果は[#85統合報告](main-integration-20261123.md)を優先する。

## 4. Native再生・競合・復旧

根拠：[JS通知生成](../src/services/voice-announcement.ts)、[VoicePolicy](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/VoicePolicy.kt)、[RunAnnouncerService](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/RunAnnouncerService.kt)、[DiagnosticFeedbackPolicy](../modules/run-announcer/android/src/main/java/app/runjourney/announcer/DiagnosticFeedbackPolicy.kt)。

1. ID/RUN/最新eventIndex/状態/目標revisionを確認する。旧batchが現在状態を後退させない。重複IDは再生しない。
2. 優先度で並べる。80以上の上位通知は低優先通知を割り込める。一般キュー16件、重要通知用の低優先退避/evict経路が残る。新PACE/時計とTest feedbackの上限・待機は個別管理される。
3. 通常案内は共通チャイム、停止候補/自動停止/自動再開は専用チャイム、手動BREAK/RESUMEはチャイムなし。カウントダウンは最初だけ共通チャイム。専用チャイム完了待ちと通常チャイムの取消可能性を混同しない。
4. 状態・期限を本文前に再検査。目標cueの開始期限が過ぎても開始済み本文を同じTTLで切らず、別watchdogを使用する。
5. Audio Focus拒否、TTS未準備/エラー、合成/prepare失敗、watchdog、中断等は理由を記録する。騒音連動合成再生失敗時は直接TTS fallback。gainの計算成功は出力音量/聴取効果の保証ではない。
6. PACE/時計は永続ledgerで受理/開始/terminalを管理。保存失敗時は該当系統を抑止して再試行。再起動で開始済み未完了はUNKNOWN_COMPLETION等へ区別し、無条件再発話しない。厳密な「一度だけ聴こえる」保証ではない。

**既知の残件**：旧5分/距離ラップ等の期限・defer失効、TTS初期化失敗後の自動再初期化、長時間滞留の受入、状態通知の実機競合。すべてを無期限FIFOへ変更した実装ではない。予定・生成・受付・開始・完了・取消は別件数。OS完了コールバックは実聴取保証ではない。

## 5. 設計・評価・変更手順

承認済み方針（PACE固定周期/時計遅延時の現在時刻）は上記実装と区別なく新仕様として記録する。残通知の信頼性改善は[残件台帳](remaining-work-20261123.md)の#40/#43/#48等。次の変更では旧版を保持し、対象SHA/Test版、変更理由、実走評価（未実施も明示）を追記する。#52/#53の資料完成と、音声機能Issueの実機受入は独立であり、前者のCloseで後者を完了扱いにしない。
