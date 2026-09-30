'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, Hand, MessagesSquare, Send, Undo2, UserRound } from 'lucide-react';
import AppShell, { EmptyState, PageHead, humanize } from '../../components/AppShell';
import { api, apiError, apiJson, dt } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface Convo { id: string; status: string; current_state: string; last_message_at: string; unread_count: number; customers: { name: string | null; wa_id: string } | null }
interface Msg { direction: string; sender: string; body: string; status: string; created_at: string }
interface Detail { conversation: { id: string; status: string; window_expires_at: string | null; customers: { name: string | null; wa_id: string } | null }; messages: Msg[] }

const initials = (s: string) => (s || '?').trim().slice(0, 1).toUpperCase();

export default function Inbox() {
  const toast = useToast();
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);

  const loadConvos = useCallback(() => { apiJson<{ conversations: Convo[] }>('/api/v1/admin/conversations').then((r) => setConvos(r.conversations)).catch(() => {}); }, []);
  const loadDetail = useCallback((id: string) => { apiJson<Detail>(`/api/v1/admin/conversations/${id}`).then(setDetail).catch(() => {}); }, []);
  useEffect(() => { loadConvos(); const t = setInterval(loadConvos, 5000); return () => clearInterval(t); }, [loadConvos]);
  useEffect(() => { if (!sel) return; loadDetail(sel); const t = setInterval(() => loadDetail(sel), 4000); return () => clearInterval(t); }, [sel, loadDetail]);
  // Scroll the messages container itself (NOT scrollIntoView, which would scroll the whole page).
  useEffect(() => { if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight; }, [detail?.messages.length, sel]);

  async function act(path: string, body?: object) {
    if (!sel) return;
    setBusy(true);
    const r = await api(`/api/v1/admin/conversations/${sel}/${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    setBusy(false); loadDetail(sel); loadConvos();
    if (!r.ok) toast(await apiError(r), 'error');
    return r.ok;
  }
  async function send() { if (!text.trim()) return; const t = text; setText(''); if (!(await act('send', { text: t }))) setText(t); }
  const open = (id: string) => { setDetail(null); setSel(id); };
  const shown = detail && detail.conversation.id === sel ? detail : null;
  const takenOver = shown?.conversation.status === 'human_takeover';
  // WhatsApp refuses free-form replies 24h after the buyer's last message.
  const expires = shown?.conversation.window_expires_at;
  const windowClosed = !!expires && new Date(expires).getTime() <= Date.now();
  const canType = takenOver && !windowClosed;
  const name = shown?.conversation.customers?.name || shown?.conversation.customers?.wa_id || '';

  return (
    <AppShell>
      <PageHead title="Inbox" sub="Every WhatsApp chat. Take over any of them — the bot pauses while you reply." />
      <div className={`card inbox ${sel ? 'has-sel' : ''}`}>
        {/* Conversation list */}
        <div className="convo-list" role="list" aria-label="Conversations">
          {(convos ?? []).map((c) => {
            const nm = c.customers?.name || c.customers?.wa_id || '?';
            const human = c.status === 'human_takeover';
            return (
              <button key={c.id} role="listitem" className="convo" aria-current={sel === c.id} onClick={() => open(c.id)}>
                <div className="avatar" aria-hidden>{initials(nm)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap', gap: 8 }}>
                    <span className="who">{nm}</span>
                    {c.unread_count > 0 && <span className="pill danger" aria-label={`${c.unread_count} unread`}>{c.unread_count}</span>}
                  </div>
                  <div className="meta">
                    {human ? <><Hand aria-hidden /> You</> : <><Bot aria-hidden /> Bot</>}
                    <span aria-hidden>·</span><span>{humanize(c.current_state)}</span>
                  </div>
                </div>
              </button>
            );
          })}
          {convos && convos.length === 0 && <EmptyState icon={MessagesSquare} title="No chats yet" hint="Conversations appear here when customers message your WhatsApp number." />}
          {!convos && [0, 1, 2, 3].map((i) => <div key={i} style={{ padding: '14px 16px' }}><div className="skeleton" style={{ height: 36 }} /></div>)}
        </div>

        {/* Chat pane */}
        <div className="chat">
          {!sel ? (
            <div style={{ margin: 'auto' }}><EmptyState icon={MessagesSquare} title="Pick a conversation" hint="Choose a chat on the left to read it or reply." /></div>
          ) : (
            <>
              <div className="chat-head">
                <div className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
                  <button className="btn subtle icon-btn chat-back" onClick={() => setSel(null)} aria-label="Back to conversations"><ArrowLeft /></button>
                  <div className="avatar" aria-hidden><UserRound size={18} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || '…'}</div>
                    <div className="hint" style={{ whiteSpace: 'nowrap' }}>{takenOver ? 'You are replying' : 'Bot is replying'}</div>
                  </div>
                </div>
                {shown && (takenOver
                  ? <button className="btn ghost sm" onClick={() => act('release')} disabled={busy}><Undo2 aria-hidden /><span>Hand back<span className="hide-sm"> to bot</span></span></button>
                  : <button className="btn sm" onClick={() => act('takeover')} disabled={busy}><Hand aria-hidden /> Take over</button>)}
              </div>

              <div ref={msgRef} className="chat-body" aria-live="polite">
                {(shown?.messages ?? []).map((m, i) => {
                  const inbound = m.direction === 'inbound';
                  const agent = m.sender === 'agent';
                  return (
                    <div key={i} className={`bubble-wrap ${inbound ? 'in' : 'out'} ${agent ? 'agent' : ''}`}>
                      <div className="bubble">{m.body}</div>
                      <div className="bubble-meta">{inbound ? 'Customer' : agent ? 'You' : m.sender === 'bot' ? 'Bot' : m.sender} · {dt(m.created_at)}{!inbound ? ` · ${m.status}` : ''}</div>
                    </div>
                  );
                })}
                {!shown && <div className="skeleton" style={{ height: 60, width: '60%' }} />}
              </div>

              {takenOver && !windowClosed && (
                <div className="notice" style={{ background: 'var(--brand-tint)', color: 'var(--brand-ink)', borderTopColor: 'var(--brand-tint-2)' }}>
                  <Hand aria-hidden /> The bot stays silent in this chat until you click “Hand back”.
                </div>
              )}
              {windowClosed && (
                <div className="notice" role="note">
                  <AlertTriangle aria-hidden /> The customer last wrote over 24 hours ago, so WhatsApp blocks replies until they message again. Call them instead.
                </div>
              )}
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <label htmlFor="reply" className="sr-only">Reply</label>
                <input id="reply" style={{ flex: 1 }} placeholder={canType ? 'Type a reply…' : windowClosed ? 'Replies are blocked for now' : 'Take over to reply yourself'} value={text} onChange={(e) => setText(e.target.value)} disabled={!canType} />
                <button className="btn icon-btn" disabled={!canType || !text.trim() || busy} aria-label="Send"><Send /></button>
              </form>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
