// Email alerts (P3) through Resend's HTTP API with plain fetch — no SDK (FR-P3.4).
// Until the domain is verified in Resend (DKIM/SPF in Cloudflare), ALERT_EMAIL_FROM stays on
// Resend's test sender, which only delivers to the account owner's address.
import { loadConfig } from '../config';
import { logger } from './logger';

export interface Email { to: string[]; subject: string; text: string; html: string }

export function isEmailConfigured(): boolean {
  return !!loadConfig().RESEND_API_KEY;
}

export async function sendEmail(mail: Email): Promise<boolean> {
  const cfg = loadConfig();
  if (!cfg.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.ALERT_EMAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!r.ok) {
      logger.warn({ status: r.status, body: (await r.text()).slice(0, 300) }, 'email send failed');
      return false;
    }
    return true;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'email send failed');
    return false;
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One notification as plain text + a minimal HTML version with the portal link. */
export function renderAlert(title: string, body: string, link: string, product: string): { text: string; html: string } {
  return {
    text: `${title}\n\n${body}\n\nOpen: ${link}\n\n— ${product}`,
    html: `<p><strong>${esc(title)}</strong></p><p>${esc(body)}</p><p><a href="${esc(link)}">Open in ${esc(product)}</a></p>`,
  };
}

/** Several notifications folded into one email (the digest rule, FR-P3.4). */
export function renderDigest(items: { title: string; body: string; link: string }[], product: string): { subject: string; text: string; html: string } {
  const subject = `${items.length} new notifications — ${product}`;
  return {
    subject,
    text: `${items.map((i) => `• ${i.title}\n  ${i.body}\n  ${i.link}`).join('\n\n')}\n\n— ${product}`,
    html: `<p><strong>${esc(subject)}</strong></p><ul>${items.map((i) => `<li><strong>${esc(i.title)}</strong><br>${esc(i.body)}<br><a href="${esc(i.link)}">Open</a></li>`).join('')}</ul>`,
  };
}
