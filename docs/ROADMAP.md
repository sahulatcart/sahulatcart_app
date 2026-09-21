# Sahulatcart — Step-by-Step Execution Roadmap

From zero to a live product. Every step says WHO does it and WHY.
- **[YOU]** = only you can (your identity/money/decisions)
- **[ME]** = I build/write/configure
- **[BOTH]** = I prepare, you click the final button (it's under your account)

Phases run partly in parallel. Meta verification is slow, so we START it early and BUILD while we wait.

> **CHOSEN LAUNCH PATH = C (fast, official, single-merchant).** We launch on the official
> WhatsApp Cloud API with ONE merchant, whose number is added **manually** under the founder's
> own WhatsApp Business Account. We **SKIP** Meta Business Verification, App Review, and Embedded
> Signup for launch (an unverified business can still send to real customers at a low tier, ~250/day
> — plenty for a pilot). The multi-tenant self-serve pieces (Phase 4 below) are **deferred to the
> scale stage** — same codebase, added later. This makes Phases 1 (verification) and 4 (App Review)
> optional-for-launch. **Catalog input = manual add + CSV/Excel upload + Meta-catalog sync** (AI
> photo-import deferred). Below, treat verification/App-Review rows as "scale-stage, not launch".

---

## PHASE 0 — Foundations (Day 1–3)

| # | Owner | Do this | Why |
|---|---|---|---|
| 0.1 | **YOU** | Tell me the domain name to use (e.g. `sahulatcart.com`) | Everything (email, website, Meta) hangs off the domain |
| 0.2 | **YOU** | Buy that domain | Needed for website + privacy policy Meta requires |
| 0.3 | **YOU** | Create a **Supabase** project → send me the URL + service key | This is our database |
| 0.4 | **YOU** | Create a **Railway** account | This hosts the backend + admin portal |
| 0.5 | **YOU** | Give me the **Claude API key** | This is the bot's brain |
| 0.6 | **YOU** | Confirm you have an **FBR NTN** (or start getting one — see Phase 1) | Meta needs a registered business; NTN = the cheap path |
| 0.7 | **ME** | Scaffold the code repo (backend, admin portal, DB schema) | So building can start immediately, before Meta is ready |

➡️ **Output of Phase 0:** I can build; you have accounts; domain is owned.

---

## PHASE 1 — Business identity + start Meta (Day 1–14, runs in parallel with Phase 2)

*Start this the same week — Meta verification is the slowest thing, so we don't wait.*

| # | Owner | Do this | Why |
|---|---|---|---|
| 1.1 | **YOU** | If no NTN: register a **Sole Proprietorship via FBR NTN** (online or via a consultant, ~few days, ~PKR 0–15k) | Meta Business Verification needs a legal business. No company needed — NTN is enough |
| 1.2 | **YOU** | Confirm your **personal Facebook account** works and enable **2FA** | Meta requires this to own the app |
| 1.3 | **BOTH** | Create a **Meta Business Manager** (I guide, you own it) | The container for the WhatsApp app |
| 1.4 | **ME** | Write the **Privacy Policy + Terms** and a **simple landing page**; deploy to your domain | Meta App Review rejects apps without a live, proper privacy policy |
| 1.5 | **BOTH** | Submit **Meta Business Verification** (upload NTN + proof of address) | The gate to everything WhatsApp. Takes days — start early |
| 1.6 | **YOU** | Get a **spare phone number/SIM** NOT used on WhatsApp or WhatsApp Business | This becomes Sahulatcart's own test/display number |

➡️ **Output of Phase 1:** business is legal; Meta is verifying; legal pages are live; test number ready.

---

## PHASE 2 — I build the core product (Day 3–21, while Meta verifies)

*None of this needs Meta approval — I build the whole engine against a test setup.*

| # | Owner | Do this | Why |
|---|---|---|---|
| 2.1 | **ME** | Database schema (merchants, products, orders, conversations, rules) with per-merchant isolation | Multi-tenant foundation |
| 2.2 | **ME** | **Admin portal**: merchant login, catalog (products/prices/photos/stock) | Where the merchant configures their shop |
| 2.3 | **ME** | **Negotiation rules engine** (code-enforced price floors, per-product discount %) | The core feature; floor must be code, never the AI |
| 2.4 | **ME** | **Conversation engine** with Claude — understands Roman Urdu, haggles, stays inside the floor | The bot's actual chatting ability |
| 2.5 | **ME** | **Order flow**: confirm items → collect delivery details → generate order slip | Turns a chat into an order |
| 2.6 | **ME** | **Payment flow (your design)**: bot offers COD **or** shows merchant's bank number → customer sends screenshot → stored → merchant notified → merchant marks "paid" in portal → bot tells customer confirmed | Exactly the manual flow you described. No gateway |
| 2.7 | **ME** | **Human takeover** ("pause bot" on any chat) + **merchant order dashboard** | Merchants won't trust a bot they can't override |
| 2.8 | **YOU** | Give me **one real merchant's catalog + prices + negotiation limits** to test with | I need realistic data to tune the bot |

➡️ **Output of Phase 2:** a working product that runs in a test/simulator — everything except the live WhatsApp connection.

---

## PHASE 3 — Connect WhatsApp (test number) (Day ~18–25)

*Once Meta Business Verification is approved.*

| # | Owner | Do this | Why |
|---|---|---|---|
| 3.1 | **ME** | Build the **WhatsApp webhook** (one endpoint, routes each message to the right merchant) | The pipe between WhatsApp and the bot |
| 3.2 | **BOTH** | Register your **spare number** on the Cloud API (verification code) | Gives us a live number to test end-to-end |
| 3.3 | **ME** | Wire the bot to the live number; create the needed **message templates**, submit for approval | Templates are required to message customers outside the 24h window |
| 3.4 | **YOU** | Play the **customer** from your own phone; chat, haggle, place a test order | Real-world testing before any real merchant |
| 3.5 | **ME** | Fix everything that breaks in real chats | Roman Urdu + real behaviour always surfaces issues |

➡️ **Output of Phase 3:** a real WhatsApp number where the full flow works — you can order from it yourself.

---

## PHASE 4 — App Review + go-live setup (Day ~25–35)

*This is what lets OTHER merchants connect their own numbers (multi-tenant).*

| # | Owner | Do this | Why |
|---|---|---|---|
| 4.1 | **ME** | Build **Embedded Signup** ("Connect WhatsApp" button in the portal) | So a merchant links their own number in a few clicks |
| 4.2 | **ME** | Record the **screencast** + write the **use-case justification** for App Review | Meta requires this to grant the two WhatsApp permissions |
| 4.3 | **BOTH** | Submit **App Review** for `whatsapp_business_messaging` + `whatsapp_business_management` | Unlocks onboarding real merchants at scale |
| 4.4 | **YOU** | Add a **credit/debit card** to Meta for per-message billing | Meta charges per message once live |
| 4.5 | **ME** | Deploy backend + portal to **Railway** on your domain | Production hosting |

➡️ **Output of Phase 4:** the platform is live and legally able to onboard any merchant.

---

## PHASE 5 — Pilot with your first real merchant (Day ~35–45)

| # | Owner | Do this | Why |
|---|---|---|---|
| 5.1 | **YOU** | Find **1 friendly merchant** willing to pilot | Real usage beats any amount of testing |
| 5.2 | **BOTH** | Onboard them: they connect their number, add catalog, set negotiation + payment details | First real tenant |
| 5.3 | **ME** | Watch real customer chats, tune the bot, fix issues | The bot gets smart on real conversations |
| 5.4 | **YOU** | Collect the merchant's feedback | Tells us what to fix before scaling |

➡️ **Output of Phase 5:** one real shop running on Sahulatcart, taking real orders.

---

## PHASE 6 — Open to more merchants (Day ~45+)

| # | Owner | Do this | Why |
|---|---|---|---|
| 6.1 | **ME** | Polish onboarding, add analytics (sales, win-rate, avg discount) | Self-serve for new merchants |
| 6.2 | **YOU** | Decide **pricing** for merchants; sign up more | The business model |
| 6.3 | **ME** | Add Phase-2 features (courier tracking, broadcasts, abandoned-cart) as needed | Growth features once core is proven |

---

## The critical-path (what blocks what)

```
NTN (you) ──▶ Meta Business Verification (slow) ──▶ Connect real number ──▶ App Review ──▶ onboard merchants
Domain (you) ─▶ Privacy policy/website (me) ──────▶ (also needed for App Review)
                          Meanwhile ▶ I build the whole product in parallel (needs none of the above)
```

**The single slowest, earliest thing = Meta Business Verification (needs your NTN).**
Start 1.1 and 1.5 first. I build everything else while it processes.
