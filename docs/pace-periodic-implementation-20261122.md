# PACE固定周期・区間スナップショット実装メモ（2026-11-22）

対象: `codex/voice-periodic-20261122`。TS実装コミット: `0c69d64`。
本書はTS実装とNativeへの契約を記録する。実機受入済みを示す資料ではない。

2026-11-22追記: Native候補は`3089748`、保存失敗のレビュー修正は`1bc3503`。PACE受付をAtomicFile・fsync・読戻し一致後にACKし、完了/設定/取消の保存失敗中はPACEだけ抑止して再試行する。独立レビューの初回P1を修正し、コード差分の限定承認を取得した。時計は元からadaptive対象外で、プレースホルダ誤読の初回指摘は呼出条件確認後に撤回された。140 Native tests成功。実機、Bluetooth、画面OFF、I/O負荷・電池は未検証。発話完了直後のプロセス終了境界、32区間の長期滞留、全音声の旧TTL経路は残課題であり、全機能完了とは扱わない。

## 承認済みの方針

- RUN開始からの経過時間を基準に、設定された60秒以上の固定周期を使用する。実再生時刻で次回をずらさない。
- FAST / SLOW / ON_TARGET / UNKNOWNによって予定を消さない。
- 区間終了時点の値を保持する。読み上げは「区間の貯金増減 → 区間終了時の累計距離 → 累計貯金／遅れ」の既存形式。
- 停止中は予定を保持する。数値不足を捏造せず明示する。無制限FIFOにはしない。
- 通常km・5分ラップ、Auto Stop判定、GPS取得、通常RUN保存を変更しない。

元設計は `origin/codex/voice-reliability-design-20261112` の
`docs/voice-reliability-design-20261112.md` / `docs/voice-reliability-matrix-20261112.md`。
後続の本人承認を優先し、元設計の提案と承認済み仕様を区別する。

## TSの責務と計算

`src/domain/pace-periodic.ts` の `paceSchedule` / `pacePeriodicSnapshots` が純粋関数として実装を持つ。
`src/services/voice-announcement.ts` がNative capabilityと受理cursorを読み、snapshotを送信する。

- slot n: `[RUN開始+(n-1)×間隔, RUN開始+n×間隔]`。60 / 120 / 180秒など既存設定値・保存形式を維持。
- 距離D(t): 既存 `effectiveEdges(run, t)` の合計。区間境界を跨ぐ有効なGPS辺は既存距離モデルの線形補間を使用し、最終GPS点より先へ外挿しない。
- 実走時間A(t): 既存 `timeModel`。Auto Stop・手動休憩・補正済みイベントの扱いを再定義しない。
- 累計B(t): `目標sec/km × D(t)/1000 - A(t)/1000`。
- 増減: 既存 `paceAnnouncementMessage` の丸め・表現を再利用。前回の「再生」snapshotではなく区間開始・終了snapshotを渡す。最初の区間はRUN開始D=0、A=0を基準にできる場合のみ増減を読む。
- 数値はNativeが受理・永続化したsnapshotを保持する。現在距離や遅延再生時点のデータへ置換しない。
- RUN/GPSオブジェクト・既存DB・設定へ新しいフィールドを書き込まない。

## 品質ガード・休止・設定変更

以下の数値は音声snapshotを確定するための実装上の保守的ガードであり、Auto Stop閾値の変更ではない。

- GPSの精度20m以下、有効な座標、順序、連続辺の10秒以下の間隔、既存ランニング上限12.5m/s以下を確認する。
- 開始時の最初のGPSが10秒以内なら既存距離モデルの記録済み経路を使用する。その間の未測定移動は加算しない。10秒を超える開始欠測は不足とする。
- 後半区間の累計を正確と誤認させないよう、累計GPS品質の不足を後続へ伝播させる。十分な後半データがあっても不明な累計を数値化しない。
- 境界を跨ぐGPSが未着なら最大15秒の確定猶予を設ける。Auto Stop有効時は判定の遡及を考慮し、15秒後かつ境界以前の `stillSince` 候補が未解決でないことを待つ。
- この待機は通知の配送TTLではない。未確定slotを受理済みにしない。
- 実走時間ゼロの全休止slotは `CANCELLED_NO_RUNNING`。一部走行を含むslotはsnapshotを生成し、現在停止中ならNativeが再開まで保持する。
- `activeFromMs` より前に始まる区間は `CONFIG_CHANGED`。新目標を古い区間へ遡及適用しない。区間原点は常にRUN開始。

品質: `READY` / `DATA_INSUFFICIENT` / `CANCELLED_NO_RUNNING` / `CONFIG_CHANGED`。
不足には理由と「この区間はデータが不足しているため、ペースをお知らせできません。」を付け、距離・貯金の数値を載せない。

## Native契約・ACK・backpressure

capability `pacePeriodicVersion() >= 1` のときのみ新経路。旧Nativeは既存経路を維持する。

```ts
paceSchedule = { version: 1, runId, startedAt, intervalMs, enabled,
  configKey: `v1:${intervalMs}:${targetSecPerKm}`, targetSecPerKm }
pacePeriodicState(runId, configKey) // JSON null、または:
{ acceptedThrough: number, activeFromMs: number }
```

- 初回cursor未設定ではscheduleのみを送る。Nativeが設定epochを永続化するまで過去区間を推測しない。
- `acceptedThrough` は連続した**保存受理済みslot**。再生完了を待つcursorではない。
- 初期RUNなら開始時刻、途中ON・間隔／目標変更なら変更時刻を `activeFromMs` とする。同configKeyでもOFF→ON時のepochを更新する。
- snapshotは `PACE_WARNING.data.pacePeriodicSnapshot`。IDは `runId:pace:configKey:slot`、予定時刻は `scheduledAt=endAt`、priority20。時間だけで失効させないため旧TTLを適用しない。
- READYと不足文を個別に保持し、旧同種破棄・defer時の最新値置換から除外する。無音取消2種も理由を記録してterminal ACKする。
- TSは1回最大32slotを提案する。保存失敗／満杯ならNativeはcursorを進めず、同IDを次回再送する。JSの `sentNotices` は消費しない。
- RUN終了／設定OFFはNativeが取消理由を永続化する。音声を終わったRUNへ流さない。
- retryは `PACE_SNAPSHOT_SUBMITTED` と記録し、固有の生成件数へ重複計上しない。固有SCHEDULED／受理／完了ログはNative ledgerが担当する。

Native側の固定周期tick・永続ledger・キュー統合・再起動復旧は別実装である。32件上限を満たすだけで大量の古い音声を連続再生してよいとは判断しない。長時間滞留時の統合／取消方針とデータ不足通知頻度は、Native実装・独立レビューで確認する。

## 検証済み範囲と未検証

TS実装時点:

- Jest全体: **76 suites / 584 tests PASS**（約91秒、Native SQLiteを使用する既存試験を含む）。
- PACE snapshot／service／既存announcement／voice-batch focused: **42 tests PASS**。
- 型チェック、Expo Lint、`git diff --check`: PASS。
- 固定周期・分類非依存・遅延再生不変・初回基準・120/180秒・休止・判定待ち・GPS欠測／精度／逆順／飛び・境界補間・後続異常の非干渉・設定変更・32件上限・橋渡し失敗後の同ID再送・ACK後抑止・OFF／終了・PACE-only復旧を確認。

Native実装後に必要:

- 保存前にACKしないこと、永続再起動後も同一snapshotであること。
- 停止中保持、無音取消cursor、設定OFF→ON、目標A→B→A、キュー満杯のcursor非前進。
- 新snapshotが通常PACE同種破棄・defer置換・20秒TTLの影響を受けないこと。
- RUN終了取消、Auto Stop高優先通知との共存、全区間ログの追跡。
- Android実機・Bluetooth・画面OFF・バックグラウンド・長時間・CPU/I/Oへの影響・既存データの更新前後照合。

**実機試験・音声聴取・独立レビューは未完了。上記584件を実機成功や最終受入の代わりに扱わない。**
