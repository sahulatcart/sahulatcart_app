# Sahulatcart — What the Founder Must Provide

Everything **you** (Farhan) need to supply or set up. I build all code. Payment flow = manual
(bot shows merchant bank number → customer sends screenshot → merchant confirms in portal),
so **no payment gateway and no fund custody** — that removes the hardest requirements.

> **[H]** verified in research · **[K]** from Claude's knowledge (verify if critical) · **[$]** has a cost

---

## Already covered by you
- ✅ Git / GitHub — done
- ✅ Supabase credentials — you'll provide
- ✅ Claude (AI) API key — you'll provide
- ✅ Railway hosting — you'll set up

---

## A. ABSOLUTE MUST-HAVES to go live

### 1. Meta / Facebook (for WhatsApp Cloud API)
| # | Item | Notes |
|---|---|---|
| A1 | **Personal Facebook account** (active) [H] | Yours. Used to own the Meta app + Business Manager. |
| A2 | **Meta Business Manager / Business Portfolio** | Free. Created under your FB account. |
| A3 | **Meta App** (Business type, WhatsApp product) | I create/configure this; you own it. |
| A4 | **Meta Business Verification** [H] [K] | The gatekeeper. Requires documents proving **legal business name, business address, and phone number**. See section D — needs a business registration (an FBR **NTN** is enough). |
| A5 | **App Review → Advanced Access** for `whatsapp_business_messaging` + `whatsapp_business_management` [H] | Needed for the multi-tenant Tech-Provider model. Requires: a **screencast** of the business-facing admin UI, a **written justification** stating you're a Tech Provider managing clients' numbers/templates. I prepare these; submitted under your app. |
| A6 | **Valid business email** [H] | e.g. `you@sahulatcart.com`. Used for Meta + domain. |
| A7 | **Credit/debit card on Meta** for message billing [$][K] | Meta charges per-message (see costs). A card must be on file once you exceed free messaging. |
| A8 | **2FA / authenticator app** [K] | Meta requires 2FA on the business account. Just your phone. |

### 2. WhatsApp phone number(s)
| # | Item | Notes |
|---|---|---|
| A9 | **One dedicated phone number** for Sahulatcart's own display/test number [H][K] | Must **NOT be active on regular WhatsApp or WhatsApp Business app** (if it is, delete it from the app first). A cheap spare SIM works. Needs to receive an SMS/call verification code. |
| A10 | Merchants bring **their own numbers** | Each merchant connects their own number via Embedded Signup — not your problem to supply. |

### 3. Domain + legal pages (Meta App Review checks these)
| # | Item | Notes |
|---|---|---|
| A11 | **Registered domain name** [$][K] | e.g. `sahulatcart.com` or `.com`. ~$10–15/yr (or PKR ~3,500/yr for `.pk`). |
| A12 | **Public Privacy Policy page** (live) [H] | Must load fast, show business name + contact, explain data usage matching permissions. I write it; must be hosted live before review. |
| A13 | **Terms of Service page** (live) [K] | Same hosting. I draft it. |
| A14 | **A basic public landing page** [K] | A one-page site at the domain. I build it. |

### 4. Business registration (Pakistan) — the one thing to sort personally
| # | Item | Notes |
|---|---|---|
| A15 | **Business registration for Meta verification** [H] | **Minimum viable = a Sole Proprietorship via FBR NTN.** In Pakistan a sole prop needs **no SECP company** — only FBR **NTN** registration, and the NTN certificate itself acts as the business registration certificate. This is the cheap/fast path (see below). |
| A16 | **Proof of business address** [K] | A utility bill / letterhead in the business name; Meta may ask for it. |

---

## B. NEEDED SOON (right after go-live, not day 1)
- **B1. Business bank account** [K] — for receiving your SaaS subscription revenue from merchants. A personal account works to start; a business account is cleaner once registered.
- **B2. A logo** [K] — for the WhatsApp display profile, admin portal, landing page. Even a simple one. I can generate a starter.
- **B3. WhatsApp display name approval** [K] — each connected number gets a display name reviewed by WhatsApp; must match the business, not be misleading.
- **B4. Business email inbox** — actually monitored (support@, and for Meta notices).

---

## C. OPTIONAL / LATER
- **C1. SECP (Pvt Ltd) company** — only if you later want investors, bigger contracts, or a formal company. **Not needed for launch.**
- **C2. Payment gateway (Safepay/PayFast/AssanPay)** — **NOT needed** given your manual payment flow. Only revisit if you ever want to auto-collect *your own SaaS fees* from merchants online.
- **C3. Meta Tech Provider "verified" badge / higher tiers** — comes with volume.
- **C4. Test devices** — a spare Android phone with WhatsApp to play the "customer" during testing. Helpful, not mandatory (I can use my own).

---

## D. Business registration — the minimum viable path [H]

Since your app takes **no payments**, you do **not** need a company or any gateway. You only
need enough registration to pass **Meta Business Verification**:

- **Sole Proprietorship via FBR NTN** — the cheapest, fastest legal business identity in Pakistan.
  - No SECP registration required; the **NTN certificate serves as the sole-proprietorship certificate** [H].
  - Typically done online via FBR IRIS or through a consultant.
  - **Rough cost:** free to ~PKR 5,000 DIY, or ~PKR 5,000–15,000 via a consultant [$][K, verify].
  - **Rough time:** a few days [K, verify].
- With NTN + a business bank letter / letterhead + proof of address, you can complete Meta verification.

> ⚠️ If you already have an NTN (most people who file tax do), you may be most of the way there.
> **This is the only item that could genuinely block you** — everything else is routine. If you
> cannot register even a sole proprietorship, tell me and we'll look at alternatives (e.g. verifying
> under an existing registered business you have access to).

---

## E. COST SUMMARY (rough, verify live) [$]

| Item | Est. cost | Cadence |
|---|---|---|
| Domain | $10–15 / PKR ~3,500 | per year |
| FBR NTN / sole prop | free–PKR 15,000 | one-time |
| Meta Business Verification | **free** | one-time |
| WhatsApp messaging | free inside 24h window; pay only for marketing/re-engagement templates — **PK per-msg rate: verify live** | per message |
| Claude API | usage-based (you provide key) | monthly |
| Supabase | free tier to start, ~$25/mo Pro later | monthly |
| Railway | ~$5–20/mo | monthly |
| Payment gateway | **PKR 0 — not used** | — |

**Bottom line:** to go live you're looking at a **domain + an FBR NTN + your existing accounts**.
Ongoing costs are hosting + Claude usage + WhatsApp template messages. No big capital, no gateway.

---

## F. What I need from you to START BUILDING (before any of the above is ready)
None of the Meta/business items block me from building. To begin Phase 1 I only need:
1. **Supabase project URL + service key** (or let me use a local/dev DB first)
2. **Claude API key** (for the bot; can be added later — I'll stub it)
3. Confirmation of the **project/brand name spelling** for the domain (Sahulatcart).

The Meta verification, NTN, domain, and phone number are needed **to connect real WhatsApp and go
live** — you can start those in parallel while I build. I'll give you a step-by-step when we hit that stage.

---

### Verified sources
- Meta: `developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission` (Advanced Access, screencast, justification)
- Meta verification docs: WATI country-docs guide; privacy-policy requirements (saurabhdhar.com)
- Phone number rules: bitbybit Cloud API registration guide
- Sole proprietorship / NTN: hrbs.com.pk
- (Payment-gateway sources intentionally dropped — not applicable to your no-payments flow)
