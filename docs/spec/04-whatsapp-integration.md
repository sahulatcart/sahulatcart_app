# 04 — WhatsApp Integration (Meta Cloud API, Path C)

This document specifies how Sahulatkaar connects to WhatsApp via the **Meta WhatsApp Cloud
API** (Graph API) for the **Path C launch**: single merchant, one phone number added manually
under the platform's own WABA, **no** Meta Business Verification / App Review / Embedded
Signup yet. The schema is already multi-tenant (routing by `phone_number_id`), so scaling to
many merchants later needs no rewrite.

> Naming note: all table/column/enum references below match [02 — Data Model](02-data-model.md)
> exactly (`whatsapp_numbers`, `whatsapp_secrets`, `messages`, `conversations`,
> `message_templates`, `webhook_events`, enums `message_type`, `message status`,
> `whatsapp_quality`, `whatsapp_tier`, etc.). All secrets are referenced, not inlined — see §10
> and [09 — Non-functional / DevOps](09-nonfunctional-devops.md), which is the single source of
> truth for env-var names (`META_*`, CD-27).

> **⚠️ VERIFY LIVE**: Meta's WhatsApp Cloud API surface (API version, tier thresholds, rate
> limits, template category rules, quality-rating mechanics) changes frequently. Every value
> tagged **⚠️ VERIFY LIVE** in this doc must be re-checked against the live
> [Meta WhatsApp Cloud API docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
> at implementation time. Values here reflect our best understanding as of **2026-07**.

---

## 0. Terminology / object map

| Meta object | What it is | Where we store it |
|---|---|---|
| **Business Manager / Meta Business Account** | Top-level business container (the platform's, in Path C) | not in DB (platform-level, in `09` secrets/config) |
| **Meta App** (Business type) | App holding the WhatsApp product, app id + app secret, webhook config | platform-level config (`09`) |
| **WABA** (WhatsApp Business Account) | Owns phone numbers + templates | `whatsapp_numbers.waba_id`, `message_templates` scoped per merchant |
| **Phone Number** | The registered WA number | `whatsapp_numbers.phone_e164` |
| **Phone Number ID** | Meta's numeric ID for that number — **the inbound routing key** | `whatsapp_numbers.phone_number_id` (unique) |
| **System User Token / Access Token** | Bearer token used for send + Graph calls | `whatsapp_numbers.access_token_ref` → `whatsapp_secrets.id` (never raw); `NULL`/`'platform'` ⇒ `META_SYSTEM_USER_TOKEN` env (CD-2, §1.1) |
| **Verify Token** | Shared secret for webhook GET handshake | platform config (`09`) |
| **Business-initiated conversation** | Outbound started by us outside 24h (needs template) | drives §5/§6 |

---

## 1. Number & account setup (Path C)

### 1.1 What we do NOW (manual, one number)

**Step 1 — Meta Business Manager**
- Use the **platform's own** Meta Business Manager (business.facebook.com). In Path C the
  merchant's number lives under *our* WABA, not the merchant's own verified business.
- No Business Verification is required to *start* sending on the unverified tier (~250
  business-initiated conversations / 24h — see §7). Verification is **deferred**.

**Step 2 — Meta App (Business type) + WhatsApp product**
- In developers.facebook.com create an **App** of type **Business**.
- Add the **WhatsApp** product to the app. This exposes:
  - a test number (throwaway — not used in production),
  - the **App ID** and **App Secret** (App Secret is needed for webhook signature verification, §2.4),
  - the WhatsApp **Configuration** page (webhook + phone numbers).

**Step 3 — Create/attach a WABA and add the merchant's phone number**
- Under WhatsApp → API Setup / Phone Numbers, **Add phone number** to the WABA.
- ⚠️ **The number must NOT be active on the regular WhatsApp app or the WhatsApp Business
  app.** A number can only live in one place. If the merchant currently uses it on either
  app, they must **delete the account from that app first**
  (WhatsApp Settings → Account → Delete my account) before registering it on the Cloud API.
  Otherwise registration/verification fails.
- Choose SMS **or** voice call to receive the **6-digit verification code**; enter it to
  register the number on the Cloud API.

**Step 4 — Two-step verification PIN**
- Set a **6-digit two-step verification PIN** for the number. This PIN is required to
  register the number and may be requested again (e.g. re-registration, migration).
- Store the PIN as a secret (see §10). Losing it blocks re-registration.

**Step 5 — Display name**
- Set the WhatsApp **display name** (what buyers see as the sender). It goes through Meta's
  **display-name review**; until approved the number may show a temporary/unverified state.
  Track this in `whatsapp_numbers.verified_name_status`.

**Step 6 — Generate a long-lived token**
- For a stable production token, create a **System User** in Business Manager and generate a
  **System User access token** scoped with `whatsapp_business_messaging` +
  `whatsapp_business_management`, assigned to the WABA + app. Prefer this over the temporary
  24h token shown in API Setup.
- ⚠️ **VERIFY LIVE**: exact permission names and whether the token can be non-expiring.
- **Token storage & dereference (CD-2):** the raw token is **never** stored in the DB. For a
  per-merchant token, encrypt it into a `whatsapp_secrets` row (`kind='access_token'`,
  ciphertext/iv/auth_tag/key_id) and point `whatsapp_numbers.access_token_ref` at that
  `whatsapp_secrets.id`; the worker decrypts on use. In **Path C** the single number runs on
  the platform's own token: leave `access_token_ref` `NULL` (or `'platform'`), and the
  dereference rule uses the **`META_SYSTEM_USER_TOKEN`** env var instead of decrypting a
  secret. Also set `token_expires_at` / `token_rotated_at` (CD-9) when known.

**Step 7 — Record in DB**
- Insert a `whatsapp_numbers` row for the merchant with: `display_name`, `phone_e164`,
  `waba_id`, `phone_number_id` (the routing key, unique), `quality_rating` (`whatsapp_quality`
  enum, default `unknown`), `messaging_tier` (`whatsapp_tier` enum, `unverified` at launch),
  `status='connecting'` → `'connected'` after webhook + first successful send,
  `access_token_ref` (NULL/`'platform'` for the Path C platform token — see Step 6),
  `token_expires_at`/`token_rotated_at`/`flag_reason` (CD-9), `verified_name_status`.

> **Token dereference rule (CD-2), used everywhere a bearer token is needed (§3.2, §4):**
> `access_token_ref` is `NULL` or `'platform'` ⇒ use the `META_SYSTEM_USER_TOKEN` env var;
> otherwise decrypt the referenced `whatsapp_secrets` row (`kind='access_token'`) with
> `TOKEN_ENCRYPTION_KEY`.

### 1.2 What is DEFERRED (not needed for Path C pilot)

| Deferred item | Why we can skip it now | When we need it |
|---|---|---|
| **Meta Business Verification** | Unverified tier (~250 biz-initiated conv/24h) covers a single pilot | To raise messaging tier beyond 250 and to remove "unverified" limits |
| **App Review / Advanced Access** | Not needed while we message only within our own WABA with our own token | Multi-merchant self-serve where third parties grant us access |
| **Embedded Signup** | Numbers added manually by us | Multi-tenant self-serve onboarding |
| **Official Business Account (green tick)** | Cosmetic; not required | Optional trust signal at scale |

### 1.3 Future multi-tenant path (brief)

At scale we become a **Tech Provider / Solution Partner** and use **Embedded Signup**: each
merchant grants us access to *their own* WABA + number via a guided OAuth flow, we complete
**Business Verification** and **App Review** for `whatsapp_business_management` /
`whatsapp_business_messaging`, and per-merchant tokens/WABAs are provisioned automatically.
The current schema already isolates per-merchant (`whatsapp_numbers.waba_id`,
`phone_number_id`, `access_token_ref`), so only the onboarding flow changes — routing and
data isolation are unchanged.

---

## 2. Webhook

### 2.1 Endpoint & subscription

- **Endpoint:** `POST/GET /api/v1/webhook/whatsapp` (per [01](01-architecture.md); one shared
  endpoint for all tenants).
- In the Meta App → WhatsApp → **Configuration → Webhook**, set the **Callback URL** to the
  public HTTPS URL of this endpoint and the **Verify Token** (§10).
- **Subscribe to fields** on the WABA: at minimum `messages` (covers inbound messages,
  interactive replies, reactions, referrals, and status callbacks). Also subscribe
  `message_template_status_update` (template approval lifecycle → §6) and
  `phone_number_quality_update` / `account_update` for quality + tier changes (→ §7).
  - ⚠️ **VERIFY LIVE**: exact field names for quality/tier/account webhooks.
- Local dev: expose via ngrok/tunnel (see [01](01-architecture.md) Environments).

### 2.2 GET verification handshake

Meta sends a GET with query params when you save the webhook:

```
GET /api/v1/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=1158201444
```

Handler:
1. Assert `hub.mode === 'subscribe'`.
2. Assert `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN` (constant-time compare).
3. Respond **200** with the raw `hub.challenge` value as the plain-text body.
4. Any mismatch → **403**.

### 2.3 POST payload structure

Envelope is always `entry[].changes[].value`. For messages, `value` carries `messages[]`
and/or `statuses[]` plus a `metadata` block identifying the receiving number.

Inbound **text** message example:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "<WABA_ID>",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "923001234567",
              "phone_number_id": "109xxxxxxxxxxxx"
            },
            "contacts": [
              { "profile": { "name": "Ahmed" }, "wa_id": "923009998877" }
            ],
            "messages": [
              {
                "from": "923009998877",
                "id": "wamid.HBgMOTIzMDA5OTk4ODc3FQIAEhgU...",
                "timestamp": "1751385600",
                "type": "text",
                "text": { "body": "salam bhai ye jacket kitne ki hai" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

- `metadata.phone_number_id` → routing key (§2.5).
- `contacts[].wa_id` / `messages[].from` → buyer's E.164 (→ `customers.wa_id`).
- `messages[].id` → `wamid.…` → `messages.wa_message_id` (unique).
- `messages[].type` → `messages.type`.

### 2.4 Signature verification (`X-Hub-Signature-256`)

Every POST carries header `X-Hub-Signature-256: sha256=<hex>`.

1. **Reject missing/malformed** first: if the header is absent, or does not match
   `sha256=<hex>` (64 lowercase hex chars), → **401** immediately, do not process.
2. Compute `HMAC-SHA256(app_secret, rawRequestBody)` — **over the exact raw bytes** received,
   before any JSON parsing/re-serialization. (Configure the body parser to retain the raw
   buffer.)
3. **Constant-time compare via `crypto.timingSafeEqual`** (CD-44):
   - Decode **both** the computed digest and the header's hex into `Buffer`s.
   - **Length-check** the two buffers first — `timingSafeEqual` throws on unequal lengths, so
     a length mismatch is itself a rejection (guards against a truncated/malformed-length
     signature). Never fall back to `===` string compare.
   - Only if lengths match, call `crypto.timingSafeEqual(computed, provided)`.
4. Any mismatch → **401**, do not process.

> **Test vectors** (release-gated, CD-44): cover four cases —
> **valid** (correct HMAC → 200/accepted), **invalid** (wrong secret/tampered body → 401),
> **missing** (no `X-Hub-Signature-256` header → 401), and
> **malformed-length** (header hex shorter/longer than 32 bytes → 401 via the length-check,
> never a thrown 500).

App Secret comes from the Meta App (§10: `META_APP_SECRET`). This is why the App Secret
is needed even in Path C.

### 2.5 Routing inbound → merchant

```
value.metadata.phone_number_id
  → SELECT * FROM whatsapp_numbers WHERE phone_number_id = $1   (unique index)
  → whatsapp_number.merchant_id  → tenant
```

If no matching `whatsapp_numbers` row: log, ACK 200 (so Meta stops retrying an
unknown-number event), and raise a platform alert — never 4xx/5xx a valid Meta delivery.

### 2.6 Idempotency (two layers)

Meta **retries** deliveries (with backoff) until it receives a 200, so duplicates are
expected. A single Meta POST can contain **multiple** `messages[]`/`statuses[]` items, each
with its own id, so idempotency is keyed **per inner item**, not per HTTP delivery.

1. **Event level — one `webhook_events` row PER INNER ITEM** (CD-12). For each `messages[]`
   and each `statuses[]` item in the payload:
   - `event_id` = that item's `wa_message_id` (for messages) / `statuses[].id` (for statuses)
     — the `webhook_events(event_id)` unique index enforces dedupe.
   - `item_type` ∈ (`message`, `status`).
   - `status` ∈ (`received`, `processed`, `error`, `dead_letter`) tracks the item's own
     processing lifecycle; `attempts int` counts worker attempts.
   - On **unique-violation for that item → skip THAT item only** (already seen); **never abort
     the batch** — continue inserting/processing the remaining items, then still ACK 200.
2. **Message level** — `messages.wa_message_id` unique. Even if an event row slips through
   twice, the insert of the inbound message dedupes.

**Partial-failure retry path (CD-12):** items are independent. An item that throws during
worker processing is marked `webhook_events.status='error'`, `attempts` incremented, and
retried on backoff (§9.1) without re-processing its sibling items (which stay `processed`).
After capped attempts it moves to `status='dead_letter'` (surfaced via `dead_letters` /
platform alert). Because each item has its own row, a Meta redelivery of the same POST re-hits
the unique index per item and safely no-ops the already-`processed` ones while allowing a
still-`error`/`received` sibling to advance.

### 2.7 Fast-ACK (<5s) then enqueue

Per [01](01-architecture.md):
1. Verify signature → route by `phone_number_id` → insert `webhook_events` (dedupe) →
   persist raw payload / inbound `messages` rows.
2. **Enqueue** each inbound message for the worker (in-process queue or Redis/BullMQ), keyed
   by `conversation_id` for per-conversation ordering.
3. Return **200** immediately (well under Meta's ~5s timeout). All Claude calls, media
   downloads, sends, and DB mutations happen in the worker, never in the request path.
4. If we ACK slowly or 5xx, Meta retries → duplicates (handled by §2.6) and eventually may
   disable the webhook if failures persist. Keep the handler cheap.

---

## 3. Receiving messages

### 3.1 Inbound types → `messages.type`

Per CD-10, the `message_type` enum is now **extended** to:
`text, image, interactive, template, document, audio, location, video, sticker, reaction,
order`. We map Meta's granular `type` to a `messages.type` enum value **and always preserve
the exact Meta type string in `messages.raw_type`** (plus full Meta JSON in `messages.raw`):

| Meta inbound `type` | Sub-shape | → `messages.type` | `raw_type` | Notes |
|---|---|---|---|---|
| `text` | `text.body` | `text` | `text` | plain buyer text |
| `image` | `image.{id,mime_type,sha256,caption}` | `image` | `image` | **payment screenshots** (§3.3) |
| `audio` | `audio.{id,mime_type,voice}` | `audio` | `audio` | voice notes (Roman-Urdu STT later) |
| `document` | `document.{id,filename,mime_type}` | `document` | `document` | PDFs/receipts |
| `video` | `video.{id,…}` | `video` | `video` | short clips (media flow §3.2) |
| `sticker` | `sticker.{id,…}` | `sticker` | `sticker` | animated/static sticker |
| `location` | `location.{latitude,longitude,name,address}` | `location` | `location` | delivery pin |
| `interactive` | `interactive.button_reply` / `interactive.list_reply` | `interactive` | `interactive` | reply to our buttons/list (§4.3) |
| `button` | `button.{text,payload}` | `interactive` | `button` | reply to a **template** quick-reply button |
| `reaction` | `reaction.{message_id,emoji}` | `reaction` | `reaction` | emoji reaction to one of our messages |
| `order` | `order.{catalog_id,product_items[]}` | `order` | `order` | native cart/catalog order → order draft (below) |
| `contacts` | `contacts[]` | `text` | `contacts` | shared contact card (no dedicated enum; kept in `raw`) |
| system/`referral` | `messages[].referral{…}` on any type | (as underlying type) | (underlying) | click-to-WhatsApp ad / link referral metadata |

- `messages.type` is the normalized enum used for routing/UI; `messages.raw_type` preserves
  the **exact** Meta type (e.g. `button`, `contacts`) so nothing is lost when a Meta type
  collapses onto a shared enum value.
- Only `contacts` still has no dedicated enum value (low value at launch) → mapped to `text`
  with the true type in `raw_type` + payload in `messages.raw`.

**Native catalog `order` → order draft (CD-10, ties to CD-15):**
When a buyer places a native WhatsApp cart order, the inbound `order` message carries
`order.{catalog_id, product_items[]}`. Each `product_items[]` entry has
`{product_retailer_id, quantity, item_price, currency}`. Mapping:

1. Resolve each `product_items[].product_retailer_id` → `products.external_ref` (the Meta
   catalog `retailer_id`, §11) to find the local `products` row (per merchant).
2. Build an **order draft**: create/populate `conversations.context.cart[]` with one entry per
   resolved item (`productId`, `name`, `qty = quantity`, `unitPrice`), then materialize per
   CD-15 (`orders(status='draft')` + one `order_items` row per `product_items[]` entry on
   entry to `collecting_delivery`).
3. `order_items.discount_source='none'` unless a negotiation is attached; `unit_price` uses the
   **local** `products.price` (Meta's `item_price` is informational — the price-match guard,
   CD-38, still governs any quoted figure). Unresolvable `retailer_id`s are surfaced to the bot
   (ask the buyer / handoff) rather than silently dropped.

**Interactive reply (button) inbound example:**

```json
{
  "messages": [
    {
      "from": "923009998877",
      "id": "wamid.XXX",
      "timestamp": "1751385700",
      "type": "interactive",
      "interactive": {
        "type": "button_reply",
        "button_reply": { "id": "pay_cod", "title": "COD" }
      }
    }
  ]
}
```

**Interactive reply (list) inbound example:**

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list_reply",
    "list_reply": { "id": "prod_42", "title": "Denim Jacket", "description": "Rs 3500" }
  }
}
```

**Location inbound example:**

```json
{
  "type": "location",
  "location": {
    "latitude": 24.8607, "longitude": 67.0011,
    "name": "Home", "address": "Block 5, Clifton, Karachi"
  }
}
```

**Referral (click-to-WhatsApp ad) — attached to the first message:**

```json
{
  "type": "text",
  "text": { "body": "is offer ke bare me batao" },
  "referral": {
    "source_url": "https://fb.me/...",
    "source_type": "ad",
    "source_id": "1203...",
    "headline": "Eid Sale 30% off",
    "body": "…",
    "ctwa_clid": "…"
  }
}
```

Referral metadata is preserved in `messages.raw` and used by the orchestrator to greet with
ad context. A referral message **counts as buyer-initiated** → opens the 24h window (§5) and
satisfies opt-in (§8).

- The `button.payload` / `interactive.*.id` value is the **stable id** we set when sending
  (e.g. `pay_cod`, `prod_42`); the state machine routes on the id, not the localized title.

### 3.2 Media download flow (image / audio / document / video / sticker)

Inbound media is delivered as an **id only**; we fetch bytes in two Graph calls:

1. **Resolve URL:** `GET https://graph.facebook.com/<META_GRAPH_API_VERSION>/<MEDIA_ID>` with
   `Authorization: Bearer <token>` → returns `{ url, mime_type, sha256, file_size, id }`. The
   `url` is short-lived (~5 min) and also requires the bearer token to fetch.
2. **Download bytes:** `GET <url>` with `Authorization: Bearer <token>`.
3. **Store in Supabase Storage** (per [02](02-data-model.md) buckets):
   - payment screenshots → `payment-screenshots/{merchant_id}/{order_id}/{uuid}.jpg` (private,
     signed URLs).
   - other inbound media → the private **`inbound-media/{merchant_id}/{conversation_id}/{uuid}.<ext>`**
     bucket ([02](02-data-model.md), CD-11: private, signed URLs, MIME/size allowlist, same
     retention as screenshots).
4. Set `messages.media_url` to the stored object path / signed URL; keep `mime_type`, `sha256`,
   and Meta media id in `messages.raw`.
5. Verify `mime_type` and size against an allowlist; reject/skip oversized or disallowed types
   with a polite Roman-Urdu reply.

### 3.3 The payment screenshot specifically

This is the highest-value inbound image. Flow:

1. Inbound `image` arrives while `conversations.current_state` (bot_state) is
   `awaiting_payment_proof` (or the orchestrator infers a payment claim from context).
2. Download + store under `payment-screenshots/{merchant_id}/{order_id}/{uuid}.jpg`.
3. Create/update the `payments` row for the order: `method='bank_transfer'`,
   `screenshot_url=<stored path>`, `status='claimed'`, `claimed_at=now()`; set
   `orders.payment_status='claimed'`.
4. **Never** auto-verify. Per [00](00-overview.md) principle *"Never touch money"*, the
   merchant verifies manually in the portal. Raise `notifications.type='payment_claim'`.
5. Bot acknowledges in Roman Urdu ("screenshot mil gaya, confirm kar ke bata deta hoon") and
   advances the flow only after merchant verification.

> Optional (Phase 2): run OCR/vision on the screenshot to pre-extract amount/reference for the
> merchant. Never used to auto-approve.

---

## 4. Sending messages

All sends: `POST https://graph.facebook.com/<META_GRAPH_API_VERSION>/<PHONE_NUMBER_ID>/messages`
with `Authorization: Bearer <token>` (resolved via the CD-2 dereference rule, §1.1) and
`Content-Type: application/json`.
⚠️ **VERIFY LIVE**: pin `META_GRAPH_API_VERSION` (e.g. `v20.0`+) at build time.

The response returns the outbound `wamid`; capture it:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "923009998877", "wa_id": "923009998877" }],
  "messages": [{ "id": "wamid.HBgMOTIz...==" }]
}
```

→ insert an outbound `messages` row: `direction='outbound'`, `sender='bot'|'agent'|'system'`,
`type=…`, `wa_message_id=<returned id>`, `status='sent'` (or `'queued'` before the call).

### 4.1 Free-form vs template

- **Free-form** (text/image/interactive/etc.) is allowed **only inside the 24h customer
  service window** (§5). Outside it → must use an approved **template** (§6).
- The Sender checks `conversations.window_expires_at` before composing: inside → free-form;
  outside → template or skip.

### 4.2 Text (free-form)

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "923009998877",
  "type": "text",
  "text": { "preview_url": false, "body": "Denim jacket Rs 3500 ki hai. Chahiye?" }
}
```

### 4.3 Image (free-form)

```json
{
  "messaging_product": "whatsapp",
  "to": "923009998877",
  "type": "image",
  "image": { "link": "https://<public-product-image-url>", "caption": "Denim Jacket — Rs 3500" }
}
```

Use a public `product-images/` URL (public-read bucket) or an uploaded media id.

### 4.4 Interactive — reply buttons

Constraints: **max 3 buttons**, each button **title ≤ 20 chars**, unique button ids.

```json
{
  "messaging_product": "whatsapp",
  "to": "923009998877",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Payment ka tareeqa chunein:" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "pay_cod", "title": "COD" } },
        { "type": "reply", "reply": { "id": "pay_bank", "title": "Bank Transfer" } }
      ]
    }
  }
}
```

### 4.5 Interactive — list message

Constraints: **≤ 10 rows total** (across all sections), row titles ≤ 24 chars, one button
label ≤ 20 chars. ⚠️ **VERIFY LIVE** on exact per-field char limits.

```json
{
  "messaging_product": "whatsapp",
  "to": "923009998877",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": { "type": "text", "text": "Hamari Jackets" },
    "body": { "text": "Ek product chunein:" },
    "action": {
      "button": "Products dekhein",
      "sections": [
        {
          "title": "Jackets",
          "rows": [
            { "id": "prod_42", "title": "Denim Jacket", "description": "Rs 3500" },
            { "id": "prod_43", "title": "Leather Jacket", "description": "Rs 6500" }
          ]
        }
      ]
    }
  }
}
```

### 4.6 Interactive — CTA URL

Single call-to-action button that opens a URL (e.g. order-slip PDF, catalog link):

```json
{
  "messaging_product": "whatsapp",
  "to": "923009998877",
  "type": "interactive",
  "interactive": {
    "type": "cta_url",
    "body": { "text": "Aap ki order slip taiyar hai." },
    "action": {
      "name": "cta_url",
      "parameters": { "display_text": "Order Slip", "url": "https://<signed-slip-url>" }
    }
  }
}
```

### 4.7 How the bot uses these in flows

| Bot moment (`bot_state`) | Message type used |
|---|---|
| Greeting / product Q&A | text (+ image for product) |
| Show catalog subset | **list** (≤10 rows) |
| Confirm negotiated price | text; optional reply buttons "Haan / Nahi" |
| `selecting_payment` | **reply buttons**: COD / Bank Transfer |
| Show bank details | text (from `bank_accounts`) |
| `confirming` order | text summary + reply buttons "Confirm / Change" |
| Order slip ready | **cta_url** to signed `order-slips/` URL, or image |
| Outside 24h re-engage | **template** only (§6) |

- Interactive replies keep buyer input structured (id-based routing, fewer LLM
  mis-parses). Titles are localized Roman Urdu but routing is on the stable `id`.

### 4.8 Delivery/read status callbacks → `messages.status`

Meta pushes async `statuses[]` on the same `messages` webhook field:

```json
{
  "field": "messages",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "923001234567", "phone_number_id": "109xxxx" },
    "statuses": [
      {
        "id": "wamid.HBgMOTIz...==",
        "status": "delivered",
        "timestamp": "1751385800",
        "recipient_id": "923009998877",
        "conversation": { "id": "CONV_ID", "origin": { "type": "service" } },
        "pricing": { "billable": true, "category": "service" }
      }
    ]
  }
}
```

Map `statuses[].status` → `messages.status` by `wa_message_id`:

| Meta status | → `messages.status` |
|---|---|
| `sent` | `sent` |
| `delivered` | `delivered` |
| `read` | `read` |
| `failed` | `failed` (+ `messages.error` from `errors[]`) |

Statuses are also idempotent (dedupe via `webhook_events`, §2.6). Only advance state, never
regress (e.g. don't overwrite `read` with a late `delivered`).

---

## 5. The 24-hour customer service window

### 5.1 Rules

- Every inbound buyer message opens/refreshes a **24-hour customer service window** for that
  conversation. **Inside** the window we may send **free-form** messages (text, image,
  interactive, media). **Outside** it we may send **only approved templates** (§6).
- The window is per conversation (per buyer number). It resets to `now + 24h` on **each**
  inbound message from that buyer.

### 5.2 `conversations.window_expires_at` handling

- On every inbound message (in the fast-ACK/persist step): set
  `conversations.window_expires_at = inbound_timestamp + 24h` (use Meta's `timestamp`, not
  local receive time, to stay aligned with Meta's clock).
- Before any outbound **free-form** send, the Sender checks:
  `now < window_expires_at` → free-form allowed; else → template path.
- ⚠️ **VERIFY LIVE**: whether the 24h clock is exactly the buyer's last-message time (it is,
  per current Meta rules) and edge behavior near expiry — treat a small safety margin
  (e.g. send free-form only if `> 2 min` remain) to avoid racing the boundary.

### 5.3 Inside vs outside

| | Inside 24h | Outside 24h |
|---|---|---|
| Text / image / interactive / media | ✅ | ❌ |
| Approved **template** | ✅ (allowed too) | ✅ (only option) |
| Cost category | service/free-tier per Meta pricing ⚠️ VERIFY LIVE | template (utility/marketing/auth) billed |

### 5.4 Buyer returns after the window

- If a buyer replies **after** expiry, their inbound reopens a fresh 24h window → the bot can
  immediately resume free-form. (No template needed for the *reply* — templates are only for
  *business-initiated* first contact outside the window.)
- If **we** need to reach a cold buyer (e.g. "your order shipped") and the window has expired,
  we must send a **utility template** (§6). Once the buyer replies to it, the window reopens
  and the conversation continues free-form.
- The FSM should persist enough `conversations.context` to resume gracefully after a gap
  (e.g. pending order draft), since a returning buyer may be hours/days later.

---

## 6. Templates

### 6.1 When required

Templates are required for any **business-initiated** message **outside the 24h window**
(§5). Inside the window, free-form is fine and templates are unnecessary (but allowed).

### 6.2 Categories

Meta template categories (⚠️ VERIFY LIVE — category policy shifts):

| Category | Use | Sahulatkaar usage |
|---|---|---|
| **utility** | Transactional follow-ups tied to a specific order/action | order confirmation, payment received, shipping/dispatch, delivery, COD reminder |
| **marketing** | Promotions, offers, re-engagement | promos, sale announcements (**deferred** — see §7 broadcasts) |
| **authentication** | OTP / login codes | **not used** (we don't do auth OTP) |

Meta **auto-classifies** at submission and may re-categorize; the effective category affects
billing. Store the requested category in `message_templates.category`.

### 6.3 `message_templates.status` mapping

Meta template status → `message_templates.status`
(enum: `draft, pending, approved, rejected, paused, disabled`):

| Meta status | → `message_templates.status` |
|---|---|
| (local, not yet submitted) | `draft` |
| `PENDING` / `IN_APPEAL` | `pending` |
| `APPROVED` | `approved` |
| `REJECTED` | `rejected` (+ `rejection_reason`) |
| `PAUSED` | `paused` |
| `DISABLED` / `DELETED` | `disabled` |

Lifecycle updates arrive via the `message_template_status_update` webhook (§2.1). On each,
update the matching `message_templates` row by `wa_template_id` / `name`+`language`.

### 6.4 Handling PAUSED / REJECTED

- Before sending a template, check `message_templates.status='approved'`.
- If a needed template is `paused`/`rejected`/`disabled`:
  1. **Fall back**: if the buyer is *within* the 24h window, send the equivalent message
     free-form instead. If outside the window, **skip/queue** and do not force-send.
  2. **Notify merchant**: `notifications.type='template_status'` (portal + optionally
     WhatsApp/email per `notifications.channel`) so the merchant can fix/resubmit.
  3. Log to `audit_log`.
- A template can be `paused` automatically by Meta for high negative feedback; repeated
  pauses can `disable` it. Keep a fallback for every transactional template.

### 6.5 Component structure, variables, language

- `message_templates.body_json` holds the **components** array: `header` (text/image/
  document), `body` (with `{{1}}`, `{{2}}` placeholders), `footer`, `buttons`
  (quick-reply / url / phone).
- Variables are positional (`{{1}}`…). At send time we supply `components[].parameters` in
  order. Provide sample values at submission (Meta requires examples).
- `language` = BCP-47-ish code (e.g. `en`, `ur`, `en_US`). Roman Urdu is written in Latin
  script → we submit as **`en`** (⚠️ VERIFY LIVE — there is no dedicated Roman-Urdu locale;
  confirm `en` vs `ur` acceptance for Latin-script Urdu body text) with the actual Roman-Urdu
  wording in the body. Keep per-language variants keyed by `message_templates.language`.

**Template send example (utility, order confirmation):**

```json
{
  "messaging_product": "whatsapp",
  "to": "923009998877",
  "type": "template",
  "template": {
    "name": "order_confirmation",
    "language": { "code": "en" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "SK-1042" },
          { "type": "text", "text": "Rs 3500" }
        ]
      }
    ]
  }
}
```

The send response returns a `wamid` → persist as an outbound `messages` row with
`type='template'`, `template_name='order_confirmation'`.

### 6.6 Concrete templates needed at launch

All **utility** unless noted. Roman-Urdu bodies (submitted under `en`). `{{n}}` = variable.
The launch set matches [02](02-data-model.md) `message_templates` (CD-32).

**Buyer-facing:**

| `name` | category | purpose | variables |
|---|---|---|---|
| `order_confirmation` | utility | confirm placed order | {{1}} order_number, {{2}} total |
| `payment_received` | utility | acknowledge verified payment | {{1}} order_number, {{2}} amount |
| `order_shipped` | utility | dispatch / shipping notice | {{1}} order_number, {{2}} (optional courier/eta) |
| `order_delivered` | utility | delivery confirmation / thanks | {{1}} order_number |
| `order_cancelled` ✚ | utility | order cancellation notice (CD-32) | {{1}} order_number, {{2}} (optional reason) |
| `cod_reminder` | utility | COD prep / confirm before dispatch | {{1}} order_number, {{2}} amount |
| `payment_reminder` | utility | nudge for pending bank transfer | {{1}} order_number, {{2}} amount |
| `reengage_generic` | marketing | re-open a stale chat (**deferred**, needs opt-in §8) | {{1}} customer name |

**Merchant-facing (WhatsApp-to-merchant alerts, CD-32):**

| `name` | category | purpose | variables |
|---|---|---|---|
| `merchant_new_order` ✚ | utility | alert merchant of a newly placed order | {{1}} order_number, {{2}} total |
| `merchant_payment_claim` ✚ | utility | alert merchant a buyer submitted a payment screenshot to verify | {{1}} order_number, {{2}} amount |

> **Channel decision (CD-32):** the **portal (realtime) is the primary** merchant-alert
> channel, with email deferred at launch (per doc 09). The `merchant_new_order` /
> `merchant_payment_claim` utility templates above make the **WhatsApp-to-merchant** channel
> available so a merchant can also be pinged on WhatsApp (via `notifications.channel='whatsapp'`,
> §9.5); if that channel is not enabled for a given merchant, these alerts fall back to portal.
> Marketing templates + broadcasts remain **deferred** (§7). Launch ships the utility set above.

---

## 7. Rate limits, tiers, quality, throughput

### 7.1 Messaging tiers (business-initiated conversations / rolling 24h)

⚠️ **VERIFY LIVE** — thresholds and whether "conversation" vs "message" counting applies:

| Tier | Cap (business-initiated/24h) |
|---|---|
| Unverified / new | ~**250** (Path C pilot lives here — sufficient) |
| Tier 1 | 1,000 |
| Tier 2 | 10,000 |
| Tier 3 | 100,000 |
| Tier 4 | Unlimited |

- Tiers auto-scale up based on volume + quality once the business is **verified**. Path C is
  intentionally capped at ~250 — fine for one pilot merchant.
- Store the current tier in `whatsapp_numbers.messaging_tier` — typed enum **`whatsapp_tier`**
  (`unverified`,`tier_1`,`tier_2`,`tier_3`,`tier_4`), CD-9 — updated from account/quality
  webhooks.
- Note: **user-initiated** replies (inside the 24h window) are **not** limited by this tier —
  only business-initiated (template) conversations are. So bot↔buyer chat volume is not capped
  by 250; only outbound cold-starts are.

### 7.2 Phone number quality rating

- `whatsapp_numbers.quality_rating` is the typed enum **`whatsapp_quality`**
  (`green`,`yellow`,`red`,`unknown`) ([02](02-data-model.md), CD-9) — green (High) /
  yellow (Medium) / red (Low), `unknown` before first signal.
- **Degraded by:** buyers blocking/reporting the number, low read rates, spammy/irrelevant
  outbound, sending outside expectations, high template opt-out. Red rating can trigger
  restricted/flagged status and tier downgrade.
- Protect it: only message opted-in buyers, keep replies relevant, honor stop requests, avoid
  unsolicited broadcasts (deferred), keep templates high-quality.
- Quality changes arrive via the quality/account webhook (§2.1) → update
  `whatsapp_numbers.quality_rating`; on `red`/flagged set `whatsapp_numbers.status='flagged'`
  with `flag_reason='quality'` (typed enum `flag_reason` ∈ `quality|token|policy|manual|null`,
  CD-9) and alert the platform + merchant. Automated quality circuit-breaker (CD-42):
  `quality_rating='red'` auto-pauses proactive/business-initiated sends on the number.

### 7.3 Throughput

- Default send throughput ~**80 messages/second** per number (⚠️ VERIFY LIVE), auto-raisable
  by Meta. Far above pilot needs.
- Graph API also enforces app-level rate limits (HTTP 429 / error `#4` / `#80007`) — the
  Sender must honor `Retry-After`/backoff (§9).

### 7.4 Constraint on broadcasts → **defer**

Broadcasts (mass business-initiated templates) are constrained by: the ~250/24h unverified
cap, per-second throughput, quality-rating risk, and opt-in requirements (§8). Per
[00](00-overview.md) broadcasts/abandoned-cart are **out of scope for launch** — do not build
mass outbound in Path C. Any future broadcast must throttle to tier + throughput and only
target opted-in buyers.

---

## 8. Compliance essentials

- **Opt-in:**
  - A **buyer-initiated** message (including click-to-WhatsApp-ad referrals, §3.1) **satisfies
    opt-in** for the ensuing conversation — no separate consent needed to *reply*.
  - Any **merchant-initiated** outreach to a buyer who hasn't messaged first requires **prior
    opt-in** (buyer gave the number + agreed to be contacted on WhatsApp, via a clear
    disclosure naming the business). Track consent before enabling merchant-initiated
    templates/broadcasts.
    - Consent is tracked in [02](02-data-model.md) `customers` (CD-8): `wa_opt_in_status`
      (typed enum `wa_opt_in` ∈ `unknown|in|out`, default `unknown`), `wa_opt_in_source`,
      `wa_opt_in_at`. For Path C (buyer-initiated only) this stays `unknown`/`in` and is
      low-risk, but a recorded `in` is **required** before any marketing/broadcast. Opt-in/STOP
      enforcement gates all business-initiated sends (CD-42).
- **STOP / opt-out:** honor buyer stop requests (bandh karo / stop / unsubscribe) — set
  `customers.wa_opt_in_status='out'` and suppress non-essential outbound. Improves quality
  rating.
- **Prohibited goods:** WhatsApp Commerce Policy bans certain categories (alcohol, tobacco,
  drugs, weapons/ammunition, adult products, live animals, certain supplements, gambling,
  counterfeit, etc.). ⚠️ **VERIFY LIVE** against the current WhatsApp Commerce/Business
  policy. The merchant's catalog must comply; selling prohibited goods risks number/WABA ban.
- **Platform-ban risk (multi-tenant):** in Path C the merchant's number lives under the
  **platform's own WABA** — a merchant policy violation can jeopardize the **platform's**
  WABA/Business Manager, not just theirs. Therefore: **vet merchants** before onboarding
  (business legitimacy, product category), enforce a merchant agreement, and monitor quality
  per number. This is a stronger requirement than in the future model where each merchant uses
  their own WABA.

---

## 9. Error handling & resilience

### 9.1 Send failures & retries

- Wrap every Graph send; on failure inspect the error object:

```json
{ "error": {
    "message": "(#131047) Re-engagement message ...",
    "type": "OAuthException",
    "code": 131047,
    "error_data": { "details": "Message failed to send because more than 24 hours have passed..." },
    "fbtrace_id": "A..."
} }
```

- **Classify** (⚠️ VERIFY LIVE — codes shift):
  | Symptom | Typical codes | Action |
  |---|---|---|
  | Outside 24h window | `131047`, `131051` | switch to template or defer; don't retry as-is |
  | Rate limited | `4`, `80007`, `130429` | backoff + retry (respect `Retry-After`) |
  | Invalid/expired token | `190` | do not retry; alert platform; refresh token (§9.3) |
  | Recipient not on WhatsApp / invalid | `131026`, `131052` | mark `messages.status='failed'`; notify merchant |
  | Template paused/not approved | `132xxx` family | fall back / skip (§6.4) |
  | Temporary Meta error / 5xx | `131016`, HTTP 5xx | retry with backoff |

- **Retry policy:** exponential backoff with jitter (e.g. 1s, 4s, 15s, 60s), capped attempts,
  only for **retryable** classes. Non-retryable (window/token/invalid-recipient/policy) →
  fail fast, mark `messages.status='failed'` + `messages.error`, surface to merchant.
- Preserve per-conversation ordering: a failed-then-retried message must not reorder behind
  later messages (single-flight per conversation via the queue).

### 9.2 Expired / invalid token

- Code `190` (or 401) → mark `whatsapp_numbers.status='flagged'` with `flag_reason='token'`
  (CD-9), stop sends on that number, raise a **platform** alert, and rotate the System-User
  token (re-encrypt into `whatsapp_secrets`, bump `token_rotated_at`; §10). Re-enable after
  refresh.

### 9.3 Number flagged / quality red

- On `red` quality or a `flagged`/restricted account webhook: set
  `whatsapp_numbers.status='flagged'`, pause non-essential outbound, alert platform +
  merchant, and investigate (blocks/reports, spammy templates).

### 9.4 Template rejected/paused

- Handled in §6.4: fall back (in-window free-form) or skip (out-of-window), notify merchant
  via `notifications.type='template_status'`, log.

### 9.5 Operational alerts (who gets told)

| Event | Channel | Audience |
|---|---|---|
| Payment claim / new order | `notifications` (portal + WA) | merchant |
| Template rejected/paused | `notifications.type='template_status'` | merchant |
| Number flagged / quality red | alert | platform + merchant |
| Token expired/invalid | alert | platform (ops) |
| Webhook signature failures spike | alert | platform (ops) |
| Unknown `phone_number_id` inbound | alert | platform (ops) |
| Send failure rate / 429 spike | alert | platform (ops) |

> Platform-ops alerting channel (PagerDuty/Slack/email) is defined in
> [09](09-nonfunctional-devops.md). Merchant-facing alerts use the `notifications` table.

### 9.6 Resilience patterns

- **Fast-ACK always** (§2.7) so Meta never retries due to our slowness.
- **Idempotent** processing (§2.6) so Meta retries are harmless.
- **Circuit-break** sends on a number when token/quality is bad, rather than hammering Graph.
- **Persist raw** payloads (`messages.raw`, `webhook_events.payload`) for replay/debug.

---

## 10. Config / secrets needed

All secrets stored via Railway env vars / secret manager; the DB stores only **references**
(`whatsapp_numbers.access_token_ref` → `whatsapp_secrets`), never raw tokens.

> **Env-var names are canonical in [09 — Non-functional / DevOps](09-nonfunctional-devops.md)
> — that doc is the single source of truth.** All names use the **`META_*`** prefix (CD-27);
> the older `WHATSAPP_*` names are retired. The table below mirrors doc 09 for local
> convenience only — if it ever disagrees, doc 09 wins. **Startup assertion (fail fast, CD-27):**
> the app boots with a check that every required Meta secret (`META_APP_ID`, `META_APP_SECRET`,
> `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_SYSTEM_USER_TOKEN`,
> `TOKEN_ENCRYPTION_KEY`) is **present and non-empty**; a missing/blank value aborts startup.

| Secret / config | Purpose | Scope | Storage |
|---|---|---|---|
| `META_APP_ID` | Meta App ID | platform | env |
| `META_APP_SECRET` | Webhook `X-Hub-Signature-256` verification (§2.4) | platform | env (secret) |
| `META_WEBHOOK_VERIFY_TOKEN` | Webhook GET handshake (§2.2) | platform | env (secret) |
| `META_SYSTEM_USER_TOKEN` | Path C platform send + Graph calls when `access_token_ref` NULL/`'platform'` (§1.1, CD-2) | platform | env (secret) |
| Per-merchant System-User / access token | Send + Graph calls (§4, §3.2) | per number | encrypted in `whatsapp_secrets`, referenced by `whatsapp_numbers.access_token_ref` |
| `TOKEN_ENCRYPTION_KEY` | Encrypt/decrypt `whatsapp_secrets` ciphertext (`key_id` selects version) | platform | env (secret) |
| `phone_number_id` | Routing key + send URL | per number | `whatsapp_numbers.phone_number_id` (non-secret id) |
| `waba_id` | WABA ops (templates, number mgmt, catalog §11) | per number | `whatsapp_numbers.waba_id` (non-secret id) |
| Two-step verification PIN | Number registration/re-registration (§1.1) | per number | secret manager |
| `META_GRAPH_API_VERSION` | Pin Graph API version (§4, §11) | platform | env |

> `whatsapp_numbers` now carries `token_expires_at`, `token_rotated_at`, and the typed
> `flag_reason` enum (`quality|token|policy|manual|null`); `quality_rating`/`messaging_tier`
> are the typed `whatsapp_quality`/`whatsapp_tier` enums — all finalized in
> [02](02-data-model.md) (CD-9).

---

## 11. Catalog / Commerce API (catalog-sync)

The `catalog_sync` background job (`background_jobs.type='catalog_sync'`, CD-3) pulls a
merchant's Meta product catalog into local `products` so the bot can quote/sell native-catalog
items (§3.1 `order` mapping). It uses the Meta **Graph Catalog/Commerce API**.

### 11.1 Endpoints

| Call | Endpoint | Purpose |
|---|---|---|
| List catalogs on the WABA | `GET /{waba_id}/product_catalogs` | discover the catalog(s) bound to the merchant's WABA → `catalog_id` |
| List products in a catalog | `GET /{catalog_id}/products` | fetch the product rows to upsert |

- **Base:** `https://graph.facebook.com/<META_GRAPH_API_VERSION>/…`, `Authorization: Bearer <token>`
  (token via the CD-2 dereference rule, §1.1).
- **`GET /{catalog_id}/products` field set** (request explicitly via `?fields=`):
  `id, retailer_id, name, description, price, currency, availability, image_url, url` (⚠️ **VERIFY
  LIVE** — exact catalog field names/availability). `retailer_id` is the merchant-assigned SKU
  and is the **join key** to local products.
- **Pagination:** Graph cursor pagination — follow `data[]` + `paging.cursors.after` /
  `paging.next` until exhausted (page size via `?limit=`). The sync job loops all pages before
  marking the `background_jobs` row `completed`.

### 11.2 Token scope

The token must be scoped for catalog reads: **`whatsapp_business_management`** and/or
**`catalog_management`** (⚠️ **VERIFY LIVE** — confirm which scope the Catalog endpoints require
and whether the Path C System-User token already carries it). If missing, catalog-sync fails
with a scope error surfaced on the `background_jobs.error` field + platform alert.

### 11.3 `retailer_id → products.external_ref` upsert

- For each fetched product, **upsert** the local `products` row keyed on
  `(merchant_id, external_ref)` where `products.external_ref = retailer_id` (Meta catalog id).
  Existing unique index `products(merchant_id, external_ref)` ([02](02-data-model.md)) backs
  this.
- Map `name/description/price/currency/image_url` onto the local columns; prohibited-keyword
  screening (CD-42) runs on imported names/descriptions and raises a review task on a hit.
- Conflict detection uses `products.external_updated_at` — skip/flag rows the merchant edited
  locally more recently rather than clobbering them.
- The native-catalog `order` inbound (§3.1) resolves `product_retailer_id → external_ref` to
  find the local product for the order draft.

### 11.4 Connection storage

The catalog connection lives in **`merchants.settings.metaCatalog`** ([02](02-data-model.md),
CD-13):
```ts
metaCatalog: { catalogId: string, connected: boolean, tokenRef: string, lastSyncedAt: string } | null
```
`catalog_sync` reads `catalogId` from here (discovered once via `GET /{waba_id}/product_catalogs`),
uses `tokenRef` for the bearer token, and stamps `lastSyncedAt` on each successful run.

---

## Cross-references
- Routing, flows, multi-tenancy: [01 — Architecture](01-architecture.md).
- Tables/enums/buckets: [02 — Data Model](02-data-model.md).
- Bot FSM states (`bot_state`): [05 — Bot / Negotiation](05-bot-negotiation.md).
- Canonical decisions resolving all gaps in this doc: [10 — Audit Report](10-audit-report.md)
  (CD-2, CD-9, CD-10, CD-12, CD-27, CD-28, CD-32, CD-44).
- Secrets/DevOps/alerting (canonical env-var names): [09 — Non-functional / DevOps](09-nonfunctional-devops.md).
