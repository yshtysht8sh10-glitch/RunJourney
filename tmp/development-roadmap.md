# RunJourney 開発ロードマップ

> 最終更新: 2026-10-04
>
> この文書は「何を作るか」ではなく「どの順番で対応するか」を管理する。
> 各機能の詳細仕様・完了条件の正本はGitHub Issueとする。
>
> 順番は固定ではない。実走で基本機能の問題が見つかった場合は優先順位を見直す。

## プロダクト原則

**Simple by default, powerful by choice.**

最初はSTART / STOPだけでも迷わず使えるシンプルなランニングアプリとし、必要なユーザーがPace Analysis、Voice、Journey、Streak、EXP等を段階的に利用できるようにする。

**Sensors measure facts → app infers → user can correct afterward.**

GPS等の一次データ、アプリによる推定、ユーザーによる補正を分離する。

---

## NOW

### 1. #6 — Voice 実機動作確認 → Close

実装側の対応は完了。

- 5分ラップ距離を小数第2位（10m単位）まで読み上げ
- Pace / km/h / フル換算は丸め前距離を使用
- History / Lap / Voiceは共通のEffective Run / Pace Analysisを利用
- focused / full tests、Android build、SO_51Bへのインストール完了

**ユーザーの次回実走による動作確認をもって #6 をCloseする。**

確認ポイント:
- 0.83km等の読み上げが自然か
- 10m単位の変化を体感できるか
- Pace / km/h / フル換算に違和感がないか
- 履歴の同一5分LapとVoiceが一致するか
- Auto Stop / Breakを跨いでも距離が跳ねないか

#19（環境騒音連動Voice）は別Issueとして扱うため、#6のCloseを妨げない。

### 2. #20 — 履歴のごみ箱

次の実装対象。

誤STARTやテスト記録を安全に通常履歴から除去する。

- soft delete
- ごみ箱へ移動
- 復元
- 7日後に自動完全削除
- 手動完全削除
- ごみ箱入りした時点でJourney等の集計対象外
- Raw GPS等は完全削除まで保持

日常の実走開発を楽にするため優先度高。

---

## NEXT

### 3. #18 — High Frequency GPS Observation

現在約5秒周期のGPS観測を、**約1秒観測 + 約5秒永続記録**へ分離できるかPoCする。

目的:
- Auto Stopの応答改善
- GPS jitter / 外れ値検出
- speed推定
- 将来のSensor Observation Layer

まずSO_51Bでbattery / background / screen-offを検証する。

### 4. #7 — Auto Stop / Break仕上げ

現状:
- Auto Stop実装済み
- Break実装済み
- retroactive timing実装済み
- Voice連携済み
- Diagnostics実装済み
- 履歴から含める/除外する補正を実装済み
- 実走でAuto Stop成立を確認済み

#18の結果も参考にしながら実走品質を仕上げる。

---

## 基盤完成フェーズ

### 5. #15 — Export / Import

2種類を想定する。

**Backup / Restore**
- 完全な機械可読データ
- Standalone Test → Production移行
- 端末移行
- Raw GPS等を保持

**Human / AI Analysis Export**
- 人間が読める
- ChatGPT等へ渡して走行分析できる
- ラップ、ペース、停止等を含む

### 6. #5 — Pace Analysis

既存の5分ラップ基盤から拡張する。

- 500m
- 1km
- 任意距離
- 任意時間
- ペース推移グラフ
- 履歴詳細分析

### 7. #14 — Non-destructive Edit

#7で停止区間の「含める/除外する」は先行実装済み。

今後:
- GPS異常区間補正
- Run分割
- Run結合
- タイトル / メモ
- Undo / Redo

### 8. #19 — 環境騒音連動Voice

- 静かな環境: 通常音量
- 車等で騒がしい: 一時的に音量を上げる
- 静かになったら戻す
- マイク音声そのものは保存せず騒音レベルのみ利用する方向でPoC

---

## Journey / ゲーミフィケーションフェーズ

### 9. #2 / #9 — Journey

静岡から出発して世界を旅し、最終的に月へ。

#2と#9は重複が大きいため、実装開始時に一本へ統合することを検討する。

### 10. #10 — Streak

- 今日走ったか
- 現在の連続日数
- 最長記録

### 11. #11 — EXP / Gems

ランニングでEXPを獲得し、Achievement等でGemを獲得する。

### 12. #12 — Weekly EXP Ranking

将来的なオンライン要素。
Run / Cycle等の異なる活動カテゴリはランキングを混在させない。

---

## FUTURE

必要になった段階で優先順位を再評価する。

- #3 GPS軌跡の地図表示
- #4 履歴の時間表示切替
- #8 履歴集計・仕切り
- #13 Walk / Bicycle / Driveへの拡張
- #16 健康・健康寿命への拡張

---

## DONE

### #17 — 5分ラップ距離と総走行距離の整合性

**CLOSED**

- Total / Lap / Voiceの共通計算を整理
- START / STOP境界を修正
- 通知遅延と分析区間を分離
- Effective Run / Pace Analysisへ統一
- 整合性・境界・遅延・補正・旧記録等のテストを追加
- 構造的不整合を解消してClose

前回実走で観測した差の真因そのものは未証明だが、再発を検出できる構造とテストを整備済み。

---

## Close管理

### ユーザー確認後Close
- #6 Voice — 実装・自動テスト・実機インストール完了。次回実走の動作確認をもってClose

### Close候補
- #1 基本設計指針 — 設計思想がREADME/開発方針へ定着していればClose

### 一部実装済みだがOPEN維持
- #5 Pace Analysis
- #7 Auto Stop / Break
- #14 Non-destructive Edit

---

## 現在の一本道

```text
#6 Voice 実走確認 ──→ Close
        │
        ├── 並行して #20 ごみ箱を実装
        ↓
#18 1秒GPS PoC
        ↓
#7 Auto Stop仕上げ
        ↓
#15 Export / Import
        ↓
#5 Pace Analysis拡張
        ↓
#14 履歴編集基盤
        ↓
#19 騒音連動Voice
        ↓
========================
   ランニング基盤完成
========================
        ↓
#2/#9 Journey
        ↓
#10 Streak
        ↓
#11 EXP / Gems
        ↓
#12 Ranking
```

## 更新ルール

開発サイクルは、

**実走 → 気付き → Issue → 優先順位の再評価**

とする。

- 新しいIssueを作ったら、このロードマップ上の位置を判断する
- IssueをCloseしたらDONEへ移す
- ユーザー実走確認待ちのIssueは、実装待ちIssueをブロックしない限り並行して次へ進む
- 実走で基本記録の不具合が発見された場合、Journey/ゲーム機能より優先する
- 詳細仕様をこの文書へ重複記載しすぎず、Issueを正本とする
