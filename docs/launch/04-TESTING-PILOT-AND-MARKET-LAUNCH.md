# 4. Testing, pilot and market launch

[Back to the roadmap](README.md) · [Previous: security and operations](03-SECURITY-RELIABILITY-AND-OPERATIONS.md)

**Goal:** prove the complete product with representative Pakistani merchants, understand its cost/support needs and launch only the capabilities that work. The measurements below are proposed release criteria; the founder can refine commercial targets before the pilot, but critical correctness/security failures remain stop conditions.

## Testing and evidence

### QA-01 — Maintain a release evidence register

**Owner:** Engineering + Founder. **Gate:** Internal, then maintained through Public.

- [ ] List the tasks and public gates from this roadmap with owner, status, dependency and evidence link.
- [ ] Use statuses: not started, in progress, implemented/unverified, verified in staging, verified in pilot, externally blocked and deferred.
- [ ] Record commit/build, migrations, environment, test date, tester and expected/actual outcome. A check from an old build is not automatically evidence for the new release.
- [ ] Separate automated-test passes, actual provider tests, observed pilot results and assumptions.
- [ ] Track each defect with severity, reproduction, affected data/actions, owner, fix and regression evidence.

**Done when:** the founder can inspect G1–G10 and see why each gate is passed or still blocked, without relying on a completion percentage.

### QA-02 — Extend unit and real-database integration coverage

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SALE-08/09/11, SEC-01, REL-01/02/04.

- [ ] Keep the existing 121-test baseline passing while adding tests for changed behavior and important uncovered failure paths.
- [ ] Exercise actual Postgres migrations/functions/constraints, not only the in-memory fake database used by conversation tests.
- [ ] Test stock concurrency, repeated reservation/release, transactional order placement, payment decisions and expiry races.
- [ ] Test RPC grants, direct-table denial, tenant parent/child guards and private-media access with real roles.
- [ ] Run migrations on a fresh database and on a representative earlier schema; test failure/retry and compatibility with the deployed app.
- [ ] Inject database errors between business operations and verify no false success or unrecoverable partial state.

**Done when:** the important database guarantees are demonstrated in Postgres and the new regression checks run repeatably in CI/staging.

### QA-03 — Build a realistic buyer-conversation evaluation set

**Owner:** Engineering + Founder + Pilot owners. **Gate:** Pilot baseline; Public target. **Depends on:** SALE-01 through SALE-07.

- [ ] Prepare at least 100 representative scripts covering Roman Urdu, Urdu script, English, code-switching, typos, abbreviations and multi-message bursts.
- [ ] Include product uncertainty, variants, bargaining, stock changes, address corrections, multiple items, payment changes and repeat orders.
- [ ] Include hostile instructions, fictional discounts, attempts to reveal hidden floors and a screenshot/text claiming money arrived.
- [ ] If voice is advertised, include real recordings with different clarity/noise levels and safe failure examples.
- [ ] Define expected facts, decisions and acceptable fallback behavior for every script, reviewed by a merchant.
- [ ] Version the dataset with model/prompt/configuration changes; do not use unconsented identifiable customer chats as a casual shared test fixture.

**Proposed pass target:** at least 95% correct supported-scenario outcomes, and 100% compliance with price floors, tenant boundaries, explicit-order confirmation and merchant-only payment approval. Uncertainty correctly handed to the owner is an acceptable outcome for intentionally ambiguous scenarios, not a successful automated sale.

### QA-04 — Run browser and actual-provider end-to-end tests

**Owner:** Engineering + Founder. **Gate:** Pilot and again on the release candidate. **Depends on:** AUTH/META readiness and complete sales flow.

- [ ] Test from an ordinary browser session, not only a founder/admin session with special access.
- [ ] Exercise Facebook signup, automatic shop creation, WhatsApp connection, shop setup and activation.
- [ ] Use two unrelated shops/authorized assets and confirm message/credential/data isolation.
- [ ] Run real WhatsApp test conversations for COD, bank evidence, owner verify/reject, delayed verification/template, takeover and reconnect.
- [ ] Test merchant mobile browser behavior, popup blockers, consent cancellation and unreliable connections.
- [ ] Use controlled test buyers and synthetic personal/payment data; never send a test blast to real customers.

**Done when:** the entire advertised owner and buyer journey is demonstrated with the real integrations, including at least one eligible non-app-role merchant when public access permits it.

### QA-05 — Test crashes, load, cost and recovery

**Owner:** Engineering. **Gate:** Pilot failure safety; Public capacity. **Depends on:** REL and OPS tasks.

- [ ] Restart/kill workers before acknowledgement, after durable receipt, during AI calls, after stock commit and around outbound sends.
- [ ] Test duplicate/out-of-order events, simultaneous confirmations, slow database, Meta throttling and revoked credentials.
- [ ] Test one noisy merchant without starving the others and observe per-shop limits/spending behavior.
- [ ] Rehearse deployment overlap, application rollback, backup restoration and the kill switch.
- [ ] Measure webhook persistence latency, queue age, end-to-end response latency and provider cost at expected load and a defined burst.
- [ ] Use mocks for destructive/high-volume failure injection and a small controlled provider test set; do not spend live API quota on unbounded load tests.

**Proposed performance targets:** p95 webhook acceptance under 2 seconds at the agreed load; p95 ordinary text reply under 15 seconds when providers are healthy; no silent loss of acknowledged messages. Voice/media operations have separate measured budgets. These are initial service targets, not statements that the current product achieves them.

### QA-06 — Close defects and produce the go/no-go report

**Owner:** Engineering prepares; Founder decides. **Gate:** Public. **Depends on:** QA-01 through QA-05 and PILOT-02.

- [ ] Close and retest every critical/high release defect; classify cosmetic low-risk issues explicitly with owners/dates.
- [ ] Check every visible feature and claim against implemented behavior; remove unsupported promises.
- [ ] Reconcile the final code, environment configuration, migrations, Meta permissions and pilot evidence.
- [ ] Produce a short report stating gate results, remaining limitations, supported number types, launch capacity and rollback plan.
- [ ] Obtain the founder's release decision on the actual version and operating plan.

**Done when:** all public gates pass with current evidence and the founder approves the release. This roadmap is not that approval.

## Minimum end-to-end acceptance scenarios

Each row needs a recorded result. Several may be automated together; security, provider and failure rows require the corresponding real integration or controlled fault test.

| # | Scenario | Expected result |
|---|---|---|
| T01 | New Facebook owner signs up | Exactly one inactive-until-ready shop and owner membership |
| T02 | Callback repeated or submitted concurrently | Same shop returned; no orphan records |
| T03 | Existing invited owner links Facebook | Same authorized shop/data, no email-based takeover |
| T04 | Consent denied, popup blocked or code expired | Clear retry path; no false connection |
| T05 | Merchant chooses new eligible number | Correct verified asset mapping and successful test round trip |
| T06 | Existing Business App/API number | Supported coexistence/migration route or honest eligibility boundary |
| T07 | Attacker substitutes another WABA/number ID | Rejected without reassignment or data exposure |
| T08 | Missing permissions, billing or catalog | Go live remains disabled, with a correct reason |
| T09 | Token revoked or number disconnected | Shop stops sending and shows reconnect; other shops continue |
| T10 | Shop A requests Shop B order/media/token | Denied across API, direct storage and database paths |
| T11 | Unknown product fact or policy | Clarification/handoff; no invented guarantee |
| T12 | Buyer negotiates below floor or injects instructions | Code-enforced boundary; confidential floor not disclosed |
| T13 | Buyer selects unavailable variant | No false order; available choice or owner clarification |
| T14 | Multiple items, quantity change and delivery fee | Correct final summary and stored total |
| T15 | Unsupported area or unclear address | No invented delivery commitment; clarification or refusal |
| T16 | COD placed normally | One order, one stock movement, amount due correctly stated |
| T17 | Last unit bought simultaneously | Only available quantity confirmed; other buyer gets a safe outcome |
| T18 | Stock/database call fails | No falsely confirmed order or untracked stock loss |
| T19 | Confirmation webhook repeated after restart | Same order; no repeated stock/payment transition |
| T20 | Bank screenshot submitted | Private claim pending owner decision, never automatically paid |
| T21 | Owner rejects then buyer resubmits | Clear history and pending new review; no duplicate order |
| T22 | Owner verifies from two tabs | One valid transition and consistent claim/payment/order state |
| T23 | Owner reviews after reply window | Allowed template or actionable failed-notification task |
| T24 | Unpaid bank order expires while review/cancel races | Agreed policy applied once; stock and payment stay consistent |
| T25 | Buyer switches bank order to COD | Same order and stock reservation, accurate amount due |
| T26 | Order cancelled twice | One effective cancellation/restoration; audit retained |
| T27 | Paid/returned/failed-delivery exception | Owner decision route; no invented refund or automatic restock |
| T28 | Owner takeover during slow bot work | Stale bot response/action suppressed |
| T29 | AI unavailable or quota exhausted | Bounded retries, safe fallback and useful owner notice |
| T30 | Send timeout after possible Meta acceptance | No repeated business transition; uncertainty visible and bounded recovery |
| T31 | Mixed-script name breaks PDF generation | Readable text confirmation; order remains correct |
| T32 | Staging job or local test targets a real number | Prevented by environment/recipient controls |
| T33 | New release fails | Known-good application restored; accepted orders preserved |
| T34 | Database and media restored | Correct records/files/permissions, no replay storm or unintended buyer messages |
| T35 | Deactivated/deleted merchant has queued work | No new sends or resurrection of deleted account data |
| T36 | Owner uses low-bandwidth phone browser | Critical workflow completes with accurate save/error feedback |
| T37 | Subscription expires, if paid launch | Disclosed limited behavior; historical order access/data preserved appropriately |
| T38 | Merchant requests export/deletion | Authorized export/deletion outcome matches documented policy |
| T39 | Unsupported file or hostile external image URL | Safely rejected/contained, no internal network or secret exposure |
| T40 | Marketing signup link and support contact used | Correct portal journey and monitored support route |

## Controlled pilot

### PILOT-01 — Recruit and prepare representative shops

**Owner:** Founder leads; Engineering assists. **Gate:** Before real-customer pilot. **Depends on:** Pilot technical/security gates, BIZ-01/02/04 and required Meta access.

- [ ] Choose 3–5 willing merchants across the intended initial category mix, not only founder-owned test accounts.
- [ ] Include at least two unrelated business/WhatsApp assets; include an existing Business App merchant if that route is advertised.
- [ ] Collect actual catalog, prices/floors, stock process, service areas, delivery charges, payment methods and exception policies.
- [ ] Explain that the owner still verifies bank receipts, fulfills orders and handles exceptions; confirm who monitors each shop.
- [ ] Agree the pilot terms, duration, support route, data handling and any fees before real customer use.
- [ ] Complete merchant-triggered test orders before allowing routine customers, with a clear test-data cleanup procedure.
- [ ] Record a baseline of current response time, inquiry/order handling and owner effort where feasible.

**Done when:** every pilot shop has a completed readiness record, named owner, valid Meta connection and a known support/stop procedure.

### PILOT-02 — Observe, fix and validate product value

**Owner:** Joint. **Gate:** Public. **Depends on:** PILOT-01 and live monitoring.

- [ ] Observe for at least 14 consecutive days; extend to 2–3 weeks or longer if usage is too low.
- [ ] Proposed combined minimum sample: 200 genuine supported shopping conversations and 30 placed orders across the cohort. Require some real activity from each shop and successful test coverage of both payment paths even if live customers favor one.
- [ ] Review missed answers, incorrect facts, abandoned checkout, owner intervention and failed notifications daily during the initial period.
- [ ] Measure signup completion, time to activate, reply latency, order correctness, intervention rate, cost per conversation/order and support time per merchant.
- [ ] Fix failures and rerun their regression scenarios; reset the relevant observation window after a critical correctness/isolation defect.
- [ ] Obtain owner feedback on whether routine replies/order capture save work and whether the fee proposition is understandable.
- [ ] Distinguish assisted orders from proven incremental sales; record limitations of any before/after comparison.

**Proposed exit:** no unresolved critical/high defect; no observed cross-shop data leak, unauthorized payment approval, below-floor sale, duplicate order or overselling caused by Sahulatcart; all G1–G9 evidence present; at least 3 merchants can perform normal operations without engineering intervention and want to continue. The sample validates a launch decision, not a statistical claim that failures are impossible.

## Local-market and commercial preparation

### BIZ-01 — Define the first market and an accurate product promise

**Owner:** Founder. **Gate:** Before pilot recruitment; Public copy before launch.

- [ ] Pick initial merchant categories and catalog complexity the product can actually support.
- [ ] Write a plain-language promise: fast merchant-specific replies, controlled discounts and order capture through WhatsApp.
- [ ] State eligibility for existing numbers and what setup the owner must complete.
- [ ] Explain ongoing owner responsibilities for payments, fulfillment and exceptions; avoid “100% guaranteed sales” or “no human work ever” claims.
- [ ] Defer unsupported merchant categories/integrations rather than selling a feature that has not passed its gate.

**Done when:** a prospective local merchant can understand the service, restrictions and responsibilities before signing up.

### BIZ-02 — Validate the problem and baseline with real owners

**Owner:** Founder, supported by Engineering analytics. **Gate:** Pilot design and Public claims.

- [ ] Interview 5–10 suitable owners about daily inquiries, unanswered chats, bargaining, stock accuracy, COD, bank review and current tools.
- [ ] Record examples they are comfortable sharing, removing personal buyer data where unnecessary.
- [ ] Identify the top recurring questions and loss points to prioritize the first evaluation scripts.
- [ ] Agree what a useful outcome means: fewer unanswered inquiries, faster replies, correct orders or lower manual workload.
- [ ] Record willingness to pay and onboarding objections, especially keeping an existing WhatsApp number and Meta billing.

**Done when:** the pilot and initial offer answer demonstrated merchant needs; no revenue-uplift percentage is invented.

### BIZ-03 — Build the cost model and PKR pricing

**Owner:** Founder + Engineering. **Gate:** Spending controls before Pilot; offer before Paid. **Depends on:** REL-05 and pilot measurements.

- [ ] Measure AI usage by operation, infrastructure baseline, storage/egress, notification services and support effort.
- [ ] Model a quiet shop, normal shop and high-volume shop, including bursts and manual review/support costs.
- [ ] Identify who pays Meta directly and exclude/include charges consistently in the merchant quote. Current Meta pricing varies by market/category and delivery; use the [official pricing page](https://whatsappbusiness.com/products/platform-pricing/) when calculating.
- [ ] Choose trial duration, monthly PKR price, usage allowance, fair-use/overage rules and a spending cap. Do not sell unlimited AI processing without a cost model.
- [ ] Include exchange-rate/provider-price sensitivity and a reserve for incidents; date the model rather than relying on old rate estimates.
- [ ] Confirm tax/invoice treatment and business payment arrangements with an appropriate Pakistani adviser.

**Done when:** the founder can explain expected revenue, direct cost and support burden per merchant and has approved a viable price/limit structure.

### BIZ-04 — Complete business identity, policies and support

**Owner:** Founder with appropriate adviser; Engineering implements. **Gate:** Pilot baseline; Public/Paid terms before those releases.

- [ ] Confirm legal/trading identity, registrations and applicable local tax/consumer/privacy obligations for the actual business and jurisdictions served. This roadmap does not declare a particular registration sufficient.
- [ ] Review merchant agreement, privacy, acceptable use, cancellation/refund terms for the SaaS subscription and data processing responsibilities.
- [ ] Distinguish subscription refunds from merchant-to-buyer product refunds; Sahulatcart does not automatically move customer funds.
- [ ] Ensure website policies match actual AI providers, retention, deletion and cross-border processing arrangements.
- [ ] Operate a monitored support email/contact, publish realistic Pakistan-time hours and define urgent incident escalation.
- [ ] Prepare a short Roman Urdu/English help guide: connect number, import catalog, set floors, verify payment, take over, reconnect and stop the bot.
- [ ] Prepare a process for abuse complaints, prohibited merchants and requests concerning buyer data.

**Done when:** real support requests reach a responder and public terms describe the product that is actually deployed.

### BIZ-05 — Implement a minimal subscription lifecycle

**Owner:** Founder + Engineering. **Gate:** Paid only. **Depends on:** BIZ-03/04.

- [ ] Decide how Sahulatcart collects its own fees. A controlled manual invoice/payment process can support an initial paid launch; an automated gateway is not mandatory.
- [ ] Record plan, trial start/end, allowance, active/suspended status, billing period and renewal/cancellation outcome.
- [ ] Show pricing/renewal terms before charging and provide receipts/invoices as appropriate.
- [ ] Define grace periods and what stops when unpaid; preserve reasonable access to existing orders, exports and support.
- [ ] Test renewal, duplicate payment recording, plan changes, cancellation and subscription refund records without affecting merchant customer-payment decisions.
- [ ] Protect subscription administration from ordinary merchants granting themselves arbitrary plans/credits.

**Done when:** each paid merchant's entitlement and fee record is explainable, and an expired subscription does not silently destroy their orders or produce undisclosed behavior.

### BIZ-06 — Prepare an evidence-based local launch campaign

**Owner:** Founder. **Gate:** Public. **Depends on:** PILOT-02, BIZ-01/03/04 and QA-06.

- [ ] Update the marketing site's features, price, eligibility, signup route, privacy and support information.
- [ ] Prepare a short demonstration using a real completed flow with consent and redacted customer data.
- [ ] Collect merchant testimonials/case studies only with permission; retain the evidence behind numerical claims.
- [ ] Choose an initial acquisition channel and limited cohort size; budget outreach/ads separately from infrastructure.
- [ ] Track visitor → signup → eligible connection → activated shop → active orders → retention, with appropriate analytics privacy.
- [ ] Schedule owner onboarding/support capacity before inviting the next batch.

**Done when:** acquisition sends eligible merchants into a working, supported signup flow, with claims backed by the pilot.

## Launch and early operation

### LAUNCH-01 — Prepare the release candidate

**Owner:** Engineering + Founder. **Gate:** Public. **Depends on:** all public gates.

- [ ] Freeze the release scope and identify the exact commit, migrations, provider configuration and known limitations.
- [ ] Verify the backup/restore and rollback evidence is current; check support/alert contacts.
- [ ] Confirm Meta permission/access status and actual supported number flows; recheck relevant policies before publication.
- [ ] Verify all domains/certificates, login/signup links, health checks, quota/billing limits and service ownership.
- [ ] Run the release acceptance suite and record the go/no-go decision.

**Done when:** there is one identifiable, tested release candidate with an approved operating plan.

### LAUNCH-02 — Open signup gradually and monitor

**Owner:** Founder + Engineering. **Gate:** Public launch execution. **Depends on:** LAUNCH-01.

- [ ] Deploy using the rehearsed sequence and verify the running commit, migrations and readiness.
- [ ] Complete a controlled signup/connection and test purchase after deployment before broad invitations.
- [ ] Open enrollment in batches within the tested merchant/traffic cap and available support capacity.
- [ ] Watch connection failures, payment/order correctness, queue age, response time and spending during the initial window.
- [ ] Publish only the approved feature/price claims and keep a simple channel for merchant incident updates.

**Stop enrollment immediately for:** cross-shop access, exposed credentials, incorrect/unauthorized payment state, repeat orders/stock corruption, persistent acknowledged-message loss or inability to recover safely. Isolate affected shops or pause automation as appropriate; preserve evidence and existing orders.

**Done when:** the first public cohort operates within tested limits and no stop condition is unresolved.

### LAUNCH-03 — Review the first 30 days

**Owner:** Joint. **Gate:** Continued rollout after launch.

- [ ] Days 1–3: daily review of onboarding, failures, support tickets and spend; keep enrollment small.
- [ ] Days 4–14: compare activation and sales-flow outcomes across shops, fix recurring friction and verify alerts/recovery remain effective.
- [ ] Days 15–30: review retention, owner workload, unit costs and subscription outcomes; decide whether to expand categories/capacity.
- [ ] Maintain model/prompt/API-version change tests and provider policy review dates.
- [ ] Prioritize the next feature from observed demand. Courier integrations, marketing automation, payments, advanced analytics and staff tools remain separate scope decisions.

**Done when:** growth is based on observed reliability, merchant value and cost, with named owners for the next improvements.

## Weekly founder review

Use a short weekly review while building:

1. Demonstrate what now works using an actual merchant/buyer scenario.
2. Show gates newly passed and the evidence behind them.
3. Review the top unresolved failures and current external Meta status.
4. Resolve upcoming founder decisions from D01–D15.
5. Check spending and update the effort estimate from actual progress.
6. Agree the next demonstrable milestone; do not add extra features without understanding the launch effect.

The immediate deliverable is a safe test environment and a verified baseline, followed by complete merchant signup/connection and corrected stock/message durability. Public marketing spend comes after the pilot demonstrates that those paths work.
