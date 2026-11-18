import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../config';
import { callGemini, GeminiClient, thinkingFor } from './gemini';
import { LlmUnavailableError } from './types';

const cfg = loadConfig();
type Init = { body: string; headers: Record<string, string>; signal?: AbortSignal };
let bodies: Record<string, unknown>[];

const ok = (text: string) => ({ status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
/** A request that never answers, like the 503s that took 80-95 s on 2026-11-18. It gives up only when aborted. */
const hang = (init: Init) =>
  new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));

beforeEach(() => {
  cfg.GEMINI_API_KEY = 'test-gemini-key';
  cfg.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  bodies = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('thinking settings per model', () => {
  it('Gemini 3 and later get thinkingLevel minimal (they refuse thinkingBudget 0, or ignore it)', () => {
    expect(thinkingFor('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
    expect(thinkingFor('gemini-3.1-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
    expect(thinkingFor('gemini-flash-lite-latest')).toEqual({ thinkingLevel: 'minimal' });
  });

  it('Gemini 2.x keeps thinkingBudget 0', () => {
    expect(thinkingFor('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
  });

  it('classify sends the setting for the configured model', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: Init) => {
      bodies.push(JSON.parse(init.body));
      return ok('{"intent":"greet","language":"roman_urdu"}');
    });
    const cls = await new GeminiClient().classify('hi', { productNames: ['T-Shirt'] });
    expect(cls.intent).toBe('greet');
    const gen = bodies[0]!.generationConfig as Record<string, unknown>;
    expect(gen.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });
});

describe('a slow model cannot hold a reply', () => {
  it('abandons an attempt that does not answer, and gives up by the deadline', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', async (_url: string, init: Init) => {
      attempts++;
      return hang(init);
    });
    const t0 = Date.now();
    // 40 ms timeout, 300 ms back-off, a second 40 ms attempt, then the next back-off would pass 400 ms.
    await expect(callGemini({}, { attemptMs: 40, deadlineMs: 400 })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(Date.now() - t0).toBeLessThan(800);
    expect(attempts).toBeGreaterThanOrEqual(2); // a timed-out attempt is retried while time is left
  });

  it('retries a 503 inside the deadline and returns the answer', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => (++n === 1 ? { status: 503, json: async () => ({}) } : ok('salam')));
    expect(await callGemini({}, { attemptMs: 1000, deadlineMs: 5000 })).toBe('salam');
    expect(n).toBe(2);
  });

  it('does not sleep past the deadline for a long RetryInfo delay', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 429,
      json: async () => ({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '18s' }] } }),
    }));
    const t0 = Date.now();
    await expect(callGemini({}, { attemptMs: 1000, deadlineMs: 2000 })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
