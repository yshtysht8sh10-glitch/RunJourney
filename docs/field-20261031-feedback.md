# 2026-10-31 Test v21 約12km実走

## 順序・依存・保全
PR #50（Draft/OPEN）のhead 72f82b4を基点にcodex/field-20261031-feedbackを作成。#50は#46のブランチをbaseとする。mergeしない。Production/Pace、既存履歴を変更せずTestのみ更新する。

## 1. #19 騒音連動
実機TestのDiagnostics→音声ログJSON Exportから取得。原ログ23,969,519 bytesと標準Backup12,222,437 bytesは私有D:/working/RunJourney-preservation/field-20261031/に保存。Backup端末/PC SHA256一致8f2c1cde6d1e893a5fb798cf8787c7f59b3866520bd6a177bb6a44d047a0600a。原音声は保存していない。

対象RUNは開始設定ON/マイク許可、内蔵マイクtype15、終了時24,032サンプル（画面OFF23,701）、dBFS min -74.77/max -11.43/mean -43.63。dBFSは校正された音圧ではない。NOISE_LEVEL 1,046件中1,023件はgain約1.0。補正は静音0.65→騒音1.0で、通常TTSの1.0を超える増幅ではない。上限張付きを確認したが、体感不良の原因をこれだけで断定できない。端末stream音量は開始14/30→終了12/30、アプリは変更しない。

STARTED 123件：adaptive58件（Pace42、km12、5分3、終了1）、通常TTSは状態/予告52件とWORKOUT_GOAL1件、5分13件。5分の合成SYNTHESIS_TIMEOUT14件あり（再試行を含む）。通常TTSへのfallbackは音声自体を保つが騒音追従しない。出力経路STARTED時type0なので本体/Bluetoothを断定できない。

修正：再生中gain/routeを変化時と5秒ごとに同一通知IDでADAPTIVE_APPLIEDへ記録。fallback理由を発話レコードに保持し、gain上限・端末stream上限・通常再生超過なし・聴取未確認を別欄に記録。閾値/上限/音声内容/優先度は変更しない。静音→騒音→静音の既存JVMテストと実サービスfallback回帰を検証。聴取効果は次回実走受入。
