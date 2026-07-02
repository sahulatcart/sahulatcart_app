import { BotIntent, type Lang } from '@app/shared';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { replySpecToPrompt } from './prompts';
import {
  type ClassifyContext,
  type Classification,
  type ComposeContext,
  type DeliveryDetails,
  type LlmClient,
  LlmUnavailableError,
  type ReplySpec,
} from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart { text?: string }
interface GeminiResp {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string; code?: number };
}

async function callGemini(
  body: unknown,
  { retries = 2 }: { retries?: number } = {}
): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.GEMINI_API_KEY) throw new LlmUnavailableError('GEMINI_API_KEY not set');
  const url = `${BASE}/${cfg.GEMINI_MODEL}:generateContent?key=${cfg.GEMINI_API_KEY}`;

  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        await sleep(300 * (attempt + 1));
        continue;
      }
      const json = (await res.json()) as GeminiResp;
      if (json.error) throw new LlmUnavailableError(json.error.message ?? 'gemini error');
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) {
        lastErr = 'empty completion';
        await sleep(200 * (attempt + 1));
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(300 * (attempt + 1));
    }
  }
  logger.warn({ lastErr }, 'gemini unavailable after retries');
  throw new LlmUnavailableError(lastErr);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Disable "thinking" for these short, latency-sensitive calls (else it burns tokens/truncates).
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

const DELIVERY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    area: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    phone: { type: 'string', nullable: true },
  },
};

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...BotIntent] },
    productQuery: { type: 'string', nullable: true },
    quantity: { type: 'integer', nullable: true },
    offerRupees: { type: 'number', nullable: true },
    language: { type: 'string', enum: ['roman_urdu', 'english', 'urdu'] },
  },
  required: ['intent', 'language'],
};

export class GeminiClient implements LlmClient {
  async classify(text: string, ctx: ClassifyContext): Promise<Classification> {
    const sys =
      `You classify a Pakistani shopper's WhatsApp message for a shop bot. ` +
      `Catalog products: ${ctx.productNames.join(', ') || '(none)'}. ` +
      `Return the intent, the product they refer to (productQuery, match to catalog if possible), ` +
      `quantity, any price they OFFER in rupees (offerRupees, number only; null if none), and language. ` +
      `Roman Urdu examples: "kitnay ka hai"=ask_price, "2000 me do"=make_offer offerRupees 2000, ` +
      `"ye wala do"=add_to_order, "theek hai"=accept, "nahi mehnga hai"=reject, "cash on delivery"=choose_cod, ` +
      `"bandh karo"=stop. Message: "${text.replace(/"/g, "'")}"`;
    const raw = await callGemini({
      contents: [{ parts: [{ text: sys }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', responseSchema: CLASSIFY_SCHEMA, ...NO_THINKING },
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { intent: 'out_of_scope', productQuery: null, quantity: null, offerPaisa: null, language: 'roman_urdu' };
    }
    const intent = (BotIntent as readonly string[]).includes(parsed.intent as string)
      ? (parsed.intent as BotIntent)
      : 'out_of_scope';
    const offerRupees = typeof parsed.offerRupees === 'number' ? parsed.offerRupees : null;
    return {
      intent,
      productQuery: typeof parsed.productQuery === 'string' ? parsed.productQuery : null,
      quantity: typeof parsed.quantity === 'number' ? Math.round(parsed.quantity) : null,
      offerPaisa: offerRupees != null && offerRupees > 0 ? Math.round(offerRupees) * 100 : null,
      language: (['roman_urdu', 'english', 'urdu'].includes(parsed.language as string) ? parsed.language : 'roman_urdu') as Lang,
    };
  }

  async extractDelivery(text: string): Promise<DeliveryDetails> {
    const empty: DeliveryDetails = { name: null, address: null, area: null, city: null, phone: null };
    try {
      const raw = await callGemini({
        contents: [{ parts: [{ text:
          `Extract delivery details from this Pakistani customer's WhatsApp message. ` +
          `Return name (person's name), address (house/street), area (locality/mohalla), city, phone if present, else null. ` +
          `Message: "${text.replace(/"/g, "'")}"` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', responseSchema: DELIVERY_SCHEMA, ...NO_THINKING },
      });
      const p = JSON.parse(raw) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      return { name: str(p.name), address: str(p.address), area: str(p.area), city: str(p.city), phone: str(p.phone) };
    } catch {
      return empty;
    }
  }

  async compose(spec: ReplySpec, ctx: ComposeContext): Promise<string> {
    const prompt = replySpecToPrompt(spec, ctx);
    const raw = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 150, ...NO_THINKING },
    });
    return raw.trim();
  }
}
