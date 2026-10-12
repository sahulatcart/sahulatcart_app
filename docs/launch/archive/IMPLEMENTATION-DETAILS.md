# Engineering details for the feature implementation plan

[Back to the implementation plan](IMPLEMENTATION-PLAN.md) · [Feature definitions F01–F31](FEATURE-PLAN.md)

**Prepared: 6 October 2026.** Everything described as new below is proposed. Proposed files, routes, tables and functions do not exist merely because they are named here. Recheck the working tree and live migration state before implementation; choose the next available migration numbers then.

## 1. Architecture and working conventions

- Extend the existing Next.js portal, same-origin API proxy, Fastify backend and Supabase Auth/Postgres/Storage arrangement.
- Keep customer-visible price decisions in the negotiation engine and authoritative checkout code. Gemini remains the implemented AI provider unless a later task deliberately adds another.
- Keep browser access to merchant tables denied; use authenticated backend routes. The service role bypasses normal tenant RLS, so each privileged operation must enforce its merchant/asset relationship explicitly.
- Use restricted database functions for business transactions and durable job claims. Multiple independent Supabase HTTP requests are not one database transaction.
- Use Postgres-backed inbox/outbox and leases initially. Add a separate broker only if measured constraints justify it. Starting with one normal worker instance does not remove deployment-overlap races.
- Add schemas/types and small service modules when needed; extract touched sections of the existing large admin route file incrementally, without an unrelated rewrite.
- Make feature flags, environment identity and migration compatibility explicit. New automation is disabled until the server's readiness checks pass.

## 2. W00 — Test and deployment foundation

**Existing touchpoints:** [package scripts](../../package.json), [test configuration](../../backend/vitest.config.ts), [fake database](../../backend/src/test-support/fake-db.ts), [configuration](../../backend/src/config.ts), [startup](../../backend/src/index.ts), [Railway configuration](../../.railway/railway.ts).

**Slices:**

1. Record local/deployed commit and migrations separately. Use environment-variable names/presence checks without emitting secret values.
2. Add a two-merchant integration fixture and an isolated real-Postgres test runner. Keep fast unit/conversation tests; fake RPC implementations cannot serve as evidence that SQL locking/grants work.
3. Introduce injectable Meta and AI adapters for application tests, with a strict live-test opt-in and recipient/asset allowlist for actual provider tests.
4. Separate application environment identity from generic runtime mode. Workers must be deliberately enabled for the correct database/assets; neither a local production build nor a staging deployment should accidentally consume live events.
5. Add CI checks using the installed, locked tools: shared/backend/admin type checks, backend tests, real-database tests and separate backend/admin builds. Add browser checks for the flows introduced below. Do not run the admin build into an active dev server's .next directory.
6. Include shared code and dependency/build files in affected Railway watch paths; establish a tested staging promotion/rollback procedure before live feature releases.

**Exit checks:** fixtures and network assertions prove tests cannot reach live database/provider destinations; a fresh database can run all migrations; actual command exit codes determine pass/fail.

## 3. W01 — Transactions and durable messaging

**Existing touchpoints:** [order service](../../backend/src/orchestrator/order-service.ts), [payment service](../../backend/src/orchestrator/payment-service.ts), [webhook](../../backend/src/whatsapp/webhook.ts), [sender](../../backend/src/whatsapp/client.ts), [orchestrator](../../backend/src/orchestrator/orchestrator.ts), [in-process queue](../../backend/src/lib/keyed-queue.ts), [stock functions](../../db/migrations/0008_stock_reservation.sql), [auth](../../backend/src/lib/auth.ts).

### W01-A — Add compatible persistence contracts

- Extend webhook event state with processing attempts, retry schedule, claim/lease identity and last error as needed. Preserve a dedupe identity for each accepted inner message/status event.
- Add an outbound job store with merchant, number/conversation, stable business-operation key, message/template intent, state, attempts, retry time, lease and provider message ID. Store references to private media, not expiring signed URLs or credentials.
- Add stable checkout/operation identities and uniqueness rules for draft creation and confirmation. A retry must reuse the same identity.
- Add an auditable inventory-movement identity for reserve/release/manual adjustment/return decisions as needed. Preserve existing counts as the migration baseline; do not invent historical movements.
- Enable appropriate table restrictions and revoke sensitive function execution from public/anon/authenticated. Validate tenant consistency for references even when callers use the service role.

### W01-B — Commit checkout as one operation

- Add a restricted placement function accepting the backend-derived merchant, checkout/order reference and expected confirmation version. Read authoritative lines, quantities, pricing/quote validity and delivery configuration from trusted persisted state.
- Lock the order and affected stock rows in stable product order; recheck availability and validate amounts/relationships.
- Allocate the order number, change order/payment state, decrement stock, write payment/history/inventory records and enqueue confirmation intent within the transaction.
- Return explicit outcomes: newly placed, already placed, quote changed, out of stock, invalid state or failure. On failure, do not leave a newly confirmed order behind.
- Replace the current update-then-reserve path. Keep a compatible façade in order-service so callers do not need a simultaneous full rewrite.
- Make draft materialization transactional/idempotent too; repeatedly applying one conversation checkout must not create separate drafts competing for the same negotiation lines.

### W01-C — Accept durably, process under a claim

- Keep signature verification over the raw request bytes. Validate supported payloads and durably insert inner events before returning HTTP success.
- Make partially repeated batches harmless. Distinguish duplicate inserts from storage failures; on persistence failure use the provider-appropriate retriable response.
- Claim work atomically in Postgres, with expiry/recovery of abandoned claims. Coordinate each conversation across workers/deployments.
- Do not hold a database transaction open during a slow model/network request. Use expected-state versions and fenced claims when committing results so a stale worker cannot overwrite newer state.
- Make persisted messages, business actions and reply intents idempotent under the accepted event/step identity. Handle error/dead-letter/retry states deliberately rather than relying only on the current received-event sweeper.

### W01-D — Send with recoverable intent

- Convert orchestrator/owner/payment sends to queued intents, with an explicit last-moment check for account status, connection, takeover and message policy.
- Generate signed media URLs when dispatching; do not enqueue a URL likely to expire before delivery.
- Use bounded timeouts/backoff, record delivery/status events and surface permanent failures.
- Treat a timeout after possible Meta acceptance as uncertain. External delivery is not guaranteed exactly once; never repeat stock/payment actions to compensate for an uncertain send.
- Collect per-merchant provider/AI usage events from this stage so W09 is not built on missing usage history.

**Verification:** real SQL concurrency tests, duplicate batch delivery, failure before/after acknowledgement, two overlapping workers, stale claims, last-unit checkout, send timeout and repeated confirmation. Verify shops cannot target each other's rows/jobs and no paused shop sends a stale bot reply.

## 4. W02 — Identity and persistent onboarding

**Existing touchpoints:** [Supabase client](../../admin/lib/supabase.ts), [API client](../../admin/lib/api.ts), [login page](../../admin/app/login/page.tsx), [onboarding page](../../admin/app/onboarding/page.tsx), [app shell](../../admin/components/AppShell.tsx), [auth resolver](../../backend/src/lib/auth.ts), [merchant API](../../backend/src/routes/admin.ts), [core schema](../../db/migrations/0001_core.sql).

**Proposed changes:**

- Separate verified identity from merchant membership: an authenticated identity can call provisioning; merchant routes still require active membership and a permitted shop status.
- Add a callback page and protected provisioning route outside the current membership-only admin guard. A session/bootstrap response should distinguish unauthenticated, needs provisioning, onboarding incomplete and ready.
- Add a restricted provisioning transaction that creates/fetches a shop plus owner membership. Serialize concurrent requests by verified user identity and enforce the chosen one-shop launch rule without silently deleting existing multi-membership data.
- Change the default for newly created shops to automation disabled. Do not blindly overwrite existing live-shop settings; perform a migration/preflight inventory and preserve legitimate current connections.
- Record durable onboarding progress and policy agreement versions. Hydrate form data from server state and validate allowed fields; prevent generic settings updates from directly enabling an unready bot.
- Add secure account linking/recovery through provider-supported verified identity handling and a documented audited fallback. Never transfer a shop solely because an unverified email matches.
- Replace production shared-token administration with individual platform access; keep owner/admin authorization distinct even though the merchant UI has no staff management.

**Verification:** simultaneous signup creates one shop; invalid JWT/provided merchant ID rejected; an identity without membership can provision but cannot read another shop; existing owner migration retains data; consent cancellation and missing-email cases remain recoverable; suspended users cannot act through old sessions.

Provider implementation reference: [Supabase Facebook sign-in](https://supabase.com/docs/guides/auth/social-login/auth-facebook). Verify the current app use case and redirect/email configuration during implementation.

## 5. W03 — Meta connection and activation

**Existing touchpoints:** [number/secret schema](../../db/migrations/0001_core.sql), [WhatsApp sender](../../backend/src/whatsapp/client.ts), [media downloader](../../backend/src/whatsapp/media.ts), [webhook](../../backend/src/whatsapp/webhook.ts), [catalog-sync handler](../../backend/src/routes/admin.ts), [config](../../backend/src/config.ts), [onboarding](../../admin/app/onboarding/page.tsx).

**Proposed modules:** a connection service, server-only credential resolver/encryption module, Meta adapter, readiness service and dedicated authenticated connection routes. Names are implementation suggestions, not existing files.

**Slices:**

1. Create expiring, single-use connection-attempt records bound to owner/shop. Bind browser completion messages to the attempt and verify documented SDK message origins/payloads.
2. Exchange the authorization code on the backend. Inspect the grant and authorized assets through Meta; validate the number/WABA relationship before mapping it to the merchant. Enforce uniqueness and explicit controlled reassignment.
3. Reuse whatsapp_secrets with authenticated encryption/key versions; enforce the credential's merchant relationship. Reuse whatsapp_numbers for validated routing and lifecycle metadata, extending the states/fields where needed.
4. Complete supported WABA subscription, registration and billing/readiness steps. Implement each as a recoverable connection step, since network calls cannot be part of one database transaction.
5. Route all outbound sends, media download and catalog/template operations through the merchant credential resolver. Missing authorization must not fall back to another shop's or a general platform token.
6. Add health/error states, revocation handling and reconnect. Disconnect invalidates local access/queued work promptly, then performs the appropriate provider cleanup without disrupting shared assets.
7. Add a readiness response with stable reason codes and merchant-facing instructions. Activation is a dedicated server-validated transition; pause remains immediately available.
8. Add the minimum necessary template integration for delayed order/payment updates, including per-WABA approval/language state and a visible fallback task when a notification is unavailable.

**Pre-approval evidence:** encrypted storage tests, asset-substitution attacks, single-use attempt handling, mocked lifecycle/errors, readiness guards and allowed real test-asset round trips. **Post-access evidence:** unrelated merchant-owned assets, required granted permissions, supported existing-number paths, revocation/reconnect and actual template delivery.

Current exact scopes, token behavior, number coexistence and API versions are implementation-time checks against official Meta documentation/app settings. Do not copy legacy line-of-credit or On-Premises examples into the direct Tech Provider flow. References: [Meta partner roles](https://whatsappbusiness.com/partners/become-a-partner/) and [Embedded Signup guidance](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup).

## 6. W04 — Catalog, inventory configuration and shop facts

**Existing touchpoints:** [catalog list](../../admin/app/catalog/page.tsx), [product editor](../../admin/app/catalog/[id]/page.tsx), [settings](../../admin/app/settings/page.tsx), [merchant routes](../../backend/src/routes/admin.ts), [validation](../../backend/src/lib/validation.ts), [CSV](../../backend/src/lib/csv.ts), [Shopify import](../../backend/src/lib/shopify.ts), [delivery matching](../../backend/src/orchestrator/delivery.ts).

- Extend explicit product/settings validation; enforce monetary bounds, unique SKU rules and the difference between zero, unknown and untracked inventory.
- Proposed first-release variant model: each orderable size/color combination uses its own existing product row/SKU. Add optional grouping metadata only if needed for browsing; do not pretend a free-text attribute has independent stock. Confirm this with the target merchants before locking catalog UX.
- Add import preview/validation results and recoverable apply operations. Distinguish absent optional fields from deliberately cleared values; retain owner pricing/stock controls on repeat imports.
- Add authorized delivery-zone CRUD and complete its settings UI; normalize cities/areas and make unmatched-location policy explicit.
- Store/version shop policies and payment preferences in validated fields. Reject arbitrary activation/privileged settings keys.
- Separate manual stock adjustments from normal product text edits; send changes through the inventory operation introduced in W01.

**Verification:** import repeats/mixed valid-invalid rows, variants with different prices/stock, edits while checkout is active, unsupported addresses, price formatting and image-access validation. Do not add ongoing Shopify synchronization as an implicit part of import.

## 7. W05 — Conversation, negotiation and final confirmation

**Existing touchpoints:** [orchestrator](../../backend/src/orchestrator/orchestrator.ts), [product resolution](../../backend/src/orchestrator/resolve.ts), [delivery](../../backend/src/orchestrator/delivery.ts), [price guard](../../backend/src/orchestrator/guard.ts), [negotiation engine](../../backend/src/negotiation/engine.ts), [AI prompts](../../backend/src/llm/prompts.ts), [conversation tests](../../backend/src/orchestrator/orchestrator.flow.test.ts).

- Version the persisted checkout context so item/quantity/address/payment changes invalidate a previous final confirmation when necessary.
- Resolve products to actual merchant-owned SKUs and keep authoritative facts/prices separate from model-generated wording.
- Make multi-item edits and repeated orders in a conversation explicit. Stable draft/confirmation identities must survive webhook replay.
- Keep code-enforced negotiation floors, quantity arithmetic and final amount matching; model instructions cannot override business facts or reveal confidential pricing limits.
- Confirm item lines, delivery charge/address, payment method and full total before invoking the placement transaction. Revalidate expired/changed quotes and request a fresh confirmation.
- Persist handoff and shop pause as authoritative states. A worker must check them again when committing/sending a reply after a slow AI request.
- Build a versioned, merchant-reviewed language evaluation set and structured invalid-output fallbacks. Advertise voice/media support only after its supported paths pass tests.

**Verification:** Roman Urdu/Urdu/English cases, ambiguous products, corrections after “yes”, last-minute price changes, second purchases, repeated messages, malicious discount instructions and takeover while a response is in progress.

## 8. W06 — Payment transitions, expiry and exceptions

**Existing touchpoints:** [order service](../../backend/src/orchestrator/order-service.ts), [payment service](../../backend/src/orchestrator/payment-service.ts), [slip generation](../../backend/src/orchestrator/slip.ts), [media handling](../../backend/src/whatsapp/media.ts), [orders/payment schema](../../db/migrations/0004_orders_payments.sql), [order details UI](../../admin/app/orders/[id]/page.tsx).

- Introduce restricted transactional payment/cancellation operations with backend-derived actor/merchant, expected state and stable operation key. Update order/payment/claim/history and outgoing intents together.
- Make screenshot claims idempotent by their inbound media/message operation; authorize reads through private storage and bounded signed links. Re-upload/rejection histories must not silently replace the currently reviewed claim.
- Require the owner to verify funds. Support conflicts, partial/excess/unclear payment and late payment through an explicit owner task; do not infer receipt from OCR or message text.
- Add reservation-expiry timestamps and a durable expiry job. Founder policy decides timeout and treatment of a submitted-but-unreviewed claim; default configuration must not silently expire such a claim without an agreed rule.
- Add a basic exception record with type, affected order lines/quantities, owner decision, restocking action and audit history. Restocking uses an idempotent inventory movement and cannot exceed eligible returned quantity or double-release previously cancelled stock.
- Keep receipt generation after the business commit, with stored-object references and readable text fallback. Delivery retries repeat the receipt/notification only.
- Apply one shared outbound policy selector to payment/order notifications; send a valid approved template when required or create a visible owner follow-up task.

**Verification:** double-click/two-tab owner actions, approval vs cancellation/expiry races, repeated evidence, bank-to-COD switch, late transfers, partial returns, duplicate restock requests, unreadable PDF and delayed-notification delivery. No courier booking or automatic movement/refund of money is added.

## 9. W07 — Workspace, notifications and analytics

**Existing touchpoints:** [dashboard](../../admin/app/page.tsx), [orders](../../admin/app/orders/page.tsx), [inbox](../../admin/app/inbox/page.tsx), [notifications](../../admin/app/notifications/page.tsx), [analytics](../../admin/app/analytics/page.tsx), [app shell](../../admin/components/AppShell.tsx), [merchant API](../../backend/src/routes/admin.ts).

- Add stable pagination/filter/search contracts and tenant-safe indexes; do not rely on fixed first-page limits for merchant history.
- Use action responses that distinguish accepted/queued/completed/failed status; a toast must not claim a buyer received an unsent message.
- Add typed notification intents for payment review, new orders, handoff and connection/processing errors. Deduplicate by the business event and deep-link to the relevant record.
- Select an owner alert channel with the founder; implement its verified destination, consent/settings, retry and delivery-failure behavior where required.
- Preserve the existing design while completing narrow-screen, loading, empty, error, expired-session and slow-connection states.
- Define aggregates from committed records, using Pakistan-day boundaries and separate placed value, verified bank revenue and collected COD. Exclude drafts/test records and never count retries as sales.

**Verification:** realistic mobile owner journeys, more than one page of history, two-tab conflicts, failed-save feedback, notification duplicates and totals reconciled to an explicit set of orders.

## 10. W08 — Data requests, security and recovery

**Existing touchpoints:** [auth](../../backend/src/lib/auth.ts), [retention](../../backend/src/lib/retention.ts), [image handling](../../backend/src/lib/images.ts), [database access restrictions](../../db/migrations/0007_lock_direct_table_access.sql), [settings](../../admin/app/settings/page.tsx).

- Add export/deletion request records and authenticated owner routes. Use durable workers for larger exports/deletions, with progress and expiring private downloads.
- Require reauthentication/verified ownership for destructive identity/data actions. Verify provider deauthorization/deletion callbacks before applying changes.
- Stop access and sends immediately when needed, then perform the documented retention/deletion workflow across tables, storage and queued work. Use minimal tombstones or a recovery ledger so a restore cannot revive deleted messaging permissions.
- Complete schema validation, expensive-operation limits, SSRF/media restrictions, session safeguards and private-file access tests across all added routes.
- Rotate encryption/provider credentials through a tested procedure; complete the removal/isolation of legacy platform-token shortcuts.
- Rehearse database and storage-object recovery plus configuration/key access. Keep restore environments isolated; reconcile outstanding jobs before enabling sends.
- Add operational alerts for acceptance failures, stuck queues, invalid connections, order/payment inconsistencies and spending, without repeatedly calling the paid LLM readiness probe.

**Verification:** the full two-shop adversarial matrix; expired/downloaded export links; deletion with queued work; retention-job failures; compromised/revoked credentials; restored orders/files with no replay storm. Correctness and security issues remain release blockers even if screens look complete.

## 11. W09 — Plans and usage

**Existing touchpoints:** merchant plan field in [core schema](../../db/migrations/0001_core.sql), [shared types](../../shared/src/types.ts), [configuration](../../backend/src/config.ts), [settings](../../admin/app/settings/page.tsx). Current plan metadata is not a complete subscription system.

- Add subscription periods/status, entitlement versions and protected manual billing records; reuse existing plan metadata where compatible rather than creating competing authorities.
- Aggregate idempotent usage events by merchant/billing period. Define the unit being sold; internal provider retries and duplicate webhooks must not arbitrarily inflate merchant usage.
- Build a server-side entitlement check and concurrency-safe reservation/accounting for limited expensive operations. Maintain basic platform abuse/cost protection even for free pilots.
- Add the merchant plan/usage screen and warning states; define renewal, grace, cancellation and read/export access in each state.
- Keep SaaS subscription payments separate from merchant customer payments and separate from Meta's own billing arrangement.

**Verification:** duplicate billing actions, period rollover, trial expiry, simultaneous quota-consuming requests, cancellation and protected plan changes. Founder-selected prices/limits and business terms are required before paid activation.

## 12. Proposed API contracts

These are application route proposals, not Meta Graph API endpoints. Preserve compatible current routes where useful; place new routes behind the same-origin portal proxy and the correct Fastify auth scope.

| Route | Purpose and boundary |
|---|---|
| GET /api/v1/session | Verified identity and shop/onboarding state; no secret or credential returned |
| POST /api/v1/merchant/provision | Verified identity required; merchant membership not yet required; idempotent provisioning |
| GET/PATCH /api/v1/admin/onboarding | Current owner's saved setup; allowed fields only |
| POST /api/v1/admin/whatsapp/connection-attempts | Start an owner-bound expiring connection |
| POST /api/v1/admin/whatsapp/connection-attempts/:id/complete | Consume valid attempt/code and verify authorized assets |
| GET /api/v1/admin/whatsapp/connection | Safe health/prerequisite state, never raw tokens |
| POST /api/v1/admin/whatsapp/disconnect | Reauthenticated owner; stop local sends and perform safe cleanup |
| GET /api/v1/admin/readiness | Server-calculated checks with stable reason codes |
| POST /api/v1/admin/bot/activate | Recheck readiness atomically with activation state change where possible |
| GET/POST/PATCH/DELETE /api/v1/admin/delivery-zones… | Owner-scoped delivery configuration with explicit validation |
| POST /api/v1/admin/orders/:id/exceptions | Record an owner-managed order exception; no direct refund execution |
| POST /api/v1/admin/data-requests | Create authorized export/deletion request; return request status/reference |
| GET /api/v1/admin/data-requests/:id | Only the owning merchant can view progress or authorized download details |
| GET /api/v1/admin/subscription | Current plan/period/usage; owner cannot self-grant arbitrary entitlements |

Existing order/payment actions should call the new transaction services behind their current routes. Every sensitive mutation accepts a stable operation identity where replay matters, checks expected state and returns an explicit outcome/conflict.

## 13. Migration and review boundaries

1. **Persistence foundation:** inbox/outbox, operation identities, inventory movement identity and restricted transaction/claim functions.
2. **Identity:** provisioning constraints/state, disabled new-shop defaults and durable onboarding, with an existing-account migration audit.
3. **Meta:** connection attempts, validated credential references, lifecycle/readiness/template metadata.
4. **Commerce completion:** minimal SKU grouping if chosen, expiry/exception records and completed payment transitions.
5. **Data and billing:** data-request jobs/retention metadata and subscription/usage structures.

Each group can be more than one migration. Use additive changes, inspect existing rows before adding uniqueness, backfill explicitly and avoid deleting columns or records needed by the running version. Old code must not process the new queue simultaneously with an incompatible worker path. Deploy new persistence first, then compatible code, then enable the new consumer/feature after checks.

Suggested review slices are W01-A through W01-D; identity backend then portal integration; credentials then signup lifecycle; catalog then delivery/settings; conversation checkout; payment transitions then exceptions; workspace; data controls; subscriptions. Each merged slice must preserve the working app or remain disabled behind an explicit feature flag.

**For every slice:** confirm feature IDs, inspect migration compatibility, implement the smallest complete behavior, run relevant tests and type checks, demonstrate the result, and update the changelog with verified outcomes and limitations. Run actual-provider tests only for provider-dependent changes and permitted assets. The final W10 release uses the [full acceptance matrix](04-TESTING-PILOT-AND-MARKET-LAUNCH.md), including an actual merchant pilot.
