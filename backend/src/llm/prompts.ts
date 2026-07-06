import type { ComposeContext, ReplySpec } from './types';

/**
 * Build the compose prompt from a structured ReplySpec. The LLM only PHRASES the
 * given decision in Roman Urdu — the price (if any) is fixed by the engine and must
 * be repeated exactly. The floor is NEVER included here (docs/spec/06 §7.1).
 */
const STYLE_TONE: Record<string, string> = {
  narm: `You are extra warm, sweet and generous — jaldi maan jaane wala dukaandar. Use friendly touches ("bhai jaan", light emoji). `,
  sakht: `You are a confident, firm dukaandar who knows the maal is worth its price — polite but rarely budges, no begging, minimal emoji. `,
  standard: ``,
};

export function replySpecToPrompt(spec: ReplySpec, ctx: ComposeContext): string {
  const persona =
    `You are ${ctx.botName ? ctx.botName + ', ' : ''}a friendly, polite Pakistani shopkeeper's WhatsApp bot for "${ctx.businessName}". ` +
    `Reply in short, natural Roman Urdu (Urdu in Latin letters), warm and conversational, like a real dukaandar. ` +
    STYLE_TONE[ctx.style ?? 'standard'] +
    `Use "Rs" for prices (never the ₹ symbol). Keep it to 1-2 short sentences. Do NOT invent prices or products. ` +
    `Only output the message text, nothing else.\n\nSituation: `;

  // For multi-unit asks ("3 kitnay ki?"): state per-piece AND the exact total.
  const qty = (sp: { quantity?: number; totalRupees?: number; priceRupees: number }): string =>
    sp.quantity && sp.quantity > 1 && sp.totalRupees
      ? ` The customer wants ${sp.quantity} pieces: Rs ${sp.priceRupees} per piece, total exactly Rs ${sp.totalRupees} for all ${sp.quantity}. State BOTH figures (per piece and total) — no other numbers.`
      : '';

  let s: string;
  switch (spec.kind) {
    case 'greeting':
      s = `A customer just messaged. Greet them warmly (salaam) and ask how you can help / what they are looking for.`;
      break;
    case 'quote':
      s = `Tell the customer that "${spec.productName}" costs exactly Rs ${spec.priceRupees}. State this price clearly.` + qty(spec);
      break;
    case 'counter':
      s = `The customer is haggling on "${spec.productName}". Counter-offer exactly Rs ${spec.priceRupees}${spec.final ? ' and gently say this is your final/best price ("last price")' : ''}. Name this exact figure, sound flexible but firm.` + qty(spec);
      break;
    case 'accept':
      s = `Happily agree to sell "${spec.productName}" at exactly Rs ${spec.priceRupees}. Confirm the deal warmly and name this exact figure.` + qty(spec);
      break;
    case 'hold':
      s = `Politely decline to lower the price further on "${spec.productName}"; restate Rs ${spec.priceRupees} as the price. Stay friendly, no pressure. Name this exact figure.` + qty(spec);
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
    case 'ask_delivery':
      s = `The deal is done. Warmly ask the customer for their delivery details: full name, complete address, and area/city. Keep it to one friendly line.`;
      break;
    case 'ask_delivery_missing':
      s = `You still need the customer's ${spec.missing} to deliver. Politely ask them for just that.`;
      break;
    case 'ask_payment_method':
      s = `The order total is exactly Rs ${spec.priceRupees}. Tell them the total (this exact figure) and ask how they'd like to pay: Cash on Delivery ya bank transfer?`;
      break;
    case 'bank_await':
      s = `You've just shared the bank account details. Ask the customer to transfer the amount and send a screenshot of the payment here. One friendly line.`;
      break;
    case 'payment_received':
      s = `The customer sent a payment screenshot. Thank them and say you're verifying it and will confirm shortly. One line.`;
      break;
    case 'payment_verified':
      s = `Payment for order ${spec.orderNumber} is verified. Warmly confirm the order is placed and thank them.`;
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
    case 'upsell':
      s = `Their order is confirmed. Casually suggest adding "${spec.productName}" for exactly Rs ${spec.priceRupees} — it would ship together with their order. One light, no-pressure line; name this exact figure.`;
      break;
    case 'product_answer':
      s =
        `The customer asked about "${spec.productName}": "${spec.question}". Answer using ONLY these facts from the shop owner:\n---\n${spec.facts}\n---\n` +
        `STRICT RULES: If the facts do not answer the question, say you will check with the owner ("ye main malik se confirm kar ke batata hoon") — NEVER guess or invent. Do NOT state any price or number that is not in the facts. 1-2 short sentences.`;
      break;
    case 'kb_answer':
      s =
        `The customer asked: "${spec.question}". Answer using ONLY this shop information provided by the owner:\n---\n${spec.kb}\n---\n` +
        `STRICT RULES: If the information does not answer the question, say you will check with the owner ("ye main malik se confirm kar ke batata hoon") — NEVER guess or invent policies, times, or addresses. Do NOT state any price or number that is not in the information. 1-2 short sentences.`;
      break;
  }
  return persona + s;
}
