# 02 — Data Model (canonical)

Postgres (Supabase). UUID PKs. All money in **integer paisa**. All timestamps `timestamptz` UTC.
Every tenant table has `merchant_id uuid` + RLS. `created_at`/`updated_at` on all tables (omitted below for brevity).

> **Revised per the audit (doc 10).** Tables/fields/enums added to resolve DM/CO/FL/SEC/DEP findings are marked ✚.

## Entity relationship (high level)
```
platform_admins (cross-tenant operators)
merchants 1──* merchant_users
merchants 1──* whatsapp_numbers 1──1 whatsapp_secrets ✚
merchants 1──* products *──1 product_categories
merchants 1──* customers 1──* conversations 1──* messages
conversations 1──* negotiations *──0..1 products   (product_id nullable: cart-scope haggle) ✚
merchants 1──* orders 1──* order_items *──0..1 products
orders 1──1 payments 1──* payment_claims ✚
merchants 1──* bank_accounts
merchants 1──* delivery_zones
merchants 1──* message_templates
merchants 1──* bot_knowledge
merchants 1──* notifications
merchants 1──* background_jobs ✚
* ──* order_status_history, webhook_events, audit_log, dead_letters ✚, llm_calls ✚
```

## Tables

### platform_admins ✚ (CD-1 — cross-tenant operators; NOT a merchant role)
| id uuid PK | auth_user_id uuid unique (Supabase) | name | email | is_active bool |

### merchants  (tenant root)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| business_name | text | shown to buyers |
| owner_name | text | |
| email | text unique | |
| phone | text | contact (not necessarily WA) |
| status | enum `merchant_status` | `pending`,`active`,`suspended` — see vetting gate (CD-42) |
| plan | enum `plan` | `pilot`,`basic`,`pro` (billing later) |
| timezone | text | default `Asia/Karachi` |
| currency | text | default `PKR` |
| default_language | enum `lang` | `roman_urdu`,`english`,`urdu` |
| category | text ✚ | product category attestation (prohibited-goods vetting, CD-42) |
| agreement_accepted_at | timestamptz null ✚ | merchant-agreement acceptance (CD-42) |
| bot_persona | jsonb | tone, name, greeting, style knobs |
| negotiation_defaults | jsonb | canonical shape below |
| business_hours | jsonb | for "we'll reply" behavior |
| settings | jsonb | canonical shape below |

**`merchants.settings` canonical shape ✚ (CD-13):**
```ts
{ botEnabled: boolean, codEnabled: boolean, paymentInstructions: string,
  defaultDeliveryCharge: number /*paisa*/, freeDeliveryThreshold: number /*paisa*/,
  lowStockThreshold: number, onboardingCompletedAt: string /*ISO*/ | null,
  metaCatalog: { catalogId: string, connected: boolean, tokenRef: string, lastSyncedAt: string } | null,
  notificationPrefs: NotificationPrefs /*tenant default; per-user override on merchant_users*/ }
```
**`merchants.negotiation_defaults` canonical shape ✚ (CD-13, CD-6):**
```ts
{ maxDiscountPct: number, minMarginPct?: number,
  concessionSteps: number[] /*cumulative FRACTIONS 0→1 of the list→floor gap*/,
  roundsMax: number, autoAcceptAtFloor: boolean,
  openingStance?: 'list_price'|'small_goodwill',
  stalemateAction?: 'handoff'|'hold_and_close',
  bulkTiers?: { minQty:number, extraDiscountPct:number }[] }
```
Fail-closed default: absent ⇒ `maxDiscountPct=0` ⇒ floor = list price.

### merchant_users  (portal auth; linked to Supabase auth.users)
| id uuid PK | merchant_id FK | auth_user_id uuid (Supabase) | name | email | role enum `user_role` (`owner`,`manager`,`staff`) | is_active bool | notification_prefs jsonb null ✚ (per-user override) | last_login_at |

### whatsapp_numbers  (a tenant may have ≥1 connected number)
| id uuid PK | merchant_id FK | display_name | phone_e164 | waba_id | phone_number_id (Meta, **unique** — routing key) | quality_rating enum `whatsapp_quality`✚ (`green`,`yellow`,`red`,`unknown`) | messaging_tier enum `whatsapp_tier`✚ (`unverified`,`tier_1`..`tier_4`) | status enum (`connecting`,`connected`,`flagged`,`disconnected`) | access_token_ref → `whatsapp_secrets.id` null | token_expires_at ✚ | token_rotated_at ✚ | flag_reason enum✚ (`quality`,`token`,`policy`,`manual`,null) | verified_name_status |

### whatsapp_secrets ✚ (CD-2 — encrypted per-tenant tokens; service-role-only)
| id uuid PK | merchant_id FK | kind enum `whatsapp_secret_kind` (`access_token`) | ciphertext bytea | iv bytea | auth_tag bytea | key_id text (for `TOKEN_ENCRYPTION_KEY` rotation) | created_at | rotated_at null |
RLS: deny all to portal/anon; **service-role only + FORCE RLS**. Dereference: `access_token_ref` NULL/`'platform'` ⇒ use `META_SYSTEM_USER_TOKEN` (Path C).

### product_categories
| id uuid PK | merchant_id FK | name | is_prohibited_flag bool ✚ (screening, CD-42) | sort_order |

### products
| column | type | notes |
|---|---|---|
| id uuid PK | | |
| merchant_id FK | | |
| category_id FK null | | |
| sku | text null | unique per merchant if set |
| name | text | |
| description | text | |
| price | int (paisa) | list price |
| cost | int (paisa) null | optional; **staff cannot read** (CD-37) |
| currency | text | default PKR |
| stock | int null | null = untracked |
| track_stock | bool | |
| images | text[] | Storage URLs (non-guessable keys, CD/SEC-9) |
| is_active | bool | |
| negotiable | bool default false | can this product be haggled? |
| max_discount_pct | numeric null | per-product override of merchant default |
| min_price | int (paisa) null | absolute floor override (wins over pct) |
| external_ref | text null | Meta catalog `retailer_id` for sync |
| external_updated_at | timestamptz null ✚ | catalog-sync conflict detection |
| attributes | jsonb | size/color/etc. |

### customers  (a buyer on WhatsApp, per merchant)
| id uuid PK | merchant_id FK | wa_id (phone e164, **unique per merchant**) | name | address | area | city | notes | tags text[] | is_blocked bool | wa_opt_in_status enum✚ `wa_opt_in` (`unknown`,`in`,`out`) default `unknown` | wa_opt_in_source text null ✚ | wa_opt_in_at timestamptz null ✚ | total_orders int | total_spent int(paisa) | first_seen_at | last_seen_at |

### conversations
| column | type | notes |
|---|---|---|
| id uuid PK | | |
| merchant_id FK | | |
| customer_id FK | | |
| whatsapp_number_id FK | | which of the merchant's numbers |
| status | enum `conversation_status` | `bot_active`,`human_takeover`,`closed` |
| window_expires_at | timestamptz | 24h window; refreshed on each inbound |
| current_state | enum `bot_state` | FSM state (doc 05); "last active state, resumable" |
| context | jsonb | canonical `ConversationContext` shape below |
| assigned_user_id FK null | | who took over |
| last_message_at | timestamptz | |
| unread_count | int | for portal inbox |

**`conversations.context` canonical shape ✚ (CD-13, per doc 05 §1.3):**
```ts
{ resume_state?: BotState, activeProductId?: uuid, activeNegotiationId?: uuid,
  cart?: { productId: uuid, name: string, qty: number, unitPrice: number, agreedPrice?: number }[],
  delivery?: { name?, address?, area?, city? }, paymentMethod?: 'cod'|'bank_transfer',
  pendingOrderId?: uuid, pendingPaymentId?: uuid, misunderstandCount?: number, flags?: object }
/* all money in paisa; orders/order_items become source of truth once materialized (CD-15) */
```

### messages
| id uuid PK | conversation_id FK | merchant_id FK | direction enum (`inbound`,`outbound`) | sender enum (`customer`,`bot`,`agent`,`system`) | type enum `message_type` (`text`,`image`,`interactive`,`template`,`document`,`audio`,`location`,`video`✚,`sticker`✚,`reaction`✚,`order`✚) | raw_type text null ✚ (exact Meta type) | body text | media_url text null | wa_message_id text unique null | template_name null | status enum (`queued`,`sent`,`delivered`,`read`,`failed`) | error text null | raw jsonb (owner/manager only, CD-37) | created_at |

### negotiations
| id uuid PK | conversation_id FK | merchant_id FK | product_id FK **null** ✚ (null = cart-scope) | scope enum✚ `negotiation_scope` (`line`,`cart`) default `line` | line_allocations jsonb null ✚ | quantity int | list_price int | floor_price int | rounds int | last_bot_offer int | last_customer_offer int | final_offered bool default false ✚ | status enum (`ongoing`,`agreed`,`rejected`,`abandoned`) | agreed_price int null | created_at |

### orders
| column | type | notes |
|---|---|---|
| id uuid PK | | |
| merchant_id FK | | |
| customer_id FK | | |
| conversation_id FK null | | origin chat |
| order_number | text null | assigned at `confirmed`; unique per merchant (`SK-1042`) |
| status | enum `order_status` | see enum + transition table (doc 10 CD-15) |
| payment_method | enum `payment_method` | `unset`,`cod`,`bank_transfer` |
| payment_status | enum `payment_status` | mirrors `payments.status` |
| payment_locked | bool default false ✚ | true on claimed/verified/cod_collected (CD-5, edit guard) |
| subtotal | int(paisa) | |
| discount_total | int(paisa) | |
| delivery_charge | int(paisa) | |
| total | int(paisa) | subtotal - discount + delivery |
| delivery_name/phone/address/area/city | text | |
| notes | text | |
| slip_url | text null | |
| placed_at | timestamptz null | set at `confirmed` |
| cancelled_reason | text null | |
| returned_reason | text null ✚ | (CD-5) |

### order_items
| id uuid PK | order_id FK | product_id FK null | name_snapshot | unit_price int(paisa) | quantity int | discount int(paisa) (**total** line discount, CD-22) | negotiated_discount int default 0 ✚ | discount_source enum✚ `discount_source` (`negotiated`,`manual`,`coupon`,`none`) | negotiation_id uuid null ✚ | line_total int(paisa) (= unit_price×qty − discount) |

### payments  (current-state row; 1:1 order)
| id uuid PK | order_id FK (unique) | merchant_id FK | method enum `payment_method` | amount int(paisa) | status enum `payment_status` | bank_account_id FK null | screenshot_url text null (latest) | claimed_at null | verified_at null | verified_by_user_id FK null | cod_collected_at timestamptz null ✚ | cod_collected_by_user_id FK null ✚ | refunded_at timestamptz null ✚ | refund_reason text null ✚ | rejection_reason text null | reference text null |

### payment_claims ✚ (CD-4 — full claim history)
| id uuid PK | payment_id FK | order_id FK | merchant_id FK | screenshot_url text | reference text null | amount int(paisa) | status enum (`claimed`,`verified`,`rejected`) | rejection_reason text null | claimed_at | decided_at timestamptz null | decided_by_user_id FK null | created_at |

### bank_accounts  (merchant's OWN accounts, shown to buyers)
| id uuid PK | merchant_id FK | bank_name | account_title | account_number | iban null | branch null | is_default bool | is_active bool |
CRUD restricted to owner/manager (CD-37).

### delivery_zones
| id uuid PK | merchant_id FK | area_name | city | charge int(paisa) | is_serviceable bool | eta_text |

### message_templates
| id uuid PK | merchant_id FK | name | category enum (`utility`,`marketing`,`authentication`) | language | body_json jsonb | status enum (`draft`,`pending`,`approved`,`rejected`,`paused`,`disabled`) | wa_template_id null | rejection_reason |
Launch set includes buyer-facing (order_confirmation, payment_received, order_shipped, order_delivered, order_cancelled ✚) + merchant-facing (merchant_new_order ✚, merchant_payment_claim ✚) per CD-32.

### bot_knowledge  (bot training / FAQ)
| id uuid PK | merchant_id FK | type enum (`faq`,`business_info`,`policy`,`shipping`,`custom`) | question text null | answer text | is_active bool | embedding vector null (⚠️ requires `pgvector` extension enabled — CD-14) |

### notifications
| id uuid PK | merchant_id FK | user_id FK null | type enum (`new_order`,`payment_claim`,`takeover_request`,`bot_needs_help`,`low_stock`,`template_status`,`system`) | title | body | data jsonb (**no signed URLs** — store orderId/paymentId only, CD-40) | channel enum (`portal`,`whatsapp`,`email`) | read_at null | created_at |

### background_jobs ✚ (CD-3 — async import/sync)
| id uuid PK | merchant_id FK | type enum `job_type` (`product_import`,`catalog_sync`) | status enum `job_status` (`queued`,`processing`,`completed`,`failed`) | input jsonb | result jsonb null | error text null | file_url text null | error_report_url text null | created_at | started_at null | finished_at null |
Index `(merchant_id, type, created_at)`.

### order_status_history
| id uuid PK | order_id FK | from_status | to_status | changed_by enum (`bot`,`agent`,`system`) | user_id null | note | created_at |

### webhook_events  (idempotency + debug — **one row per inner item**, CD-12)
| id uuid PK | source enum (`whatsapp`) | event_id text unique (= inner `messages[].id`/`statuses[].id`) | item_type enum✚ (`message`,`status`) | status enum✚ (`received`,`processed`,`error`,`dead_letter`) | attempts int✚ | payload jsonb | processed_at null | error null | received_at |

### dead_letters ✚ (CD-14, optional — or reuse webhook_events.status)
| id uuid PK | merchant_id FK null | conversation_id null | reason | payload jsonb | created_at |

### llm_calls ✚ (CD-14, optional — cost/latency metrics)
| id uuid PK | merchant_id FK | conversation_id FK | message_id FK null | model text | prompt_tokens int | completion_tokens int | latency_ms int | decision text null | cost_micros int | created_at |

### audit_log
| id uuid PK | merchant_id FK null | actor enum | user_id null | action text | entity text | entity_id uuid | diff jsonb | created_at |

## Enums (canonical — reused across all docs)
- `merchant_status`: pending, active, suspended
- `plan`: pilot, basic, pro
- `lang`: roman_urdu, english, urdu
- `user_role`: owner, manager, staff  *(platform admins live in `platform_admins`, not here — CD-1)*
- `conversation_status`: bot_active, human_takeover, closed
- `bot_state`: greeting, browsing, product_qa, negotiating, order_building, collecting_delivery, selecting_payment, awaiting_payment_proof, confirming, completed, handoff (doc 05)
- `order_status`: draft, pending_confirmation, confirmed, awaiting_payment, paid, preparing, dispatched, delivered, cancelled, returned  *(transitions: doc 10 CD-15)*
- `payment_method`: unset, cod, bank_transfer
- `payment_status`: unpaid, claimed, verified, failed, cod_pending, cod_collected, **refunded** ✚
- `message_type`: text, image, interactive, template, document, audio, location, **video, sticker, reaction, order** ✚
- `message direction`: inbound, outbound · `message sender`: customer, bot, agent, system · `message status`: queued, sent, delivered, read, failed
- `negotiation status`: ongoing, agreed, rejected, abandoned · `negotiation_scope`: line, cart ✚
- `discount_source` ✚: negotiated, manual, coupon, none
- `whatsapp_quality` ✚: green, yellow, red, unknown · `whatsapp_tier` ✚: unverified, tier_1, tier_2, tier_3, tier_4
- `wa_opt_in` ✚: unknown, in, out
- `job_type` ✚: product_import, catalog_sync · `job_status` ✚: queued, processing, completed, failed
- `notification type`: new_order, payment_claim, takeover_request, bot_needs_help, low_stock, template_status, system

## Storage buckets (Supabase Storage)
- `product-images/` — **non-guessable keys** `{merchant_id}/{uuid}.jpg`; served to WhatsApp via signed URL with TTL covering Meta's fetch, `noindex` (CD/SEC-9).
- `payment-screenshots/` (private, on-demand signed URLs, single-use short TTL) — `{merchant_id}/{order_id}/{uuid}.jpg`
- `inbound-media/` ✚ (private, signed URLs, MIME/size allowlist) — `{merchant_id}/{conversation_id}/{uuid}.<ext>`
- `order-slips/` (private, signed URLs) — `{merchant_id}/{order_id}.pdf`
- `catalog-imports/` (private) — uploaded CSV/Excel files
Retention/purge jobs: screenshots 90d post-completion; webhook_events/messages.raw 30d (CD-41).

## RLS — hardened pattern (CD-35; every tenant table)
```sql
alter table <t> enable row level security;
alter table <t> force row level security;         -- table owner constrained too
create policy tenant_isolation on <t>
  for all to authenticated
  using (
    merchant_id = (nullif(auth.jwt() ->> 'merchant_id',''))::uuid
    and auth.jwt() ->> 'merchant_id' is not null
  )
  with check (
    merchant_id = (nullif(auth.jwt() ->> 'merchant_id',''))::uuid
  );
-- platform-admin cross-tenant bypass (CD-1):
create policy platform_admin_all on <t>
  for all to authenticated
  using ((auth.jwt() ->> 'platform_admin')::boolean is true);
```
- The `merchant_id`/`role`/`platform_admin` claims are injected ONLY by the **Custom Access Token Auth Hook** (CD-36, specified in doc 09) — never client-supplied. Deactivated users get no claim → default-deny.
- **Bot/worker writes** use a **restricted worker role** (not full service-role) + parent/child `merchant_id` CHECK triggers (`messages→conversations`, `order_items→orders`, `payments→orders`) so a code bug can't cross tenants (CD-39).
- `whatsapp_secrets`: service-role only, deny portal/anon. Test: a JWT with no `merchant_id` returns zero rows and cannot insert on every tenant table.

## Key indexes
- `whatsapp_numbers(phone_number_id)` unique — inbound routing.
- `messages(conversation_id, created_at)`, `messages(wa_message_id)` unique.
- `customers(merchant_id, wa_id)` unique.
- `orders(merchant_id, order_number)` unique, `orders(merchant_id, status)`.
- `products(merchant_id, is_active)`, `products(merchant_id, external_ref)`.
- `conversations(merchant_id, status, last_message_at)`.
- `webhook_events(event_id)` unique — per-inner-item dedupe.
- `payment_claims(order_id, created_at)`, `background_jobs(merchant_id, type, created_at)`.
