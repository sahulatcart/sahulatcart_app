import { describe, it, expect } from 'vitest';
import { parseWebhook, normalizeType, extractText } from './parse';
import type { WebhookPayload } from './types';

const textPayload: WebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001', phone_number_id: 'PN123' },
            contacts: [{ profile: { name: 'Ahmed' }, wa_id: '923001234567' }],
            messages: [{ id: 'wamid.AAA', from: '923001234567', type: 'text', text: { body: 'kitnay ka hai' } }],
          },
        },
      ],
    },
  ],
};

describe('parseWebhook', () => {
  it('normalizes a text message with routing + profile', () => {
    const change = parseWebhook(textPayload)[0]!;
    expect(change.phoneNumberId).toBe('PN123');
    expect(change.messages).toHaveLength(1);
    const m = change.messages[0]!;
    expect(m.waMessageId).toBe('wamid.AAA');
    expect(m.from).toBe('923001234567');
    expect(m.type).toBe('text');
    expect(m.text).toBe('kitnay ka hai');
    expect(m.profileName).toBe('Ahmed');
  });

  it('extracts interactive reply titles and button text', () => {
    expect(extractText({ id: 'x', from: 'y', type: 'interactive', interactive: { button_reply: { title: 'Confirm' } } })).toBe('Confirm');
    expect(extractText({ id: 'x', from: 'y', type: 'button', button: { text: 'Yes' } })).toBe('Yes');
  });

  it('maps types and falls back unknown → text', () => {
    expect(normalizeType('image')).toBe('image');
    expect(normalizeType('order')).toBe('order');
    expect(normalizeType('button')).toBe('interactive');
    expect(normalizeType('contacts')).toBe('text');
  });

  it('extracts delivery statuses and drops unknown ones', () => {
    const change = parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PN123' },
                statuses: [
                  { id: 'wamid.OUT', status: 'delivered' },
                  { id: 'wamid.OUT2', status: 'weird' },
                ],
              },
            },
          ],
        },
      ],
    })[0]!;
    expect(change.statuses).toEqual([{ waMessageId: 'wamid.OUT', status: 'delivered' }]);
  });

  it('skips changes with no phone_number_id', () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: {} }] }] })).toHaveLength(0);
  });
});
