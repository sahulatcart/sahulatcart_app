# Sahulatcart — Pakistan market launch roadmap

**Prepared: 5 October 2026. Scope: the first public, self-service release for Pakistani merchants.**

For the shorter product-feature list and build order, start with the [feature-only plan](FEATURE-PLAN.md).
For execution, use the [implementation plan](IMPLEMENTATION-PLAN.md) and its [engineering details](IMPLEMENTATION-DETAILS.md).

This is the current launch plan. It replaces the launch sequencing and scope assumptions in the older ROADMAP.md and DEV-PLAN.md, which were written for a manually connected, single-shop pilot. It does not mean the work listed here is implemented. Existing technical specifications remain useful, but the founder's decisions below take precedence where they differ.

The product is ready when a merchant can create an account, connect an eligible WhatsApp number, configure their shop, receive correct customer orders, verify bank payments, and recover from ordinary problems without an engineer operating their account. Security, reliable stock and payments, and an observed pilot are part of completion.

## Read this roadmap in five parts

| Document | What it contains |
|---|---|
| **This overview** | Current position, launch scope, priorities, dependencies, effort, decisions and release gates |
| [1. Merchant onboarding and Meta](01-MERCHANT-ONBOARDING-AND-META.md) | Facebook login, automatic merchant accounts, WhatsApp signup, credentials, number eligibility, approvals and reconnecting |
| [2. Customer sales and merchant tools](02-CUSTOMER-SALES-AND-MERCHANT-TOOLS.md) | Catalog, AI replies, negotiation, checkout, inventory, COD, payment evidence, cancellations and portal completion |
| [3. Security, reliability and operations](03-SECURITY-RELIABILITY-AND-OPERATIONS.md) | Tenant isolation, durable messaging, transactional writes, environments, secrets, backups, deployment and support tools |
| [4. Testing, pilot and market launch](04-TESTING-PILOT-AND-MARKET-LAUNCH.md) | Test cases, launch evidence, Pakistani merchant pilot, pricing, business preparation and launch-day procedure |

Every numbered task includes an owner and a completion condition. Checkboxes start unchecked because code presence alone does not establish launch readiness. Check one only after recording evidence against the release being tested.

**Owners:** Engineering = implementation/configuration/testing; Founder = product, business and budget decisions; Joint = engineering prepares and founder validates; External = Meta or another provider controls the outcome. This document authorizes no purchase, production change or submission by itself.

**Gates:** Internal = before realistic end-to-end testing; Pilot = before outside merchants process real customer data/orders; Public = before open local-market signup; Paid = before charging a subscription. An item can carry several gates. The first applicable gate is the deadline. Public launch requires the Pilot gates too. Paid requirements can remain deferred during a clearly labelled free pilot.

## 1. What exists today

This baseline comes from the local repository and the preceding review in this conversation. Railway settings, Supabase migrations, Meta permissions and provider billing were not independently verified against their live dashboards for this roadmap.

| Area | Evidence in the repository | What remains to prove or build |
|---|---|---|
| Marketing site | Static site with product, pricing, privacy, terms and support pages | Current claims, working signup links, pricing accuracy and support operation |
| Merchant portal | Catalog, orders, inbox, settings, notifications, analytics and setup screens | First-time signup, connection states, mobile completion and truthful readiness checks |
| Login | Supabase email/password sign-in; API checks user membership | Facebook sign-in, recovery/linking and automatic first-login shop creation |
| Merchant provisioning | Platform-admin creation endpoint | Safe self-service transaction, no duplicate or orphan shops |
| WhatsApp | Signed inbound webhook, phone-number routing, text/image/document sending | Embedded Signup, merchant credentials, templates, connection lifecycle and real multi-shop validation |
| AI | Gemini implementation with conversation state and merchant knowledge | Real-language evaluation, cost controls and safe failure behavior; Anthropic is currently an unimplemented option |
| Negotiation | Deterministic rules, floor protection and automated tests | Concurrent/catalog-change scenarios and realistic merchant acceptance |
| Orders and payments | COD, bank screenshot review, slips, cancellation and stock reservation code | Atomic completion, stock-error handling, incomplete payment recovery and policy decisions |
| Security | Backend authentication, signed webhook checks, table restrictions and private-media patterns | Adversarial tenant tests, token encryption integration, access audit and release review |
| Operations | Railway configuration, health checks, replay and retention jobs | Environment isolation, durable acceptance, restore drill, alerting and reproducible deployment |
| Tests | Last local run: 121 backend tests passed; shared/backend/admin type checks passed | Browser tests, actual Postgres rules, provider integrations, load and failure tests |

Relevant starting points: [login](../../admin/lib/api.ts), [onboarding screen](../../admin/app/onboarding/page.tsx), [merchant API](../../backend/src/routes/admin.ts), [WhatsApp sender](../../backend/src/whatsapp/client.ts), [webhook](../../backend/src/whatsapp/webhook.ts), [checkout](../../backend/src/orchestrator/order-service.ts), [payment actions](../../backend/src/orchestrator/payment-service.ts), [stock migration](../../db/migrations/0008_stock_reservation.sql), [access restrictions](../../db/migrations/0007_lock_direct_table_access.sql), [deployment settings](../../.railway/railway.ts).

The previous approximate 45% completion estimate is a planning judgment, not an audited progress metric. From now on, report completed release gates and demonstrated merchant journeys, rather than increasing a percentage because another screen exists.

## 2. Product decisions already established

- The market is Pakistani local e-commerce merchants; the customer speaks through the merchant's WhatsApp number.
- The product automates routine product questions, negotiation and order capture. It cannot guarantee that every inquiry becomes a sale.
- Merchant accounts are created automatically at signup. Facebook is the intended portal login.
- Each merchant authorizes their own WhatsApp assets through Meta's supported onboarding.
- Merchant pricing limits are enforced in code. The AI does not decide the floor.
- Orders reduce tracked stock once. Duplicate delivery of a message must not reduce stock again.
- COD and bank-transfer payment evidence are supported. Only the merchant confirms whether a bank payment arrived.
- The merchant fulfills orders. Sahulatcart does not become a warehouse, courier or payment custodian.
- No staff-management product is required. Keep the launch experience focused on the owner; existing authorization code must still remain safe.
- Human takeover, payment review and exceptional cases remain necessary owner actions. Marketing should describe these honestly.
- The founder has final say on scope and release.

## 3. Scope of the first public release

**Required:** account creation and recovery; WhatsApp connection/reconnection; shop/catalog setup; product answers; guarded negotiation; correct checkout; stock; COD; merchant payment review; order slips; owner inbox and takeover; notifications; essential analytics; data separation; operational monitoring; privacy/deletion; documented support; controlled pilot evidence.

**Required at a basic level, with policies still to decide:** cancellation handling, expired unpaid orders, stock restoration, return/failed-delivery exceptions and corrections after payment. This can be a merchant-owned exception record and handoff. It does not require courier integration or automated refunds.

**Not a launch prerequisite:** staff/team management, courier booking, warehouse management, broadcasts, abandoned-cart campaigns, loyalty, mobile apps, generic flow builders, automated payment verification, customer payment gateways, advanced dashboards or bidirectional Shopify sync. A Shopify/CSV import is not the same as ongoing inventory synchronization. Promote any of these only after explicitly adding its costs and tests to scope.

## 4. Launch sequence and dependencies

| Phase | Work and task references | Owner | Demonstration required to leave the phase |
|---|---|---|---|
| 0 — Baseline and decisions | Confirm deployments, scope, number support, stock policy and pilot cohort; OPS-01, QA-01, BIZ-01/02 | Joint | Current deployment map and a short approved decision register |
| 1 — Safe test foundation | Separate test data and credentials, fix release checks, durable message acceptance and stock failure; OPS-02/03, REL-01/02, SALE-08/09 | Engineering | A test cannot send as a real merchant; failure cannot falsely confirm an order |
| 2 — Merchant identity | AUTH-01 through AUTH-05 | Engineering | New Facebook user gets exactly one shop and can return to it |
| 3 — WhatsApp integration and review | META-01 through META-09; start verification in Phase 0 | Joint / External | Merchant assets connect using merchant-scoped access; review submission is demonstrable |
| 4 — Complete sales journey | SALE-01 through SALE-16 and PORTAL-01 through PORTAL-04 | Engineering / Founder | A buyer completes COD and bank-payment flows with correct stock and owner controls |
| 5 — Prove security and operations | SEC-01 through SEC-08, REL-01 through REL-05, OPS-01 through OPS-06 | Engineering | Tenant attacks fail, crashes recover, backups restore, failures alert an operator |
| 6 — Controlled merchant pilot | QA-01 through QA-06, PILOT-01/02; required Meta access must already work | Joint | 3–5 representative shops complete the agreed evidence window |
| 7 — Local public launch | BIZ-01 through BIZ-06, LAUNCH-01 through LAUNCH-03 | Founder / Engineering | Every public gate has evidence; founder approves the actual release |

Phases overlap where dependencies allow. Catalog work can run while Meta reviews the app. Production account access, live verification and outside-merchant onboarding cannot be simulated into being approved. We can prepare and test supported development/test assets before approval; we cannot promise every Meta flow works for arbitrary merchants in development mode.

**Critical dependency chain:** isolated test environment → identity + secure tenant model → WhatsApp connection → real sales tests → security/recovery proof → pilot → public signup. Meta approvals and founder policy decisions run alongside that chain.

## 5. First implementation priorities

These are ordered by the damage or blockage they prevent:

1. Establish a test environment whose database, storage, credentials and message destinations cannot affect live merchants.
2. Make checkout fail safely when stock reservation fails. The current order-service logs some reservation errors and keeps the order.
3. Save accepted webhook messages before returning success. Current code acknowledges before persistence.
4. Make merchant creation, checkout and payment transitions consistent across all related records.
5. Implement Facebook login and automatic merchant provisioning.
6. Implement authenticated Embedded Signup with server-side asset verification and encrypted per-merchant tokens.
7. Replace every platform-token-only path: sending, media download, catalog access and future template work.
8. Replace the current unconditional “Go live” action with server-enforced readiness checks.
9. Add recovery/retry handling and approved order-update templates, including payment review after the reply window closes.
10. Test two independent merchants through the entire flow, then run the controlled pilot.

Source of the first four findings: [order-service](../../backend/src/orchestrator/order-service.ts), [webhook](../../backend/src/whatsapp/webhook.ts), [merchant creation](../../backend/src/routes/admin.ts), [payment-service](../../backend/src/orchestrator/payment-service.ts). They are code observations; no production incident is being claimed.

## 6. Effort and scheduling

These are **initial engineering effort ranges**, not delivery promises or Meta approval estimates. Re-estimate after the test environment and first real connection are demonstrated. They assume one experienced full-time engineer, prompt founder decisions, existing infrastructure access and no substantial scope expansion.

| Work package | Initial focused engineering effort |
|---|---:|
| Baseline, decisions and isolated test setup | 3–5 working days |
| Facebook identity, automatic shops and onboarding persistence | 4–7 working days |
| Embedded Signup, token lifecycle, readiness and templates | 7–12 working days |
| Sales, catalog, stock, payment and portal completion | 8–14 working days |
| Durable processing, security tests, deployment and recovery | 8–14 working days |
| End-to-end testing, pilot fixes and launch preparation | 7–12 working days |
| **Total initial planning range** | **37–64 engineering days** |

Allow a **2–3 week observation period for the pilot**, longer if transaction volume is low. Some pilot observation can overlap with fixes and launch preparation. For one engineer, a practical initial calendar allowance is roughly **10–16 weeks**, with Meta approval delay and major discoveries capable of extending it. Adding engineers does not divide the calendar time proportionally. These ranges count existing features as a starting point, not a rebuild.

## 7. Founder decision register

Decisions are proposed here so engineering can prepare options without pretending the founder has approved them.

| ID | Decision needed | Proposed starting point | Needed before |
|---|---|---|---|
| D01 | First merchant segment | One or two ordinary retail categories with clear SKUs and policies | Pilot recruitment |
| D02 | Existing WhatsApp Business App numbers | Validate Meta coexistence for the target cohort; otherwise explain and support an eligible alternative without deleting their app blindly | Public onboarding claims |
| D03 | Number/shop limits | One owner, one shop and one active WhatsApp number in the first UI | Identity/connection model |
| D04 | Variants | Treat every stock-bearing size/color combination as a distinct SKU; add grouped variants if cohort requires it | Catalog build |
| D05 | Stock source | Sahulatcart stock is authoritative for its own checkout; merchants record external sales until a real sync is built | Pilot |
| D06 | Unpaid bank order expiry | Choose an explicit reservation timeout, notification and late-payment procedure with the pilot merchants | Real bank orders |
| D07 | Cancellation and returns | Owner decides exceptional outcomes; restore stock only under an explicit recorded rule | Pilot |
| D08 | Prices, delivery and tax presentation | Show the full customer total before confirmation; obtain correct tax treatment from the merchant/adviser | Pilot |
| D09 | SaaS pricing and trial | Limited pilot, then a clearly capped PKR plan; fees and usage based on measured costs | Paid launch |
| D10 | Meta billing responsibility | Merchant pays Meta directly for their WABA under the intended direct Tech Provider model | Onboarding copy |
| D11 | Support commitment | Named owner, Pakistan-time support hours and critical-incident response | Pilot |
| D12 | Data retention and deletion | Written periods for chats, order data, media and backups, consistent with actual jobs and obligations | Pilot |
| D13 | Backup loss/recovery tolerance | Proposed target: recover within 4 hours and lose no more than 15 minutes of database changes; budget and demonstrate it before promising it | Production plan |
| D14 | Account recovery and disconnect | Verified recovery channel; explain what stops and what data remains when WhatsApp is disconnected | Public |
| D15 | Launch capacity and stop rules | Start with 3–5 pilot shops, then controlled batches; stop on wrong prices, duplicate orders or data isolation failures | Pilot |

## 8. External dependencies and what the founder supplies

- Confirm ownership and administrator access for GitHub, Railway, Supabase, the domain, Meta business portfolio and app. Record identifiers and recovery contacts, not secret values in this document.
- Supply the real business identity and documents Meta requests. Do not assume an NTN alone guarantees acceptance; check the actual verification flow and accepted documents.
- Complete Meta verification/review steps that require the business owner's identity or account action. Engineering prepares implementation, reviewer instructions and demonstrations.
- Provide eligible test assets and phone-number access for ownership verification; merchants themselves enter their OTPs in the authorized flow.
- Confirm infrastructure/AI budget and provider spending limits. Record no stale fixed-price promises from older plans.
- Bring 3–5 willing pilot merchants with real catalogs, price floors, stock, delivery policies and time to verify results.
- Decide pricing, support, merchant agreement and the exception policies above. Obtain appropriate local tax/legal review for the business model before selling subscriptions.

Secrets belong in provider settings or approved local secret files, never a roadmap, screenshot, ticket or chat transcript. Prior secret exposure is recorded in [PITFALLS.md](../PITFALLS.md); confirm rotation rather than assuming those old credentials are safe.

## 9. Public release gates

No gate is considered passed merely because the corresponding page loads.

| Gate | Required evidence |
|---|---|
| G1 — Account lifecycle | First signup, repeat login, cancelled consent, recovery and deactivation work without duplicate shops |
| G2 — Authorized WhatsApp use | Required Meta access is approved; a representative non-app-role merchant connects assets they own |
| G3 — Isolation | Two shops cannot access each other's data, media, tokens, outbound identity or orders |
| G4 — Sales correctness | Full COD and bank flows, discounts, quantities, variants and delivery totals match expected results |
| G5 — Inventory and payments | Concurrent last-item purchase is safe; retries never double-decrement or double-verify; failure never reports false success |
| G6 — Messaging recovery | Persistence before acknowledgement; crash recovery; safe retry/outbox; visible permanent failures |
| G7 — Merchant control | Pause, takeover, payment review, exceptions and connection health are usable on a phone |
| G8 — Operations | Alert delivery, release rollback and database plus media recovery are demonstrated |
| G9 — Privacy and business | Actual data use matches policies; deletion works; support and commercial terms are ready |
| G10 — Pilot outcome | Agreed pilot volume/window passed; no unresolved critical/high launch defects; founder accepts the evidence |

Record commit, environment, test date, tester, result and evidence location for each gate. Secrets and raw customer data do not belong in evidence screenshots.

## 10. Source freshness and limitations

The implementation tasks and proposed thresholds are Sahulatcart planning recommendations. Provider requirements below were checked on 5 October 2026:

- [Meta partner roles](https://whatsappbusiness.com/partners/become-a-partner/): Embedded Signup and the distinction between Tech Providers and Solution Partners inform the onboarding/billing plan.
- [WhatsApp messaging policy](https://whatsappbusiness.com/policy/): the policy page displayed an update of 23 September 2026. The template/window, consent, escalation and sensitive-data checks are reflected in Part 1.
- [WhatsApp platform pricing](https://whatsappbusiness.com/products/platform-pricing/): use the current Pakistan/category rates when preparing the cost model; this roadmap does not quote fixed rates.
- [Supabase Facebook sign-in](https://supabase.com/docs/guides/auth/social-login/auth-facebook): informs the login/email-permission configuration.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [backups](https://supabase.com/docs/guides/platform/backups): inform access testing and separate database/media recovery.
- [Railway environments](https://docs.railway.com/environments): informs environment separation.
- [Meta's Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/collection/du6gzjv/embedded-signup) confirms the supported onboarding mechanism. The detailed current Tech Provider developer page could not be retrieved during this research. Exact permissions, token behavior, coexistence eligibility and endpoint versions must therefore be checked in official Meta developer documentation and the app dashboard during implementation, rather than copied from old examples.

The next work package is **Phase 0 and Phase 1**, while the founder progresses Meta verification and pilot recruitment. Meta approval alone will not finish the product.
