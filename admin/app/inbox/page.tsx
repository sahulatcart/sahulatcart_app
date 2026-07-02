'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';

interface Convo { id: string; status: string; current_state: string; last_message_at: string; unread_count: number; customers: { name: string | null; wa_id: string } | null }
interface Msg { direction: string; sender: string; body: string; status: string; created_at: string }
interface Detail { conversation: { id: string; status: string; customers: { name: string | null; wa_id: string } | null }; messages: Msg[] }

export default function Inbox() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvos = useCallback(() => { apiJson<{ conversations: Convo[] }>('/api/v1/admin/conversations').then((r) => setConvos(r.conversations)).catch(() => {}); }, []);
  const loadDetail = useCallback((id: string) => { apiJson<Detail>(`/api/v1/admin/conversations/${id}`).then(setDetail).catch(() => {}); }, []);

  useEffect(() => { loadConvos(); const t = setInterval(loadConvos, 5000); return () => clearInterval(t); }, [loadConvos]);
  useEffect(() => { if (!sel) return; loadDetail(sel); const t = setInterval(() => loadDetail(sel), 4000); return () => clearInterval(t); }, [sel, loadDetail]);
  useEffect(() => { endRef.current?.scrollIntoView(); }, [detail?.messages.length]);

  async function act(path: string, body?: object) {
    if (!sel) return;
    setBusy(true);
    await api(`/api/v1/admin/conversations/${sel}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    loadDetail(sel); loadConvos();
  }
  async function send() {
    if (!text.trim()) return;
    const t = text; setText('');
    await act('send', { text: t });
  }

  const takenOver = detail?.conversation.status === 'human_takeover';

  return (
    <AppShell>
      <h1>Inbox</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, height: '70vh' }}>
        <div className="section" style={{ overflowY: 'auto', padding: 0 }}>
          {convos.map((c) => (
            <div key={c.id} onClick={() => setSel(c.id)} style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: sel === c.id ? '#f0fdfa' : undefined }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{c.customers?.name || c.customers?.wa_id}</strong>
                {c.unread_count > 0 && <span className="badge pending">{c.unread_count}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <span className={`badge ${c.status === 'human_takeover' ? 'info' : 'ok'}`}>{c.status === 'human_takeover' ? 'you' : 'bot'}</span> · {c.current_state}
              </div>
            </div>
          ))}
          {convos.length === 0 && <p style={{ padding: 14, color: 'var(--muted)' }}>No conversations yet.</p>}
        </div>

        <div className="section" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
          {!detail ? (
            <p style={{ padding: 20, color: 'var(--muted)' }}>Select a conversation.</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <strong>{detail.conversation.customers?.name || detail.conversation.customers?.wa_id}</strong>
                {takenOver ? (
                  <button className="btn sec" onClick={() => act('release')} disabled={busy}>↩︎ Hand back to bot</button>
                ) : (
                  <button className="btn" onClick={() => act('takeover')} disabled={busy}>Take over</button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.messages.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.direction === 'inbound' ? 'flex-start' : 'flex-end', maxWidth: '75%' }}>
                    <div style={{ background: m.direction === 'inbound' ? '#fff' : m.sender === 'agent' ? '#0f766e' : '#dcfce7', color: m.direction === 'inbound' ? 'var(--ink)' : m.sender === 'agent' ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontSize: 14 }}>
                      {m.body}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: m.direction === 'inbound' ? 'left' : 'right' }}>{m.sender}{m.direction === 'outbound' ? ` · ${m.status}` : ''}</div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
                <input style={{ flex: 1 }} placeholder={takenOver ? 'Type a reply…' : 'Take over to reply as a human'} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={!takenOver} />
                <button className="btn" onClick={send} disabled={!takenOver || !text.trim()}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>Taking over pauses the bot for that chat; hand back to resume automated replies.</p>
    </AppShell>
  );
}
