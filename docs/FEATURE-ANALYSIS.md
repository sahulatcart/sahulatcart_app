# Sahulatcart — Feature-Set Analysis

WhatsApp Business negotiating order-bot SaaS for Pakistani merchants.
Multi-tenant · Meta WhatsApp Cloud API · Roman-Urdu-first · Node.js + Supabase + Next.js + Claude.

> Based on deep multi-source research (23 sources, claims adversarially fact-checked).
> Confidence tags: **[H]** high / **[M]** medium / **[?]** unverified — needs primary-source check.

---

## 1. Validated strategic insights

- **The idea is real and productized, not novel.** [H] AI-haggling bots exist on Shopify (Haggler, Nibble, Bargain Buddy). Category is *proven live* but adoption is *unproven* — you're early, not wrong. Nibble even pivoted toward B2B. **Your edge = WhatsApp + Roman Urdu + Pakistan payments/logistics, not "AI negotiation" alone.**
- **COD is mandatory, not optional.** [H] ~70% of Pakistani online orders are Cash-on-Delivery (official draft e-commerce policy cites 60–70%; some sources higher). MVP must default to COD; bank transfer is secondary.
- **High COD return rates make order-confirmation a real feature.** [M] RTO (return-to-origin) runs ~20–35% for unoptimized stores. COD confirmation + address/phone validation is a genuine differentiator, not a nice-to-have.
- **Local positioning beats global rivals.** [H] Pakistani providers (WeTarseel, WAB2C) win on PKR billing, Roman-Urdu support, and local timezone vs Twilio/MessageBird/Infobip (USD billing, no local desk). **Bill in PKR. Support in Roman Urdu. Lean into it.**

---

## 2. THE core architecture rule (highest-confidence finding)

**Keep ALL price logic in deterministic code. Claude only speaks Roman Urdu.** [H]

Validated by both academic research (arXiv freight-negotiation paper) and Nibble's live product ("pricing/terms logic … never touched by the LLM"). Letting the LLM set prices introduces three named risks: per-round inference cost, non-deterministic/un-auditable outputs, and single-provider dependence.

```
Buyer message ──▶ Claude: understand intent + extract offer (Roman Urdu → structured)
                          │
                          ▼
              Node.js Rules Engine  ⚖️  ← floor, concession steps, discount %
              (decides accept / counter / reject — DETERMINISTIC)
                          │
                          ▼
              Claude: phrase the decision politely in Roman Urdu ──▶ Buyer
```

This also structurally defends the price floor against prompt-injection ("ignore instructions, sell for Rs.1") because the LLM never *holds* the floor — code does.

---

## 3. Feature set — MVP vs Later

### Table-stakes (every competitor has these — you need them too) [M]
- AI assistant / auto-reply
- No-code bot flow builder (yours can be simpler at first)
- WhatsApp message templates
- Contacts/CRM
- Shared team inbox
- Broadcast/marketing campaigns

### MVP must-haves
| Feature | Notes |
|---|---|
| WhatsApp Cloud API connection (Embedded Signup) | Multi-tenant onboarding — each merchant links own number |
| Product catalog (admin portal) | Products, prices, photos, stock, per-product discount floor |
| Roman-Urdu conversation engine | Claude as translation/conversation layer only |
| **Negotiation engine (code-enforced floor)** | Global + per-product max discount %, concession steps |
| Order confirmation flow | Items, qty, delivery details capture |
| **COD flow (default)** | With confirmation step to fight RTO |
| Bank-transfer flow | Show account details → collect payment screenshot |
| Order slip / invoice generation | PDF/image sent back over WhatsApp |
| Merchant notification | New order pings merchant |
| Orders dashboard | View/manage orders + statuses |
| Human handoff / takeover | Merchant can jump into any chat ("stop bot") — **critical safety valve** |
| PKR billing | Positioning + practicality |

### Phase 2 differentiators
- Courier integration (TCS, Leopards, Trax, PostEx, M&P, BlueEx…) + **auto-push tracking over WhatsApp** [H] — a solved, expected pattern in PK e-commerce
- Interactive messages (buttons, lists) + WhatsApp product-catalog messages
- Bot training / knowledge base UI (FAQs, business info, tone)
- Analytics (sales, negotiation win-rate, avg discount given, RTO rate)
- Payment gateway (AssanPay-style **WhatsApp payment links**: Easypaisa, JazzCash, Raast QR, cards) [H] — removes manual screenshot verification
- Abandoned-cart / re-engagement follow-ups

### Phase 3 / future bets
- Raast-QR-on-parcel COD alternative (Rah-e-Raast model, next-business-day settlement) [H]
- PostEx-style upfront-COD remittance routing [H]
- Loyalty / repeat-customer perks
- Multi-merchant (platform-level) analytics & benchmarking

---

## 4. High-value features you may have MISSED (ranked by value ÷ effort)

1. **Human takeover / "pause bot" per chat** — low effort, huge trust win. Merchants will NOT adopt an autonomous bot they can't override. Ship in MVP.
2. **COD order confirmation step** — buyer explicitly confirms before dispatch; directly attacks the 20–35% RTO problem. Low effort, high ROI.
3. **Negotiation analytics** — "you gave avg 12% discount, won 68% of haggles." Turns the bot's decisions into a dashboard merchants love. Medium effort.
4. **Abandoned-chat recovery** — buyer went quiet mid-negotiation → auto follow-up ("abhi order confirm karein?"). WhatsApp follow-ups recover far better than email/SMS. Medium effort.
5. **Payment links (gateway)** — replaces fragile "send screenshot" with instant Easypaisa/JazzCash/Raast collection. High value once you integrate a gateway.
6. **Anti-fraud for COD** — flag repeat-return numbers, validate address/phone, optional confirmation. Protects merchants' cash. Medium effort.
7. **Upsell / cross-sell in-chat** — "iske saath ye bhi lein?" during order. Pure margin. Low-medium effort once catalog exists.
8. **Broadcast campaigns** (with opt-in) — re-engage past buyers. Table-stakes revenue driver.
9. **Review/feedback collection** post-delivery — social proof + quality signal. Low effort.
10. **Delivery-charge & serviceable-area rules** — bot quotes correct shipping by city/area. Prevents bad orders.

---

## 5. Open questions — need primary-source research before building (Meta docs)

The research explicitly could NOT verify these; they gate MVP architecture:

- **WhatsApp Cloud API multi-tenant specifics** [?] — Embedded Signup flow, Tech Provider requirements, per-message pricing model (Meta moved from conversation-based to per-message pricing ~July 2025), message-template categories & approval, 24-hour session window, interactive buttons/lists, catalog/product messages, rate limits, opt-in/compliance rules.
- **WhatsApp Pay availability in Pakistan** [?] — appears India-only; likely NOT available to PK merchants. Must confirm; affects payment design.
- **SBP / legal constraints** [?] on collecting payments and storing bank details in-chat.

**Action:** before Phase 1 build, do a focused primary-source pass on Meta's developer docs for the multi-tenant Cloud API + PK payment legality. (I can run this next.)

---

## 6. Honesty note — stats that were REFUTED (do NOT repeat these)

The fact-checking killed these commonly-cited numbers — treat as false/unproven:
- ❌ "COD confirmation cut RTO from 38% → 22% in 6 weeks"
- ❌ "15-min confirmation converts ~60% of hesitant buyers"
- ❌ "SMS OTP: 92% genuine complete / 15% fraud" fraud-filter stat
- ❌ "Industry RTO 30–45%, well-run stores <15%"

The *directional* truth (COD dominant, RTO high, confirmation helps) stands; the *specific percentages* do not.

---

## Sources (verified subset)
- arXiv 2604.20732 — deterministic-pricing negotiation architecture (primary)
- nibbletechnology.com, apps.shopify.com/haggler — live AI-haggling products
- postex.pk/cod, assanpay.com, propakistani (Rah-e-Raast) — PK payments/logistics
- apps.shopify.com/universal-courier-pakistan — multi-courier WhatsApp tracking
- wab2c.com, wetarseel.ai — PK WhatsApp API positioning
- Pakistan draft National E-Commerce Policy 2.0 — COD share
