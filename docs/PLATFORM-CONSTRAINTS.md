# Sahulatcart — Platform Constraints (WhatsApp Cloud API + Pakistan Payments)

Build-blocking technical & legal constraints. Decides onboarding flow, cost model, payment layer.

> **[H-verified]** = confirmed against primary sources in research (Meta policy docs, SBP circulars).
> **[K]** = from Claude's knowledge (≤ Jan 2026); directionally reliable but **verify exact numbers against live Meta docs before finalizing pricing/limits** — these pages are JS-rendered and can't be auto-fetched.

---

## A. Messaging rules — 24h window & templates  [H-verified]

- **The 24-hour customer service window is the core constraint.** The bot can chat **freely in Roman Urdu** (free-form) only within **24 hours of the buyer's last message**. The timer resets on every new buyer message.
- **Outside the 24h window → you MUST use a pre-approved template.** First-contact (business-initiated) messages always require an approved template.
- **Template categories:** `marketing`, `utility`, `authentication` (+ free-form `service` messages usable only inside the window).
- Meta can **review, pause, reject, or disable any template at any time** (low read-rates / negative feedback → `PAUSED`). **Build fallback handling** — a paused template must not break the order flow.
- **Architecture impact:**
  - Live negotiation/order chat = free-form, fine (buyer is active, inside window).
  - **Re-engaging a cold buyer** (abandoned-cart follow-up, "your order shipped" a day later) = **needs an approved template.**
  - Each merchant tenant needs its **own approved template library.** Classify order-confirmation/shipping as **utility**, promos as **marketing**.

## B. Opt-in & compliance  [H-verified]

- **Explicit opt-in required** before messaging: you need the user's number **and** confirmation they want messages. Inbound buyer messages satisfy entry; **merchant-initiated blasts/follow-ups require captured opt-in.** Record per-tenant opt-in provenance.
- **Prohibited goods** (cannot be sold over WhatsApp): firearms, drugs, endangered species, real/virtual/fake currency (incl. crypto/ICOs), MLM, payday/P2P loans, debt collection, bail bonds.
- **⚠️ Platform risk (multi-tenant):** a violation can **permanently ban your entire organization from all WhatsApp products** — not just the offending merchant. **Mitigations:** merchant vetting + prohibited-goods screening at onboarding; per-tenant isolation where possible; T&Cs pushing liability to merchants.

## C. Pakistan payment legality  [H-verified]

- **Do NOT custody funds or issue wallets.** Issuing e-money/wallets requires an SBP **EMI license** (non-bank, **Rs. 200M** initial capital). Sahulatcart must stay a **software/orchestration layer**, never a money holder/issuer.
- **Merely integrating a licensed gateway/rail does NOT require a license.** Route money **buyer → merchant** via a licensed rail or gateway.
- **Raast (SBP's national instant rail) is the compliant collection path.** Its **Person-to-Merchant (P2M)** service is officially launched (SBP Circular C4 of 2023) — Raast QR, Raast Alias, IBAN, Request-to-Pay. Merchants access Raast **through their own bank/EMI**; Sahulatcart surfaces the QR/alias in the bot checkout, it does not onboard with SBP.
- **Gateways** like AssanPay / PayFast / Safepay are the practical integration for WhatsApp payment links (Easypaisa, JazzCash, Raast QR, cards).
- **⚠️ Unverified (verify before building payment layer):**
  - **WhatsApp Pay in Pakistan** — likely **India-only**; do not assume it's available.
  - **Legality/risk of "bank transfer + payment screenshot" verification** and **storing merchant bank details** — unresolved. Storing *merchant's own* payout details is low-risk; *facilitating/verifying* payments edges toward regulated territory. Keep it as "merchant shows their own account, buyer pays directly" (no funds through us) to stay clean.

---

## D. Embedded Signup / Tech-Provider onboarding  [K — verify on developers.facebook.com]

To let many merchants connect **their own** WhatsApp number:

1. **Become a Tech Provider** (not Solution Partner — SP is the heavier BSP/reseller model with billing responsibility; **Tech Provider is the standard for SaaS** where each customer owns their WABA).
2. **Prerequisites:**
   - A **Meta App** (Business type) with the WhatsApp product added.
   - A **Meta Business Account** + **Business Verification** (submit business documents; free; can take days).
   - **App Review** to get **Advanced Access** for `whatsapp_business_management` and `whatsapp_business_messaging`.
   - Configure the **Embedded Signup** flow (Facebook JS SDK popup).
3. **Merchant onboarding flow (the "Connect WhatsApp" button):**
   - Merchant clicks it → Facebook-hosted popup → logs in with their FB/Meta account → creates or selects their **WABA** + **phone number** → grants your app permission.
   - You receive an auth **code** → exchange server-side for an access **token** → read their **WABA ID** + **phone number ID**.
   - Register the number + set a **two-step PIN**; subscribe your webhook to their WABA.
4. **Fees:** No Meta fee for onboarding/verification itself. You pay only per-message (Section E). You may add your own SaaS subscription on top.
5. **Architecture impact:** one shared Meta App, **one webhook endpoint**, route inbound by `phone_number_id → tenant`. Store each tenant's token/WABA/phone IDs (encrypted) in Supabase.

## E. Messaging pricing (post-July-2025)  [K — verify live rates]

- Meta shifted from **conversation-based → per-message pricing on ~1 July 2025.**
- Charged **per delivered template message**, by category: **marketing** (paid), **authentication** (paid), **utility** (paid *outside* window).
- **FREE:** `service` messages (free-form) inside the 24h window; **utility templates are free when sent inside an open 24h window.**
- The old "1,000 free service conversations/month" tier was **removed** in the new model (service messages now free within window instead).
- **Rates are per-country** — **Pakistan has its own rate card**; I don't have exact PKR figures. **Get these live before pricing your plans.**
- **Cost-design takeaway:** keep buyers *inside* the 24h window (they're chatting anyway → free). The **only** real per-message cost is **marketing/re-engagement templates** to cold buyers. Model your SaaS pricing around that.

## F. Interactive & commerce message types  [K — verify limits]

| Type | Key limits |
|---|---|
| Reply buttons | up to **3** buttons, title ≤ **20** chars |
| List message | 1 list, ≤ **10** rows total across ≤10 sections; row title ≤24, desc ≤72 |
| CTA URL button | single URL button |
| Single / Multi-Product Message | **requires a Meta Commerce catalog** linked to the WABA; MPM up to ~30 products |
| WhatsApp Flows | multi-screen forms (address capture, etc.) |

- Interactive (non-template) messages must be sent **inside the 24h window**. Templates can carry quick-reply/URL/call buttons.
- **Catalog/product messages** need a **Meta Commerce catalog** — extra setup per merchant; treat as **Phase 2**. MVP can render products as image + text + reply buttons.

## G. Rate limits, quality & tiers  [K — verify]

- **Messaging limit tiers** (business-initiated unique users / 24h): **250 → 1K → 10K → 100K → unlimited.** New numbers start low (250–1K) and **auto-upgrade** with good quality + volume.
- **Quality rating:** High (green) / Medium (yellow) / Low (red), from buyer **blocks/reports** + template read-rates. Sustained low → tier can drop / number flagged.
- **Throughput:** Cloud API default **~80 messages/sec**, upgradable to ~1,000 mps.
- **Impact:** For SME merchants (low volume, buyer-initiated chats) tiers are a **non-issue at MVP.** Matters only when you add **bulk marketing broadcasts** — that's where quality management and tiers bite.

---

## Net architectural decisions locked by this research

1. **Onboarding:** Tech Provider + Embedded Signup; one Meta App, one webhook, route by `phone_number_id`. Store tokens encrypted per tenant.
2. **Cost model:** design to keep conversations inside the free 24h window; only budget for marketing/re-engagement templates. Get live PK rates before setting SaaS prices.
3. **Payments:** never touch the money. Merchant shows **their own** Raast QR / bank details / gateway payment link (AssanPay-style); buyer pays merchant directly. This sidesteps EMI licensing entirely.
4. **Compliance:** opt-in capture + prohibited-goods screening at merchant onboarding are **mandatory** to protect the shared platform from a blanket ban.
5. **Templates:** per-tenant approved template library; utility for transactional, marketing for promos; build paused-template fallbacks.

## Still to verify against live Meta docs (before Phase 1 payment/pricing work)
- Exact Pakistan per-message rates by category (2026).
- WhatsApp Pay availability in Pakistan (assume NO until confirmed).
- Current messaging-tier auto-upgrade thresholds & throughput caps.
- Legality of screenshot-based payment verification under SBP (design around "no funds through us" to be safe).
