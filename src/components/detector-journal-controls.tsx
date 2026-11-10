import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DetectorJournal, detectorJournalAllowed, detectorJournalNative, replayLocalDetectorJournal } from '@/services/detector-journal';
import { runDetectorDeviceProbe, verifyStoredDetectorDeviceProbes } from '@/services/detector-device-probe';
import { RunRepository } from '@/repositories/run-repository';

export function DetectorJournalControls({ buildGitHash }: { buildGitHash: string }) {
  const [message, setMessage] = useState('OFF（起動ごとにOFF・端末内暗号化・共有対象外）');
  const [busy, setBusy] = useState(false);
  if (!detectorJournalAllowed()) return null;
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch { setMessage('診断処理を完了できませんでした。RUNは継続します。'); }
    finally { setBusy(false); }
  };
  return <View style={{ padding: 12, gap: 12, borderWidth: 1 }}>
    <Text>Issue #72：入力・判定ジャーナル（初期実装）</Text>
    <Text>採取範囲：JS_SUBMITTED_ONLY。OS未配信・開始前・終了freeze後は含みません。sealと判定再現一致は別に確認します。</Text>
    <Text selectable>{message}</Text>
    {(['short','paced','long','failure','crash'] as const).map(mode=><Pressable key={mode} accessibilityRole="button" disabled={busy} onPress={()=>void action(async()=>{setMessage('人工入力を検証中。通常RUNは保存しません。');setMessage(JSON.stringify(await runDetectorDeviceProbe(mode,buildGitHash)));})}><Text>{({short:'実機検証：短時間ON/OFF比較',paced:'実機検証：画面OFF 1Hz（ON/OFF各25秒）',long:'実機検証：95分相当の入力負荷',failure:'実機検証：記録受付拒否後の継続',crash:'実機検証：強制終了用（途中でPCから終了）'})[mode]}</Text></Pressable>)}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void action(async()=>setMessage(JSON.stringify(await verifyStoredDetectorDeviceProbes())))}><Text>実機検証：再起動後の復号・seal・再現確認</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void action(async () => {
      if (await RunRepository.getActiveRun()) { setMessage('RUN開始前にONにしてください。計測途中では開始しません。'); return; }
      await DetectorJournal.arm(buildGitHash); setMessage(DetectorJournal.status);
    })}><Text>次のRUNの診断をON</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { DetectorJournal.stop(true); setMessage('OFF。終了前の記録は不完全として保持します。'); }}><Text>診断をOFF</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void action(async () => {
      const sessions: { id: string; bytes: number; expired: boolean; sealState?: string }[] = JSON.parse(await detectorJournalNative().detectorJournalList!());
      // Output only counts, never session payloads/coordinates/run IDs.
      setMessage(`${DetectorJournal.status} / 保存${sessions.length}件 / ${sessions.reduce((sum, s) => sum + s.bytes, 0)} bytes / 7日超${sessions.filter(s => s.expired).length}件 / Native seal ${sessions.filter(s=>s.sealState==='SEALED').length}件（再現一致とは別） / 最大引渡し${DetectorJournal.maxHandoffMs.toFixed(2)}ms`);
    })}><Text>座標を含まない保存状況を確認</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void action(async () => {
      const sessions: { id: string }[] = JSON.parse(await detectorJournalNative().detectorJournalList!());
      let complete = 0, incomplete = 0;
      for (const session of sessions) { try { const result = await replayLocalDetectorJournal(session.id); if (result.complete) complete++; else incomplete++; } catch { incomplete++; } }
      setMessage(`端末内再現リプレイ：整合${complete}件／不完全・不一致${incomplete}件。実停止の正解率ではありません。`);
    })}><Text>診断OFF後に端末内で現行方式を再現</Text></Pressable>
    <Text>削除・原データExport・実停止マーカーは次段階のレビュー対象です。7日超でも自動削除しません。</Text>
  </View>;
}
