# Sahulatcart — market-ready plan

Written 2026-10-12 from the code as it is today, the Meta Tech Provider roadmap (PDF, 2026-09-21)
and the live services. This is the single plan. The eight documents it replaces are in
[archive/](archive/) for reference only.

**Plain-words version for reading and sharing:** [Sahulatcart-Plan.pdf](Sahulatcart-Plan.pdf)

**Build spec for the two developers:** [SRS-Fazal.md](SRS-Fazal.md) and [SRS-Uzair.md](SRS-Uzair.md) (PDF: [SRS-Fazal.pdf](SRS-Fazal.pdf),
[SRS-Uzair.pdf](SRS-Uzair.pdf)), which assign every feature to Fazal (Meta and
messaging) or Uzair (portal and operations), with requirements, tables, API contracts, tests and a
week-by-week schedule.
(rebuild with `python3 docs/launch/build-plan-pdf.py` after editing the script).

## The goal

**Build the whole product now, against Meta's test setup, so that on the day Meta approves us the
only work is three settings in the Meta dashboard. No code changes, no new features, no waiting.**

That is possible because Meta approval does not unlock new APIs. It unlocks *who* we may use the
same APIs for. Everything below is built and tested with Meta's test number and with merchants added
as app testers, which Meta allows before approval.

## Where we are today

Facts, checked on 2026-10-12.

**Working, in production:** the Roman-Urdu sales bot (intent, product matching, negotiation inside
merchant floors, price guard, shop Q&A, voice notes, upsell, handoff); orders by COD and by bank
transfer with screenshot review; atomic order numbers; stock reservation; PDF slips; the merchant
portal (dashboard, inbox with takeover, orders, catalog with CSV/Shopify import and AI descriptions,
settings, notifications, analytics); durable webhook handling with replay; data retention; daily
database backups. Live data: 1 merchant, 5 products, 2 conversations, 0 orders. We are before the
pilot.

**Built for one merchant only.** Inbound messages already route to a merchant by phone number, but
every outbound message, media download and catalog sync uses one token from `.env`. A merchant row
can only be created by an API call with the shared admin token, and the WhatsApp number only by the
seed script. The portal has no signup page, no password reset, no "Connect WhatsApp", no team page.

**Missing entirely:** Embedded Signup (the "Connect WhatsApp" button), per-merchant tokens (the
encrypted `whatsapp_secrets` table exists; nothing uses it), message templates (so a buyer who last
wrote over 24 hours ago cannot be messaged at all), alerts to the merchant outside the portal (a
merchant only sees a new order while the portal is open), order stages after "paid", enforcement of
opt-out, error alerting, rate limiting, billing.

**Meta paperwork: not started, and blocked on the owner.** The roadmap's owner items from September
are still open: NTN, full registered street address, legal name copied exactly from the certificate,
Gemini billing. The website still shows "To be confirmed" placeholders for NTN and address. Nothing on
the Meta side can start until these land.

**Fixed since the old plan:** webhook saved before the 200 to Meta; checkout stops when stock cannot
be reserved; Railway redeploys on shared-code changes; backups; Supabase moved to the company
account; `https://sahulatcart.com` now works (Cloudflare is in front of the domain).

## What Meta approval changes, and what it does not

| | Before approval (now) | After approval |
|---|---|---|
| App mode | Development | Live |
| Permissions | Standard access | Advanced access to the same two permissions |
| Who can connect a number | Our own test number, and merchants we add as app **testers** | Any merchant |
| Messaging limit | 250 per 24 h per unverified business | Tiers that grow with quality |
| The API calls we make | Identical | Identical |
| Our code | Identical | Identical |

So the plan is: build and test every Meta-facing feature now with testers, submit App Review as soon
as the two features Meta wants to see (connect a number, create a template) work, and keep building
the rest while Meta reviews.

### Approval day: the whole runbook

1. Meta dashboard → App → switch **Development** to **Live**.
2. Permissions and Features → confirm `whatsapp_business_messaging` and
   `whatsapp_business_management` show **Advanced access**.
3. Railway → backend → set `SIGNUP_OPEN=true` (until then, signup accepts only emails on an
   allow-list, which is how testers get in).
4. One real merchant, not a tester, signs up and connects a number. Send one message, get one reply.

That is all. Everything else in this plan happens before that day.

## Two tracks, in parallel

**Track A, Meta,** is paperwork and dashboard work. It is mostly waiting, and only the owner can do
the first step. **Track B, product,** is engineering. The one dependency between them: App Review
(A6) needs B1 and B2 working, because Meta requires a screen recording of the real product.

```
Week:   1    2    3    4    5    6    7    8    9    10   11   12   13   14
A  [A1][A2][--A3 business verification--][A4][A5][--A6 App Review--][A7: approval day]
B  [------B1 signup + connect WhatsApp------][B2 templates][---B3 onboarding---][----B4 shop ops----][--B5 reliability--][------B6 pilot------][B7 billing]
                                                  ^ record the two videos here, submit A6
```

If Meta is slower than drawn, B continues; nothing in B3–B7 waits for Meta. If Meta is faster, the
pilot starts earlier with real merchants instead of testers.

---

## Track A — Meta

### A1. Owner inputs (owner, this week)

Nothing else on this track can start without these. They were due 26 September.

| Item | Why |
|---|---|
| Company registration certificate and **FBR NTN certificate** (scans, all four corners legible) | The two documents Meta accepts for name and address |
| **Legal name copied character for character** from the certificate | "Nubrix Technologies (Pvt) Ltd" vs "(Private) Limited" is a rejection |
| **Full registered street address** | "Lahore, Pakistan" is a city, not an address |
| A **utility bill** or bank statement showing the business phone | Proves the phone number |
| **Gemini billing enabled** on the Google Cloud project | The free tier trains on buyer data, which breaches the WhatsApp Business Solution Terms, and allows 20 requests a day |
| A **dedicated SIM** for our own display number, never used on WhatsApp | Meta registers it to the Cloud API |
| A **card** on the Meta business portfolio, and **two-factor auth** on the Meta account | Required for message billing and for the portfolio |

### A2. Publish the details on the site (engineering, same day as A1)

Replace the two `.tbc` placeholders in `site/about.html` with the NTN and street address, and put the
same legal name, address and phone in the footer of every page. Meta's reviewer matches the website
against Business Manager and the documents, character for character.

### A3. Business verification (owner submits; Meta takes hours to days)

Business Manager → Settings → Business Info, filled exactly as on the certificate → Security Centre →
Start Verification → upload the two documents → confirm the phone or email code. Status shows in
Security Centre. **Wait.** Do not resubmit with altered details.

### A4. Meta app configuration (engineering with the owner logged in)

- Create the app: type **Other** → **Business**, attached to the verified portfolio. Add the
  **WhatsApp** product and **Facebook Login for Business**.
- Settings → Basic: icon (1024×1024, `site/assets/logo-1024.png`), category *Business and pages*,
  Privacy `/privacy.html`, Terms `/terms.html`, Data Deletion `/data-deletion.html`, app domain
  `sahulatcart.com`, business use *clients*.
- Facebook Login for Business → **Embedded Signup configuration**: create one, note its **config ID**
  (this is `META_EMBEDDED_SIGNUP_CONFIG_ID` in B1).
- WhatsApp → Configuration → webhook URL `https://appbackend-production-dae8.up.railway.app/api/v1/webhook/whatsapp`,
  our verify token, and subscribe to **four** fields: `messages`, `message_template_status_update`,
  `phone_number_quality_update`, `account_update`. Today only `messages` is on; the other three are
  the ones that tell us when a template is rejected or a number is restricted.
- Pin `META_GRAPH_API_VERSION` to a version Meta currently supports (the code defaults to `v21.0`,
  which is old) and note its retirement date.

### A5. Tech Provider enrolment (owner clicks through)

Developers dashboard → the Tech Provider onboarding guide → accept the platform terms. No partner app
ID: we go direct on the Cloud API.

### A6. App Review (engineering records; owner submits) — needs B1 and B2

Request **exactly two** permissions: `whatsapp_business_messaging` and
`whatsapp_business_management`. Not `whatsapp_business_manage_events`.

For each permission, a written justification and its **own** uncut screen recording of the real
product:

- *messaging*: a tester merchant's number receives a buyer message, the bot replies, the reply is
  shown arriving in the WhatsApp app.
- *management*: a template being created from our portal and appearing in WhatsApp Manager.

Justification wording, adapted from the roadmap: "Sahulatcart is a Tech Provider. Merchants in
Pakistan connect their own WhatsApp Business number through Embedded Signup; the platform answers
their customers automatically within pricing rules the merchant sets; the merchant supervises every
conversation and can take over at any time." Meta turns these around in about a day.

### A7. Approval day

The four-step runbook above. Then switch our own pilot merchants from "tester" to ordinary accounts
(nothing changes for them).

### If Meta stalls

The old plan had no fallback. There is one: numbers owned by **our** verified portfolio can message
without Advanced Access. For a pilot we can register a Sahulatcart-owned number per shop and set its
display name to the shop's name. It is a stopgap, not a product: Meta requires the display name to
reflect the business that owns the number, so this only runs while approval is pending and the shop
moves to its own number on approval. B1 is built so that switching is a reconnect, not a migration.

---

## Track B — Product

Each milestone has one "done when" test. A milestone is not done until that test passes against the
deployed backend, not only locally.

### B1. Signup and "Connect WhatsApp" (3 weeks)

The core of self-service, and the first thing Meta wants to see. Built first.

**Signup and account.** Email and password through Supabase Auth, with email confirmation and
password reset. Not Facebook login for the portal: that would add a second Meta review surface and
Embedded Signup already handles the Facebook part. On first login the backend creates the merchant
row and the owner membership in one transaction, keyed on the auth user id so a repeated login finds
the same shop. Until `SIGNUP_OPEN=true`, signup accepts only emails on `SIGNUP_ALLOWLIST`; that is how
testers and pilot shops get in before approval.

**Connect WhatsApp.** A page in the portal with one button. It launches Meta's Embedded Signup
(Facebook JS SDK, our config ID, `response_type: 'code'`). The browser passes the returned code to
the backend only. The backend:

1. exchanges the code for the merchant's business token (`GET /oauth/access_token`);
2. reads the WABA and phone number the merchant granted (never trusting IDs the browser reported);
3. encrypts the token with `TOKEN_ENCRYPTION_KEY` (AES-GCM) into `whatsapp_secrets`, the table that
   already exists for this;
4. subscribes our app to the WABA (`POST /{waba}/subscribed_apps`);
5. registers the number (`POST /{phone}/register` with a PIN we generate and store encrypted);
6. writes `whatsapp_numbers` with the `phone_number_id`, which is what inbound routing already uses;
7. sends one test message to the merchant's number and marks the connection **connected** only when
   it is delivered.

`client.ts`, `media.ts` and catalog sync stop reading `META_SYSTEM_USER_TOKEN` and resolve the token
per merchant. The env token stays only as the fallback for the one pilot merchant until it is
reconnected through the button, then it is removed. A **connection page** shows status
(connected / needs attention / disconnected), the display name, quality rating and messaging tier
from the `phone_number_quality_update` and `account_update` webhooks, with **Reconnect** and
**Disconnect**. A merchant who closes the popup halfway is left in "not connected" with nothing
half-written.

**Done when:** a tester account signs up, connects the test number, a message to that number gets a
bot reply, and the token appears nowhere in logs, the browser or the URL. A second tester cannot see
or message through the first tester's number.

### B2. Confirm inside the window; templates only as the rare fallback (1 week)

**The rule.** Since 1 October 2026, a free-form message inside the buyer's 24-hour window uses the
shop's 1,000 free messages a month (then about Rs 4); a template is **always** charged, even inside
the window. So the bot never sends a template while the window is open, and the product is built to
get everything done inside it:

- Order confirmation, bank details and "send the screenshot" go out immediately, free-form.
- **Payment verification inside the window.** The window runs 24 hours from the buyer's last
  message, which is usually the screenshot. The merchant gets a push alert at once (B4), and the
  payment claim in the portal shows **"free to confirm until 3:40 pm tomorrow"** with a countdown.
  Verify before then and the "payment verified" message is free-form and free. Most will be.
- **After the window closes** nothing is sent automatically. The order page shows "window closed,
  sending costs about Rs 4" with a button; the merchant decides. Same for dispatch notices, which
  are usually days later. A buyer can also ask "status" at any time, which reopens a window.

**Templates still exist, for two reasons:** the late cases above need one, and Meta's App Review
requires a recording of a template being created through our product. At connect time the backend
creates two **utility** templates on the merchant's WABA: `payment_update` (verified or rejected,
with the order number) and `order_sent`. Their approval status arrives on the
`message_template_status_update` webhook and shows on the connection page, where a rejected one can
be resubmitted. `notifyBuyer()` uses a template only when the window is closed **and** the merchant
pressed the button.

**Done when:** a template created from the portal shows *approved* in WhatsApp Manager; a payment
verified 20 hours after the screenshot goes out free-form and is counted against the free 1,000;
a verification 30 hours after is not sent until the merchant presses the Rs 4 button. **Record the
two App Review videos here and submit A6.**

### B3. Onboarding that gates go-live (2 weeks)

The wizard exists but "Go live" only sets a flag. It becomes seven steps, each checked by the
backend, and the bot cannot be enabled until all pass:

1. Shop name, logo, address, hours (also pushed to the WhatsApp business profile).
2. Connect WhatsApp (B1).
3. Add at least one product (form, CSV or Shopify CSV; this exists).
4. Delivery areas and charges. The bot already uses zones, but there is no screen to edit them; this
   adds one.
5. Payment: COD on or off (`codEnabled` exists and is ignored today), bank account for transfers.
6. Bot name, style and greeting (the greeting is saved today and never used; it will be).
7. **Send yourself a test order** from your own phone, end to end. Go live unlocks after one
   completed test order.

Two attestations at signup, required by Meta's policies: the merchant sells no prohibited goods, and
will message only customers who contacted them first. The support page already explains opt-in; the
checkbox makes it binding.

**Done when:** a new tester reaches "live" only through all seven steps, and the dashboard's "finish
setting up" card disappears exactly then.

### B4. What a real shop needs in week one (2 weeks)

- **Alerts outside the portal, without paying Meta.** New order, payment claim, handoff and "bot
  needs help" reach the merchant by **portal push notifications** (Web Push with a service worker;
  works on Android and on iPhone when the portal is added to the home screen) and by **email**. Both
  are free. **No WhatsApp alerts to merchants at launch** (decided 2026-10-13): since 1 October 2026
  they count as paid messages like any other, and a busy shop would pay for every one. Today a
  merchant only learns of an order while the portal tab is open.
- **Order stages.** Preparing → dispatched → delivered, from the order page, with the buyer told at
  dispatch: free-form if the window is open, otherwise a paid button the merchant may press. The enum
  exists; the transitions do not.
- **Unpaid bank orders expire.** After 24 hours without a screenshot: order cancelled, stock
  released, buyer and merchant told. Today they sit open forever.
- **Opt-out enforced.** The bot already records "bandh karo" as opt-out and then keeps replying.
  Fix: no bot replies to an opted-out customer, and "STOP" is matched as a keyword without an LLM
  call. Opt-in is the customer's first message; store the timestamp.
- **Small gaps that embarrass:** delete a product; edit the bot name after onboarding; "today" on the
  dashboard in Pakistan time (it is UTC now); a product with a quantity in stock cannot be ordered
  above it twice.
- Roman Urdu stays the one reply language for launch. English and Urdu script are detected already;
  honouring them is a later milestone.

**Done when:** a tester places an order with the portal closed and gets a WhatsApp alert within a
minute; a bank order with no screenshot is cancelled at 24 hours with stock back.

### B5. Running it for many shops (1–2 weeks)

- **Error alerting.** Sentry (free tier) on backend and admin; an uptime check on `/readyz` (plain,
  never `?llm=1`) that emails the owner.
- **Per-merchant LLM budget.** One Gemini key serves every shop. With billing on, add a daily cap per
  merchant so one busy shop cannot hand every other shop's chats to a human.
- **Message meter per shop.** Count every outbound message per phone number per month; show
  "N of 1,000 free used" on the dashboard; alert the merchant at 80% and at 100%; let the merchant
  choose what happens after the free 1,000: keep going (paid, about Rs 4 each) or switch the bot to
  handoff-only. Human replies from the inbox count too and are shown.
- **Rate limits** on signup, login and the admin API. Fix the admin-token lockout so ten bad guesses
  from a stranger do not lock the owner out.
- **Platform owner console.** One page, visible only to `platform_admins` (the table and JWT claim
  exist; the backend ignores them): list merchants with connection status, last message, order count;
  suspend a merchant (`merchants.status` exists and is never checked; it will be).
- **Tests that are missing:** admin routes, including a cross-tenant test that proves merchant A
  cannot read merchant B's orders by id; the webhook route end to end; signup and connect flows with
  Meta mocked. Admin portal gets a lint and typecheck gate in CI.
- **Single instance stays.** The in-process queue is correct for one backend instance, which is enough
  for the first fifty shops. The change to a database lock is written down in `CLAUDE.md` for when a
  second replica is needed.

**Done when:** a thrown error in production reaches the owner's inbox within five minutes, and the
cross-tenant test is in the suite.

### B6. Pilot: 3–5 real shops, 2–3 weeks

Starts as soon as B4 is done. Before approval the shops join as app testers (or on our numbers; see
*If Meta stalls*); after approval they are ordinary accounts. Targets: 200 conversations, 30 orders,
zero wrong prices, zero duplicate orders, zero cross-shop leaks. Stop rules: any of those three
counts above zero stops onboarding until fixed. One named person answers merchants on WhatsApp,
Pakistan hours.

### B7. Billing (1–2 weeks, after the pilot)

Plans `pilot | basic | pro` exist in the schema and are never read. Add: a 30-day free pilot, then a
capped PKR plan; plan limits on conversations per month; a usage page; invoices paid by bank
transfer to our account, marked paid by hand in the owner console. No payment gateway at first.
Expired plans switch the bot to handoff-only, never silent.

---

## Timeline

One full-time engineer. Weeks are elapsed, not effort.

| Milestone | Weeks | Cumulative |
|---|---|---|
| B1 signup + connect | 3 | 3 |
| B2 templates, then App Review submitted | 1 | 4 |
| B3 onboarding | 2 | 6 |
| B4 shop operations | 2 | 8 |
| B5 reliability | 1–2 | 10 |
| B6 pilot | 2–3 | 13 |
| B7 billing | 1–2 | 14 |

Meta's own time (verification days, App Review about a day) runs inside weeks 1–6 and does not add
to this if A1 lands this week. If A1 slips, every week of slip is a week later that real merchants
can join, but nothing in B waits.

## Decisions made in this plan

Made so that nobody is waiting on them. Any can be reversed, but each has a reason.

1. **Portal login is email and password, not Facebook.** Fewer Meta surfaces to review; Embedded
   Signup covers the Facebook part.
2. **One owner, one shop, one number per account** for launch. Team members and multiple numbers come
   after billing.
3. **Two utility templates per shop, created automatically.** Merchants do not write templates.
4. **Merchants pay Meta directly** for conversations; we are a Tech Provider, not a Solution Partner,
   and cannot carry their Meta bills.
5. **Roman Urdu only** at launch.
6. **No payment gateway** for our own subscription at first; bank transfer and manual marking.
7. **COD and bank transfer only** for buyers, as today. No Raast, no gateway. Nothing in the product
   touches buyer money.
8. **Unpaid bank orders expire at 24 hours** by default; a merchant can set 6–72 hours.
9. **Stock is reduced at order placement and restored on cancellation**, as the code does now.
   Merchants record outside sales by editing stock.
10. **Prohibited-goods and opt-in attestation at signup**, enforced by a checkbox and the suspension
    control, not by reviewing every catalog.
11. **Fewer messages per sale is a product requirement, and every shop sees its meter.** Since
    Meta's 1 October 2026 pricing, each bot reply past 1,000 a month per number costs about Rs 4 in
    Pakistan. Messages are combined, buttons replace questions, nothing paid is sent automatically
    for dispatch, merchant alerts go by push and email. Sahulatcart pays Meta nothing under the Tech
    Provider model; our costs are hosting and the AI, so the cheapest Gemini model handles the
    intent step, which is most calls, and the per-merchant daily AI budget in B5 caps the rest.

## What only the owner can do

Everything on this list is on Track A; nothing on Track B needs it.

- The A1 items, this week. They have been the blocker since September.
- Submit business verification (A3) and accept the Tech Provider terms (A5): both need the Meta
  account holder.
- Click submit on App Review (A6); the recordings and text are prepared by engineering.
- Choose the 3–5 pilot shops.

## What was removed from the old plan, and why

- Seven overlapping numbering schemes (phases, 60 task IDs, 31 features, 11 work packages, 10 gates,
  40 scenarios, 15 decisions) for the same work. This plan has 7 milestones and 7 Meta steps.
- App Review scheduled after weeks of internal refactoring. Meta is the longest external wait; it is
  now submitted at week 4, as soon as the two demos exist.
- A generic outbox and lease system, encryption key rotation, deletion pipelines and a restore drill
  before launch. The webhook is already durable and backed up; those come when there is load.
- Facebook portal login. See decision 1.
- Hedging about whether Meta's APIs would work. They are known; they are listed in B1 and B2.
- 37–64 engineering days as the estimate. It was optimistic by about half; the table above is in
  weeks.
