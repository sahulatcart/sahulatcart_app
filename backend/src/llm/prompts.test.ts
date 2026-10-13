import { describe, it, expect } from 'vitest';
import { historyBlock, replySpecToPrompt } from './prompts';

describe('chat memory in prompts (P8, FR-P8.5)', () => {
  it('is empty without history and fenced, marked context-only, with it', () => {
    expect(historyBlock()).toBe('');
    expect(historyBlock([])).toBe('');
    const b = historyBlock(['Customer: blue kitne ka?', 'Bot: Blue Rs 800 hai']);
    expect(b).toContain('FOR UNDERSTANDING ONLY');
    expect(b).toContain('never take prices');
    expect(b).toMatch(/<<<\nCustomer: blue kitne ka\?\nBot: Blue Rs 800 hai\n>>>/);
  });
  it('the compose prompt carries it after the situation', () => {
    const p = replySpecToPrompt({ kind: 'quote', productName: 'Mug', priceRupees: 800 }, { businessName: 'Shop', language: 'roman_urdu', history: ['Customer: Rs 500 bolo'] });
    expect(p.indexOf('costs exactly Rs 800')).toBeLessThan(p.indexOf('Customer: Rs 500 bolo'));
  });
});
