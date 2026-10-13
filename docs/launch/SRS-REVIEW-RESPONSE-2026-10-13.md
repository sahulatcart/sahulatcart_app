# Reply to Uzair's SRS review (13 October 2026)

From Fazal. Answers to Part B's questions, decisions on Part A's open points, and what changed in
the SRS files as a result. Everything below is already applied to `SRS-Fazal.md`, `SRS-Uzair.md` and
`PLAN.md` on branch `docs/market-ready-plan`; the shared Parts 0 and 1 are still identical in both.

## Your five questions

**Q1, go-live before M3: yes.** Until M3 lands, the WhatsApp readiness step counts as connected when
the shop has a `whatsapp_numbers` row. Written down as **IC-10**, so it is a contract, not a verbal
OK. M3 replaces it in week 3.

**Q2, per-merchant LLM cap: it is M5, mine.** New FR-M5.7: `message_usage` gains `llm_calls`,
bumped in `gemini.ts`; `settings.llmDailyCap` (default 2,000) checked before each call; past the cap
the existing "AI down" handoff path runs. Not your stream.

**Q3, shop address and the business profile: both.** P2 adds the address field (`merchants.address`,
migration 0013). I expose `syncBusinessProfile(db, merchantId)` (**IC-9**, FR-M3.7); you call it after
step 1 saves, I call it on connect. It is a no-op until a number is connected. The profile picture is
not pushed at launch; Meta needs the resumable-upload API for it.

**Q4, commit the SRS files: done**, under `docs/launch/`, with PDFs, on the branch above. It needs
one PR to reach `main`; the compare link is in the owner's hands.

**Q5, phone format: digits only, everywhere.** Now a rule in Part 0.3 for both streams.
`merchants.phone` and `whatsapp_numbers.phone_e164` are normalised on write; every comparison strips
non-digits from both sides. My M2 handshake (FR-M2.8) compares the inbound `from` with
`merchants.phone` that way.

## Your decisions

| # | Your decision | Mine |
|---|---|---|
| A2.1 | Compare phones as digits | **Agreed**, and generalised (Q5). |
| A2.2 | Unique index on `merchant_users(auth_user_id)` | **Agreed.** In migration 0012. Note for later: it also forbids one person managing two shops; we drop it when team features arrive. |
| A2.3 | Live merchant completes the wizard; attestations back-filled | **Agreed.** FR-P2.10. |
| A2.5 | State iOS 16.4+ | **Agreed.** FR-P3.2. |
| A2.6 | Expiry job reads `unpaidExpiryHours` | **Agreed.** FR-P4.3/4.4; PLAN decision 8 now says "24 by default, 6–72". |
| D1 | Push + email only; no WhatsApp alerts to merchants | **Agreed.** FR-P3.5 dropped; IC-3 says "never WhatsApp"; PLAN B4 updated. |
| D2 | No `order_sent` template; merchant messages the buyer themselves | **Half.** See below. |
| D3 | Language deferred | **Agreed.** FR-P8.4 stays deferred. |
| D4 | Expiry configurable | **Agreed.** |
| D5 | Address field; profile push is M-stream | **Agreed.** Q3. |
| D6 | LLM cap ownership | **M5.** Q2. |
| P8 | New feature for the six bot/catalog gaps | **Accepted** as P8, weeks 6–7, with one change: it **owns order-status replies outright**; I removed FR-M4.8 from M4 so we do not both build it. Merge order in IC-8 is now M4 → P5 → P8. |

**On D2.** I keep the `order_sent` template and the paid Rs 4 button, for two reasons. First, "message
the buyer yourself" means from the merchant's personal number: the shop number is on the Cloud API
and has no phone app, so there is nothing for them to message from. Second, `sendTemplate()` exists
anyway for `payment_update`, so the button costs nothing extra to build. **But you were right that
P4 must not block on it.** P4 now sends a free-form line when the window is open and otherwise only
sets `orders.pending_buyer_notice='order_sent'`; the order page says "window closed"; my button
consumes the flag when M4 lands. You never call `sendTemplate()`. IC-2 stays, marked non-blocking.

**On "three templates".** Two, not three: `payment_update` (verified or rejected, one template with a
parameter) and `order_sent`. `order_confirmed` would always be sent inside the window, where a
free-form message is cheaper, so it does not exist. PLAN decision 3 was corrected this morning.

## Things you could not see

You reviewed against `main` at `1fa5cd7`. The branch has moved since: my own SRS went through the same
kind of review this morning and changed in ways that touch you.

- **IC-7:** a platform admin may have no shop membership. `resolveCtx()` returns
  `{ isPlatformAdmin: true, merchantId: null }` for them, and your P1 `no_membership` redirect must
  check that flag first, or the console owner gets a shop created on first login.
- **Part 0.3, one route file per feature group:** your C2 rule, adopted. P1 (week 1) extracts the
  admin auth hook to `requireMerchant()` in `lib/auth.ts`; every new route file applies it; platform
  routes apply `requirePlatformAdmin()`. Please do this first in P1, since my M3 file depends on it.
- **Part 0.3, CHANGELOG under dated headings:** your C6 rule, adopted.
- **FR-M2.8 changed:** connection is proven by the merchant texting their shop number and the bot
  replying, not by an outbound test. Your onboarding step 7 copy should say the same ("send any
  message from your phone to your shop number").

## Still with the owner, not us

- Gemini billing (your G1). Nothing in P8 or M5 can be tested on the free tier.
- The Meta paperwork (G2): NTN, street address, legal name. The site still shows "To be confirmed".

## Monday

Agree IC-9 and IC-10 (two lines), confirm the route-file rule, then start: you P1, me M1.
