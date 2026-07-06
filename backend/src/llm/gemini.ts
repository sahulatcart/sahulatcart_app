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
  { retries = 4 }: { retries?: number } = {}
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
        // Honor Google's suggested RetryInfo delay on 429 (free-tier per-minute limits).
        let waitMs = 500 * (attempt + 1);
        if (res.status === 429) {
          const j = (await res.json().catch(() => null)) as { error?: { details?: { '@type'?: string; retryDelay?: string }[] } } | null;
          const rd = j?.error?.details?.find((d) => (d['@type'] ?? '').includes('RetryInfo'))?.retryDelay;
          if (rd) waitMs = Math.min(parseFloat(rd) * 1000 + 500, 20000);
        }
        await sleep(waitMs);
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
    offerScope: { type: 'string', enum: ['per_unit', 'total'], nullable: true },
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
      `quantity, any price they OFFER in rupees (offerRupees, number only; null if none), ` +
      `offerScope ("total" if the price is for ALL units together, "per_unit" if it is per piece; null when no offer), and language. ` +
      `Roman Urdu examples: "kitnay ka hai"=ask_price, "2000 me do"=make_offer offerRupees 2000 offerScope per_unit, ` +
      `"2 shirts 3000 me de do"=make_offer quantity 2 offerRupees 3000 offerScope total, ` +
      `"3 caps, 500 per piece"=make_offer quantity 3 offerRupees 500 offerScope per_unit, ` +
      `"ye wala do"=add_to_order, "theek hai"=accept, "nahi mehnga hai"=reject, "cash on delivery"=choose_cod, ` +
      `"ye cotton hai?"/"size kya hai"/"kaunse colors hain"=ask_product_info, ` +
      `"photo dikhao"/"tasveer bhejo"=ask_photo, ` +
      `"return policy kya hai"/"delivery kitne din"/"dukaan kahan hai"/"timing kya hai"=ask_shop_info, ` +
      `"bandh karo"=stop. Message: "${text.replace(/"/g, "'")}"`;
    const raw = await callGemini({
      contents: [{ parts: [{ text: sys }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', responseSchema: CLASSIFY_SCHEMA, ...NO_THINKING },
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { intent: 'out_of_scope', productQuery: null, quantity: null, offerPaisa: null, offerScope: null, language: 'roman_urdu' };
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
      offerScope: parsed.offerScope === 'total' || parsed.offerScope === 'per_unit' ? parsed.offerScope : null,
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

  async transcribeAudio(data: Buffer, mimeType: string): Promise<string | null> {
    // WhatsApp voice notes arrive as "audio/ogg; codecs=opus" — Gemini wants the bare mime.
    const mime = (mimeType.split(';')[0] ?? '').trim() || 'audio/ogg';
    try {
      const raw = await callGemini({
        contents: [{ parts: [
          { text:
            `Transcribe this WhatsApp voice note from a Pakistani customer. It is most likely Urdu, ` +
            `Punjabi, or mixed Urdu-English. Write the transcription in Roman Urdu (Latin letters), ` +
            `keeping numbers as digits (e.g. "do sau" stays "200" if they mean a price, else write words as spoken). ` +
            `Output ONLY the transcription text, nothing else. If the audio is silent or unintelligible, output exactly: [unintelligible]` },
          { inline_data: { mime_type: mime, data: data.toString('base64') } },
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300, ...NO_THINKING },
      });
      const text = raw.trim();
      if (!text || /\[unintelligible\]/i.test(text)) return null;
      return text;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'voice transcription failed');
      return null;
    }
  }

  async describeImage(data: Buffer, mimeType: string, productName: string): Promise<string | null> {
    const mime = (mimeType.split(';')[0] ?? '').trim() || 'image/jpeg';
    try {
      const raw = await callGemini({
        contents: [{ parts: [
          { text:
            `This is a product photo of "${productName}" sold by a Pakistani shop on WhatsApp. ` +
            `Write a short, appealing product description in Roman Urdu (Latin letters), 2-3 sentences: ` +
            `what it is, material/colour/style you can SEE, and who it suits. ` +
            `Do NOT invent a price, brand, or size. Output only the description text.` },
          { inline_data: { mime_type: mime, data: data.toString('base64') } },
        ] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 200, ...NO_THINKING },
      });
      return raw.trim() || null;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'image description failed');
      return null;
    }
  }
}
