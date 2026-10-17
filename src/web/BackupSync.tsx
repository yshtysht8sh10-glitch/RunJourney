import { useEffect, useRef, useState } from 'react';
import type { PagedRemote, PagedSyncQueue } from '../sync/paged-protocol';
import type { RunSummary } from '../domain/pages';
import { backupUploadQueue } from '../sync/backup-upload';
import { BrowserPageCache, importPagedFile } from './paged-cache';

export default function BackupSync({ uid, ownerUid, destination, remote }: { uid: string; ownerUid: string; destination: string; remote: PagedRemote }) {
  const [session, setSession] = useState<{ cache: BrowserPageCache; queue: PagedSyncQueue } | null>(null);
  const [rows, setRows] = useState<RunSummary[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<PagedSyncQueue['state']>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const locked = useRef(false);
  const pendingWork = useRef<Promise<void> | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let disposed = false;
    const cache = new BrowserPageCache(`runjourney-upload-v1-${encodeURIComponent(uid)}`);
    const queue = backupUploadQueue(ownerUid, cache.queueStore(uid), id => cache.source(id), remote);
    let release!: () => void;
    const lifetime = new Promise<void>(resolve => { release = resolve; });
    void (async () => {
      if (!navigator.locks) throw new Error('安全な同期にはWeb Locks対応ブラウザが必要です。ChromeまたはEdgeで開いてください');
      await navigator.locks.request(cache.name, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('同じアカウントの同期画面が別タブで開いています。そちらを閉じてから再読み込みしてください');
        await queue.open();
        const catalog = (await cache.list()).map(r => r.summary).filter(r => r.trashedAt === undefined);
        if (!disposed) { setSession({ cache, queue }); setRows(catalog); setEntries(queue.state); }
        await lifetime;
      });
    })().catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; void (async () => { try { await pendingWork.current?.catch(() => undefined); await cache.close().catch(() => undefined); } finally { release(); } })(); };
  }, [uid, ownerUid, remote, generation]);
  async function work(fn: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); setStatus('');
    try { const task = fn(); pendingWork.current = task; await task; } catch(e) { setError(String(e)); }
    finally { pendingWork.current = null; locked.current = false; setBusy(false); if (session) setEntries(session.queue.state); }
  }
  return <section className="panel">
    <h2>v17の実走バックアップを同期</h2>
    <p>安定v17を更新せず、既存の「Backup JSONをExport」で書き出したファイルのコピーを選択します。実機DB・元ファイルは変更しません。取り込みだけでは送信しません。</p>
    <p>送信先：{destination} ／ アカウントUID：{ownerUid}</p>
    <p>GPS座標・日時・診断情報を含みます。ごみ箱・進行中draft・端末設定は送信しません。</p>
    <label className="file-button">実走バックアップを選択（まだ送信しません）<input type="file" accept=".json,.ndjson,.jsonl" disabled={busy || !session} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (file && session) void work(async () => {
        const diagnostic = await importPagedFile(file, session.cache, setStatus);
        if (diagnostic) throw new Error('診断単体ファイルは同期できません。走行バックアップを選んでください');
        const catalog = (await session.cache.list()).map(r => r.summary).filter(r => r.trashedAt === undefined);
        setRows(catalog); setSelected(catalog.map(r => r.id)); setStatus(`${catalog.length}件をPC内へ検証・保管しました。まだ送信していません。`);
      });
    }} /></label>
    <p>旧JSONは5MiBまで。大きいv17バックアップはPCで <code>{'npm run prepare:v17 -- --input "コピーのパス" --output "新規NDJSONパス"'}</code> により変換して選択してください。</p>
    {error && <p role="alert" className="error">{error} 元ファイルは保持されています。</p>}
    {(status || busy) && <p role="status">{busy ? '処理中… ' : ''}{status}</p>}
    <p>送信候補 {rows.length}件 ／ 選択 {selected.length}件 ／ GPS {rows.filter(r => selected.includes(r.id)).reduce((n,r) => n+r.pointCount,0)}点</p>
    <div className="table-scroll"><table><thead><tr><th>選択</th><th>Run ID / 開始日時</th><th>GPS点数</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><input aria-label={`同期対象 ${r.id}`} type="checkbox" disabled={busy} checked={selected.includes(r.id)} onChange={e => setSelected(e.target.checked ? [...selected,r.id] : selected.filter(id => id !== r.id))} /></td><td>{r.id}<br/>{r.startedAt}</td><td>{r.pointCount}</td></tr>)}</tbody></table></div>
    <button disabled={busy || !session || !selected.length} onClick={() => void work(async () => {
      for (const id of selected) await session!.queue.enqueue(id);
      setSelected([]); setStatus('送信キューへ保存しました。下の同期ボタンで送信します。');
    })}>選択した実走記録を送信キューへ登録</button>
    <p>未完了キュー {entries.length}件。通信断・再読み込み後も、このアカウント専用のPC内データから再試行できます。</p>
    <button disabled={busy || !session || !entries.length} onClick={() => void work(async () => {
      const remaining = await session!.queue.flush(Date.now(), true);
      setStatus(remaining.length ? `${remaining.length}件が未完了です。エラーを確認して再試行してください。` : '同期完了。クラウド履歴を読み込むボタンで取得してください。');
    })}>実走データを同期／再試行</button>
    {entries.map(e => <p key={e.id}>{e.id} · {e.status} · 試行{e.attempts} · {e.error ?? '送信待ち'}</p>)}
    <p>再試行用データは、このブラウザのアカウント専用IndexedDBに残ります。ログアウトしても保持します。元のバックアップも保管してください。</p>
    <button disabled={busy || !session || entries.length > 0} onClick={() => void work(async () => {
      await session!.cache.dispose(); setSession(null); setRows([]); setSelected([]); setEntries([]); setGeneration(n => n+1); setStatus('同期用のPC内コピーを消去しました。元ファイル・実機・クラウドは保持されています。');
    })}>完了した同期用のPC内コピーを消去</button>
  </section>;
}
