'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, Bot, Hand, MessagesSquare, Send, Undo2, UserRound } from 'lucide-react';
import AppShell, { EmptyState, PageHead, humanize } from '../../components/AppShell';
import { api, apiError, apiJson, dt } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/Dialog';
import { ago, phone } from '../../lib/format';

interface Customer { id: string; name: string | null; wa_id: string; wa_opt_in_status: 'unknown' | 'in' | 'out'; wa_opt_in_at: string | null; is_blocked: boolean }
interface Convo { id: string; status: string; current_state: string; last_message_at: string; unread_count: number; customers: Pick<Customer, 'name' | 'wa_id' | 'wa_opt_in_status' | 'is_blocked'> | null }
interface Msg { direction: string; sender: string; body: string; status: string; created_at: string }
interface Detail { conversation: { id: string; status: string; window_expires_at: string | null; customers: Customer | null }; messages: Msg[] }

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
  // A link from the dashboard queue opens its chat. Read once on mount; useSearchParams would need a Suspense boundary.
  useEffect(() => { const c = new URLSearchParams(window.location.search).get('c'); if (c) { setDetail(null); setSel(c); } }, []);
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
  // P5: block / unblock the customer behind the open chat.
  const [confirmBlock, setConfirmBlock] = useState(false);
  async function setBlocked(blocked: boolean) {
    const c = shown?.conversation.customers;
    if (!c || !sel) return;
    setConfirmBlock(false);
    setBusy(true);
    const r = await api(`/api/v1/admin/customers/${c.id}/${blocked ? 'block' : 'unblock'}`, { method: 'POST' });
    setBusy(false); loadDetail(sel); loadConvos();
    if (!r.ok) toast(await apiError(r), 'error');
    else toast(blocked ? 'Customer blocked' : 'Customer unblocked', 'info', { label: 'Undo', onClick: () => setBlocked(!blocked) });
  }
  async function send() { if (!text.trim()) return; const t = text; setText(''); if (!(await act('send', { text: t }))) setText(t); }
  const open = (id: string) => { setDetail(null); setSel(id); };
  const shown = detail && detail.conversation.id === sel ? detail : null;
  const takenOver = shown?.conversation.status === 'human_takeover';
  // WhatsApp refuses free-form replies 24h after the buyer's last message.
  const expires = shown?.conversation.window_expires_at;
  const windowClosed = !!expires && new Date(expires).getTime() <= Date.now();
  const canType = takenOver && !windowClosed;
  const [quotaUsed, setQuotaUsed] = useState(false);
  useEffect(() => { apiJson<{ outbound: number; freeQuota: number }>('/api/v1/admin/usage').then((u) => setQuotaUsed(u.outbound >= u.freeQuota)).catch(() => {}); }, []);
  const name = shown?.conversation.customers?.name || phone(shown?.conversation.customers?.wa_id);
  const cust = shown?.conversation.customers ?? null;
  const optState = !cust ? '' : cust.is_blocked ? 'Blocked' : cust.wa_opt_in_status === 'out' ? `Opted out ${cust.wa_opt_in_at ? dt(cust.wa_opt_in_at) : ''}` : cust.wa_opt_in_status === 'in' ? `Opted in ${cust.wa_opt_in_at ? dt(cust.wa_opt_in_at) : ''}` : 'Opt-in unknown';

  return (
    <AppShell>
      <PageHead title="Inbox" sub="Every WhatsApp chat. Take over any of them — the bot pauses while you reply." />
      <div className={`card inbox ${sel ? 'has-sel' : ''}`}>
        {/* Conversation list */}
        <div className="convo-list" role="list" aria-label="Conversations">
          {(convos ?? []).map((c) => {
            const nm = c.customers?.name || phone(c.customers?.wa_id);
            const human = c.status === 'human_takeover';
            return (
              <button key={c.id} role="listitem" className="convo" aria-current={sel === c.id} onClick={() => open(c.id)}>
                <div className="avatar" aria-hidden>{initials(nm)}</div>
                <div className="fill">
                  <div className="row between" style={{ flexWrap: 'nowrap', gap: 8 }}>
                    <span className="who">{nm}</span>
                    {c.customers?.is_blocked ? <span className="pill neutral">blocked</span> : c.customers?.wa_opt_in_status === 'out' ? <span className="pill warning">opted out</span> : null}
                    {c.unread_count > 0 && <span className="pill danger" aria-label={`${c.unread_count} unread`}>{c.unread_count}</span>}
                  </div>
                  <div className="meta">
                    {human ? <><Hand aria-hidden /> You</> : <><Bot aria-hidden /> Bot</>}
                    <span aria-hidden>·</span><span>{humanize(c.current_state)}</span>
                    <span aria-hidden>·</span><span>{ago(c.last_message_at)}</span>
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
                    <div className="hint nowrap">{cust?.is_blocked ? 'Blocked, nobody replies' : cust?.wa_opt_in_status === 'out' ? 'Opted out, the bot stays silent' : takenOver ? 'You are replying' : 'Bot is replying'}{optState ? ` · ${optState}` : ''}</div>
                  </div>
                </div>
                {shown && (
                  <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    {cust && (cust.is_blocked
                      ? <button className="btn ghost sm" onClick={() => setBlocked(false)} disabled={busy}><Ban aria-hidden /> Unblock</button>
                      : <button className="btn ghost sm" onClick={() => setConfirmBlock(true)} disabled={busy} aria-label="Block customer"><Ban aria-hidden /><span className="hide-sm"> Block</span></button>)}
                    {takenOver
                      ? <button className="btn ghost sm" onClick={() => act('release')} disabled={busy}><Undo2 aria-hidden /><span>Hand back<span className="hide-sm"> to bot</span></span></button>
                      : <button className="btn sm" onClick={() => act('takeover')} disabled={busy}><Hand aria-hidden /> Take over</button>}
                  </div>
                )}
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
                {quotaUsed && canType && <span className="pill warning" title="The free 1,000 messages for this month are used; Meta charges for this one">paid</span>}
                <button className="btn icon-btn" disabled={!canType || !text.trim() || busy} aria-label={quotaUsed ? 'Send (paid message)' : 'Send'}><Send /></button>
              </form>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmBlock} onClose={() => setConfirmBlock(false)} onConfirm={() => setBlocked(true)} title={`Block ${name}?`} confirmLabel="Block customer" danger busy={busy}>
        <p className="m0">Their messages are kept but the bot never answers them. You can unblock any time.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
