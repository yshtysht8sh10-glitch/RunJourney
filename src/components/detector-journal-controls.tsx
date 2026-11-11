import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DetectorJournal, detectorJournalAllowed, detectorJournalNative, replayLocalDetectorJournal } from '@/services/detector-journal';
import { runDetectorDeviceProbe, verifyStoredDetectorDeviceProbes } from '@/services/detector-device-probe';
import { useFocusEffect } from 'expo-router';
import { RunRepository } from '@/repositories/run-repository';

export function DetectorJournalDetails({ buildGitHash }: { buildGitHash: string }) {
  const [message, setMessage] = useState('OFF（起動ごとにOFF・端末内暗号化・共有対象外）');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullMessage, setFullMessage] = useState(false);
  if (!detectorJournalAllowed()) return null;
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch { setMessage('診断処理を完了できませんでした。RUNは継続します。'); }
    finally { setBusy(false); }
  };
  return <View style={styles.details}>
    <Pressable accessibilityRole="button" accessibilityLabel="診断詳細・検証を表示" style={styles.secondary} onPress={()=>setExpanded(!expanded)}><Text style={styles.label}>{expanded ? '診断詳細・検証を閉じる' : '診断詳細・検証を表示'}</Text></Pressable>
    {expanded && <>
    <Text style={styles.label}>Issue #72：入力・判定ジャーナル（初期実装）</Text>
    <Text style={styles.label}>診断はRUN開始から95分後の最初のGPSバッチ完了で終了・sealします。通常RUNは継続します。診断をONにしてからSTARTしてください。</Text>
    <Text style={styles.label}>採取範囲：JS_SUBMITTED_ONLY。OS未配信・開始前・終了freeze後は含みません。sealと判定再現一致は別に確認します。</Text>
    <Text selectable style={styles.label} numberOfLines={fullMessage ? undefined : 6}>{fullMessage ? message.slice(0,12000) : message.slice(0,1000)}</Text>
    <Pressable accessibilityRole="button" style={styles.secondary} onPress={()=>setFullMessage(!fullMessage)}><Text style={styles.label}>{fullMessage ? '結果を短く表示' : '結果の詳細を表示（最大12,000文字）'}</Text></Pressable>
    {(['short','paced','long','failure','crash','limit'] as const).map(mode=><Pressable key={mode} accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={()=>void action(async()=>{setMessage('人工入力を検証中。通常RUNは保存しません。');setMessage(JSON.stringify(await runDetectorDeviceProbe(mode,buildGitHash)));})}><Text style={styles.label}>{({limit:'実機検証：95分診断終了境界（時間短縮）',short:'実機検証：短時間ON/OFF比較',paced:'実機検証：画面OFF 1Hz（ON/OFF各25秒）',long:'実機検証：95分相当の入力負荷',failure:'実機検証：記録受付拒否後の継続',crash:'実機検証：強制終了用（途中でPCから終了）'})[mode]}</Text></Pressable>)}
    <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={()=>void action(async()=>setMessage(JSON.stringify(await verifyStoredDetectorDeviceProbes())))}><Text style={styles.label}>実機検証：再起動後の復号・seal・再現確認</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={() => void action(async () => {
      const sessions: { id: string; bytes: number; expired: boolean; sealState?: string }[] = JSON.parse(await detectorJournalNative().detectorJournalList!());
      // Output only counts, never session payloads/coordinates/run IDs.
      setMessage(`${DetectorJournal.status} / 保存${sessions.length}件 / ${sessions.reduce((sum, s) => sum + s.bytes, 0)} bytes / 7日超${sessions.filter(s => s.expired).length}件 / Native seal ${sessions.filter(s=>s.sealState==='SEALED').length}件（再現一致とは別） / 最大引渡し${DetectorJournal.maxHandoffMs.toFixed(2)}ms`);
    })}><Text style={styles.label}>座標を含まない保存状況を確認</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={() => void action(async () => {
      const sessions: { id: string }[] = JSON.parse(await detectorJournalNative().detectorJournalList!());
      let complete = 0, incomplete = 0;
      for (const session of sessions) { try { const result = await replayLocalDetectorJournal(session.id); if (result.complete) complete++; else incomplete++; } catch { incomplete++; } }
      setMessage(`端末内再現リプレイ：整合${complete}件／不完全・不一致${incomplete}件。実停止の正解率ではありません。`);
    })}><Text style={styles.label}>診断OFF後に端末内で現行方式を再現</Text></Pressable>
    <Text style={styles.label}>削除・原データExport・実停止マーカーは次段階のレビュー対象です。7日超でも自動削除しません。</Text>
    </>}
  </View>;
}


export function DetectorJournalControls({ buildGitHash }: { buildGitHash: string }) {
  const [status, setStatus] = useState(DetectorJournal.status);
  const [sealedId, setSealedId] = useState<string>();
  const [incompleteId, setIncompleteId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useFocusEffect(useCallback(() => {
    let mounted = true, reading = false;
    let verifiedId: string | undefined;
    const update = async () => {
      if (!mounted) return;
      setStatus(DetectorJournal.status);
      const id = DetectorJournal.captureId;
      if (DetectorJournal.status !== 'SEALED_PENDING_VERIFICATION' || !id || id===verifiedId || reading) return;
      reading = true;
      try {
        const sessions: {id:string;sealState?:string}[] = JSON.parse(await detectorJournalNative().detectorJournalList!());
        const saved=sessions.find(s=>s.id===id);
        if(mounted && saved?.sealState==='SEALED'){verifiedId=id;setSealedId(id);}
        if(mounted && saved?.sealState==='INCOMPLETE'){verifiedId=id;setIncompleteId(id);}
      } catch { /* Retain the explicit verification-pending status. */ }
      finally { reading = false; }
    };
    if (detectorJournalAllowed()) void update();
    const timer = setInterval(()=>{if(detectorJournalAllowed()) void update();},1000);
    return ()=>{mounted=false;clearInterval(timer);};
  }, []));
  if (!detectorJournalAllowed()) return null;
  const armed = status === 'ARMED', recording = status === 'RECORDING';
  const state = armed ? 'ARMED（START待ち）' : recording ? 'RECORDING（診断記録中）'
    : status === 'SEALED_PENDING_VERIFICATION'
      ? incompleteId === DetectorJournal.captureId ? 'OFF（Native保存不完全・データ保持）'
        : sealedId === DetectorJournal.captureId ? 'SEALED（診断記録終了）' : '診断記録終了・seal確認中'
      : status.includes('INCOMPLETE') ? 'OFF（中断・不完全な記録を保持）'
      : status === 'UNAVAILABLE' ? 'OFF（記録開始に失敗）' : 'OFF';
  const arm = async () => {
    if(busy)return;
    setBusy(true);setMessage('');
    try {
      if(await RunRepository.getActiveRun()){setMessage('RUN開始前にONにしてください。');return;}
      await DetectorJournal.arm(buildGitHash);
      setStatus(DetectorJournal.status);
      if(DetectorJournal.status!=='ARMED')setMessage('開始できませんでした。診断状態を確認してください。');
    } catch {setMessage('診断を開始できませんでした。既存の記録は保持しています。');}
    finally {setBusy(false);}
  };
  return <View style={styles.panel}>
    <Text style={styles.heading}>実GPS診断</Text>
    <Text accessibilityLiveRegion="polite" style={styles.status}>診断状態：{state}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="次のRUNの診断をON" accessibilityState={{disabled:busy||armed||recording}}
      disabled={busy||armed||recording} style={[styles.primary,(busy||armed||recording)&&styles.disabled]}
      onPress={()=>void arm()}><Text style={styles.primaryLabel}>次のRUNの診断をON</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary}
      onPress={()=>{DetectorJournal.stop(true);setStatus(DetectorJournal.status);setMessage('診断はOFFです。保存済みデータは保持しています。');}}>
      <Text style={styles.label}>診断をOFF</Text>
    </Pressable>
    <Text style={styles.note}>ON → ARMEDを確認 → ラン画面でSTART。再起動するとOFFになります。</Text>
    {!!message && <Text style={styles.label} numberOfLines={3}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  panel:{backgroundColor:'#1D2932',borderColor:'#6D899C',borderWidth:1,borderRadius:12,padding:12,gap:8},
  details:{padding:12,gap:12,borderWidth:1,borderColor:'#526776',borderRadius:12,marginBottom:16},
  heading:{color:'#FFFFFF',fontSize:18,fontWeight:'700'},
  status:{color:'#8CF0B1',fontSize:17,fontWeight:'700'},
  primary:{backgroundColor:'#E85D2A',borderRadius:10,minHeight:52,padding:12,justifyContent:'center'},
  primaryLabel:{color:'#FFFFFF',fontWeight:'700',fontSize:17,textAlign:'center'},
  secondary:{backgroundColor:'#33424C',borderRadius:10,minHeight:44,padding:10,justifyContent:'center'},
  label:{color:'#F5F2EB',fontSize:14,lineHeight:20},
  note:{color:'#CEDCE5',fontSize:13,lineHeight:18},
  disabled:{opacity:.65},
});
