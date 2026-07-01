import type { ComposeContext, ReplySpec } from './types';

/**
 * Build the compose prompt from a structured ReplySpec. The LLM only PHRASES the
 * given decision in Roman Urdu — the price (if any) is fixed by the engine and must
 * be repeated exactly. The floor is NEVER included here (docs/spec/06 §7.1).
 */
export function replySpecToPrompt(spec: ReplySpec, ctx: ComposeContext): string {
  const persona =
    `You are ${ctx.botName ? ctx.botName + ', ' : ''}a friendly, polite Pakistani shopkeeper's WhatsApp bot for "${ctx.businessName}". ` +
    `Reply in short, natural Roman Urdu (Urdu in Latin letters), warm and conversational, like a real dukaandar. ` +
    `Use "Rs" for prices (never the ₹ symbol). Keep it to 1-2 short sentences. Do NOT invent prices or products. ` +
    `Only output the message text, nothing else.\n\nSituation: `;

  let s: string;
  switch (spec.kind) {
    case 'greeting':
      s = `A customer just messaged. Greet them warmly (salaam) and ask how you can help / what they are looking for.`;
      break;
    case 'quote':
      s = `Tell the customer that "${spec.productName}" costs exactly Rs ${spec.priceRupees}. State this price clearly.`;
      break;
    case 'counter':
      s = `The customer is haggling on "${spec.productName}". Counter-offer exactly Rs ${spec.priceRupees}${spec.final ? ' and gently say this is your final/best price ("last price")' : ''}. Name this exact figure, sound flexible but firm.`;
      break;
    case 'accept':
      s = `Happily agree to sell "${spec.productName}" at exactly Rs ${spec.priceRupees}. Confirm the deal warmly and name this exact figure.`;
      break;
    case 'hold':
      s = `Politely decline to lower the price further on "${spec.productName}"; restate Rs ${spec.priceRupees} as the price. Stay friendly, no pressure. Name this exact figure.`;
      break;
    case 'not_found':
      s = `The customer asked for "${spec.query}" which you don't have. Politely say it's not available and offer to help with something else.`;
      break;
    case 'out_of_stock':
      s = `"${spec.productName}" is currently out of stock. Apologize briefly and offer to help with something else.`;
      break;
    case 'order_ack':
      s = `The customer wants to order "${spec.productName}" at Rs ${spec.priceRupees}. Warmly acknowledge and say you'll take their order details shortly. Name this exact figure.`;
      break;
    case 'clarify':
      s = `You didn't fully understand. Politely ask them to clarify which product or what they need.`;
      break;
    case 'chitchat':
      s = `Respond briefly and warmly to small talk, then steer back to how you can help them shop.`;
      break;
    case 'handoff':
      s = `Tell the customer you're connecting them to a person who will help shortly. Be reassuring.`;
      break;
  }
  return persona + s;
}
