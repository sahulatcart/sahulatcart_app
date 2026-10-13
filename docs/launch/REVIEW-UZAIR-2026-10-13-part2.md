# Review of Stream P work, part 2: P4 and P5 (13 October 2026, evening)

From Fazal (lead). Covers PR #28 (P4, order stages and unpaid-order expiry) and PR #29 (P5,
opt-out, STOP, small gaps), both merged. Mechanical checks on `main` after both: typecheck clean
(backend and admin), **34 test files / 384 tests pass**, Railway build and deploy SUCCESS for both
services. Migrations **0015 and 0016 are applied** and verified. Both PRs are solid work; the items
below are the gaps, with severity: **should-fix** goes in the next PR, **nit** whenever convenient,
**decision** needs a one-line answer from me (given inline).

## Already fixed by me (merged separately, nothing to do)

| What | Where | Fix branch |
|---|---|---|
| **"band karo" mid-checkout stranded the order.** It is both a stop word and a cancel word; the stop check runs first, so after P5 a buyer leaving at the screenshot step was opted out while the bank order stayed placed with its stock held, and the merchant was not told. | `orchestrator.ts` `optOut()` vs `handleEscape()` | `fix/opt-out-cancels-pending-order`: shared `cancelPending()`; the goodbye now says "'start' likh dein". |

## P5 (PR #29): follow-up PR

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | should-fix (high) | `routes/admin.ts:408, :428` (imports), `:380` (PATCH), `:299/:320/:336` (images, describe); `orchestrator.ts:263`, `:783`; `lib/readiness.ts:46` | **Ghost products.** A deleted product re-imported by SKU (or PATCHed to `is_active:true`) comes back for the bot (which filters `is_active` only) but stays hidden in the portal (`deleted_at` set), and GET/DELETE return 404: the merchant can neither see nor remove what the bot is selling. Also, a deleted row keeps its SKU, so recreating that SKU fails with a raw "duplicate key". | Add `.is('deleted_at', null)` to the bot's catalog and upsell queries and to readiness; make both import paths and PATCH skip or explicitly restore deleted rows (decide with P8.6); filter the image/describe routes so they 404; clear or suffix the SKU on delete. |
| 2 | should-fix | `orchestrator.ts:207-212` | The `start` welcome is sent before the suspension, bot-off and takeover checks: a suspended shop, a shop whose bot is off, or a merchant mid-takeover greets an opted-out buyer who types "start", and it overwrites `current_state`. | Keep the re-opt write at the top; send the welcome only after those three checks. Add a flow test: suspended shop receives "start". |
| 3 | should-fix | `orchestrator.ts:298` | STOP is not recorded while the bot is silent for another reason (takeover/`handoff` state, suspended, bot off). Once the bot is back, it talks to that buyer again. | Record the opt-out at the top of the turn without replying when `STOP_RE` matches; goodbye only on the normal path. Add `handoff` to the state table. |
| 4 | should-fix | `whatsapp/webhook.ts:158-171` | Voice-note transcription (an AI call, counted against the cap) runs before the opt-out/blocked guard, so a blocked buyer spamming voice notes burns the shop's AI budget. | Move transcription after `upsertCustomer`, select `is_blocked`, skip for blocked/opted-out. |
| 5 | should-fix (pilot safety) | `llm/gemini.ts:116`, `orchestrator.ts:338` | The classifier's `stop` intent now silences a buyer permanently; it has one example, so a misclassification is costly. (Checked live: no customer is `out` today, so nothing to undo.) | Add negative examples to the prompt; consider requiring the keyword for permanent opt-out and only a goodbye for the intent. |
| 6 | decision | `payment-service.ts:93, :149`, inbox send | Order notices and manual sends ignore `out` and `is_blocked`. **My call:** transactional notices to an opted-out buyer are fine; skip automatic notices to a **blocked** buyer and warn on manual send. | As stated. |
| 7 | nit | `routes/admin.ts:22-25` | `startOfTodayUtc` still exists; the CHANGELOG says it is gone. | Delete it. |
| 8 | nit | `lib/hours.ts:21-22` | The new day helper landed between `dayInKarachi`'s JSDoc and its function, and duplicates `karachiDate()` in `lib/usage.ts`. | Reuse `karachiDate()`. |
| 9 | nit | `routes/customers.ts`, `routes/catalog.ts` | No `audit_log` row for block/unblock/delete. | Add one with `memberId`. |
| 10 | nit | `catalog/page.tsx:105`, `inbox/page.tsx:105,112` | `<Trash2 />` without `aria-hidden`; the inbox hint is `nowrap` and repeats itself, overflowing at phone width; "Blocked, nobody replies" is wrong (the merchant still can); Block shown to staff who get a 403. | As listed. |
| 11 | nit (tests) | flow tests | Missing: `shuru`; blocked buyer sending "start" stays silent; "start" on a suspended/bot-off shop; STOP in the `handoff` state. | Add them. |

**Done well:** the guard sits at the top of the turn and its silent path never reaches the classifier, the AI meter, the quota handoff or the suspension path, and the test proves it by counting classifier calls; `STOP_RE` is whole-message with "order band karo" tested as a cancel; opt-in capture never flips an `out` back; soft-delete is scoped, 404s cross-tenant, and is tested through the real server; new route files follow Part 0.3.

## P4 (PR #28): follow-up PR

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | should-fix | `payment-service.ts:220, :243`; `orders/[id]/page.tsx:163`; `noticeParams()` | Cancelling a **paid** or dispatched order calls `notifyBuyer` with the default `payment_update`; with the window closed that sets a pending notice, and the order page offers "Send for about Rs 4" which would tell the buyer of a cancelled order "verify ho gayi hai, jald deliver karenge". | In `cancelOrder` pass `fallback: 'none'` and clear `pending_buyer_notice`; make `notifyBuyerNow` 409 when status is cancelled/returned. |
| 2 | should-fix | `lib/jobs.ts:36-63` | The expiry loop has no per-order try/catch: a thrown send (fetch rejection, token lookup) after the UPDATE leaves the chat in `awaiting_payment_proof` for a cancelled order and stops every remaining order for an hour. A later screenshot then becomes a claim on a cancelled order that sits in "Payments to verify" forever. | Per-order try/catch with logging; run `setCheckoutState` before `notifyBuyer`; make the claim UPDATE in `handlePaymentProof` conditional on `status='awaiting_payment'`. |
| 3 | should-fix | `jobs.ts:39, :45` | A failed merchants read falls back to 24h (a 72h shop gets cancelled early on a transient error); a failed claims read is treated as "no claim". | Skip that merchant/order for the run when `.error` is set. |
| 4 | should-fix | `jobs.ts:55-59`; `payment-service.ts:239` | `release_stock` errors inside `Promise.all` are silent: order cancelled, stock still held, product shows sold out for good. | Check the RPC `.error`, log, `notify()` the merchant. |
| 5 | decision | `jobs.ts:60` | The job messages buyers of **suspended** shops. **My call:** their orders still expire (stock back) but no buyer message. | Select `status`; `fallback 'none'` when suspended. |
| 6 | should-fix | `orders/[id]/page.tsx:66,170` | Cancel button shown to staff, who get a 403. | Hide for staff (`me.role`). |
| 7 | should-fix | `payment-service.ts:222-231`; the confirm dialog; analytics "collected" | 409 text and comment are stale; the dialog and buyer text don't mention a refund for a paid order (invariant 2: the shop refunds, we never touch money); cancelled paid orders still count as collected revenue. | Update copy; refund line when `payment_status='verified'`; exclude cancelled/returned from "collected". |
| 8 | decision | `payment-service.ts:220/240` | Cancelling a **dispatched** order puts in-transit stock back on sale. **My call:** keep `dispatched` out of `CANCELLABLE`; use `returned` later. | As stated. |
| 9 | decision | job filter | Orders whose screenshot was **rejected** (`payment_status='failed'`) never expire and hold stock forever (spec gap). **My call:** also expire `failed` with no `claimed` claim. | As stated. |
| 10 | decision | job timing | At the default 24h the buyer is practically never told (their window closes at ~24h, the job runs at 24–25h), and a buyer who pays at hour 26 sends a screenshot into a reset chat. **My call:** a free-form reminder at about hours−4 while the window is open (orchestrator change → coordinate under IC-8), and at minimum make the claim UPDATE conditional on `status='awaiting_payment'` (same as #2). | As stated. |
| 11 | should-fix | `payment-service.ts:107-110`; `markDispatched` | A successful free message does not clear `pending_buyer_notice`, so a stale paid "payment verified" button stays on the page after the dispatch line went out free. | Have `notifyBuyer` return whether it sent; clear the notice on success. |
| 12 | should-fix (tests) | `order-stages.test.ts:276`, `routes/orders.test.ts:624`, `jobs.test.ts:50` | Cancel is not in the transition matrix (every status → cancel); no spy proving `sendTemplate` is never called on a closed-window dispatch; 72h never exercised; no `invalidSettingsField` cases for 5/73/12.5/'24'; no "one failing order doesn't stop the others" (would have caught #2); the claim fixture uses `status:'pending'`, which is not a `claim_status`. | Add them; use `'claimed'`. |
| 13 | nit | `order-stages.ts:27-32` | `currentStatus()` reads before `transition()`, so the history `from` can be stale. | Pass `from: [expected]` to `transition()` as `cancelOrder` does. |
| 14 | nit | `jobs.ts` queries | One merchants query per merchant and one claims query per order; batch with `.in()`; add a partial index on `orders(placed_at) where status='awaiting_payment' and payment_status='unpaid'` when needed. | Fine at pilot scale. |
| 15 | nit | stepper, history, filters | `awaiting_payment` shows "Confirmed" as current; `delivered` shows "now" not done; no `aria-current="step"`; history shows raw `changed_by`; the stage filter has no `returned`; stat cards don't link to a filtered list; the expiry-hours setting is editable by staff who get 403. | As listed. |

**Done well:** every stage change reuses `transition()` as one conditional UPDATE (double-click → 409, tested); 404 vs 409 and tenant scoping right with a cross-tenant test; courier/tracking/ETA clipped server-side; `fallback: 'none'` is a tidy way to keep the job from nagging or charging; the expiry UPDATE matches both status columns so it is idempotent; the job is production-only and caches each merchant's hours per run; the dispatch line goes through `sendText` so it is metered, and `sendTemplate` is never called (IC-2 as amended); the UI follows the house rules; the CHANGELOG records the clock-injection pitfall honestly. Checked on live after the deploy: the boot-time run cancelled nothing.

## Order

1. Lead merges `fix/opt-out-cancels-pending-order`.
2. You open `fix/p5-followups` (items 1–5 above first) and `fix/p4-followups` (items 1–4, 6, 7, 11, 12 first; decisions 5, 8, 9, 10 as stated).
3. The earlier P1/P2 follow-ups (previous review document) are still open: the pilot's attestation back-fill first.
4. P6 (reliability) and P7 (billing) after that; P8 (bot fixes) merges after the P5 follow-ups (IC-8).
