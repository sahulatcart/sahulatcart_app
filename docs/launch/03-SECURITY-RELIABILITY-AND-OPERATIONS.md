# 3. Security, reliability and operations

[Back to the roadmap](README.md) · [Previous: sales](02-CUSTOMER-SALES-AND-MERCHANT-TOOLS.md) · [Next: testing and market launch](04-TESTING-PILOT-AND-MARKET-LAUNCH.md)

**Goal:** each merchant's data and WhatsApp identity remain isolated; orders and payments remain correct during retries/failures; an operator can detect and recover problems. A passing unit test suite is useful evidence, but it is not a security certification or a live recovery demonstration.

This plan keeps the existing Next.js/Fastify/Supabase/Railway architecture. A new microservice platform, Kubernetes cluster or queue vendor is not required. Use the smallest design that demonstrates durable work and safe concurrency.

## Security tasks

### SEC-01 — Prove merchant isolation at every entry point

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** AUTH-02/04 and the current database access model.

- [ ] Inventory every API, storage access, RPC, job, webhook lookup and export that reads/writes merchant data.
- [ ] Derive merchant identity from a verified session or validated phone-number mapping; never from a browser-provided merchant ID alone.
- [ ] Test ID substitution for orders, messages, customers, products, bank accounts, screenshots, slips, notifications and settings.
- [ ] Validate parent/child tenant consistency in the database, including bulk imports and service-role writes.
- [ ] Prove anon/authenticated users cannot bypass the backend via Supabase tables, Storage or publicly executable RPCs.
- [ ] Inspect each new SQL function's execution grants, search path and privileges; restrict sensitive operations explicitly.
- [ ] Audit shared caches, pagination, logs and background-job parameters for accidental cross-shop reuse.

**Done when:** two independently authenticated shops fail every cross-shop read/write/send test, including after token refresh and during concurrent activity. The backend currently uses a privileged service role, so RLS alone does not prove its own queries are tenant-safe. See [Supabase's RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

### SEC-02 — Protect credentials and remove unsafe pilot shortcuts

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** OPS-01/02 and META-05.

- [ ] Inventory Meta app credentials, per-shop business tokens, Supabase keys, AI keys, database credentials and deployment credentials without printing values.
- [ ] Confirm previously exposed credentials were rotated; revoke unused credentials and remove abandoned integrations.
- [ ] Keep secrets server-only and scan code, build output, repository history, logs and error reports for accidental disclosure.
- [ ] Implement authenticated token encryption, key versioning, rotation and a recoverable key-backup procedure with limited access.
- [ ] Replace or tightly isolate the shared ADMIN_API_TOKEN fallback before outside merchants. Use individual, audited platform access and appropriate step-up authentication for sensitive support actions.
- [ ] Make environment validation reject missing critical production configuration; do not start a supposedly live messaging service in silent no-credentials mode.
- [ ] Redact authorization headers, signup codes, private URLs and provider response bodies where they can include secrets.

**Done when:** tokens never appear in the browser or ordinary logs; rotation is demonstrated; loss/revocation of one merchant token stops only that merchant.

### SEC-03 — Secure sessions, authorization and sensitive actions

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** AUTH-01 through AUTH-04.

- [ ] Review the chosen session storage/cookie model for XSS, CSRF and cross-origin risks; use protections appropriate to that model.
- [ ] Restrict redirect URLs and CORS origins; implement security headers/CSP compatible with the required Meta signup screens.
- [ ] Enforce ownership on payment decisions, bank changes, account recovery, disconnect, exports and deletion.
- [ ] Require appropriate reauthentication for ownership/payment-destination changes and audit who made them.
- [ ] Enforce shop/owner suspension on existing sessions; do not rely only on stale token claims.
- [ ] Apply endpoint-specific rate limits and abuse controls to login, provisioning, connections and costly actions.

**Done when:** a stolen low-privilege context, forged request or stale/deactivated session cannot perform an owner/platform action it is not entitled to.

### SEC-04 — Validate all inputs and limit resource abuse

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** API inventory in SEC-01.

- [ ] Use explicit schemas/field allowlists for settings, products, payment actions, imports and connection callbacks.
- [ ] Bound message length, body size, arrays, file size, paging and numeric ranges; reject unsupported types consistently.
- [ ] Prevent arbitrary settings keys from bypassing readiness, limits or merchant status.
- [ ] Treat product descriptions, chat messages, OCR/transcripts and model output as untrusted input.
- [ ] Rate-limit expensive product-description, transcription, import and AI functions per merchant/user, with fair global safeguards.
- [ ] Test SQL/HTML/script injection, malformed encodings, log injection and spreadsheet formula injection in exports.

**Done when:** malformed or expensive requests fail predictably without corrupting state, exposing secrets or starving other merchants.

### SEC-05 — Secure uploads, downloads and private media

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** META-05, SALE-02/11/12.

- [ ] Keep screenshots, inbound evidence and slips private; use authorized, short-lived access with tenant validation.
- [ ] Validate supported media types using content checks as appropriate, not only the extension supplied by the client.
- [ ] Bound download size, processing time and image/document dimensions; prevent unsafe active content from being served inline.
- [ ] Protect server-side URL fetching against internal/private network access, unexpected redirects, credential forwarding and hostile imported URLs.
- [ ] Use merchant-scoped authorization for Meta media retrieval and check the media's context before attaching it to an order.
- [ ] Keep storage paths non-guessable and scoped; test direct bucket requests and copied signed links after expiry.
- [ ] Record cleanup for failed imports/uploads and do not expose personal evidence in owner notification previews.

**Done when:** shop B cannot obtain shop A's evidence through either APIs or storage, and a malicious uploaded URL/file cannot access internal services or exhaust the worker.

### SEC-06 — Make privacy, retention and deletion real

**Owner:** Founder + Engineering. **Gate:** Pilot baseline; full owner deletion before Public. **Depends on:** D12, AUTH-03 and OPS-05.

- [ ] Map stored personal data: owner identity, buyer contact/address, chat text, audio/media, order records and payment evidence.
- [ ] State which data reaches Meta, Supabase, Railway, the AI provider and support/monitoring tools; verify their relevant settings and contractual/data-use options.
- [ ] Set retention for message text as well as raw payloads, resolved/unresolved evidence, logs, exports and backups. Existing jobs cover only part of this lifecycle.
- [ ] Reconcile the actual retention jobs with public privacy wording and merchant terms.
- [ ] Implement authenticated deletion requests, Meta deauthorization/data-deletion handling where required, deletion status and an audit trail without unnecessary retained content. Verify provider callback signatures and applicable freshness/replay protections before deleting or disconnecting anything.
- [ ] Define lawful/contractual record-retention exceptions with an appropriate adviser; explain them rather than silently retaining everything.
- [ ] Test deletion across database rows, storage, exports and queued work; document backup expiry and restoration handling for previously deleted records.

**Done when:** a test merchant's deletion request produces the documented outcome and no later worker recreates deleted data or resumes messaging.

### SEC-07 — Review dependencies and attack the release

**Owner:** Engineering; independent reviewer where available. **Gate:** Public, with critical findings fixed before Pilot.

- [ ] Inventory runtime/build dependencies and supported Node/Next/Fastify/Supabase/Meta API versions.
- [ ] Run dependency and secret scans; prioritize reachable security issues and record remediation/justification.
- [ ] Review authentication, tenant routing, onboarding asset binding, uploads, admin recovery and transaction integrity as the highest-risk paths.
- [ ] Perform an adversarial review separate from ordinary happy-path testing; use a second qualified reviewer if available.
- [ ] Re-test fixes and document remaining risk with an owner and deadline. No unresolved critical/high launch issue is accepted merely to meet a date.

**Done when:** the release has an evidence-based security review and no unresolved issue that permits cross-shop access, token theft, unauthorized money/status changes or comparable harm.

### SEC-08 — Limit and audit platform support access

**Owner:** Engineering + Founder. **Gate:** Pilot.

- [ ] Define who can inspect merchant data and under what support reason; no automatic blanket impersonation.
- [ ] Provide minimum support operations: find a merchant, see connection/processing health, pause automation, inspect a redacted error, and initiate a safe replay/recovery.
- [ ] Audit support access, status changes, manual retries, key rotations and exceptional corrections.
- [ ] Keep customer/payment data out of public tickets and recordings; use redacted examples for debugging.
- [ ] Test revocation of a platform administrator's access and retain account-recovery information securely.

**Done when:** a real support incident can be diagnosed without sharing raw credentials or silently altering merchant data. This is platform operation, not a staff-management feature sold to merchants.

## Messaging and business-data reliability

### REL-01 — Persist inbound events before acknowledging them

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** database schema/constraints and OPS-02.

Current issue: webhookRoutes sends HTTP 200 before processWebhookPayload saves the event. A crash or failed database write during that interval can lose the message despite telling Meta it was accepted. claimEvent also continues processing on some database errors.

- [ ] Verify signature and payload shape first, then durably store accepted inner events with unique provider event identities.
- [ ] Return success only after persistence; keep expensive AI/checkout work outside the request.
- [ ] On transient persistence failure, return an appropriate retriable response instead of processing an untracked event.
- [ ] Make duplicates harmless, including batches partly persisted before failure; distinguish duplicates from database outages.
- [ ] Give malformed, unknown-number and unsupported events explicit handling without creating an uncontrolled retry loop.

**Done when:** killing the process at each acceptance boundary leaves either a durable recoverable event or a retriable request; no accepted supported message disappears silently.

### REL-02 — Use durable work claims and safe concurrency

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** REL-01 and SALE-08/11.

- [ ] Replace in-process-only correctness assumptions with database-backed claims/leases/locking suitable for the deployment model.
- [ ] Serialize state transitions for the same conversation and conflicting orders, while allowing independent shops/buyers to progress.
- [ ] Use atomic operations and lease expiry/fencing as needed so a stalled old worker cannot later overwrite a new worker's state.
- [ ] Define bounded retries, transient/permanent errors, retry timing and a visible dead-letter queue.
- [ ] Test overlapping old/new deployment processes even if normal configuration uses one replica.
- [ ] Do not claim that setting REDIS_URL makes scaling safe; the actual cross-process concurrency mechanism must exist and be tested.

**Done when:** restarts and overlapping workers do not double-place an order, overwrite newer conversation state or drop unfinished work.

### REL-03 — Add a durable outbound queue and honest delivery status

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** REL-02, META-05/10.

- [ ] Commit intended notifications alongside business transactions using an outbox or equivalent durable design.
- [ ] Track pending, submitted, delivered, read, failed and uncertain outcomes separately where available.
- [ ] Classify Meta rate limits, transient failures, expired authorization and permanent payload failures; use timeouts/backoff and stop futile retries.
- [ ] Recheck merchant status, connection, takeover and message-window/template rules immediately before sending.
- [ ] Store provider IDs and handle duplicate/out-of-order status callbacks without regressing a delivered message to sent.
- [ ] Handle the ambiguous case where Meta may have accepted a send before our request timed out. Do not promise exactly-once external delivery or blindly resend indefinitely.
- [ ] Ensure repeated notifications can never repeat the underlying order/payment/stock transition.

**Done when:** a database commit followed by a send failure preserves one correct order, creates a recoverable message job and shows the owner the actual outcome.

### REL-04 — Reconcile inconsistent or abandoned business state

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SALE-08/09/11, REL-02/03.

- [ ] Identify partial historical records from current multi-write flows: missing order lines/payments, inconsistent claim states or reserved stock without a valid order.
- [ ] Build read-only reconciliation reports first; define explicit corrective operations rather than silent broad rewrites.
- [ ] Make payment/order/history updates transactional or safely recoverable; check every required database error.
- [ ] Handle expiry jobs, cancellation and owner verification racing over the same order.
- [ ] Surface records requiring human judgment, especially bank-transfer/refund ambiguity.

**Done when:** a deliberate failure between writes either rolls back cleanly or appears in a tested recovery workflow; the portal never reports a false completed transition.

### REL-05 — Bound AI/provider failures and spending

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** BIZ-03 and SALE-05/15.

- [ ] Configure timeouts, concurrency limits and bounded retry budgets for AI, Meta and external media calls.
- [ ] Set per-shop usage/spending controls and global protection against a burst consuming the whole provider quota.
- [ ] Measure AI use by operation: intent, reply, transcription and product-description work.
- [ ] Provide a safe fallback or owner handoff when quota/provider access fails; avoid endlessly repeating the same paid call.
- [ ] Keep health monitoring from generating paid AI traffic. In this repository, /readyz?llm=1 performs a real model request and must not be a routine polling target.

**Done when:** a provider outage or abusive chat has bounded cost and leaves correct, recoverable orders while unaffected shops remain usable.

## Environments, deployment and operation

### OPS-01 — Record what actually runs and who owns it

**Owner:** Engineering + Founder. **Gate:** Internal.

- [ ] Map GitHub repository/branch/commit to the three services: marketing site, merchant portal and backend.
- [ ] Record Railway projects/services/domains, Supabase projects, Meta app/webhook, AI provider and account owners.
- [ ] Verify deployed commit, migration history, bucket access and configured features through safe metadata-only checks.
- [ ] Correct stale README/db/spec claims: current migrations go beyond 0002, Gemini is implemented, and public launch includes self-service onboarding.
- [ ] Record a known-good release and operational contacts without storing secrets in the map.

**Done when:** everyone can identify which repository, configuration and database serve each real URL. A passing local test is not misreported as production verification.

### OPS-02 — Separate development, staging and production

**Owner:** Engineering + Founder for budget. **Gate:** Internal before realistic integration work; Pilot mandatory.

- [ ] Development is local implementation; staging is the isolated rehearsal system; production serves real merchants.
- [ ] Use distinct database/storage/auth configuration and credentials for staging and production, with no accidental real-shop token reuse.
- [ ] Configure appropriate separate Meta test assets/app setup or supported testing arrangement; allowlist staging recipients.
- [ ] Use synthetic or anonymized fixtures; copied production personal data needs a justified controlled process.
- [ ] Make environment visible to operators and prevent staging jobs from processing production queues or sending to real buyers.
- [ ] Verify domain/callback differences explicitly for Facebook login and Embedded Signup.

**Done when:** an automated staging test cannot create an order in the production database or send using a production merchant number. Railway supports isolated configuration through [environments](https://docs.railway.com/environments); the database and provider assets still require deliberate separation.

### OPS-03 — Make releases reproducible and reversible

**Owner:** Engineering. **Gate:** Pilot.

- [ ] Add CI for shared/backend/admin type checks, backend tests, appropriate browser/integration suites and both application builds.
- [ ] Configure a real linter or remove any implication that the existing placeholder lint script performs checks.
- [ ] Use locked dependency installation and protected review/checks for the release branch.
- [ ] Fix Railway watch paths to include relevant shared code, root package/lockfiles and build configuration. Current per-folder paths miss some dependency changes.
- [ ] Reconcile repository Docker/Railway configuration with the actual provider settings; use one documented source of deployment truth.
- [ ] Apply database migrations through an ordered, recorded process; use compatible changes so the previous app version can run during rollout.
- [ ] Rehearse application rollback and define a forward-repair procedure for irreversible data migrations. Rolling back an app does not automatically roll back the database.
- [ ] Do not run an admin production build into the same .next directory as an active local dev server; use CI or an isolated build checkout.

**Done when:** a fresh checkout builds reproducibly, shared changes trigger the affected services, and a failed release can be reversed without losing merchant orders.

### OPS-04 — Monitor failures that matter to merchants

**Owner:** Engineering + Founder/operator. **Gate:** Pilot. **Depends on:** REL-01 through REL-05.

- [ ] Track webhook persistence failures, queue age, dead letters, reply latency, send failures, connection health, order/payment errors and resource saturation.
- [ ] Add structured correlation IDs for merchant, conversation, order and event while redacting personal content.
- [ ] Measure availability and backend readiness without paid model probes; monitor actual successful messaging separately.
- [ ] Configure alert thresholds, destination, severity and named responder; test alert delivery with a controlled failure.
- [ ] Add provider spending/quota alerts and document where to inspect the underlying error.
- [ ] Detect retention/reconciliation job failures and persistent backlog rather than assuming scheduled code ran.

**Done when:** deliberately breaking a test connection or worker produces a useful alert and a visible owner-facing state before the issue is discovered through a complaint.

### OPS-05 — Back up and restore database, media and configuration

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** D12/13 and SEC-02/06.

- [ ] Choose recovery-time and recovery-point targets that the budget and provider plans can actually support. The proposed 4-hour/15-minute targets are not achieved until demonstrated.
- [ ] Enable/verify suitable database backups or point-in-time recovery and secure independent recovery access.
- [ ] Back up required product media, evidence and slips separately, consistent with retention; database backups alone do not include Storage objects. [Supabase documents this limitation](https://supabase.com/docs/guides/platform/backups).
- [ ] Preserve encryption-key versions and essential configuration securely so restored credential rows remain usable; test safe key recovery without leaking keys.
- [ ] Restore into an isolated environment, validate representative orders/media, and reconcile post-restore message events without re-sending old orders.
- [ ] Document restoration of permissions, auth configuration, subscriptions/jobs and deletion obligations after recovery.

**Done when:** an actual timed restore succeeds and its measured data-loss/recovery window is accepted by the founder before real merchants rely on it.

### OPS-06 — Prepare incident response and capacity limits

**Owner:** Engineering + Founder. **Gate:** Pilot basics; Public capacity proof. **Depends on:** OPS-04/05 and QA-05.

- [ ] Write short runbooks for Meta outage/revocation, model quota, database outage, stuck orders, duplicate-event storms, compromised credentials and failed deployments.
- [ ] Define who pauses a shop/platform, who communicates with affected merchants and who authorizes re-enablement.
- [ ] Maintain a tested kill switch that prevents new automated actions while preserving evidence and permitting safe investigation.
- [ ] Load-test expected pilot/public traffic and bursts; set a documented merchant/traffic cap below observed safe capacity.
- [ ] Configure connection pools, worker concurrency, request limits and storage budgets; scale only after cross-process tests pass.
- [ ] Define incident severity, response hours and escalation contacts; avoid promising 24/7 human support without staffing it.

**Done when:** a simulated incident can be detected, contained, communicated and recovered using the runbook, and launch enrollment stays within tested capacity.
