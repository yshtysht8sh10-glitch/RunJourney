# 音声文書・版履歴の参照

**最新実装の正本：[voice-current.md](voice-current.md)。** 本書以下のv28/v31資料は歴史的仕様・検証結果であり、現行PACE/時計の仕様へ読み替えない。

## 原本の保全

[原本マニフェスト](archive/voice-document-provenance-20261123.json)に元コミット・元パス・保存先・SHA-256を記録した。16ファイルすべて元Git blobと同一バイトで保全する。基点mainも固定SHA `a822da8`で記録し、将来のHEADに依存しない。

- PR #71 `a1fc246`：変更対象14ファイルを`archive/pr71-test-v28/`以下へ原パス付きで保存。[フロー索引](archive/pr71-test-v28/docs/run-flow-index.md)、[検証表](archive/pr71-test-v28/docs/verification-matrix-v28.md)、[当時の停止フロー](archive/pr71-test-v28/docs/auto-stop-flow-20261031.md)、[当時の音声マトリクス](archive/pr71-test-v28/docs/voice-matrix-20261031.md)。旧版archiveや保守規則もそのまま含む。
- PR #74 `199acde`：[v28 HTML原本テキスト](archive/pr74-test-v28/docs/voice-spec-interactive.html.txt)。ブラウザ実行による共有localStorage書換えを防ぐため`.txt`で保全する。内容のバイトは元HTMLと同じ。
- main `a822da8`：[今回変更前のv31 HTML原本テキスト](archive/pr75-test-v31/docs/voice-spec-interactive.html.txt)。既存HTMLのスクリプト/データに変更がないことの比較元。

原本内の相対リンクは当時の配置を記録しているため、アーカイブの深い階層から解決しない場合がある。リンク先コードを当時の配置で読む場合は[PR #71の固定コミット](https://github.com/yshtysht8sh10-glitch/RunJourney/tree/a1fc246b127396831fd22864b92ce202f9aecbf6)、[PR #74の固定コミット](https://github.com/yshtysht8sh10-glitch/RunJourney/tree/199acde050859924df1f4c836f50108693d52b30)を使用する。原本のリンクを書き換えて歴史的データを改変しない。

## 現在も使える部分と差替えられた部分

| 資料 | 現行での位置付け |
|---|---|
| v28フローA〜F/検証マトリクス | RUN保存・判定の当時の説明/受入記録。成功/未実施の記録を現在の再検証結果にしない |
| v28 Auto Stopフロー | 現mainとの対応表・状態遷移・時刻・通知別フローは[新しいAuto Stop正本](auto-stop-current.md)。元配置の旧資料は歴史的記録として保持 |
| v28/v31 PACE・時計TTL | 歴史的仕様。現在の固定周期/区間snapshot/時計待機とは異なる |
| 対話型HTML | 組込み旧版/ユーザー希望版の編集・比較。schema1、保存キー、旧27行→29行互換、セル、import/exportは保持。最新仕様の代替にはしない |
| 最新実装/検証 | [正本](voice-current.md)、[#85の統合報告](main-integration-20261123.md)、[残件](remaining-work-20261123.md) |

新しい版をHTMLに追加する際も既存ID・保存データを上書きせず、保存済みユーザー編集との衝突を検証する。今回新しい組込み版を追加せず、スクリプトと版データをそのまま保全した。
