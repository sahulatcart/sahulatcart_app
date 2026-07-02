'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, Send, User, Undo2 } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';

interface Convo { id: string; status: string; current_state: string; last_message_at: string; unread_count: number; customers: { name: string | null; wa_id: string } | null }
interface Msg { direction: string; sender: string; body: string; status: string; created_at: string }
interface Detail { conversation: { id: string; status: string; customers: { name: string | null; wa_id: string } | null }; messages: Msg[] }

const initials = (s: string) => (s || '?').trim().slice(0, 1).toUpperCase();

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
    await api(`/api/v1/admin/conversations/${sel}/${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false); loadDetail(sel); loadConvos();
  }
  async function send() { if (!text.trim()) return; const t = text; setText(''); await act('send', { text: t }); }
  const takenOver = detail?.conversation.status === 'human_takeover';

  return (
    <AppShell>
      <PageHead title="Inbox" sub="Take over any chat — the bot pauses while you reply" />
      <div className="card" style={{ display: 'grid', gridTemplateColumns: '290px 1fr', height: '68vh', overflow: 'hidden' }}>
        {/* conversation list */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          {convos.map((c) => {
            const nm = c.customers?.name || c.customers?.wa_id || '?';
            return (
              <div key={c.id} onClick={() => setSel(c.id)} style={{ display: 'flex', gap: 11, padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: sel === c.id ? 'var(--brand-tint)' : undefined }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--muted)', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{initials(nm)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row between"><span className="strong" style={{ fontSize: 13.5 }}>{nm}</span>{c.unread_count > 0 && <span className="pill danger">{c.unread_count}</span>}</div>
                  <div className="hint" style={{ marginTop: 2 }}>{c.status === 'human_takeover' ? '🙋 you' : '🤖 bot'} · {c.current_state}</div>
                </div>
              </div>
            );
          })}
          {convos.length === 0 && <div className="empty"><MessagesSquare /><div>No conversations yet.</div></div>}
        </div>

        {/* chat pane */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!detail ? (
            <div className="empty" style={{ margin: 'auto' }}><MessagesSquare /><div>Select a conversation</div></div>
          ) : (
            <>
              <div className="row between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ gap: 9 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--muted)', display: 'grid', placeItems: 'center', fontWeight: 700 }}><User size={16} /></div><span className="strong">{detail.conversation.customers?.name || detail.conversation.customers?.wa_id}</span></div>
                {takenOver
                  ? <button className="btn ghost sm" onClick={() => act('release')} disabled={busy}><Undo2 /> Hand back to bot</button>
                  : <button className="btn sm" onClick={() => act('takeover')} disabled={busy}>Take over</button>}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 8, background: '#fbfcfe' }}>
                {detail.messages.map((m, i) => {
                  const inbound = m.direction === 'inbound';
                  const agent = m.sender === 'agent';
                  return (
                    <div key={i} style={{ alignSelf: inbound ? 'flex-start' : 'flex-end', maxWidth: '74%' }}>
                      <div style={{ background: inbound ? '#fff' : agent ? 'var(--brand)' : 'var(--brand-tint-2)', color: agent ? '#fff' : 'var(--ink)', border: inbound ? '1px solid var(--border)' : 'none', borderRadius: 14, borderBottomLeftRadius: inbound ? 4 : 14, borderBottomRightRadius: inbound ? 14 : 4, padding: '9px 13px', fontSize: 13.5, lineHeight: 1.45, boxShadow: 'var(--shadow-sm)' }}>{m.body}</div>
                      <div className="hint" style={{ fontSize: 10.5, textAlign: inbound ? 'left' : 'right', marginTop: 3 }}>{agent ? 'you' : m.sender}{!inbound ? ` · ${m.status}` : ''}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)', gap: 8 }}>
                <input style={{ flex: 1 }} placeholder={takenOver ? 'Type a reply…' : 'Take over to reply as a human'} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={!takenOver} />
                <button className="btn" onClick={send} disabled={!takenOver || !text.trim()}><Send /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
