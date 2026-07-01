# 10 — Audit Report & Canonical Decisions

Five independent auditors reviewed the spec (lenses: data-model integrity, completeness, flows/state-machines, security/multi-tenancy, dependencies/integration). **129 raw findings**; after de-duplication, ~45 distinct issues. This doc records them and — more importantly — the **canonical decisions** that resolve every contradiction. Where docs disagreed, the decision here wins and the docs are edited to match.

## Severity tally (raw)
| Lens | Findings | Critical | High |
|---|---|---|---|
| Data-model (DM) | 31 | 4 | 11 |
| Completeness (CO) | 26 | 1 | 8 |
| Flows (FL) | 20 | 2 | 3 |
| Security (SEC) | 30 | 7 | 11 |
| Dependencies (DEP) | 22 | 1 | 6 |

## Cross-cutting root causes (caught by multiple auditors → highest confidence)
1. **`platform_admin` has no schema home** — DM-1, CO-25, DEP-10, SEC-4.
2. **`whatsapp_secrets` (encrypted token store) missing** — DM-2, DEP-9, SEC-8.
3. **Async job table missing** behind CSV import / catalog sync — DM-3, CO-2, DEP-4.
4. **API path/verb divergence (doc 03 vs 07/08)** — DM-4, CO-1, FL-13.
5. **Order-materialization timing undefined/contradictory** — FL-1, DEP-15, CO-15.
6. **Bank flow confirm-vs-pay ordering reversed** (05 vs 08/03) — FL-2.
7. **`cod_pending` set at two different times** — FL-3, DM-23.
8. **RLS depends on an unspecified Auth Hook; policy not hardened** — SEC-1, SEC-2, DEP-11.
9. **Env-var names inconsistent** (`WHATSAPP_*` vs `META_*`) — DEP-1, SEC-20.
10. **Outbound price-match guard only proposed** — SEC-5, DEP-21.
11. **`merchants.settings` / `negotiation_defaults` / `conversations.context` shapes unpinned** — DM-5, DM-6, DM-11, CO-4, CO-14, CO-19.
12. **Payments 1:1 vs resent screenshots; no claim history** — DM-7, CO-10, FL-4.
13. **No refund/return model; COD collection overloads `verified_at`** — DM-8, DM-9, CO-6, CO-12, SEC-26.
14. **Screenshot signed-URLs stored/sent in notifications; no retention job** — SEC-14, SEC-10.
15. **Staff can verify payments / see cost-margin** (matrix conflict) — SEC-3, SEC-15.

---

## CANONICAL DECISIONS (these are now normative)

### Schema (applied to doc 02)
- **CD-1** Add table **`platform_admins`** (`id, auth_user_id unique, name, email, is_active`). `platform_admin` is NOT added to `user_role`. Cross-tenant access via a distinct RLS bypass policy keyed on the `platform_admin` JWT claim, minted server-side only.
- **CD-2** Add table **`whatsapp_secrets`** (`id, merchant_id, kind, ciphertext bytea, iv, auth_tag, key_id, created_at, rotated_at`). Service-role-only + FORCE RLS. `whatsapp_numbers.access_token_ref` → `whatsapp_secrets.id`; dereference rule: `NULL`/`'platform'` ⇒ use `META_SYSTEM_USER_TOKEN` env (Path C).
- **CD-3** Add table **`background_jobs`** (`id, merchant_id, type[product_import|catalog_sync], status[queued|processing|completed|failed], input jsonb, result jsonb, error, file_url, error_report_url, created_at, started_at, finished_at`). Backs the async import/sync poll endpoints.
- **CD-4** Add table **`payment_claims`** (child of `payments`): `id, payment_id, order_id, merchant_id, screenshot_url, reference, amount, status[claimed|verified|rejected], rejection_reason, claimed_at, decided_at, decided_by_user_id`. `payments` stays the current-state row (latest pointer). Preserves full claim history.
- **CD-5** `payments`: add `cod_collected_at`, `cod_collected_by_user_id`, `refunded_at`, `refund_reason`. `payment_status` enum: add **`refunded`**. `orders`: add `returned_reason`, `payment_locked bool default false`.
- **CD-6** `negotiations`: make `product_id` **nullable**; add `scope[line|cart] default line`, `line_allocations jsonb`, `final_offered bool default false`.
- **CD-7** `order_items`: add `negotiated_discount int default 0`, `discount_source[negotiated|manual|coupon|none]`, `negotiation_id uuid null`.
- **CD-8** `customers`: add `wa_opt_in_status[unknown|in|out] default unknown`, `wa_opt_in_source`, `wa_opt_in_at`.
- **CD-9** `whatsapp_numbers`: type the enums — `quality_rating[green|yellow|red|unknown]`, `messaging_tier[unverified|tier_1|tier_2|tier_3|tier_4]`; add `token_expires_at`, `token_rotated_at`, `flag_reason[quality|token|policy|manual|null]`.
- **CD-10** `message type` enum: add `video`, `sticker`, `reaction`, `order`; add `messages.raw_type text` to preserve exact Meta type. Native catalog `order` maps to an order draft (see CD-18).
- **CD-11** Storage: add private bucket **`inbound-media/{merchant_id}/{conversation_id}/{uuid}.<ext>`** (signed URLs, MIME/size allowlist, same retention as screenshots).
- **CD-12** `webhook_events`: **one row per inner item**, `event_id` = the item's `wa_message_id`/`statuses[].id`; add `item_type[message|status]` and `status[received|processed|error|dead_letter]` + `attempts int`. On unique-violation, skip that item only.
- **CD-13** Pin canonical JSON shapes in doc 02 (as `shared/` TS types): `merchants.settings` (`botEnabled, codEnabled, paymentInstructions, defaultDeliveryCharge, freeDeliveryThreshold, lowStockThreshold, onboardingCompletedAt, metaCatalog{catalogId,connected,tokenRef,lastSyncedAt}, notificationPrefs`), `merchants.negotiation_defaults` (+`openingStance`, `stalemateAction`, `bulkTiers`; `concessionSteps` = **cumulative fractions 0→1** of the list→floor gap), and `conversations.context` (per doc 05 §1.3).
- **CD-14** Optional/reserved: `dead_letters` surface (or reuse `webhook_events.status`), `llm_calls` cost table, `merchant_users.notification_prefs jsonb`. Note `pgvector` must be enabled before `bot_knowledge.embedding` ships.

### Flows / state machines (applied to docs 03, 05, 08)
- **CD-15** **Order materialization:** cart lives in `conversations.context` through `order_building`; on entry to `collecting_delivery`, write `orders(status='draft')` + `order_items` (guarantees an `order_id` for payment/slip). `draft→pending_confirmation` on entry to `selecting_payment`. `pending_confirmation→confirmed` on the buyer's explicit final confirm (assigns `order_number`, `placed_at`, slip, stock decrement, `new_order`). Adopt auditor #3's consolidated `order_status` table verbatim.
- **CD-16** **Bank transfer = confirm-then-pay.** Buyer confirms the order first (`→confirmed`), then `confirmed→awaiting_payment`, bot state `awaiting_payment_proof`, `send-bank-details`. Screenshot → `claimed` (state stays `awaiting_payment_proof`, NOT `confirming`). Merchant verify → `verified` + `awaiting_payment→paid`, bot state `completed`. Remove the "buyer says yes again after paying" step. Fix 08 §A2.4 and 05 diagram.
- **CD-17** **COD:** `payment_status='cod_pending'` set **at COD selection** (not dispatch). Remove dispatch-time `cod-mark-pending` as a required transition. `cod_pending→cod_collected` at delivery (uses `cod_collected_at`). COD never passes through `unpaid/claimed/verified/paid`.
- **CD-18** **`failed` is a resting state** after reject (no auto-reset to `unpaid`). Retry edge: `failed→claimed` on a new screenshot. Single `payments` row created once, at payment-method selection (idempotent upsert on unique `order_id`).
- **CD-19** **Takeover/release own the state mirror:** the endpoints (not just prose) save `context.resume_state=current_state` + set `current_state='handoff'` on takeover (explicit or implicit-agent-send), and restore `current_state=resume_state` on release. Inbound during `human_takeover` short-circuits BEFORE state routing — a screenshot is stored but NOT auto-claimed.
- **CD-20** **Serialize per conversation:** strictly one in-flight worker per `conversation_id` (FIFO per key) + `pg_advisory_xact_lock(hashtext(conversation_id))` around the context read-modify-write. `payments` verify/reject/claim guarded by `SELECT … FOR UPDATE` + state guard.
- **CD-21** **Abandonment = preserve, not cancel, at launch.** No auto-cancel of `draft`/`awaiting_payment`. A background job flips `negotiations ongoing→abandoned` on window expiry (actor `system`); order/payment/bot_state untouched; buyer's next inbound resumes/opens a fresh negotiation. `awaiting_payment→cancelled` and `draft→cancelled` are manual-only.
- **CD-22** **Negotiation math:** `order_items.discount` = TOTAL line discount = `(list_unit − agreed_unit) × qty`; identity `line_total = unit_price×qty − discount` holds. Fix 05 §3b example.
- **CD-23** **Agreed price is locked:** re-entering `negotiating` on an `agreed` product returns HOLD at `agreed_price` (reason `agreed_locked`); only a quantity change (recompute within floor) or takeover can alter it.
- **CD-24** **Stalemate→handoff timing:** handoff only after the final floor offer is rejected (`rounds≥roundsMax && final_offered && offer<floor`). Fix 05 §4.1.
- **CD-25** **Intent enum:** doc 05 §2.1 is canonical; replace doc 03 §3.7's divergent list. `handoff` is a routing outcome, not an intent. Add `entities.items[]` for multi-item turns and a `stop`/opt-out intent (CD-8).

### API / dependencies (applied to docs 03, 04, 07, 08, 09)
- **CD-26** **Doc 03 §6 is the canonical API route table.** Rewrite doc 07/08 references to match. Payment actions are **`POST`** (not PATCH). Canonical names: `GET /session`, `PATCH /merchant`, `/conversations/:id/release`, `/product-categories`, `/message-templates`, `/products/import`, `/products/catalog-sync`, `/team/invite`. Add missing ones referenced by 07 to doc 03: `GET /dashboard/summary`, `GET /analytics/*`, `POST /orders/:id/slip/resend`, number `POST /whatsapp-numbers/:id/reconnect`, `GET /whatsapp-numbers/:id/health`, `GET /readyz`, plus platform-admin number-registration endpoints (CD-1).
- **CD-27** **Env-var names: `META_*` (doc 09) is canonical.** Fix doc 04 (`WHATSAPP_*`→`META_*`) and doc 03 (`META_VERIFY_TOKEN`→`META_WEBHOOK_VERIFY_TOKEN`). Startup-assert all secrets present & non-empty (fail fast). Decide internal-auth once: keep doc 03's HMAC service token, add its secret to doc 09, drop the ambiguous `INTERNAL_API_KEY`.
- **CD-28** **Catalog Graph API:** add a "Catalog/Commerce API" section to doc 04 (endpoints `GET /{waba}/product_catalogs`, `GET /{catalog_id}/products`, token scope `whatsapp_business_management`/`catalog_management` — VERIFY LIVE, pagination, `retailer_id→products.external_ref` upsert). Store connection in `merchants.settings.metaCatalog`.
- **CD-29** **Realtime publication list is explicit in doc 03 §5:** `conversations, messages, orders, payments, notifications, negotiations, whatsapp_numbers`; add the `ALTER PUBLICATION supabase_realtime ADD TABLE …` step; confirm Realtime honors RLS `merchant_id` scoping. Adds the missing `whatsapp_numbers` channel (DEP-2).
- **CD-30** **Slip generator:** pin HTML-template + headless-Chromium/Puppeteer (Roman-Urdu/emoji font embedding required); add layout spec to doc 08; add dependency to doc 09.
- **CD-31** **Claude client:** name `@anthropic-ai/sdk`; commit a concrete default model id + a cheaper fallback model, both env-configurable and tagged VERIFY LIVE against the claude-api reference; document prompt-caching + per-message token budget.
- **CD-32** **Email channel:** pick a provider (Resend) + env config, OR mark email deferred at launch (portal realtime primary). Merchant-WhatsApp alerts need `merchant_new_order`/`merchant_payment_claim` utility templates added to doc 04's launch set, else that channel is deferred.
- **CD-33** **Global bot kill-switch:** `merchants.settings.botEnabled`; a `PATCH` toggles it; the orchestrator gate suppresses autonomous replies when false (optional holding line); go-live sets it true.
- **CD-34** **Single-instance guard:** backend refuses to start with replicas>1 unless `REDIS_URL` is set (protects per-conversation ordering). Separate Meta app/verify-token per environment (staging must not clobber prod webhook).

### Security (applied to docs 02, 03, 07, 09)
- **CD-35** **Harden RLS** on every tenant table: `for all to authenticated`, explicit `::uuid` cast with `nullif(...,'')`, `is not null` guard, and `force row level security`. Provable default-deny when the claim is absent. Add a zero-rows/insert-denied test.
- **CD-36** **Specify the Custom Access Token Auth Hook** (in `db/`): looks up `merchant_users` by `auth_user_id`, rejects deactivated users, injects `merchant_id` + `role` (+ `platform_admin` from `platform_admins`); handles no-merchant and multi-merchant cases. Integration-tested.
- **CD-37** **One permission matrix** (doc 09's, strictest, is canonical): **staff CANNOT** verify/reject payments, CRUD bank accounts, or see `cost`/margin/`raw`. Enforce at API route guard AND strip sensitive fields server-side for `role='staff'`. Fix doc 03 endpoint role columns.
- **CD-38** **Outbound price-match guard** is a MANDATORY composer step (CD/SEC-5): extract every currency figure from the composed message; assert it equals the engine's `priceToName` and no other price appears; on mismatch don't send — regenerate once, else canned template/handoff. Release-gated test.
- **CD-39** **Service-role write safety:** restricted worker DB role (not full service-role) + parent/child `merchant_id` CHECK triggers (`messages→conversations`, `order_items→orders`, `payments→orders`) + a repository layer requiring `merchant_id`. DB-level guard is primary, tests secondary.
- **CD-40** **Screenshot URL hygiene:** never store/transmit signed screenshot URLs in `notifications`; store `orderId`/`paymentId` only; mint short-lived single-use signed URLs on demand at portal view after a role/RLS check. Reconcile TTL to one short value.
- **CD-41** **Retention/erasure jobs:** scheduled purge of `payment-screenshots` (90d post-completion) + `webhook_events`/`messages.raw` (30d); tenant-offboarding cascade (delete-by-`merchant_id` + storage prefixes + token revocation) and buyer-erasure routine, as platform-admin ops with `audit_log`.
- **CD-42** **Merchant/WABA protection (Path C):** vetting gate before `status='active'` + product-category attestation + prohibited-keyword screen on catalog import raising a review task; automated quality circuit-breaker (`quality_rating='red'`→auto-pause proactive sends); merchant-agreement acceptance record. Opt-in/STOP enforcement (CD-8) gates all business-initiated sends.
- **CD-43** **Webhook & LLM abuse limits:** cheap pre-HMAC burst limiter + `WEBHOOK_MAX_BODY_BYTES` enforced before HMAC; per-conversation + per-merchant Claude call/token budget enforced at the worker with kill-switch + alert; `is_blocked` short-circuits at the persist step before the LLM.
- **CD-44** **Signature comparison hardening:** decode to buffers, length-check, `timingSafeEqual`; test valid/invalid/missing/malformed-length vectors. Decide cookie-session CSRF (SEC-22): if cookies used for mutations, mandate SameSite + CSRF tokens; else drop `SESSION_SECRET`.
- **CD-45** **CSV/upload hardening:** sanitize CSV cells on import AND export (formula-injection prefixes); `image.link` allowlisted to the tenant's own bucket; cap decoded image dimensions/pixels; shared log/Sentry PII redactor (mask phone, strip tokens/URLs/screenshots).

---

## Full findings index
Every raw finding (DM-1…31, CO-1…26, FL-1…20, SEC-1…30, DEP-1…22) maps to one or more canonical decisions above. The per-lens reports are archived in the workflow transcript. Post-fix, the five end-to-end traces (buyer→reply, negotiation→slip, bank-payment, catalog-sync, notifications) all pass once CD-15/16/28/30/32 land.

## Fix status
See the changelog at the bottom of this file (updated as edits are applied to docs 02–09).

### Changelog — ALL FIXES APPLIED ✅
- **doc 02** (data model) — rewritten: added `platform_admins`, `whatsapp_secrets`, `background_jobs`, `payment_claims`, `dead_letters`, `llm_calls`; added fields (cod_collected_at, refunded status/fields, returned_reason, payment_locked, final_offered, negotiation scope/line_allocations/nullable product_id, order_items discount attribution, customer opt-in, whatsapp token/quality/tier enums); pinned `settings`/`negotiation_defaults`/`context` shapes; added `inbound-media` bucket; extended `message_type`; per-item `webhook_events`; hardened RLS + worker-role guards. (CD-1…14, 35, 39)
- **doc 00** — glossary floor definition fixed; out-of-scope decisions added (review/upsell/STT/proactive) (DM-30, CO-9/21).
- **doc 01** — payment verb PATCH→POST.
- **doc 03** (API) — canonical route table locked; corrected order-status transitions; POST payment verbs; background_jobs/payment_claims wiring; permission matrix; Realtime publication list; bot kill-switch; intent set; env/HMAC naming. (CD-15,17,20,25,26,27,29,33,37)
- **doc 04** (WhatsApp) — env canonicalization; per-item webhook idempotency; extended message types + catalog `order` mapping; new Catalog/Commerce API section; merchant templates; signature hardening; token dereference. (CD-2,9,10,12,27,28,32,44)
- **doc 05** (bot flows) — order materialization at collecting_delivery; confirm-then-pay bank flow; cod_pending at selection; failed as resting state; takeover mirror + no auto-claim; negotiation math; agreed-lock; stalemate timing; stop intent; bank-unavailable edge; kill-switch; pull-only fulfilment. (CD-15,16,17,18,19,20,22,23,24,25,33)
- **doc 06** (negotiation) — GAP notes marked resolved (fields now in doc 02); glossary/cross-ref cleanup.
- **doc 07** (screens) — all API paths aligned to canonical routes; permission matrix definitive; settings keys pinned; analytics metric definitions; screenshot hygiene; payment_locked edit guard; claim history; kill-switch; whatsapp health enums. (CD-2,3,4,9,13,15,19,26,29,33,37,40,42, CO-18)
- **doc 08** (payments/notifications) — confirm-then-pay + COD selection timing; failed resting; payment_claims history; refund modelling; screenshot-URL hygiene; channels/templates; opt-out. (CD-4,5,8,15,16,17,18,26,32,40,42)
- **doc 09** (devops/security) — Auth Hook specified; RLS hardened; worker-role guards; env canonical + fail-fast; slip generator; Claude SDK/model; price-match composer step; retention/erasure jobs; abuse limits; upload hardening; ops guards. (CD-27,30,31,34,35,36,37,38,39,40,41,43,44,45)
- **Final consistency sweep** — analytics endpoint names reconciled (07→canonical), HMAC secret name aligned (03↔09), no residual "order created at confirming"/"cod at dispatch"/"platform_admin in enum" contradictions. Spec = 12 docs, ~7,000 lines.

Post-fix, the five end-to-end traces (buyer→reply, negotiation→slip, bank-payment, catalog-sync, notifications) all pass. Remaining intentional deferrals (Phase 2): partial payments, proactive re-engagement, AI photo-import, STT, buyer simulator build item.
