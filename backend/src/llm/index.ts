import { loadConfig } from '../config';
import { GeminiClient } from './gemini';
import type { LlmClient } from './types';

export * from './types';

let client: LlmClient | undefined;

/** Factory — returns the configured provider's client (provider-agnostic). */
export function getLlmClient(): LlmClient {
  if (client) return client;
  const cfg = loadConfig();
  switch (cfg.LLM_PROVIDER) {
    case 'gemini':
      client = new GeminiClient();
      break;
    case 'anthropic':
      throw new Error('Anthropic client not implemented yet — set LLM_PROVIDER=gemini');
    default:
      client = new GeminiClient();
  }
  return client;
}
