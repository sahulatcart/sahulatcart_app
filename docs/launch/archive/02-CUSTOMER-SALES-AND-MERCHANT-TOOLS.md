# 2. Customer sales and merchant tools

[Back to the roadmap](README.md) · [Previous: onboarding](01-MERCHANT-ONBOARDING-AND-META.md) · [Next: security and operations](03-SECURITY-RELIABILITY-AND-OPERATIONS.md)

**Goal:** a buyer can ask questions, select the right product, agree on a permitted price, confirm delivery/payment details and place one correct order. The owner sees what happened and handles only the decisions that belong to them.

**Current position:** substantial code exists for the catalog, Gemini conversation engine, guarded negotiation, delivery collection, COD, bank-transfer screenshots, order slips, payment actions, inbox and notifications. These tasks complete missing behavior and prove the existing behavior under real use. They do not call for rebuilding every screen.

## Catalog, shop facts and customer conversation

### SALE-01 — Establish a reliable catalog and stock source

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** D04/05 and AUTH-05.

- [ ] Define required product data: SKU/name, sellable description, PKR price, stock-tracking setting, images, active status and discount controls.
- [ ] Ensure size/color options correspond to actual orderable SKUs. Descriptive attributes alone must not imply independent variant stock.
- [ ] If using one product row per variant initially, make the customer selection and owner naming unambiguous; document that limitation.
- [ ] Distinguish zero stock, unknown stock, unlimited/untracked stock and inactive products. The bot must not turn one into another.
- [ ] Let the owner add/edit/archive products and adjust inventory safely; preserve historical order-line snapshots.
- [ ] Decide how outside sales update Sahulatcart's inventory. Do not market a one-time import as ongoing Shopify stock sync.

**Done when:** the bot cannot confirm an unavailable size/color; a product edited or archived today does not rewrite yesterday's order.

### SALE-02 — Make catalog imports usable and recoverable

**Owner:** Engineering. **Gate:** Pilot for any offered importer. **Depends on:** SALE-01, SEC-05.

- [ ] Provide a documented CSV template and realistic example covering SKU, stock, price and optional attributes.
- [ ] Validate data types, negative/invalid amounts, duplicate SKUs, required columns, oversized files and repeated imports.
- [ ] Preview changes before applying bulk edits and report row-specific errors.
- [ ] Do not overwrite owner-set price floors, stock or negotiation flags merely because optional columns are absent.
- [ ] Preserve a recoverable record of import changes and make partial failure visible.
- [ ] Test every advertised source: manual/CSV and existing Shopify export support; enable Meta catalog sync only after merchant-scoped authorization is implemented and demonstrated.

**Done when:** a real merchant imports their catalog, understands rejected rows and retries without duplicates or accidental pricing changes.

### SALE-03 — Complete the shop knowledge and response rules

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** AUTH-05 and SALE-01.

- [ ] Store merchant-provided delivery, hours, location, exchange/return policy, payment methods and frequently asked questions.
- [ ] Make updates available to subsequent replies, with a clear rule for already quoted orders.
- [ ] Answer only from the correct shop's catalog and policies; ask clarification or hand off when facts are missing.
- [ ] Avoid invented warranties, stock, delivery dates, discounts, refund promises or claims that a transfer was received.
- [ ] Identify the bot as the merchant's automated assistant in an appropriate introduction; make owner contact discoverable.
- [ ] Test contradictory and incomplete shop data so the bot does not select a convenient invented answer.

**Done when:** an unknown-policy question reliably produces clarification/escalation and never a fabricated business commitment.

### SALE-04 — Make delivery and local formatting correct

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** D08 and AUTH-05.

- [ ] Add a complete owner interface and authorized API for delivery zones, charges and unsupported areas. The current settings route reads zones; a complete editing flow must be verified/built.
- [ ] Define a safe fallback for an unmatched city/area instead of assuming free or supported delivery.
- [ ] Accept Pakistani phone formats such as 03xx and +92 through normalization; preserve international numbers only if intentionally supported.
- [ ] Capture name, reachable phone, city, area and useful address/landmark, and show them back before confirmation.
- [ ] Calculate in integer paisa, display PKR consistently and use Pakistan time for merchant-facing dates/reports.
- [ ] Show delivery cost and any disclosed taxes/fees in the final total; apply tax rules supplied for the business, not guessed by the AI.

**Done when:** supported and unsupported address examples produce the correct fee/next step; the buyer sees the complete amount before placing the order.

### SALE-05 — Evaluate the actual Pakistani conversation experience

**Owner:** Engineering + Founder + Pilot merchants. **Gate:** Pilot baseline, Public quality target. **Depends on:** SALE-01/03/04 and QA-03.

- [ ] Build a merchant-reviewed set of Roman Urdu, Urdu-script, English and code-switched messages, including spelling variants and short fragmented replies.
- [ ] Cover ambiguous product references, multiple items, quantity changes, bargaining, refusals, repeat customers and a second order in the same chat.
- [ ] Confirm the intended model/provider is implemented and configured. Today Gemini is implemented; choosing the Anthropic option throws an error.
- [ ] Bound model latency, input/output size and conversation history; summarize safely without changing agreed order facts.
- [ ] Validate existing voice transcription with real test recordings if advertised. Show a useful text-request fallback for unclear or unsupported audio/media.
- [ ] Avoid endless clarification loops; after a defined limit, create an owner task and tell the buyer what happens next.

**Done when:** the agreed evaluation set reaches the QA-03 target, with zero unsafe price, payment or order claims. Treat audio as unsupported in public copy until its tests pass.

### SALE-06 — Finish price and negotiation edge cases

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SALE-01, QA-02/03.

- [ ] Preserve deterministic list/floor/discount rules and the outbound price-match guard.
- [ ] Validate combinations of minimum price, discount percentage, cost and quantity, including non-negotiable items and values close to rounding boundaries.
- [ ] Prevent prompts, product descriptions and screenshots from exposing confidential floors or overriding code decisions.
- [ ] Define quote expiry and what happens if the owner changes price/stock before confirmation; request reconfirmation when the accepted offer is no longer valid.
- [ ] Test multiple line items, discounts on one item only, partial quantity changes and an already agreed price.
- [ ] Define the maximum negotiation/clarification rounds and a useful stop/handoff response.

**Done when:** every amount sent to a buyer and stored on an order agrees with the code-authorized calculation, including retries and malicious messages.

## Checkout, inventory and payments

### SALE-07 — Make checkout explicit and unambiguous

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** SALE-01/04/06.

- [ ] Present selected SKUs/variants, quantities, unit prices, discounts, delivery fee, complete total, address and chosen payment method.
- [ ] Require an explicit final confirmation; a general greeting or unrelated “yes” must not place an unintended order.
- [ ] Allow correction of item, quantity, address and payment method before placement.
- [ ] Recheck stock and current permitted pricing at confirmation.
- [ ] Use a stable checkout identity so duplicate messages, retries and refreshes resolve to the same placement.
- [ ] Keep draft carts separate from placed orders in dashboards and analytics.

**Done when:** the buyer's final summary matches every persisted order line/amount, and repeating confirmation cannot create another order.

### SALE-08 — Commit an order and its inventory consistently

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SALE-07, REL-02 and QA-02.

Current issue: order placement updates the draft first, then calls reserve_stock. A reservation RPC error is logged and the order can remain placed. That is not acceptable for tracked inventory at launch.

- [ ] Put final validation, order placement, stock movement and necessary related records inside a database transaction or an equally proven atomic design.
- [ ] If the database/stock operation fails, report a retryable checkout failure; do not confirm a sale with unknown stock.
- [ ] Serialize concurrent purchases of the last unit and lock inventory in a consistent order to avoid deadlocks.
- [ ] Keep order-number allocation unique per merchant; gaps in numbering are acceptable, duplicate orders are not.
- [ ] Commit notification/message jobs with the business transition so a crash cannot silently lose the confirmation.
- [ ] Preserve the correct order if WhatsApp sending fails after the database commit; retry the notification rather than recreate the order.

**Done when:** simultaneous last-item purchases yield only the available quantity, failed transactions leave no partial confirmed order, and a retried checkout never decrements twice.

### SALE-09 — Define reservation, expiry and restoration rules

**Owner:** Founder sets policy; Engineering implements. **Gate:** Pilot. **Depends on:** D05/06/07, SALE-08.

- [ ] Decide exactly when COD and bank-transfer orders reduce available stock; proposed baseline follows the user's request: once the order is placed.
- [ ] Define expiry of unpaid bank orders and abandoned drafts separately. Record the expiry timestamp and reason.
- [ ] Decide what happens when a screenshot is awaiting owner review at expiry; never silently cancel or release stock while claiming payment is being accepted.
- [ ] Handle a late transfer after expiry as an owner decision; do not recreate or fulfill it automatically without stock checks.
- [ ] Make stock restoration idempotent and auditable; retrying cancellation does not add stock repeatedly.
- [ ] For returned/failed-delivery goods, restore stock only when the owner confirms goods are actually saleable again.
- [ ] Record manual inventory adjustments with a reason and prevent lost updates between adjustments and checkout.

**Done when:** all expiry/cancel/late-payment races have defined outcomes and the stock ledger/reconciliation matches the resulting order states.

### SALE-10 — Complete COD behavior

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** SALE-07/08.

- [ ] Offer COD only where the merchant enables it and delivery is supported.
- [ ] Use explicit “payment due on delivery” language; a confirmed COD order is not collected revenue.
- [ ] Show COD amount and delivery details to the owner for fulfillment outside Sahulatcart.
- [ ] Keep an optional owner-recorded collected state separate from order confirmation and prevent repeated collection actions.
- [ ] Test buyer switching from an unpaid bank order to COD without a second order or stock deduction.

**Done when:** the buyer and owner see the same amount due and analytics never count uncollected COD as cash received.

### SALE-11 — Complete bank-payment evidence and decisions

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** SALE-07/08, META-10, SEC-05.

- [ ] Show the correct merchant-approved payment instructions and exact order amount through the approved payment-instruction design.
- [ ] Store payment evidence privately, attach it to the correct merchant/order and mark it as a claim, not proof that money arrived.
- [ ] Give the owner clear **Received** / **Not received** actions, the order total, evidence and decision history.
- [ ] Commit payment/order/claim/audit changes consistently; surface partial failures and do not show success if a required write failed.
- [ ] Handle repeated uploads, rejection then resubmission, two browser tabs and a simultaneous cancellation.
- [ ] Route partial, excess, unclear or duplicate transfers to the owner. No automatic screenshot-based approval or automated refund.
- [ ] Notify the buyer through the allowed message/template path and show actual send failures to the owner.

**Done when:** only an authorized owner can confirm payment; duplicate actions cannot create multiple decisions; the buyer's status agrees with the owner's recorded decision.

### SALE-12 — Make receipts and order records dependable

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SALE-08/10/11.

- [ ] Generate an order slip with shop identity, unique order reference, line items, discounts, delivery amount, total and accurate payment status.
- [ ] Keep personal delivery details limited to the intended merchant/buyer view.
- [ ] Test PDF generation for Urdu names and mixed script. A complete, readable text slip is an acceptable launch fallback if PDF rendering fails.
- [ ] Keep slips private with controlled links, and let the owner view/download or resend through an allowed messaging path.
- [ ] A slip/media upload failure must not roll back a correctly placed order or duplicate it on retry.

**Done when:** every placed order has a readable customer confirmation and a recoverable merchant record even if PDF generation is unavailable.

### SALE-13 — Complete cancellation and exception handling

**Owner:** Founder sets policy; Engineering implements. **Gate:** Pilot basic handling. **Depends on:** D07, SALE-09/11.

- [ ] Retain and test the cancellation action already present in code; define which order/payment states permit it.
- [ ] For buyer cancellation requests, confirm what can be cancelled automatically and what needs owner approval.
- [ ] Record reason, actor, time, stock action and customer-notification outcome.
- [ ] For paid, dispatched, returned or failed-delivery orders, provide an owner-owned exception route and record resolution.
- [ ] Do not promise or execute an automatic refund; keep any manual refund record separate from actually moving money.
- [ ] Protect the audit/history when an owner corrects an error. Never erase a sale merely to make totals look right.

**Done when:** a buyer is not trapped after asking to cancel, stock is restored only under the agreed policy, and exceptional orders remain visible to the owner.

### SALE-14 — Make owner takeover and bot pause reliable

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** AUTH-04, REL-02/03, META-10.

- [ ] Support per-conversation takeover and a whole-shop bot pause with obvious status in the inbox.
- [ ] Recheck takeover/pause immediately before sending a queued bot reply, not only at the beginning of AI processing.
- [ ] During takeover, save incoming messages without automatic selling; owner replies still obey authorization and message-window rules.
- [ ] On release, resume from actual saved order/conversation state instead of replaying stale offers.
- [ ] Provide a clear buyer escalation response and an owner notification; do not imply the owner is online if they are not.

**Done when:** racing takeover against a slow AI reply does not result in the bot contradicting the owner or placing an additional order.

### SALE-15 — Make failure and uncertainty safe for the buyer

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** REL-01 through REL-05.

- [ ] Handle model timeout, invalid model output, Meta failure, database unavailability, missing media and unsupported attachments with defined fallback states.
- [ ] Avoid telling the buyer an order is placed or payment is received until that business transition is committed.
- [ ] Preserve cart/order context through restarts and quota exhaustion.
- [ ] Prevent rapid error-reply loops and repeated notifications for the same incident.
- [ ] Give the owner an actionable summary: affected conversation/order, last successful step and safe next action.

**Done when:** failure drills leave an explainable state, correct money/stock records and a recoverable customer conversation.

### SALE-16 — Separate recorded orders from claimed sales impact

**Owner:** Engineering + Founder. **Gate:** Public. **Depends on:** SALE-08/10/11, BIZ-02.

- [ ] Define inquiries, qualified shopping conversations, placed orders, confirmed COD, verified bank payments, cancellations and collected revenue separately.
- [ ] Document the conversion denominator and avoid double-counting retries, test data or repeat messages.
- [ ] Show bot-assisted orders without asserting every one is a recovered sale that otherwise would have been lost.
- [ ] Compare pilot response/conversion outcomes with a recorded merchant baseline before making quantified marketing claims.

**Done when:** a sample of portal totals reconciles to individual orders and every public performance claim has evidence or is removed.

## Merchant portal completion

### PORTAL-01 — Finish daily owner work on mobile

**Owner:** Engineering + Pilot owners. **Gate:** Pilot for critical actions; Public for full advertised flow.

- [ ] Complete catalog, order detail, screenshot review, takeover, settings and onboarding on ordinary Android browsers and a narrow screen.
- [ ] Verify loading, empty, failed, expired-session and offline/reconnected states; preserve unsaved work where practical.
- [ ] Prevent double-submission, indicate saves and present actionable errors.
- [ ] Keep labels readable, controls touchable and keyboard/focus behavior usable; test Urdu/long names and long order values.

**Done when:** an owner completes critical tasks from a phone without zooming around a broken layout or asking an engineer to operate the portal.

### PORTAL-02 — Provide useful notifications

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** REL-03 and D11.

- [ ] Notify for new order, payment review, requested takeover, connection failure and unresolved processing failure.
- [ ] Choose at least one practical owner alert channel beyond an unopened dashboard if the pilot shows this is necessary; respect its delivery/consent requirements.
- [ ] Deduplicate alerts, link to the exact action and allow marking handled/read.
- [ ] Display alert delivery failures and avoid putting payment evidence or unnecessary customer details into notification previews.

**Done when:** a pilot owner notices a bank-payment claim and can open the right review screen promptly; repeated retries do not flood them.

### PORTAL-03 — Make lists, search and data export viable

**Owner:** Engineering. **Gate:** Public. **Depends on:** SEC-01/05.

- [ ] Add pagination and useful filters/search for orders, products and conversations; verify large catalogs and long histories.
- [ ] Export the merchant's own orders/catalog in a documented format with safe CSV handling.
- [ ] Keep operational states clear: payment status, order status, messaging status and connection status must not share an ambiguous “complete” label.
- [ ] Exclude tests/drafts from business totals and define Pakistan-day boundaries consistently.

**Done when:** merchants can find/export the correct records beyond the first page, with no cross-shop exposure.

### PORTAL-04 — Remove misleading or unfinished product affordances

**Owner:** Engineering + Founder. **Gate:** Public.

- [ ] Audit every visible button/link and marketing promise against a working implementation.
- [ ] Remove or explain unused staff-management language, non-working providers/integrations and unsupported sync claims.
- [ ] Show eligibility limits before a merchant invests time in setup.
- [ ] Keep the settings/help text aligned with owner responsibilities for payments, fulfillment and exceptional cases.

**Done when:** a walkthrough from the marketing site through a completed order encounters no dead action or unsupported promise.
