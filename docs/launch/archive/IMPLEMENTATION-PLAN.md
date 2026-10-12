# Sahulatcart — feature implementation plan

**Prepared: 6 October 2026. Status: proposed work; implementation has not started under this plan.**

This turns the [31-feature completion plan](FEATURE-PLAN.md) into a build sequence. Use this document for the work order and demonstrations; use the [engineering details](IMPLEMENTATION-DETAILS.md) for database, backend, frontend and test changes. The [full launch roadmap](README.md) remains the reference for business preparation and public-release requirements.

## 1. How we will deliver the product

Keep the existing Next.js portal, Fastify backend and Supabase database. Complete the existing features and add the missing merchant onboarding/WhatsApp capabilities. Build in small, reviewable changes, each demonstrating a useful result.

There are two tracks:

- **Product implementation:** Engineering builds and tests the work packages below. Most work can proceed before Tech Provider approval.
- **Meta access:** The founder progresses business/app requirements while Engineering prepares the integration and review demonstration. An implemented integration remains unverified for public use until the required access and real-merchant tests pass.

The first paid release adds subscriptions to the same core product. Merchant fulfillment and bank-payment decisions remain with the owner. Existing staff-role code is secured, but staff-management screens are outside this plan.

## 2. Work packages in delivery order

| Package | What we implement | Features | Depends on | Completion demonstration |
|---|---|---|---|---|
| W00 | Isolated development/integration tests and release checks | Foundation for all | Access to the chosen test environment | Tests cannot write to the live shop or message real buyers |
| W01 | Safe order placement, durable messages and shared security boundaries | F17, F27, F28 | W00 | Retries/restarts do not lose accepted messages, oversell or duplicate orders |
| W02 | Facebook login, automatic shop creation, account access and saved onboarding | F01–F04 | W00; W01 security boundary | New owner gets one shop; returning owner resumes the same setup |
| W03 | Merchant-owned WhatsApp connection, credentials, reconnect and readiness | F05–F08 | W01, W02 | A permitted test shop connects and exchanges messages using its own authorization |
| W04 | Catalog, SKU stock, delivery settings and shop knowledge | F09–F12 | W01, W02 | Owner configures a real shop without database edits |
| W05 | Local-language sales, guarded negotiation, checkout and handoff | F13–F16 | W01, W04 | Buyer selects products, agrees a valid price and confirms a complete order |
| W06 | COD, payment review, receipts, cancellations, expiry and exceptions | F17–F22 | W01, W05; W03 for real sends | COD and bank orders remain correct through decisions, retries and cancellations |
| W07 | Owner workspace, notifications, mobile completion and analytics | F23–F26 | W02, W04–W06 | Owner runs their daily workflow on a phone |
| W08 | Export/deletion, security completion and recovery validation | F27–F29 | Foundations in W01; final integration after W03–W07 | Two shops remain isolated; data requests and failure recovery work |
| W09 | Subscription lifecycle and usage visibility/limits | F30–F31 | Usage metering begins in W01; plan rules agreed | Owner sees their plan/allowance; renewal, cancellation and limits behave as disclosed |
| W10 | Real merchant acceptance and release | F01–F29; F30–F31 for paid | Required Meta access; W00–W08; W09 for paid | Representative merchants complete signup-to-order tests and the pilot gates pass |

W00 is preparation, not a new product feature. W10 proves the integrated release, not a replacement for testing each package. W09 does not block a clearly identified free pilot.

## 3. Package outcomes and implementation slices

### W00 — Safe working environment

1. Record the current deployed services, database/migration state and local code baseline using metadata that excludes secrets.
2. Provide an isolated Postgres/Supabase test setup, fake provider adapters and two merchant fixtures; configure a separate controlled environment for actual provider tests.
3. Add reliable checks for backend tests, real database behavior, shared/backend/admin type checks and both app builds.
4. Record how a tested version reaches staging and how it can be rolled back. Correct deployment watch paths before relying on automatic releases.

**Result:** development can proceed without using real merchant data or consuming live messaging/AI quota accidentally. No Meta approval needed for local/mocked work; actual provider tests use only permitted assets.

### W01 — Make the existing core safe

1. Introduce database-backed event/outgoing-message records and stable operation identities.
2. Make order placement, stock reduction and required payment/history records one consistent transaction. A failed stock operation must prevent confirmation.
3. Persist inbound events before acknowledging them; process them through durable claims with safe per-conversation concurrency.
4. Route outgoing messages through recoverable jobs; a send failure must not recreate the order or repeat a payment decision.
5. Enforce tenant/owner checks, protect private media, redact secrets and remove production dependence on the shared pilot admin token.

**Result:** the existing bot can safely resume work after a crash. Test last-unit purchases, duplicate confirmations, database failure and two-shop access attacks. Build/test locally now.

### W02 — Merchant identity and onboarding

1. Add Facebook sign-in and a callback flow using the existing Supabase Auth integration.
2. Add a signed-in-user provisioning endpoint that works before merchant membership exists; create the shop and owner membership atomically and idempotently.
3. Create new shops with automation disabled; preserve existing accounts during migration.
4. Load/save onboarding progress from the server instead of starting every visit from blank/default form values.
5. Complete returning access, logout, safe existing-account linking, verified recovery and disabled-account behavior.

**Result:** a first-time owner reaches their own setup screen; a returning owner reaches the same shop. Code and allowed test-user validation proceed now; general-public Facebook access remains a provider configuration/access check.

### W03 — WhatsApp connection and Meta review demonstration

1. Add Connect WhatsApp with a server-bound, expiring connection attempt and clear cancelled/failed/retry states.
2. Exchange authorization on the backend, verify accessible business assets and save encrypted merchant-scoped credentials.
3. Complete the supported registration/subscription steps and show connection health, reconnect and disconnect actions.
4. Use the correct credential for every send, media download and catalog/template operation.
5. Add a server-calculated readiness checklist and activation endpoint. Catalog/delivery/payment checks use the same services completed in W04/W06.
6. Demonstrate the requested permission uses and prepare the review material as soon as supported test access permits.

**Result:** a test merchant can connect and receive a real round-trip message where permitted. Mocks prove application behavior; they do not establish Meta approval or existing-number eligibility. Do not wait for all dashboard polish to prepare review.

### W04 — Shop configuration

1. Complete product editing, archiving, CSV preview/import errors and safe updates.
2. Represent each independently stocked size/color combination as a distinct sellable SKU; preserve current product/order identifiers.
3. Build owner-editable delivery zones, fees and unsupported-area behavior.
4. Complete the shop facts/policies interface and validated settings used by the bot.
5. Feed these results into the activation checklist so missing business data stays visible.

**Result:** a merchant loads a real catalog, chooses stock/price limits and configures delivery/payment/FAQ information without engineering assistance. No Tech Provider approval needed for these features.

### W05 — Buyer conversation and checkout

1. Complete product/variant resolution and ask clarification for uncertain requests.
2. Improve Roman Urdu, Urdu and English behavior against a merchant-reviewed set of example conversations; preserve safe fallback behavior for unsupported media.
3. Keep pricing decisions in the existing deterministic engine and verify every quoted/ordered amount against it.
4. Make cart edits, delivery capture, payment selection and explicit final confirmation reliable; recheck stock and quote validity.
5. Make owner handoff suppress stale bot work and preserve the saved order context.

**Result:** realistic scripted buyers reach correct orders or an appropriate handoff. Run application tests now and repeat actual WhatsApp scenarios after W03 has the necessary provider access.

### W06 — Orders, payments and exceptions

1. Finish COD confirmation and optional owner-recorded collection without treating unpaid COD as received cash.
2. Store bank-payment evidence privately and implement atomic owner decisions, rejection/resubmission and conflict handling.
3. Generate correct receipts with a readable fallback; deliver order/payment updates using the permitted free-form or approved-template route.
4. Implement cancellation and configurable unpaid-order expiry with one-time stock restoration and an explicit late-payment path.
5. Add owner-managed return/failed-delivery cases and controlled restocking of physically recovered, sellable goods.

**Result:** orders and stock remain consistent through double-clicks, retries, late review and cancellation. Product/payment tests can proceed before Meta approval; delayed-message/template delivery needs valid provider setup and approval where applicable.

### W07 — Merchant workspace

1. Complete paginated/searchable order and chat lists, payment-review details and takeover/pause actions.
2. Make notifications actionable and deduplicated; provide a practical owner alert route for urgent review/failures.
3. Complete mobile layouts, slow-network behavior and clear loading/save/error states.
4. Reconcile analytics with actual placed orders, verified payments, COD collected and cancellations using Pakistan-day boundaries.

**Result:** an owner can operate their shop from a phone and trust the displayed totals. No Tech Provider approval is needed for application development; real message controls are retested against Meta.

### W08 — Data controls and final security/recovery

1. Add merchant-scoped export and authenticated account-deletion requests with visible status.
2. Prevent disconnected/deleted/suspended shops from sending queued work; apply the agreed retention policy to rows, files and recovery procedures.
3. Finish cross-shop access tests, credential rotation, dependency/security checks and limits on expensive operations.
4. Demonstrate alerts, service rollback and database/media restoration, including safe resumption of queued work.

**Result:** the integrated application passes tenant isolation and failure recovery tests, and data requests produce the documented outcome. Security work begins in W01 and continues in every package.

### W09 — Paid-plan features

1. Store plan/trial/billing-period/status and a dated entitlement configuration; manual invoicing is sufficient for the first version if chosen.
2. Show allowance, actual usage and warning states using the usage events collected since W01.
3. Enforce limits server-side and define a clear grace/limited-service state that preserves appropriate access to existing orders and exports.
4. Complete renewal/cancellation and protected platform recording of subscription payments.

**Result:** a paid merchant understands their fee, renewal and allowance, and cannot bypass limits or assign themselves a plan. Founder-approved prices/allowances are needed before enabling the paid offer.

### W10 — Complete the integrated product

1. Retest the current release through signup → WhatsApp connection → catalog setup → buyer conversation → order → payment review → owner notification.
2. Repeat with two unrelated merchants and supported real-number paths after required Meta access is available.
3. Run the controlled pilot and resolve launch-blocking issues against the acceptance scenarios in the detailed roadmap.
4. Record the actual release version, feature limitations and founder go/no-go decision before public enrollment.

**Result:** a demonstrated product ready for the supported market and merchant cohort. Code completion alone does not close this package.

## 4. Run Meta work alongside implementation

| Checkpoint | Product progress | Meta work |
|---|---|---|
| Start | W00/W01 begin | Confirm app/business ownership, current verification/access status, required documents and public policy/support URLs |
| Account flow | W02 becomes demonstrable | Configure permitted Facebook identity testing and public access requirements |
| Connection flow | W03 runs with supported test assets | Prepare/submit review material when the requested capabilities can be shown; track each requested permission separately |
| Review period | W04–W08 continue; W09 if needed | Resolve reviewer feedback and recheck current account-specific number/permission requirements |
| Approval received | W10 actual merchant validation | Test an eligible merchant outside the app's internal roles and record granted access |
| Pilot complete | Release gates pass | Reconfirm required provider access remains valid before opening public signup |

If Meta blocks one real integration test, keep that evidence item pending and continue independent implementation. Do not mark it passed based on a simulated response. Verification status has not been checked in the live Meta dashboard during creation of this plan.

## 5. Feature coverage — no feature left unassigned

| Feature | Main package | Feature | Main package |
|---|---|---|---|
| F01 Facebook login | W02 | F17 Order/stock correctness | W01 + W06 |
| F02 Automatic merchant account | W02 | F18 Receipts | W06 |
| F03 Access/recovery | W02 | F19 COD | W06 |
| F04 Saved onboarding | W02 | F20 Bank evidence/review | W06 |
| F05 WhatsApp signup | W03 | F21 Cancel/expire | W06 |
| F06 Merchant credentials | W03 | F22 Return/delivery exceptions | W06 |
| F07 Connection lifecycle | W03 | F23 Owner workspace | W07 |
| F08 Activation readiness | W03, completed with W04/W06 | F24 Notifications | W07 |
| F09 Catalog | W04 | F25 Mobile use | W07 |
| F10 SKU/variant stock | W04 | F26 Sales overview | W07 |
| F11 Delivery configuration | W04 | F27 Security/isolation | W01 + W08; every package |
| F12 Shop knowledge | W04 | F28 Message/order recovery | W01 + W08 |
| F13 Local-language replies | W05 | F29 Data controls | W08 |
| F14 Guarded negotiation | W05 | F30 Plans/subscriptions | W09 |
| F15 Cart/checkout | W05 | F31 Usage/limits | W09 |
| F16 Owner handoff | W05 + W07 | | |

## 6. Delivery rules and decisions

- Each slice includes the database/backend/UI changes it needs, relevant tests and a demonstration. Use the detailed appendix to keep interfaces consistent.
- Keep additive database changes compatible with the currently deployed version; preserve merchant data and apply migrations through the tested release process.
- Open a new work package when its prerequisites are available. W04 can progress while W03 waits for provider access; W07 screen work can use stable API fixtures while payment changes are completed.
- This plan does not assume multiple engineers or automatic subagent delegation. Concurrency here means independent work may proceed when time and staffing allow.
- Confirm existing decision-register items before enabling dependent behavior: number support, variant representation, outside-stock updates, unpaid-order expiry, returns/restocking, account recovery, retention, notification channel and paid-plan allowances. Prepare the code/configuration without inventing an owner policy.
- Use states **planned → in progress → implemented → integration verified → pilot verified**. For Meta-dependent work, also record **provider access pending**. All packages currently remain planned under this implementation plan.
- Keep the previous 37–64 engineering-day range as a preliminary overall estimate, not a fresh commitment. Re-estimate after W00/W01 and the first real connection; provider waiting time is separate from coding effort.

**First implementation milestone:** W00 plus the transaction/event schema slice of W01. Its visible result is a safe two-shop test setup and proof that a failed stock operation cannot falsely confirm an order. Then finish message durability before adding self-service signup.
