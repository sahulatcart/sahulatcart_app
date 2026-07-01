# 08 — Payments & Notifications

> **Money principle (non-negotiable).** Sahulatkaar NEVER takes payments and NEVER holds funds. There
> is **no payment gateway, no card data ever, no wallet, no escrow**. The bot either arranges **Cash on
> Delivery (COD)** or shows the **merchant's OWN bank account** (from `bank_accounts`) so the customer
> pays merchant↔customer directly via their own banking app. Verification of a bank transfer is a
> **manual human act** by the merchant, who checks their real bank balance and clicks Verify/Reject in
> the portal. This keeps us clear of SBP / EMI licensing. See [00-overview](00-overview.md) principle 2
> and [09-nonfunctional-devops](09-nonfunctional-devops.md) for the compliance recap.

This document covers (A) the full payment flow and its state machines, and (B) the whole notification
system. It uses the canonical enums, tables and buckets from [02-data-model](02-data-model.md) exactly.
It cross-references [05-bot-flows](05-bot-flows.md) (conversation FSM) and [03-backend-api](03-backend-api.md)
(endpoints), and [04-whatsapp-integration](04-whatsapp-integration.md) (templates / 24h window).

---

# PART A — PAYMENTS

## A0. Canonical fields used here (from doc 02, verbatim)

**`orders`**
- `status` enum `order_status`: `draft, pending_confirmation, confirmed, awaiting_payment, paid, preparing, dispatched, delivered, cancelled, returned`
- `payment_method` enum `payment_method`: `unset, cod, bank_transfer`
- `payment_status` enum `payment_status`: `unpaid, claimed, verified, failed, cod_pending, cod_collected, refunded`
- `payment_locked bool` (true on claimed/verified/cod_collected — edit guard, CD-5)
- `cancelled_reason (null)`, `returned_reason (null)` (CD-5)
- money: `subtotal, discount_total, delivery_charge, total` — all **integer paisa**.

**`payments`** (current-state row, one per order — `order_id` is unique; the **latest pointer**)
- `id, order_id (unique), merchant_id, method (payment_method), amount (paisa), status (payment_status),`
  `bank_account_id (null), screenshot_url (null — latest), claimed_at (null), verified_at (null),`
  `verified_by_user_id (null), cod_collected_at (null), cod_collected_by_user_id (null),`
  `refunded_at (null), refund_reason (null), rejection_reason (null), reference (null)`

**`payment_claims`** ✚ (CD-4 — full claim history; a `payments` row may have many)
- `id, payment_id, order_id, merchant_id, screenshot_url, reference (null), amount (paisa),`
  `status (claimed | verified | rejected), rejection_reason (null), claimed_at, decided_at (null),`
  `decided_by_user_id (null)`

**`bank_accounts`** (merchant's own accounts)
- `id, merchant_id, bank_name, account_title, account_number, iban (null), branch (null), is_default, is_active`

**`bot_state`** (relevant states): `selecting_payment`, `awaiting_payment_proof`, `completed`.
> Note: the old `confirming` bot state is **not** used on the bank path anymore. After a screenshot the
> conversation stays in `awaiting_payment_proof` until the merchant verifies (CD-16).

> **Naming note.** `payment_status` is a **single shared enum** used on both `orders.payment_status`
> and `payments.status`. The two are kept in lock-step: the `payments` row is the source of truth; a DB
> write always updates both in the same transaction. Order-level `order_status` is a *separate* lifecycle
> (fulfilment), coupled to but not equal to `payment_status`.
>
> **Order timing (CD-15).** The `orders` row (and thus `order_id`) exists **before** any payment: the cart
> lives in `conversations.context` through `order_building`, and on entry to `collecting_delivery` we
> materialize `orders(status='draft')` + `order_items`. So a real `order_id` is always available for the
> screenshot storage path and for `payments.order_id` — payment never has to "invent" an order id. The
> order becomes `pending_confirmation` on entry to `selecting_payment`.

---

## A1. The two payment methods & the combined state machine

Payment is entered from bot state `selecting_payment` (see [05-bot-flows](05-bot-flows.md)). At that
point the order **already exists** — it was materialized as `draft` at `collecting_delivery` and moved to
`status = pending_confirmation` on entry to `selecting_payment` (CD-15) — with `payment_method = unset`,
`payment_status = unpaid`. We **upsert exactly one `payments` row once**, keyed on the unique `order_id`,
when the method is chosen (idempotent; CD-18). That single row is the current-state pointer for the life
of the order.

### A1.1 Method selection (shared prefix)

The bot presents an interactive reply (two buttons) once the order total is locked:

> Roman Urdu (customer):
> *"Aap ka order ready hai — total **Rs. {total}**. Payment kaise karenge?*
> *1) Cash on Delivery (COD) — delivery pe cash.*
> *2) Bank Transfer — abhi account pe bhej dein, screenshot bhej dein."*

- Choose **COD** → `payment_method = cod`, go to §A3.
- Choose **Bank Transfer** → `payment_method = bank_transfer`, go to §A2.

On selection we upsert the **single** `payments` row (once, idempotent on unique `order_id` — CD-18):
```
payments.order_id = orders.id           -- order already exists (CD-15)
payments.method   = <cod | bank_transfer>
payments.amount   = orders.total        -- snapshot at selection; re-checked at claim (see A5)
payments.status   = <cod_pending | unpaid>
```
For COD this is the last `payments.status` write until cash collection; for bank transfer the same row
is transitioned unpaid→claimed→verified/failed. Individual bank claims are recorded in `payment_claims`
(§A2.4), while `payments` keeps only the latest pointer.

### A1.2 Combined lifecycle table (method + payment_status + order_status)

Consistent with doc 10 CD-15/16/17/18. Note the **confirm-then-pay** ordering on the bank path: the buyer
confirms the order first (`pending_confirmation → confirmed`), and only then does it move to
`awaiting_payment`.

| Step | `payment_method` | `payment_status` | `order_status` | Who acts |
|---|---|---|---|---|
| Order materialized (at `collecting_delivery`) | `unset` | `unpaid` | `draft` | bot |
| Enter `selecting_payment` | `unset` | `unpaid` | `pending_confirmation` | bot |
| **COD path** | | | | |
| COD chosen | `cod` | `cod_pending` | `confirmed` | bot |
| COD preparing / dispatched | `cod` | `cod_pending` | `preparing`→`dispatched` | merchant |
| Mark **delivered** (cash not yet taken) | `cod` | `cod_pending` | `delivered` | merchant |
| Mark **cash collected** | `cod` | `cod_collected` | `delivered` | merchant |
| **Bank-transfer path** | | | | |
| Bank chosen | `bank_transfer` | `unpaid` | `pending_confirmation` | bot |
| Buyer confirms order | `bank_transfer` | `unpaid` | `confirmed` | customer → bot |
| Bank details sent | `bank_transfer` | `unpaid` | `awaiting_payment` | bot |
| Customer sends screenshot | `bank_transfer` | `claimed` | `awaiting_payment` | customer → bot |
| Merchant verifies | `bank_transfer` | `verified` | `paid` | merchant |
| Merchant rejects | `bank_transfer` | `failed` (resting) | `awaiting_payment` | merchant |
| Retry: new screenshot after reject | `bank_transfer` | `claimed` | `awaiting_payment` | customer → bot |
| Verified → fulfilment | `bank_transfer` | `verified` | `preparing`→`dispatched`→`delivered` | merchant |
| **Both paths** | | | | |
| Refund (after verified / cod_collected) | (unchanged) | `refunded` | `cancelled`/`returned` | merchant |
| Cancelled anytime | (unchanged) | (unchanged) | `cancelled` | merchant/bot |

**`failed` is a RESTING state (CD-18).** On reject we set `payment_status = failed`, record
`rejection_reason` on the current `payment_claims` row, and tell the customer. We do **not** auto-reset to
`unpaid`. The order simply waits in `awaiting_payment`/`failed` until the customer sends a new screenshot,
which takes the single `payments` row `failed → claimed` again (a fresh `payment_claims` row). See §A2.5.

**Terminal-ish payment states:** `verified` (bank) and `cod_collected` (COD) are the "money received"
end states; `refunded` is the post-money-back end state (§A4.4). `order_status = paid` is reached only for
`bank_transfer` on verify; for **COD the order goes `confirmed → preparing → dispatched → delivered` while
`payment_status` stays `cod_pending` until cash is in hand** (it never passes through `unpaid`, `claimed`,
`verified`, or `paid` — CD-17). This asymmetry is intentional — see §A3.

---

## A2. Bank-transfer flow (detail)

### A2.1 Choosing which `bank_account` to show

Selection algorithm (deterministic, in Payment Service):
1. Candidate set = `bank_accounts` where `merchant_id = order.merchant_id AND is_active = true`.
2. If any candidate has `is_default = true` → use it.
3. Else use the most recently updated active account.
4. If **no active account exists** → bank transfer is unavailable: bot apologises and offers COD only,
   and we raise a `system` notification to the merchant ("Bank transfer selected but no active bank
   account configured"). See §B / notification type `system`.

The chosen account id is written to `payments.bank_account_id` so the exact account shown is auditable
(the merchant may later change `is_default`; we keep the one actually shown to *this* customer).

### A2.2 Exact info shown to the customer

Free-form text (inside the 24h window). Fields come straight from the chosen `bank_accounts` row:

> *"Bank transfer ke liye yeh details hain:*
> *🏦 Bank: **{bank_name}***
> *👤 Title: **{account_title}***
> *#️⃣ Account #: **{account_number}***
> *{iban ? "IBAN: **{iban}**" : ""}*
> *{branch ? "Branch: {branch}" : ""}*
> *💰 Amount: **Rs. {total}** (exact)*
> *Transfer karne ke baad payment ka **screenshot** yahin bhej dein — hum confirm kar ke order pakka kar denge."*

Rules:
- Amount shown = `orders.total` formatted from paisa (`Rs. {total/100}` with thousands separators).
- We never show `iban`/`branch` lines if null.
- We explicitly ask for the **screenshot** in the same message (sets expectation for §A2.3).
- **Confirm-then-pay (CD-16).** Bank details are only sent **after** the buyer has confirmed the order
  (`pending_confirmation → confirmed`). Sending the details performs the transition
  `confirmed → awaiting_payment` and sets bot state → `awaiting_payment_proof`. `payment_status` stays
  `unpaid` until a screenshot arrives.

### A2.3 Receiving & storing the screenshot

When an inbound WhatsApp **image** arrives while conversation state is `awaiting_payment_proof`
(routing per [05-bot-flows](05-bot-flows.md)):

1. Backend downloads the media from Meta Graph API using the media id (see [04-whatsapp-integration](04-whatsapp-integration.md)).
2. Uploads to Supabase Storage bucket **`payment-screenshots/`** (private) at path
   `{merchant_id}/{order_id}/{uuid}.jpg` — the `order_id` always exists (CD-15), so the path is stable.
3. The stored object is **private**. We store only the storage **path** on `payments`/`payment_claims`;
   we never store or transmit a signed URL (CD-40). The portal mints a **short-lived, single-use signed
   URL on demand** at view time (after a role/RLS check), using **one** short TTL value (see §A7). We
   never make this bucket public.
4. We do **not** OCR, parse, or interpret the image at launch (see §A4 — trust model).

> **Edge:** if the message is not actually an image (e.g. a PDF `document`), accept it too and store it
> under the same path with its real extension; still treat as a claim. If it's plain text like "paid"
> with no attachment, see §A6.

### A2.4 Recording a claim (`payment_claims` + `payments` pointer)

On a valid screenshot receipt we do two writes in a single transaction (CD-4). First, insert a **new
`payment_claims` row** capturing this attempt in full history:
```
payment_claims (insert):
  payment_id       = payments.id
  order_id         = orders.id
  merchant_id      = orders.merchant_id
  screenshot_url   = <storage PATH only, not a signed URL (CD-40)>
  reference        = <null | parsed/entered ref>
  amount           = orders.total              -- re-asserted; guard in A5
  status           = 'claimed'
  claimed_at       = now()
```
Then update the single `payments` **latest pointer** (unpaid **or** `failed` → `claimed`; CD-18):
```
payments.screenshot_url = <same storage PATH>
payments.claimed_at     = now()
payments.amount         = orders.total
payments.bank_account_id= <account shown in A2.1>
payments.status         = 'claimed'
orders.payment_status   = 'claimed'
orders.payment_locked   = true               -- edit guard (CD-5, §A5)
-- order_status stays 'awaiting_payment' until merchant verifies
```
The conversation **stays in bot state `awaiting_payment_proof`** (NOT `confirming` — CD-16); we are still
awaiting the *merchant's* verify/reject, and a fresh screenshot must re-enter `claimed` from the same
state. We fire notification `payment_claim` (§B).

Customer acknowledgement (Roman Urdu):
> *"Shukriya! Aap ki payment ka screenshot mil gaya. Hum verify kar rahe hain — thodi dair mein order
> confirm ho jayega. ⏳"*

### A2.5 Merchant verify / reject actions

Merchant opens the order in the portal, views the screenshot (signed URL), **opens their own bank app,
confirms the money actually landed**, then acts. Endpoints (see [03-backend-api](03-backend-api.md)):

Both actions are **`POST`** (CD-26) and decide the **latest** `payment_claims` row (the one in `claimed`),
guarded by `SELECT … FOR UPDATE` + a state guard (CD-20).

**Verify** — `POST /api/v1/orders/:id/payment/verify`
```
payment_claims (latest claimed row):
  status              = 'verified'
  decided_at          = now()
  decided_by_user_id  = <merchant_user.id>
payments (pointer):
  verified_at         = now()
  verified_by_user_id = <merchant_user.id>
  status              = 'verified'
orders.payment_status = 'verified'
orders.status         = 'paid'
orders.payment_locked = true
```
Bot then tells the customer (free-form if in window, else utility template — §A6/§B):
> *"Payment confirm ho gayi ✅ Aap ka order **{order_number}** pakka ho gaya hai. Jaldi dispatch karenge.
> Shukriya!"*
Bot state → `completed` (CD-16). Notification: none new to merchant; realtime pushes updated order.
`new_order` semantics already fired at buyer confirm (CD-15).

**Reject** — `POST /api/v1/orders/:id/payment/reject` (body: `{ reason }`)
```
payment_claims (latest claimed row):
  status              = 'rejected'
  rejection_reason    = <reason>   -- e.g. "amount kam hai", "screenshot blurry", "paisa nahi aaya"
  decided_at          = now()
  decided_by_user_id  = <merchant_user.id>
payments (pointer):
  rejection_reason    = <reason>
  status              = 'failed'   -- RESTING; no auto-reset (CD-18)
orders.payment_status = 'failed'
orders.status         = 'awaiting_payment'   -- stays here; failed is a resting payment state
-- payment_locked stays true until a new claim or a manual switch to COD
```
> **Implementation note (CD-18).** `failed` is a **resting state** — we do **not** reset `payments.status`
> back to `unpaid`. The rejected attempt is preserved as its own `payment_claims` row (full history), so
> no `audit_log` copy is needed for that. The retry path is the edge **`failed → claimed`**: the customer's
> next screenshot inserts a fresh `payment_claims` row and flips the `payments` pointer back to `claimed`
> (§A2.4). `rejection_reason` is surfaced to the customer.

Bot re-asks the customer, quoting the reason (Roman Urdu):
> *"Maaf kijiye, payment abhi confirm nahi hui. Wajah: **{rejection_reason}**.*
> *Meherbani kar ke sahi amount **Rs. {total}** transfer kar ke naya screenshot bhej dein — ya COD pe
> switch karna ho to bata dein."*
Bot state stays `awaiting_payment_proof` (it never left — CD-16); the next screenshot re-enters `claimed`.

### A2.6 Bank-transfer step diagram (bot ↔ customer ↔ system ↔ merchant)

Confirm-then-pay ordering (CD-16): the buyer confirms the order **first**, THEN pays.

```
CUSTOMER            BOT / SYSTEM                         MERCHANT
   │                     │                                  │
   │  picks "Bank"       │ payment_method=bank_transfer     │
   ├────────────────────▶│ upsert payments (unpaid), amount │
   │                     │ order_status=pending_confirmation │
   │  ◀── "confirm karein? total Rs.{total}" ───────────────│
   │  confirms order ───▶│ order_status=confirmed            │
   │                     │ (order_number, placed_at, slip)   │
   │                     │ pick bank_account (default/active)│
   │                     │ confirmed → awaiting_payment      │
   │  ◀── account details+amount+"send screenshot" ─────────│
   │                     │ payment_status=unpaid             │
   │  (pays in own app)  │  state=awaiting_payment_proof     │
   │                     │                                  │
   │  ── screenshot img ─▶ store PATH→payment-screenshots (priv)│
   │                     │ INSERT payment_claims (claimed)   │
   │                     │ payments pointer: claimed_at,      │
   │                     │   screenshot_url(path), amount     │
   │                     │ payment_status=claimed            │
   │                     │ state STAYS awaiting_payment_proof ┼──▶ notif: payment_claim
   │  ◀── "mil gaya, verify kar rahe hain" ─────────────────│    (portal + optional WA/email;
   │                     │                                  │     no signed URL in payload — CD-40)
   │                     │                     opens bank app, checks balance
   │                     │                     (portal mints on-demand signed URL to view shot)
   │                     │                                  │
   │                     │  ◀── VERIFY ─────────────────────┤ (or REJECT + reason)
   │                     │ claim+payments: verified          │
   │                     │ payment_status=verified            │
   │                     │ order_status=paid, state=completed │
   │  ◀── "payment confirm ✅ order pakka" ──────────────────│
   │                     │                                  │
   │  ◀ (if REJECT) "wajah:{reason}, dobara bhejein" ───────│ payment_status=failed (RESTING)
   │  ── NEW screenshot ─▶ INSERT new payment_claims; failed→claimed (retry edge, CD-18)
```

---

## A3. COD flow (detail)

### A3.1 Confirmation

Customer picks COD, then gives the explicit final confirm (`pending_confirmation → confirmed`, CD-15).
`cod_pending` is set **at COD selection** (CD-17), so on confirm:
```
payment_method       = cod
payments.status      = 'cod_pending'      -- set at selection (idempotent upsert, single row)
orders.payment_status= 'cod_pending'
orders.status        = 'confirmed'        -- buyer's final confirm: order_number, placed_at, slip, stock, new_order
```
Bot (Roman Urdu):
> *"Theek hai — **Cash on Delivery**. Aap ka order **{order_number}** confirm ho gaya. Total **Rs. {total}**
> delivery ke waqt cash mein dena hoga. Hum jaldi bhej denge. 🚚"*
State → `completed` for the conversation (order handed to fulfilment); notification `new_order` fired (§B).

### A3.2 `cod_pending` → `cod_collected` (when/how set)

`payment_status = cod_pending` is set **at COD selection** (§A3.1), not at dispatch (CD-17). There is no
dispatch-time "mark pending" transition. COD money is collected in the physical world, so `cod_pending`
persists through the whole fulfilment path and only flips to `cod_collected` when the merchant confirms
cash in hand.

**Delivered and cash-collected are two separate actions (CD-17)** — a courier may deliver now and remit
cash later, so we never conflate them:

1. **Mark delivered** — `POST /api/v1/orders/:id/deliver` (or portal action). Sets
   `orders.status = 'delivered'`; **payment stays `cod_pending`** (cash may not be in hand yet).
2. **Mark cash collected** — a separate `POST /api/v1/orders/:id/payment/cod-collect` action. Uses the
   dedicated columns (CD-5) — we do **not** overload `verified_at`:
   ```
   payments.status                 = 'cod_collected'
   payments.cod_collected_at       = now()
   payments.cod_collected_by_user_id = <merchant_user.id>
   orders.payment_status           = 'cod_collected'
   orders.payment_locked           = true
   -- order_status is already 'delivered' (step 1); unchanged here
   ```

The two steps may fire in the same portal interaction (deliver + cash collected together) or minutes/days
apart. `verified_at`/`verified_by_user_id` remain **bank-transfer-only** fields.

### A3.3 Interaction with `order_status`

COD order never enters `payment_status = paid` / `order_status = paid`. Its fulfilment path is:
`confirmed → preparing → dispatched → delivered`, with payment overlaid as `cod_pending` until
`cod_collected`. A COD order can also be `cancelled` or `returned`; a returned COD that was already
collected needs a manual refund (§A4.4).

### A3.4 COD step diagram

```
CUSTOMER          BOT / SYSTEM                 MERCHANT
   │  picks COD        │                          │
   ├──────────────────▶│ payment_method=cod        │
   │                   │ payment_status=cod_pending (AT SELECTION, CD-17)
   │                   │ order_status=confirmed ────┼──▶ notif: new_order
   │  ◀ "COD confirm, cash on delivery" ────────────│
   │                   │            preparing → dispatched (merchant advances)
   │                   │            payment_status stays cod_pending throughout
   │        (courier delivers)                      │
   │                   │  ◀── mark DELIVERED ──────────────────┤ (step 1)
   │                   │ order_status=delivered                 │
   │                   │ payment_status STILL cod_pending       │
   │        (cash handed over / remitted)           │
   │                   │  ◀── mark CASH COLLECTED ─────────────┤ (step 2, separate)
   │                   │ payment_status=cod_collected           │
   │                   │ cod_collected_at, cod_collected_by set │
```

---

## A4. Reconciliation & trust (manual / human)

**Launch stance: we do NOT auto-verify.** No OCR, no bank-API reconciliation, no screenshot parsing,
no ML "is this real" check at launch. Every bank transfer is confirmed by a **human merchant** looking at
their **real bank app**. The screenshot is *evidence to prompt the merchant*, not proof the system trusts.
(Future/optional: OCR to pre-fill amount/reference for merchant convenience, or bank statement import —
explicitly **out of scope** for Path C, see [00-overview](00-overview.md).)

### A4.1 Mismatched amount
Merchant sees screenshot says Rs. 4,500 but order total is Rs. 5,000. Merchant **Rejects** with reason
"amount kam hai — Rs. {total} bhejein" (or accepts a renegotiated total by editing the order first, §A5).
Bot re-asks (§A2.5).

### A4.2 Fake / blurry / wrong screenshot
Merchant can't read it or suspects a reused/old screenshot → **Reject** with reason "screenshot saaf
nahi / purana lag raha hai". Bot asks for a clear new one. No automated fraud detection; the human bank
check is the backstop — even a perfect fake fails because **the money simply isn't in the merchant's
account**.

### A4.3 Partial payment
Customer pays half. Merchant policy-dependent: usually **Reject** ("full amount chahiye") and re-ask; or,
if merchant accepts partials, they edit the order/record a note — **no first-class partial-payment
support at launch**. `payment_claims` records each attempt for history, but the `payments` pointer still
carries a single `amount` and a single money-received state; partial receipts summing to `total` are **out
of scope now** (deferred).

### A4.4 Refunds / returns / cancellations (manual)

Money always moves customer↔merchant directly, so a refund is a **manual merchant→customer transfer (or
cash hand-back) outside the system** — we only *record* it (CD-5). Fields: `payment_status = 'refunded'`,
`payments.refunded_at`, `payments.refund_reason`, and `orders.returned_reason` (for returns).

- **Cancel before payment:** merchant/bot sets `order_status = cancelled`, `cancelled_reason`. Payment
  untouched (`unpaid`/`cod_pending`) — nothing to refund, so `payment_status` is **not** set to `refunded`.
- **Cancel/return after a verified bank transfer:** money already in the merchant's account. Merchant
  transfers it back in their own bank app, then records it:
  ```
  payments.status         = 'refunded'
  payments.refunded_at    = now()
  payments.refund_reason  = <reason>          -- e.g. "out of stock", "customer returned item"
  orders.payment_status   = 'refunded'
  orders.status           = 'cancelled'  or  'returned'
  orders.returned_reason  = <reason>          -- when returned
  ```
- **Return of already-collected COD:** merchant hands cash back, then records the same `refunded` +
  `refunded_at`/`refund_reason`, sets `order_status = 'returned'`, `orders.returned_reason`.
- **Manual flow (portal).** A "Refund / mark returned" action on a `verified`/`cod_collected` order opens a
  reason prompt, writes the fields above, logs to `audit_log`/`order_status_history`, and (optionally)
  notifies the customer. There is **no** automated money movement — the portal copy reminds the merchant to
  actually send the money before recording it.

### A4.5 Duplicate claims
Customer sends **two** screenshots in quick succession (nervous re-send). Each screenshot inserts its own
`payment_claims` row (full history is preserved — CD-4), and the single `payments` pointer keeps the
**latest** `screenshot_url` (path) + `claimed_at`; it stays `claimed` (idempotent while already `claimed`).
Only **one** `payment_claim` notification per transition into `claimed` is fired (debounce): if already
`claimed` and unread, update the existing notification rather than spamming. (A genuine retry *after a
reject* — `failed → claimed` — does fire a fresh notification, since it is a new transition.)

---

## A5. Amounts (all in paisa)

- Every money field is **integer paisa** (doc 02). Display converts `paisa/100` with `Rs.` and grouping.
- **Invariant at claim time:** `payments.amount == orders.total`. We re-assert this when writing the
  `claimed` transition (§A2.4). If a race changed the total, we re-snapshot to the current `orders.total`.
- **Order edited after claim:** if a merchant edits the order (adds item, changes discount/delivery) while
  `payment_status = claimed`, `orders.total` changes and no longer matches `payments.amount`/what the
  customer actually paid. `orders.payment_locked = true` (set at claim/verify/cod_collected — CD-5) guards
  this: edits on a locked order are **blocked/warned** in the portal and require an explicit "re-request
  payment" confirmation. Confirming invalidates the live claim → the current `payment_claims` row is left
  as history, the `payments` pointer goes back to `unpaid` (a deliberate re-request, distinct from the
  `failed` reject state), `payment_locked` clears, and the bot re-sends the new amount + asks for a fresh
  screenshot (which enters `claimed` via a new `payment_claims` row).

---

## A6. Payment edge cases (behaviour defined)

| Edge | Behaviour |
|---|---|
| Customer types "paid ho gaya" but **no screenshot** | Bot stays in `awaiting_payment_proof`, replies: *"Please payment ka screenshot bhej dein taake hum verify kar sakein. Bank details phir se: {…}"* (re-shows account). Does **not** set `claimed`. |
| Customer sends screenshot **before choosing a bank / method** | If `payment_method = unset`: bot says *"Pehle payment method chunein — Bank ya COD?"* and re-prompts §A1.1. We still store the image under the order path (the `order_id` already exists — CD-15) but do **not** insert a `payment_claims` row / set `claimed` until a `bank_transfer` method + account exist. |
| Customer pays **wrong account** (not the shown `bank_account`) | System can't detect this (no bank API). Merchant simply won't see the money in the shown account → **Reject** with reason "yeh account meri details se match nahi karta / paisa nahi aaya"; bot re-shows correct details. |
| **COD order → customer later wants to prepay** by bank | Allowed: bot/merchant switches `payment_method = bank_transfer`, `payment_status = unpaid` (from `cod_pending`), and re-runs §A2 (show account, ask screenshot). The order is already `confirmed`, so it moves `confirmed → awaiting_payment`; on verify → `paid`. Fulfilment path otherwise unaffected. |
| **24h window expires** while awaiting proof | Free-form re-prompts are impossible outside the window. **At launch we do NOT proactively chase** (deferred, [00-overview](00-overview.md) out-of-scope). Defined behaviour: the order sits in `awaiting_payment` / `unpaid`; when the customer next messages (any inbound reopens the window) the bot resumes and re-shows details. **Proactive re-engagement would require an approved utility template** (e.g. `payment_reminder`) — flagged but deferred; see [04-whatsapp-integration](04-whatsapp-integration.md). Merchant can also nudge manually via takeover + template. |
| Customer sends screenshot **after already verified** | Bot replies *"Aap ki payment pehle hi confirm ho chuki hai ✅ — koi aur cheez chahiye?"*; no state change. |
| Screenshot arrives while conversation is in **`human_takeover`** | Bot does not auto-process; message stored, merchant handles it manually (they can still verify/reject via portal). |

---

## A7. Security / compliance recap

- **No funds custody, no gateway, no card data — ever.** We only *show* the merchant's own bank details
  and *store* a customer screenshot; money moves customer↔merchant directly. (SBP/EMI-safe — doc 00 §2.)
- **Storing the merchant's OWN `bank_accounts` is fine** — it's the merchant's own data, shown to their
  own customers. Access is RLS-scoped to the merchant.
- **Screenshots are private.** Bucket `payment-screenshots/` is private. We store only the storage **path**
  (never a signed URL) on `payments`/`payment_claims`/notifications (CD-40). The portal mints a
  **short-lived, single-use signed URL on demand** at view time, after a role/RLS check (**staff cannot**
  verify/reject — CD-37), using **one** short TTL value (a single canonical value, e.g. a few minutes — see
  doc 09; do not spread multiple TTLs across the codebase). RLS + storage policies scope to `merchant_id`.
  Never public, never indexed.
- **PII handling.** Screenshots may contain the customer's own account number / name. Treat as sensitive
  PII: signed-URL-only, retention policy, deletable on request. Full PII/retention rules in
  [09-nonfunctional-devops](09-nonfunctional-devops.md).
- **No automated trust.** Verification is a deliberate human action, logged with `verified_by_user_id` +
  `audit_log` — an accountability trail, not an algorithm.

---

# PART B — NOTIFICATIONS

## B0. Canonical table (from doc 02, verbatim)

**`notifications`**
- `id, merchant_id, user_id (null), type, title, body, data (jsonb — **no signed URLs**; store orderId/paymentId only, CD-40), channel, read_at (null), created_at`
- `type` enum: `new_order, payment_claim, takeover_request, bot_needs_help, low_stock, template_status, system`
- `channel` enum: `portal, whatsapp, email`

Design: **one row per (notification, channel, recipient)**. A single event (e.g. a new order) may fan out
into several rows — one `portal` row per targeted user for realtime + read-state, plus optionally one
`whatsapp` row and/or one `email` row. `read_at` is **per-row per-user** (per-user read state, §B4).

---

## B1. Notification types — trigger, audience, channel, payload, response

Audience roles use `merchant_users.role`: `owner, manager, staff` (doc 02). "Portal" = in-app realtime
via Supabase Realtime (doc 01 §Realtime). Default channels can be overridden by preferences (§B4).

### B1.1 `new_order`
- **Trigger:** the buyer's explicit final confirm — `pending_confirmation → confirmed` — for **both** COD
  and bank transfer (CD-15/16). This is where `order_number`, `placed_at`, slip and stock-decrement happen.
  (Bank transfer then proceeds `confirmed → awaiting_payment`; `new_order` is NOT re-fired at `paid`.)
- **Audience:** `owner` + `manager` (staff optional per prefs).
- **Channel:** `portal` (always); `whatsapp` + `email` optional.
- **Merchant does:** opens the order, starts fulfilment (preparing → dispatch).
- **Payload:**
```json
{
  "type": "new_order",
  "title": "New order SK-1042 — Rs. 5,000",
  "body": "COD order from Ali (0300-1234567), 2 items. Deliver to Gulshan, Karachi.",
  "data": {
    "orderId": "…", "orderNumber": "SK-1042", "customerId": "…",
    "customerName": "Ali", "customerWaId": "923001234567",
    "totalPaisa": 500000, "paymentMethod": "cod", "paymentStatus": "cod_pending",
    "itemCount": 2, "deliveryCity": "Karachi"
  }
}
```

### B1.2 `payment_claim`
- **Trigger:** bank-transfer `payment_status` transitions to `claimed` (screenshot received, §A2.4) —
  including the retry transition `failed → claimed`.
- **Audience:** `owner` + `manager` (whoever can verify — **staff cannot**, CD-37).
- **Channel:** `portal` (always); `whatsapp` + `email` optional. **Highest operational priority** — the
  customer is waiting.
- **Merchant does:** open order, view screenshot (portal mints an on-demand single-use signed URL after a
  role/RLS check — CD-40), check bank app, **Verify** or **Reject**.
- **Payload (CD-40 — NO signed URL; store ids only, portal mints the URL at view time):**
```json
{
  "type": "payment_claim",
  "title": "Payment claimed — SK-1042 (Rs. 5,000)",
  "body": "Ali sent a bank-transfer screenshot. Verify against HBL •••4321.",
  "data": {
    "orderId": "…", "orderNumber": "SK-1042", "paymentId": "…", "paymentClaimId": "…",
    "amountPaisa": 500000, "bankAccountId": "…", "bankName": "HBL",
    "accountLast4": "4321", "claimedAt": "2026-07-01T10:22:00Z"
  }
}
```
> The screenshot is reachable only by opening the order/claim in the portal, which mints a short-lived,
> single-use signed URL server-side after checking the caller's role/RLS. The signed URL is **never** put
> in `notifications.data`, WhatsApp, or email.

### B1.3 `takeover_request`
- **Trigger:** the bot or a rule requests a human — e.g. customer explicitly asks for a human ("insaan se
  baat karni hai"), angry sentiment, or a keyword. (Bot-flow FSM → `handoff`, see [05-bot-flows](05-bot-flows.md).)
- **Audience:** `owner` + `manager` + on-shift `staff`.
- **Channel:** `portal` (always); `whatsapp` optional.
- **Merchant does:** opens the inbox conversation, sets `conversation.status = human_takeover`
  (`assigned_user_id`), replies as a human.
- **Payload:**
```json
{
  "type": "takeover_request",
  "title": "Takeover requested — Ali",
  "body": "Customer asked to talk to a person.",
  "data": { "conversationId": "…", "customerId": "…", "customerName": "Ali",
            "reason": "customer_requested_human", "lastMessage": "insaan se baat karni hai" }
}
```

### B1.4 `bot_needs_help`
- **Trigger:** the bot is stuck / low-confidence — can't understand after N tries, negotiation dead-ended,
  a product/policy question it can't answer, an internal error mid-conversation.
- **Audience:** `owner` + `manager` + `staff`.
- **Channel:** `portal` (always); `whatsapp` optional.
- **Merchant does:** review conversation, take over or add a `bot_knowledge` entry so the bot handles it next time.
- **Payload:**
```json
{
  "type": "bot_needs_help",
  "title": "Bot stuck — Ali",
  "body": "Couldn't answer after 3 attempts: question about warranty.",
  "data": { "conversationId": "…", "customerId": "…", "reason": "low_confidence",
            "attempts": 3, "lastMessage": "warranty kitne saal ki hai?" }
}
```

### B1.5 `low_stock`
- **Trigger:** a tracked product (`track_stock = true`) `stock` falls at/below a threshold (or hits 0)
  after an order decrements it.
- **Audience:** `owner` + `manager`.
- **Channel:** `portal` (always); `email` optional (digest-friendly).
- **Merchant does:** restock / mark inactive / adjust `stock`.
- **Payload:**
```json
{
  "type": "low_stock",
  "title": "Low stock — Blue Kurta (M)",
  "body": "Only 2 left. Restock soon.",
  "data": { "productId": "…", "productName": "Blue Kurta (M)", "sku": "KRT-BLU-M",
            "stock": 2, "threshold": 3 }
}
```

### B1.6 `template_status`
- **Trigger:** a `message_templates.status` change from Meta — `approved`, `rejected`, `paused`,
  `disabled` (webhook from Meta, see [04-whatsapp-integration](04-whatsapp-integration.md)).
- **Audience:** `owner` + `manager`.
- **Channel:** `portal` (always); `email` optional. **Operationally important** — a paused/rejected
  template can break outside-window messaging.
- **Merchant does:** edit & resubmit rejected template; understand why a paused template can't send.
- **Payload:**
```json
{
  "type": "template_status",
  "title": "Template rejected — payment_reminder",
  "body": "Meta rejected 'payment_reminder': PROMOTIONAL content in utility category.",
  "data": { "templateId": "…", "templateName": "payment_reminder", "newStatus": "rejected",
            "category": "utility", "rejectionReason": "…" }
}
```

### B1.7 `system`
- **Trigger:** platform/operational events not covered above — e.g. WhatsApp number quality dropped or
  `flagged`, send failures, bank-transfer chosen but **no active bank account** (§A2.1), billing/plan
  notices, degraded service.
- **Audience:** `owner` (primary); `manager` optional.
- **Channel:** `portal` (always); `email` recommended for account-level issues; `whatsapp` optional for urgent.
- **Merchant does:** varies — fix config, add a bank account, address number quality (see §B3, doc 04).
- **Payload:**
```json
{
  "type": "system",
  "title": "Number quality dropped to RED",
  "body": "Your WhatsApp number quality is RED. Reduce spammy sends to avoid a ban.",
  "data": { "kind": "number_quality", "whatsappNumberId": "…", "qualityRating": "red" }
}
```

---

## B2. Delivery mechanics

### B2.1 In-portal realtime (primary, always on)
- Every notification writes a `notifications` row with `channel = portal` for each targeted user.
- **Supabase Realtime** (doc 01 §Realtime) pushes inserts to open portal tabs → toast + bell badge +
  the relevant list (orders/inbox) updates live.
- Unread count = `count(notifications where user_id = me and channel='portal' and read_at is null)`.

### B2.2 Optional WhatsApp-to-merchant (merchant's own number)
- If enabled in prefs, we send a WhatsApp message to the **merchant's own** contact number (`merchants.phone`
  or a nominated number) summarising the event with a portal deep link.
- **Constraint (call-out):** this is us messaging the merchant, and the merchant→platform conversation has
  its own 24h window. If we're **outside** that window we can only send an **approved template** (utility),
  not free-form — exactly like customer messaging (doc 04).
- **Channel status (CD-32).** Merchant-WhatsApp alerts are backed by the utility templates
  **`merchant_new_order`** and **`merchant_payment_claim`**, added to the launch template set in doc 04
  (see doc 02 `message_templates` launch set). With those templates approved, the channel can send
  outside-window; inside a fresh window it may send free-form. **If either template is not yet approved,
  its alert type falls back to portal/email only** (that WhatsApp alert is deferred until approval).
- Writes a `notifications` row with `channel = whatsapp`.

### B2.3 Email (provider = Resend; CD-32)
- Transactional email via **Resend** (env-configured; see doc 09) with the same title/body + portal deep
  link. Optional per type/prefs.
- Good for `low_stock` digests, `template_status`, and account-level `system` events where realtime might
  be missed (merchant not in portal). Writes a `notifications` row with `channel = email`.
- Email **never** contains a screenshot or a signed URL — only ids + a deep link into the portal (CD-40).
- **Launch note.** Portal realtime is the primary channel and is always on; if Resend is not configured at
  go-live, email is treated as **deferred** and only `portal` (+ optional WhatsApp) rows are written.

### B2.4 Fan-out summary
```
event ──▶ Notification Service
            ├─ resolve audience (roles + prefs)  ──▶ N × portal rows  ─▶ Supabase Realtime ─▶ portal
            ├─ if pref.whatsapp                    ──▶ 1 × whatsapp row ─▶ WA Sender (utility template if >24h)
            └─ if pref.email                       ──▶ 1 × email row    ─▶ Resend
```

> **Opt-out / STOP (CD-8, CD-42).** All of the above concern **merchant-facing** alerts. For any
> **business-initiated send to a buyer** (e.g. payment-confirmed template, a future `payment_reminder`),
> the composer/sender MUST first check the buyer's `customers.wa_opt_in_status`: a `STOP`/opt-out
> (`wa_opt_in_status = 'out'`) **suppresses** business-initiated sends to that buyer. Free-form replies
> inside an open 24h window that the buyer themselves reopened are still allowed; proactive/template sends
> are gated by opt-in.

---

## B3. Merchant-facing operational alerts (cross-ref doc 04)

These map onto `template_status` and `system` types:

| Issue | Type | Notes |
|---|---|---|
| Template **rejected / paused / disabled** | `template_status` | From Meta webhook. Merchant must resubmit; while paused, outside-window sends for that template fail. |
| **Number quality dropped** (yellow/red) or **flagged** | `system` (`kind: number_quality`) | Warn before a ban; advise reducing spammy sends. Ties to `whatsapp_numbers.quality_rating` / `status`. |
| **Send failures** (message `status = failed`, repeated) | `system` (`kind: send_failure`) | e.g. token expired, recipient blocked, template mismatch. Include `error`. |
| **No active bank account** but bank transfer needed | `system` (`kind: no_bank_account`) | From §A2.1. |
| **Messaging tier / rate limits** hit | `system` (`kind: rate_limit`) | Advisory. |

All operational-alert semantics and thresholds are owned by [04-whatsapp-integration](04-whatsapp-integration.md);
this doc only defines how they surface as notifications.

---

## B4. Preferences & read state

### B4.1 Preferences (mute / configure)
- Stored in `merchant_users` (per-user) and/or `merchants.settings` (tenant default). Shape (proposed):
```json
{
  "notificationPrefs": {
    "new_order":       { "portal": true,  "whatsapp": true,  "email": false },
    "payment_claim":   { "portal": true,  "whatsapp": true,  "email": false },
    "takeover_request":{ "portal": true,  "whatsapp": false, "email": false },
    "bot_needs_help":  { "portal": true,  "whatsapp": false, "email": false },
    "low_stock":       { "portal": true,  "whatsapp": false, "email": true  },
    "template_status": { "portal": true,  "whatsapp": false, "email": true  },
    "system":          { "portal": true,  "whatsapp": false, "email": true  },
    "quietHours":      { "enabled": false, "start": "22:00", "end": "08:00", "tz": "Asia/Karachi" }
  }
}
```
- Portal `portal` channel is effectively always-on (can't lose the audit trail) but the **toast/badge** can
  be muted per type. `whatsapp`/`email` are opt-in. Quiet hours suppress non-portal channels (portal still
  records; realtime still delivers silently).
- Managed on the **Settings → Notifications** portal screen (see [07-admin-portal-screens](07-admin-portal-screens.md)).
- **Storage (resolved, CD-13/CD-14).** Per-user prefs live in `merchant_users.notification_prefs jsonb`;
  the tenant default lives in `merchants.settings.notificationPrefs` (canonical `NotificationPrefs` shape,
  doc 02). Resolution: per-user override → tenant default → built-in defaults above.

### B4.2 Per-user read state
- `notifications.read_at` is per-row. Because each targeted user gets their own `portal` row, read state is
  naturally per-user. Marking read: `PATCH /api/v1/notifications/:id/read` (see [03-backend-api](03-backend-api.md));
  "mark all read" bulk endpoint sets `read_at = now()` for the caller's unread portal rows.
- Bell badge = unread portal rows for the current `user_id`.

---

## B5. Example merchant-facing messages (English)

- Portal toast (payment_claim): **"💰 Payment claimed on SK-1042 (Rs. 5,000) — tap to verify."**
- WhatsApp-to-merchant (utility template `merchant_payment_claim`, outside window):
  *"Sahulatkaar: New payment claim on order {{1}} for Rs. {{2}}. Open the portal to verify: {{3}}"*
- Email subject (template_status): **"Action needed: WhatsApp template 'payment_reminder' was rejected"**

---

## Cross-references
- [00-overview](00-overview.md) — money principle, scope.
- [01-architecture](01-architecture.md) — Payment Service, Realtime, verify-payment request flow.
- [02-data-model](02-data-model.md) — `orders`, `payments`, `bank_accounts`, `notifications`, enums, buckets.
- [03-backend-api](03-backend-api.md) — payment verify/reject + notification endpoints.
- [04-whatsapp-integration](04-whatsapp-integration.md) — media download, 24h window, templates, number quality.
- [05-bot-flows](05-bot-flows.md) — `selecting_payment` / `awaiting_payment_proof` / `handoff` states.
- [09-nonfunctional-devops](09-nonfunctional-devops.md) — PII/retention, storage security, compliance recap.

---

## Audit resolutions (doc 10) — status of prior gaps
1. **`cod_collected_at` / `cod_collected_by_user_id`** — added to `payments` (CD-5); COD collection no longer overloads `verified_at` (§A3.2). ✅ Resolved.
2. **Delivered vs cash-collected** — now two separate actions (mark delivered, then mark cash collected) (§A3.2, CD-17). ✅ Resolved.
3. **Refund modelling** — `payment_status='refunded'` + `payments.refunded_at`/`refund_reason` + `orders.returned_reason` (CD-5); manual refund/return flow (§A4.4). ✅ Resolved.
4. **Claim history** — `payment_claims` child table (CD-4); `payments` is the latest pointer (§A2.4, §A4.5). ✅ Resolved.
5. **Bank confirm-then-pay ordering** — corrected; state stays `awaiting_payment_proof`, `failed` is a resting state with a `failed→claimed` retry edge (CD-16/18) (§A1.2, §A2, diagram §A2.6). ✅ Resolved.
6. **Order timing** — `orders` row materialized at `collecting_delivery`, so `order_id` exists before payment (CD-15) (A0, §A1). ✅ Resolved.
7. **Edit guard** — `orders.payment_locked` blocks/warns edits on claimed/verified/cod_collected orders (CD-5) (§A5). ✅ Resolved.
8. **Screenshot URL hygiene** — notifications store `orderId`/`paymentId`/`paymentClaimId` only; portal mints on-demand single-use signed URLs; one short TTL (CD-40) (§A2.3, §A7, §B1.2). ✅ Resolved.
9. **`notification_prefs` storage** — `merchant_users.notification_prefs` + `merchants.settings.notificationPrefs` (CD-13/14) (§B4.1). ✅ Resolved.
10. **Channels** — Email = Resend (else deferred; portal realtime primary); merchant-WhatsApp backed by `merchant_new_order`/`merchant_payment_claim` utility templates (else deferred) (CD-32) (§B2). ✅ Resolved.
11. **Opt-out** — STOP/`wa_opt_in_status='out'` suppresses business-initiated sends (CD-8/42) (§B2.4). ✅ Resolved.

**Still deferred (intentional, not gaps):**
- **No partial-payment support** — single `payments` row/amount; partials are Reject-and-retry (§A4.3).
- **Proactive payment re-engagement** — needs an approved `payment_reminder` utility template; deferred at launch (§A6).
