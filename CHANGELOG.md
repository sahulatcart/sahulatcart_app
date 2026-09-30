# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left open.
Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries for 2026-07 and earlier were reconstructed from git history and commit messages.

---

## 2026-09-30 — Admin portal redesign (every page, login through settings)

**Outcome** — the merchant portal was redesigned with the `ui-ux-pro-max` guidance ("Minimalism &
Swiss Style", data-dense dashboard): a grouped sidebar (Operate / Manage), a split login page, stat
cards, clearer tables, and one set of shared pieces in `components/AppShell.tsx` (`PageHead`,
`BackLink`, `EmptyState`, `Pill`, `StatusPill`, `PaymentPill`, `humanize`). Every API call and
handler is unchanged. The marketing site (`site/`) was not touched. Brand tokens are unchanged;
JetBrains Mono (the brand's mono) was added for order and account numbers.

**Accessibility fixes that came with it:** emoji used as icons replaced with lucide icons; every
input has a real label (placeholders were the only label on several forms); icon-only buttons have
names; a visible focus ring everywhere; file pickers are keyboard-reachable (the input was
`display:none`); toasts are announced to screen readers; 44px touch targets on phones; tables scroll
inside their card instead of the page.

**Small behaviour fixes found on the way:**
- Catalog table price edits rounded to whole rupees (Rs 99.99 became 100). They now keep paisa, like
  the add form.
- The inbox now says when the bot is silent because you've taken over. Forgetting to hand a chat
  back looked exactly like "the bot stopped replying".

**How it was checked.** The portal can't sign in locally without the real backend, which shares the
live database. So a throwaway mock backend served fake data on :8080, and a fake session was put in
`localStorage`. Every page was screenshotted at 375px, ~820px and 1280px. That found problems the
typecheck couldn't: order numbers and money wrapping mid-value, "SK-" and "1024" on two lines; a
3-then-1 stat grid; the inbox a few pixels taller than the window, so the page scrolled; a mobile
stat rule written *before* the rule it overrode, so it never applied; a button focus rule
(`:focus-within`) that left a ring on every clicked button; hover colours on disabled buttons.

**Misleading symptoms, for next time:** in the sandbox, `next/font` couldn't reach Google Fonts, so
pages rendered in the fallback font. This is a dev network problem, not the code; the Docker build
downloads fonts at build time. And a screenshot taken during a window resize showed the mobile
drawer open. It was just mid-animation; the DOM said closed.

**Also:** Kaisei Decol (empty-state headlines only) and the mono font are no longer preloaded on
every page. That had been about 15 font files per page load.

---

## 2026-09-30 — Backend switched to production mode; the build-failure cause confirmed from Railway's log

**Outcome** — the live backend had been running with `NODE_ENV=development`, so the replay sweeper
and the retention job never started. It now runs with `NODE_ENV=production`, confirmed by the deploy
log line `Sahulatcart backend listening on :8080 (production)` (deploy `03d68b49`, SUCCESS). It was
done by Railway CLI (`@railway/cli` 5.63.1, installed to `~/.local`, owner logged in) instead of the
dashboard.

**The trap that was avoided.** Railway gives service variables to the build as well. With
`NODE_ENV=production`, `npm ci` skips devDependencies, and TypeScript is one. Reproduced from a clean
checkout: `tsc: command not found`, exit 127. So flipping `NODE_ENV` alone would have broken every
backend deploy again, silently, with the old container still serving. Adding
`NPM_CONFIG_INCLUDE=dev` fixes it: tested locally, and the built backend booted in production mode
with a fake environment. Both variables were set in one command, so there was one deploy.
`NPM_CONFIG_INCLUDE` was also declared in `.railway/railway.ts`. `railway config plan` showed that an
apply deletes undeclared variables, so it would otherwise have been wiped.

**The 2026-09-27/28 failures, confirmed.** `railway deployment list` shows FAILED deploys at A's,
B's and C's merges. Build `c0f38563` ends with the same 8 `Cannot find module '@app/shared'` errors
as the local reproduction, and the fix's deploy then succeeded. SKIPPED deploys are commits outside
`backend/**`.

**Noticed, not touched:** `railway config plan` wants to delete a variable `FIX` on `@app/admin`
that isn't declared in the IaC file. Its purpose is unknown; ask before applying.

---

## 2026-09-29 — Migrations 0006–0008 applied to the live database; order-number fallback removed

**Outcome** — the owner approved, and `npm run db:migrate` applied 0006 (order counter), 0007 (no
direct table access from browsers) and 0008 (stock reservation). Each ran in its own transaction and
reported `ok`. There were no placed orders yet, so the counter starts at SK-1001.

**Verified straight after, read-only:**
- `_migrations` lists all three; the new table, column and functions exist.
- `service_role` can read tables and run the functions; `authenticated` and `anon` can do neither.
- `supabase_auth_admin` can still run the login hook; `anon` can't.
- The backend's API sees the new functions: a `reserve_stock` call with a random order id returned
  `true` and changed nothing. `next_order_number` wasn't called, because that would have used up
  SK-1001.
- With the public anon key, reading `products` and calling the login hook both fail with `42501`.

**Fallback removed.** The temporary `COUNT(*)` order-number fallback in `order-service.ts` is gone. If
the counter fails, checkout now stops rather than guessing a number. Stock reservation failures are
still only logged, so an order isn't lost over a stock-count error. The flow test that covered the
fallback became two tests, one per behaviour: 121 tests.

**Still to confirm:** the owner signs in to the admin portal once, to check login works under 0007.

---

## 2026-09-29 — Payment screenshots and logs are now actually deleted

**Outcome** — `backend/src/lib/retention.ts` runs hourly in production. It deletes payment screenshots
90 days after their claim is decided (verified or rejected), and clears the references. It also
deletes `webhook_events` rows and clears `messages.raw` after 30 days. Each purge writes an
`audit_log` row. Before this, nothing ever deleted a screenshot.

**The rules disagreed, and the user chose.** The privacy policy (§10) promised screenshots "12
months, then deleted" and technical logs "90 days". Spec 09 §8.2 (CD-41, marked SPECIFIED) says 90
days after completion for screenshots and 30 days for `webhook_events` and `messages.raw`, each purge
audited. The shorter periods satisfy the policy, since it only sets maximums. The user picked the
spec. Section D's 90-day `webhook_events` purge in `webhook.ts` was replaced by this job. The
policy's wording was left alone; stating the shorter periods there is the owner's call.

**Design choices**
- **The clock starts at `decided_at`,** when the merchant settles the payment, not at upload. A
  screenshot is kept as long as verification needs it.
- **`status = 'claimed'` protects a screenshot outright.** Dates don't matter.
- **`media:` references** are Meta media ids we never stored. They are cleared but not sent to storage.
- **If the storage delete fails, the DB references stay,** so the next run retries. We never lose track
  of a file that still exists.
- **At most 100 screenshots per run.** The job is production-only, for the same reason as the replay
  sweeper: a local `.env` points at the live data.

**A weak test caught by breaking the code.** With the "awaiting review" filter removed, all the tests
still passed. The unreviewed claim in the test had no `decided_at`, so the date filter hid the
missing status filter. The test now gives that claim an old date too. Without the filter, 3 tests
fail; with it, all pass.

**Verified:** 120/120 tests across 15 files (4 new). Root and admin typechecks exit 0. Nothing was
run against live data: the job only starts when `NODE_ENV=production`.

---

## 2026-09-29 — LinkedIn added to the homepage's Organization schema

**Outcome** — `sameAs` in `site/index.html` now lists the LinkedIn company page
(`https://www.linkedin.com/company/sahulatcart/`) next to Facebook and Instagram. This follows up the
teammate's SEO pass (commits `8724355`, `c730422`, `6632c0a`), which listed LinkedIn as still to do.

The URL shared was a logged-in admin view (`…/company/sahulatcart/posts/?viewAsMember=true`). The
schema needs the public company URL, so the path and query were dropped. Both JSON-LD blocks were
parsed as JSON after the edit, not just checked by eye.

Also from the SEO follow-up, done outside the repo on 2026-09-29: the sitemap was submitted in Search
Console, and indexing was requested for `whatsapp-automation.html`. The homepage, pricing and
features pages were already indexed.

---

## 2026-09-28 — SEO audit skill, and the first round of fixes it found

**Outcome** — a project skill at `.claude/skills/seo-audit/` (kept local on the owner's machine, not
committed; static audit script, read-only live
checker, reference notes on Pakistani search behaviour and Urdu/hreflang), and the fixes from its first
run: the high-severity issue is gone and medium issues went from 6 to 1.

**`robots.txt` had been blocking `/assets/` since the SEO foundations work.** The line was meant to keep
"no search value" files out of the index, but it also blocked the CSS, `site.js`, the favicon and
`logo-1024.png` — the Organization schema's logo and every page's og:image. Google renders pages with
their CSS and JS, and advises against blocking them. Removed.

**The FAQPage JSON-LD described a FAQ that did not exist on the page.** Google's structured-data rules
require marked-up Q&A to be visible; hidden markup counts as spammy structured data. Added a visible FAQ
section to the homepage (reusing the existing `.faq` styles from pricing) with the exact same questions
and answers, and a comment telling the next editor to change both together. Also worth knowing: since
Aug 2023 Google only shows FAQ rich results for well-known government and health sites, so the earlier
note that the FAQ was "eligible for rich results" no longer holds — the value now is the visible text.

**Titles and description.** Home (73 chars, cut off in results) →
"WhatsApp Sales Bot for Pakistani Shops | Sahulatcart". Features (66) shortened; About (19) and
Support (21) given descriptive titles. Homepage description 181 → 146 chars. og titles unchanged.
`sitemap.xml` lastmod bumped for the four changed pages.

**Second round, approved by the owner the same day** — the audit is down to one medium issue (the
`.tbc` address, owner-only) and one accepted low (demo.html is a short contact page):

- **Search phrases in every hero H1.** The H1s are Roman Urdu slogans with no searchable words. A
  `.kicker` line now sits *inside* each H1 ("WhatsApp business automation for Pakistani shops",
  "WhatsApp chatbot pricing in Pakistan", …) so the slogan stays and the H1 carries the query. Styled
  by `.hero h1 .kicker`; pricing's centred hero uses `.center-kicker`. Pricing and demo titles rewritten.
- **New page `whatsapp-automation.html`** targeting "WhatsApp business automation": what's automated,
  a WhatsApp Business app vs Sahulatcart table, who it's for, a visible FAQ mirrored in FAQPage
  JSON-LD. Every claim is lifted from existing site copy; two drafted claims ("we set the API
  connection up with you", "answers stock questions") were cut because nothing on the site or in the
  spec backs them. Linked from the homepage and the footer of the four main pages — the legal pages
  have a different footer and were left alone.
- **"Sahulat Cart" (two words).** Owner reports Google doesn't show the site for it — that name was the
  WooCommerce grocery shop that previously lived on this domain. Added it as `alternateName` on the
  Organization, WebSite and SoftwareApplication nodes, and one sentence on about.html. Visible copy
  keeps the brand spelling "Sahulatcart".
- **Urdu homepage — built, then removed at the owner's request.** A `/ur/` page with hreflang was
  drafted and verified, then deleted along with its hreflang tags, sitemap entry and RTL styles: the
  owner does not want an Urdu-script version. `references/urdu-and-hreflang.md` in the seo-audit
  skill still documents how to do it properly if that changes.
- **Share image `assets/og-image.png` (1200×630)** replaces the square logo as og:image/twitter:image
  on every page (the Organization schema logo stays square, which is what that field wants). Rendered
  from an HTML card with headless Chrome — headless **Edge** exited without writing the file.
- **Fonts:** measured every rendered element's family/weight across all pages in the browser.
  JetBrains Mono and Kaisei Decol 400 were never used; dropped from the Google Fonts request.
- **Local preview gotcha, again:** `python -m http.server` served a stale style.css, so a page
  first looked like newly added CSS rules didn't exist. A `fetch(..., {cache: 'reload'})` then reload fixed it.

**After the push — two things the owner saw in Google:**

- **No logo in results (grey globe).** Almost certainly the `robots.txt` `/assets/` block again: the
  favicon is `assets/favicon.svg`, and Google's favicon crawler obeys robots.txt, so it could never
  fetch it. Unblocked by the first push. As insurance, added `assets/favicon-192.png` (192 = 4×48;
  Google wants a multiple of 48 px) with a `<link rel="icon">` on every page, and a root `favicon.ico`
  (48/32/16) because some crawlers ask for `/favicon.ico` regardless of the markup — it was a 404.
  Rendered from favicon.svg with headless Chrome (`--default-background-color=00000000` for
  transparency), then packed with Pillow. Google only refreshes favicons on recrawl: days to weeks.
- **"sahulatcart" (one word) doesn't find the site; "sahulat cart" does.** Google treats the one-word
  form as a misspelling of "sahulat card" and fills the page with Sehat Sahulat Card results — it
  doesn't know the brand as an entity yet. Put the brand first in the homepage title
  ("Sahulatcart — WhatsApp Sales Bot for Pakistani Shops"). The real fix is off-site: a Google Business
  Profile and social profiles all named "Sahulatcart" and linking to the site, then `sameAs` links to
  them in the Organization schema. The result the owner screenshotted still showed the *old* meta
  description, i.e. Google hadn't recrawled yet — changes 15 minutes old can't show there.
- Also fixed `aria-label="SahulatCart"` in `logo.svg` and `favicon.svg` — the brand is "Sahulatcart".
- **That push's site deploy failed, and it had nothing to do with the change.** Build log:
  `failed to resolve source metadata for docker.io/library/nginx:alpine … dial tcp …:443: i/o timeout` —
  Railway's builder couldn't reach Docker Hub to pull the base image. The live site kept serving the
  previous build. A plain Redeploy from the dashboard succeeded. How it was spotted without the Railway
  CLI (not installed on this machine): the public GitHub commit-status API shows Railway's per-service
  result — `curl https://api.github.com/repos/sahulatcart/sahulatcart_app/commits/<sha>/status`.
- **Organization `sameAs`** now lists the Facebook and Instagram profiles, so Google can tie the brand
  name to them. Use the canonical profile URLs, not what the owner copies from the app: the Instagram
  link carried a `?stkn=` tracking parameter, and the Facebook one was a `/share/…` redirect that
  resolves (canonical tag) to `https://www.facebook.com/p/sahulatcart-61593379073165/`.

Owner actions still open: Search Console "Request indexing" for every changed/new page plus resubmitting
the sitemap, a Google Business Profile (it will also help "Sahulat Cart" searches), the real registered
address/NTN, and the https apex fix (Cloudflare/DNS).

**Dead end:** the skill's first test run (six parallel eval agents) hit the account's session usage
limit and was abandoned; one failed agent left a `python -m http.server` running that held its sandbox
folder open until it was killed. The skill has not yet been evaluated end to end.

---

## 2026-09-28 — The backend hadn't deployed since 21 September

**Outcome** — every backend deploy since the Railway config migration has failed, so the live backend
still ran 21 September's code. Sections A, B and C reached **only the admin portal**. The cause was
reproduced and fixed in `backend/package.json`; Railway's own build log still needs confirming by
someone with access.

**The misleading symptom.** After A merged, the backend was declared live because a CORS preflight
from `evil.example` got no `Access-Control-Allow-Origin` header. That test proved nothing: the old
code only echoes its configured `ADMIN_ORIGIN`, so an unknown origin gets no header from old *or*
new code. Every URL also returned 200, because Railway keeps serving the last good container when a
build fails.

**What gave it away.** `/healthz` reported `uptime` 579,558 s (6.7 days) on 2026-09-28. And
`GET /api/v1/admin/notifications` with no login returned **404, route not found**; the new code
returns 401. The portal had deployed (its `/notifications` page returned 200), which is why it looked
fine.

**Cause, reproduced in a clean checkout** (`git archive` + `npm ci`, as Railway does).
`.railway/railway.ts` builds the backend with `npm run build --workspace=@app/backend`, which runs
only `tsc` for the backend. `@app/shared` resolves to `shared/dist`, which doesn't exist in a clean
checkout, so the build fails with `Cannot find module '@app/shared'` (exit 2, 7 errors). This also
fails on `7db3588`, from before any review work, so it's older than sections A–D. `backend/Dockerfile`
builds `shared` first and works, which suggests the service built that way before the migration
switched it to Railpack.

**Fix.** The backend's own `build` script now compiles `shared` first. That works however Railway
calls it, with no Railway settings touched. Verified from a clean checkout:
- Railway's exact command exits 0;
- the Dockerfile steps and root `npm run build` also exit 0;
- the built `backend/dist/index.js` boots with a fake environment, answers `/healthz`, and serves
  the new routes (401 on `/notifications`).

**Not yet confirmed.** Railway's build log for the failed deploys hasn't been read; nobody on this
work has Railway access. PITFALLS says read it before changing anything. The reproduction is strong
evidence, but the owner should open the backend service → Deployments → latest failed build and
check it ends with `Cannot find module '@app/shared'`. `backend/railway.json`, which describes a
Dockerfile build with a `/healthz` health check, doesn't match the IaC and was left alone.

**Confirmed by timing (2026-09-29).** PR #3, carrying this fix, was merged at 06:47:46 UTC on 09-28,
and the backend restarted at 06:48:34, its first restart in 7 days. C had been merged at 06:33 with
no restart. `/api/v1/admin/notifications` now answers 401. For about an hour it was wrongly believed
that C had deployed without the fix: #3's merge time was assumed from when the merge was reported in
chat, not read from GitHub. **Read merge times from GitHub, not from when someone mentions them.**
Railway's build log for the failed A–C deploys still hasn't been read.

**When it deploys**, sections A–D reach the backend in one go. Checks afterwards:
- `/healthz` uptime should be small;
- unauthenticated `/api/v1/admin/notifications` should return 401, not 404.

Migrations 0006–0008 still aren't applied; the code's fallbacks cover that, and it's tested.

---

## 2026-09-28 — Order-flow tests, and the smaller bugs found along the way (sections D + E)

**Outcome** — the conversation code that caused most of the review's bugs now has tests: 13 whole
conversations covering COD, bank transfer, cancellation, sold-out, unserved areas, the 24-hour window,
AI outages, ambiguous products and both stalemate settings. Six smaller bugs noticed during A–C are
fixed. Branch `fix/review-section-d`, stacked on C. No migration.

**Bugs fixed**
- **Delivery charge lookup.** The customer's area went into a SQL `ilike` pattern, so a `%` or `_`
  matched any zone. Matching was also one-way ("DHA Phase 5, Lahore" never matched zone "DHA Phase 5").
  And an area the merchant had marked **not serviceable** silently got the default charge. Zones are
  now matched in code by whole words, most specific first (`delivery.ts`). An unserved area gets
  "Maazrat, X mein abhi delivery nahi hoti" and the bot takes another address.
- **Orders page listed never-placed drafts.** Every abandoned checkout showed up. It's now filtered
  to orders with a number, like the dashboard already was.
- **Meta catalog sync** read only the first 200 products and re-activated any product the merchant had
  switched off (`is_active: true` on every upsert). It now pages through up to 10,000 products, and
  `is_active` is left alone: new rows default to active, and one switched off stays off.
- **Staff could read full bank account numbers** in Settings. Spec 09 gives staff no bank-account
  access, so they now get an empty list.
- **Bank-transfer buyers with an Urdu-script name got no slip at all.** No PDF (see C), and the
  payment-verified message didn't carry the text slip. `orderSlipText()` now adds it whenever there's
  no PDF.
- **`webhook_events` kept every raw customer message forever**, but the privacy policy (§10) says 90
  days for technical logs. The stored copy is now dropped once processed, and the sweeper deletes
  rows older than 90 days, once an hour.

**Tests (section D).** `test-support/fake-db.ts` is an in-memory stand-in for the Supabase query
builder, about 140 lines, covering only the calls the flow makes, including JSON-path filters and
many-to-one embeds. `orchestrator.flow.test.ts` scripts the AI's intents, switches its phrasing off
(so replies are the deterministic templates), and records WhatsApp sends.

**Checking the tests themselves.** All 13 passed on the first run, which is suspicious, so four
fixes were reverted one at a time: the sold-out check, the unserved-area refusal, the state filter on
verify, and the stalemate setting. Each made exactly one test fail. Files were restored from copies,
and the suite passed again.

**Deliberately not done**
- **Opt-out ("bandh karo")** is saved and still never read. Nothing proactive is sent today, so there's
  nothing to suppress yet. It belongs with the WhatsApp templates work: any template send must check it.
- **Payment screenshots are never deleted.** The privacy policy promises 12 months. That needs a storage
  cleanup job, which is a separate piece of work.

**How it was verified**
- 116/116 tests across 14 files. Root and admin typechecks exit 0.
- Locally against the live database, read-only: the orders list returns 200 with no drafts, settings
  returns 200 with the expected keys, and there were no errors in the log. Catalog sync wasn't run
  locally, because it writes products.

---

## 2026-09-27 — Settings that did nothing, and Urdu slips (section C)

**Outcome** — two negotiation settings that were stored but ignored now work and can be set in the
portal, and buyers with Urdu-script names no longer get garbled PDF slips. No migration needed.
Sections A and B were merged and deployed first (PRs #1 and #2), and checked live: `/readyz` 200,
CORS headers gone, `/notifications` 200.

**What was fixed**
- **Bulk-discount tiers never applied (#17).** The canonical schema (doc 02) keeps `bulkTiers` in
  `merchants.negotiation_defaults`. The engine only read `product.bulkTiers`, which no column or code
  path ever sets, and there was no UI to set them either. The engine now falls back to the merchant's
  tiers, as spec 06 §3.5 says, and Settings has a "Bulk discounts" editor. Two engine tests cover the
  fallback and the product override; the §10 scenario table is unchanged and still at 100%.
- **`stalemateAction` was read but ignored (#18).** Every stalled haggle handed off. Settings now has
  "When haggling stalls". `hold_and_close` holds at the final price, and the negotiation stays open so
  a later "theek hai" closes there. It isn't marked `rejected`, which would have started a fresh
  negotiation at list price. The handoff notification now says which product stalled.
- **Urdu-script names garbled the PDF slip (#19).** pdfkit's built-in fonts are Latin-1, and when a
  PDF exists the buyer gets only the PDF, not the text slip. Now `isPdfSafe()` skips the PDF for
  non-Latin text, and the existing fallback sends the WhatsApp text slip, which renders any script.
  Embedding an Urdu font was ruled out: pdfkit does no right-to-left layout, so Urdu would still print
  in reverse order.
- **Validation** for the new settings: `stalemateAction` and `openingStance` are enums; each bulk tier
  needs `minQty` ≥ 2 and an extra % from 0 to 100.

**Trap found: tests could only import pure modules.** The logger validates the environment at import
time, so the first test to touch `slip.ts` died with `process.exit(1)`. `backend/vitest.config.ts` now
gives every test a dummy environment (`NODE_ENV` has to be overridden too; Vitest sets `test`, which
`config.ts` rejects). This also unblocks the orchestrator tests planned for section D.

**How it was verified**
- Backend: 99/99 tests across 12 files: 2 engine, 1 validation, 2 slip. Root and admin typechecks exit 0.
- The Settings page compiles in the dev server with no errors.
- The new controls weren't clicked through: the portal needs a real login, and there are no test
  credentials.

---

## 2026-09-27 — Reliability fixes from the codebase review (section B)

**Outcome** — seven fixes to how the bot handles messages, AI outages, stock and the 24-hour window.
Also a portal notifications page, which the other fixes turned out to depend on. This work is on
branch `fix/review-section-b`, stacked on section A. Migration 0008 is written and tested locally but
**not applied**; the code runs safely without it.

**What was fixed**
- **Lost messages (#10).** Meta gets its 200 before processing, so a crash or redeploy mid-message
  lost it forever: its `webhook_events` row blocked any retry. Now:
  - every message in a payload is claimed (with enough stored to replay it) before any is processed;
  - each ends `processed` or `error`;
  - a sweeper (production only) replays messages stuck in `received` for 5–60 minutes, up to 3 times;
  - shutdown drains in-flight messages for up to 25 s.
- **Races within one chat (#11).** Two quick messages from a buyer ran at the same time and overwrote
  each other's conversation state. `lib/keyed-queue.ts` now runs each buyer's messages in order.
- **The AI going down (#12).** A failed classification used to reply "Ek minute, check kar ke batata
  hoon" and never follow up. It now hands the chat to the merchant with a notification. Address
  extraction used to swallow AI failures, so the customer was asked for their name forever; it hands
  off too.
- **LLM cost (#13).** Eight procedural reply kinds now always use their Roman-Urdu template, with no
  call (`TEMPLATE_ONLY_KINDS`). The `ComposedSpec` type keeps them from ever reaching `compose()`.
  Their eight prompt cases were removed.
- **24-hour window (#14, safe part).** `notifyBuyer()` doesn't attempt a send WhatsApp will refuse; it
  notifies the merchant with the message text so they can pass it on. Any failed send does the same.
  The inbox disables replies in that case and says why. Template sending waits for templates to be
  approved in Meta.
- **Stock (#15).** Stock was checked but never reduced, so the last unit could be sold to everyone.
  Migration 0008 adds `reserve_stock` / `release_stock`: all or nothing, and idempotent through
  `orders.stock_reserved`. A placed order reserves its items; if one sold out meanwhile, the checkout
  is cancelled with an apology. Cancellations release the stock. The bot also refuses quantities above
  stock ("sirf N available hain") and hands bulk requests for untracked items (over 100) to the
  merchant. There's a new **Cancel order** action (API and a button on the order page) so an unpaid
  bank order can't hold stock forever.
- **Unstable product matching (#16).** The first substring match won, and the catalog query had no
  ORDER BY, so "shirt" could mean a different product on each message. `resolveProduct()` now returns
  every candidate when a mention is ambiguous, and the bot asks which. A name that contains the others
  still wins ("t shirt" over "shirt"). The catalog is ordered.

**The discovery that changed the plan: notifications were never shown.** The backend has always
written notifications (new orders, payment screenshots, "bot needs help", cancellations), but the
portal had no screen for them and the API no endpoint to read them. #12 and #14 both depend on the
merchant seeing a notification, so this adds `GET /admin/notifications`, `POST …/read`, a
`/notifications` page and an unread badge in the nav.

**Traps and dead ends**
- **`callGemini` swallowed its own errors.** Its `catch` caught the `LlmUnavailableError` it had just
  thrown and retried it. An invalid key or exhausted quota took 5 attempts, with up to 20 s waits,
  before the bot answered anything. Now a per-day 429 and any API error fail immediately.
- **Reserve stock *after* placing the order, not before.** Reserving first means releasing when
  placement fails. But placement also "fails" on a repeated "cod" for an order that's already placed,
  and that release would hand back the *first* placement's stock. After the draft-only update succeeds,
  exactly one caller reaches the reservation.
- **The replay job only runs in production.** Local `.env` points at the live database *and* the
  live WhatsApp token. A local sweeper would pick up real stuck messages and answer real customers
  from a laptop.
- **5-minute minimum age for replays.** During a Railway deploy the old container can still be
  finishing a message. The in-flight map only protects within one process, so the age threshold is
  what prevents two containers processing the same message.
- **TypeScript can't narrow through an alias of two variables.** `notifyBuyer` needed its send and
  slip kept inside one `if` block. A combined `ok` flag didn't narrow `waId` and `phoneNumberId`.

**How it was verified**
- Backend: 94/94 tests (7 new: keyed queue, ambiguity). Root and admin typechecks exit 0.
- Migrations: PGlite with 0001–0008 applied, 26 checks, 10 of them new for stock: reserve, idempotent
  re-reserve, all-or-nothing refusal, release, double release, and service-role-only.
- Local backend (development), status codes only:
  - `/readyz` 200; notifications count and list 200; cancel an unknown order 404; send to an unknown
    conversation 404; unsigned webhook 401;
  - no `replay` lines in the log, so the sweeper stayed off locally.
- Portal: `/notifications`, `/inbox`, `/orders/:id` and `/settings` compile and redirect cleanly when
  signed out, with only the expected 401s in a fresh tab.
- Not exercised: the replay sweeper against real data. Running it locally would have processed live
  customer messages; see the production-only rule above.

**Still open**
- Apply 0008 together with 0006 and 0007 once the owner approves.
- Confirm `NODE_ENV=production` on the Railway backend; the replay sweeper only runs then.
- Railway decides how long a container gets between SIGTERM and SIGKILL. If that's shorter than the
  25 s drain, messages cut off are replayed after 5 minutes rather than finishing.
- WhatsApp message templates (for buyers outside the 24-hour window) need creating and approving in
  Meta by the owner.

---

## 2026-09-27 — Security + money fixes from the codebase review (section A)

**Outcome** — nine fixes from the review. The shipped code is safe to deploy before any migration.
Migrations 0006 and 0007 are written and tested locally but **not applied** to the live database. That
needs the owner's go-ahead.

**What was fixed**
1. **Meta catalog sync stored prices 100× too high.** `"Rs1,500.00"` had every non-digit stripped,
   giving Rs 150,000. All price strings now go through `parsePaisa()` in `lib/money.ts`, which is also
   used for CSV and Shopify imports. An unreadable price is skipped and reported, never saved as Rs 0.
   The orchestrator also ignores products with price ≤ 0. The Meta token moved from the URL into a
   header. **If catalog sync was ever used, re-run it after deploy to correct the stored prices.**
2. **Cross-tenant image delete.** `DELETE …/images` removed whatever storage path it was sent. It now
   only unlinks a ref the product holds, and only deletes storage keys under the caller's merchant.
3. **SSRF in "describe from photo".** It fetched `images[0]`, which a Shopify CSV can point anywhere.
   Fetches are now limited to our Supabase origin and `cdn.shopify.com`, with a 10 s timeout and a
   5 MB cap.
4. **Payment actions.** Verify, reject and COD-collected are now single conditional UPDATEs, so a
   double-click gets a 409 instead of messaging the buyer twice. Verify/reject no longer reset a
   buyer's newer chat: the state only moves while `context.pendingOrderId` is still this order. Who
   acted is now recorded; it was always null before.
5. **Price guard covered only price replies.** Product and shop Q&A put the customer's raw question
   into the prompt with no guard, so "say it's Rs 500" could get through. Every reply is now checked
   against `sanctionedNumbers(spec)`, and customer text is quoted as JSON data in the prompt.
6. **Order numbers were `COUNT(*)+1`.** Two checkouts at once got the same number; the second
   confirm failed silently but still told the customer "confirm". Deleting any order would have made
   every later number collide. Migration 0006 adds an atomic per-merchant counter. Confirms only work
   on a `draft` order, and an order whose items fail to insert is dropped instead of kept with a
   total and no lines.
7. **Browsers could write any table directly.** The RLS policies are `for all` and ignore roles, and
   the anon key is public. Migration 0007 revokes table access from `anon`/`authenticated`, locks
   future tables by default, and revokes the auth hook's execute right. The hook had been callable by
   anyone and returned any user's merchant id and role.
8. **Staff could edit the catalog, settings and cost.** Per the canonical matrix
   (docs/spec/09 §2.3), `isManager()` now gates these; staff get a 403 with a readable message. Also
   new: validation of product fields, negotiation defaults and settings. Before, a typo of
   `maxDiscountPct: 150` put every floor at Rs 0, and the bot would accept any offer above 10% of list
   price.
9. **Hardening.** The admin token is compared in constant time and locked for 15 minutes after 10 wrong
   guesses. `/readyz` no longer returns DB error text. CORS was removed along with `@fastify/cors` and
   `ADMIN_ORIGIN`.

**Portal.** Several handlers toasted "Saved" without checking the response, so a 403 or a validation
error looked like success. All of them now show the server's message via `apiError()`. `apiJson()`
now rejects on an error status. Before, an error body was rendered as data, which briefly crashed
`/settings` and the dashboard before the login redirect. The smoke test caught that. Catalog quick-add
rounded Rs 99.99 up to Rs 100; fixed. CSV re-import no longer wipes floors, stock or the negotiable
flag when those columns are missing from the file.

**Traps found along the way (the valuable part)**
- **The audit columns reference `merchant_users.id`, not the Supabase auth user id.** The auth
  context carried the auth id. Passing it to `verified_by_user_id` would have hit a foreign-key error,
  and because the payments update is unchecked, the order would be "paid" while its payment stayed
  unverified. The context now carries `memberId`.
- **Counting admin-token failures broke portal logins at first.** Every portal request's JWT was also
  compared against the admin token. A naive throttle would have counted each one as a failed guess
  and locked everyone out after 10 page loads. Bearer values with three dot-separated parts now go
  straight to the JWT path.
- **`alter default privileges in schema public revoke execute on functions from public` does
  nothing.** PUBLIC's execute right is global in Postgres and can't be revoked per schema. PGlite
  caught this. The global form would also hit functions from extensions installed later, so it was
  not used; instead, every new function must revoke execute itself (now in CLAUDE.md).
- **The live API confirmed `next_order_number` doesn't exist yet** (PGRST202). Without a fallback,
  shipping the code before 0006 would have stopped checkout completely. `order-service.ts` now falls
  back to the old count when the function is missing. Delete that fallback once 0006 is applied.

**How it was verified**
- Backend: 87/87 tests, 16 new. Root and admin typechecks exit 0, run from `node_modules/.bin`.
- Migrations: 0001 to 0007 applied to PGlite with Supabase-like roles and default grants; 16 checks
  pass. The harness lives in the session scratchpad, not the repo.
- Local backend against the live API using only random ids, so nothing was written and only status
  codes were printed:
  - 404 on unknown orders and on a foreign image ref;
  - 400 on price 0 and on `maxDiscountPct: 150`;
  - no CORS headers;
  - fake JWTs don't count toward the lockout, and 10 wrong tokens lock out even the right one.
- Portal: every changed page compiles and redirects cleanly with no session.

**Still open**
- Apply 0006 and 0007 (`npm run db:migrate`) after the owner approves, then delete the order-number
  fallback. After 0007, confirm portal login still works.
- docs/spec/09 makes bank-account CRUD **owner-only**, but the code allows managers. Doc 03 says
  managers may. This needs the owner's decision, so it was left unchanged.
- `ADMIN_ORIGIN` is still listed with `preserve()` in `.railway/railway.ts`. It's harmless and was
  left alone per PITFALLS (IaC edits need a `railway config plan` check).

---

## 2026-09-24 — Homepage hello-popup deployment test completed

**Outcome** — removed the temporary homepage welcome popup after confirming the full GitHub-to-Railway
deployment path and live-domain behavior. The homepage now opens directly again.

## 2026-09-24 — Temporary homepage hello popup

**Outcome** — the marketing homepage now opens with a small, branded “Hello” welcome overlay for an
end-to-end deployment test. Visitors dismiss it with the visible close button or the Escape key, after
which normal page scrolling resumes. The popup is limited to `index.html`, so legal, support, pricing,
and other direct links remain unobstructed.

The dialog uses semantic dialog attributes, moves keyboard focus to the close control, provides a
visible focus treatment, and disables its entrance animation for reduced-motion visitors.

The homepage now versions its CSS and JavaScript asset URLs so a deployment cannot combine new HTML
with an hour-old cached stylesheet or script. This ensures the popup is styled and dismissible as soon
as the new page reaches the live domain.

## 2026-09-22 — Shop name is editable from Settings

**Outcome** — a "Shop name" card at the top of the admin Settings page. The backend already accepted
it; only the UI was missing.

**The gap.** `business_name` was set exactly once, in onboarding step 1, and never exposed again. The
Settings page declared `business_name` in its `Settings` interface — so it was fetching it — but
rendered no input for it. `PATCH /api/v1/admin/settings` has accepted a `businessName` field the
whole time ([backend/src/routes/admin.ts:427](backend/src/routes/admin.ts:427)), so this was a
missing form field, not missing functionality.

Why it matters more than convenience: by the repo's own conventions, buyer-facing text uses
`merchants.business_name`, never the platform name. That value is what customers see the bot using on
WhatsApp. Wrong or empty, and every customer sees the wrong shop.

**A near-miss worth recording.** The first patch attempt asserted on an 8-space indent for the
knowledgebase card; the file uses 6. The assertion failed *before* the write, so nothing landed and
the file stayed clean — which is the point of asserting on every anchor rather than doing a blind
`replace`. Re-anchored on the exact bytes and it applied.

Typechecked with `../node_modules/.bin/tsc`, not bare `npx` — see docs/PITFALLS.md for why.

---

## 2026-09-22 — CLAUDE.md caught up again (it had drifted within a day)

**Outcome** — CLAUDE.md now matches the codebase. Added a "Marketing site — SEO files" section and
corrected two passages that had gone wrong since this morning.

**It went stale in under a day, and only because the owner asked.** CLAUDE.md was brought in line at
`03e5c70` and was wrong again 7 commits later. Two claims had flipped:

- "Custom domains are not yet attached" — `www.sahulatcart.com` went live that afternoon.
- The nginx description still explained the `mkdir -p /etc/nginx/templates` + envsubst arrangement,
  which had just been removed for being the thing that never worked.

CHANGELOG was current throughout: five entries the same day, written after each change as instructed.
The gap is specifically CLAUDE.md, which is easy to forget because it describes standing facts rather
than events. **Worth treating a change to deployment, branding or gotchas as a CLAUDE.md edit too,
not only a changelog entry.**

**Newly documented**
- `sitemap.xml` is hand-maintained, not generated — a new page needs adding by hand or Google never
  sees it.
- Canonicals point at the `.html` form; extensionless URLs are aliases, and the canonical is what
  stops them counting as duplicates.
- The Search Console verification TXT sits on `@` beside the SPF record. Deleting it silently
  unverifies the property, which has already happened once on this domain.
- Search Console is a **Domain property**, and those support DNS verification only — there is no
  backup method to add.
- `absolute_redirect off` in `site/nginx.conf` is load-bearing: without it nginx builds redirects from
  `$scheme`, which is `http` behind Railway's TLS termination.

---

## 2026-09-22 — SEO round two: locale, FAQ schema, and a measured speed problem

**Outcome** — `lang="en-PK"` on all 9 pages, FAQPage schema on the homepage (5 questions, eligible for
rich results). Search Console is verified on a Domain property with the sitemap submitted.

**Search Console was already broken and nobody knew.** The existing property was verified by
"Domain name provider" — a DNS TXT record that had gone missing, so Google had silently dropped
ownership. Re-added the token at Namecheap alongside the SPF record (two TXT rows on `@`, which is
correct) and it verified. Confirmed the token was live in public DNS *before* clicking Verify, which
avoids the failed-attempt-then-guess-at-propagation loop.

Also found in Search Console: a sitemap submitted **6 May 2022** for
`https://sahulatcart.com/sitemap_index.xml`, status "Couldn't fetch". `sitemap_index.xml` is the
WordPress/Yoast filename — independent confirmation that this domain ran a WooCommerce shop before.

**A guidance error worth recording.** Told the owner to submit the sitemap as just `sitemap.xml`.
That is right for a URL-prefix property, which shows the domain as a fixed prefix beside the box, but
wrong for the Domain property they had switched to — those have no prefix and need the full URL.
Corrected to `https://www.sahulatcart.com/sitemap.xml`. Check which property type is open before
giving Search Console instructions; the UI differs.

Similarly, suggested adding an HTML-tag verification method as a backup. **Domain properties only
support DNS verification** — that option does not exist there. Withdrawn.

**Measured the speed rather than assuming it.** First reading suggested a 5.26s TTFB, which was an
outlier. Five samples put steady state at **0.75–0.85s**, with occasional spikes to 2.9s. A
CDN-backed control site measured 0.16s from the same machine. Google's "good" threshold is 0.8s, so
the site sits right on the line — and the test machine is far closer to the `sfo` replica than
Pakistan is, so real users are worse off. Single replica, no CDN.

**Not fixed here:** the speed problem and the `https://sahulatcart.com` certificate gap have the same
solution — putting Cloudflare in front — and that touches the email records, so it needs the owner's
go-ahead rather than being folded into an SEO commit.

---

## 2026-09-22 — SEO foundations, and the nginx config that never applied

**Outcome** — `robots.txt`, `sitemap.xml`, canonical tags on all 9 pages, complete Open Graph and
Twitter cards with absolute image URLs, JSON-LD (Organization + WebSite + SoftwareApplication), and
301 redirects for the previous sites' URLs. The nginx config is now actually applied, which also
fixes extensionless URLs.

**Why nothing ranked, even for "sahulatcart".** Three separate causes:

1. **The domain has history.** Google's index holds `sahulatcart.com/product/tapal-tez-dam` —
   "Sahulat Cart", a WooCommerce grocery shop that used to live here. Google's model of the domain is
   a grocery store, not a WhatsApp product. Every one of those URLs 404s.
2. **Nothing pointed Google at the new pages.** No `robots.txt` (404), no `sitemap.xml` (404), no
   canonical tags anywhere. A new site on a domain with stale history and no Search Console
   submission can sit undiscovered indefinitely.
3. **Every old URL 404'd** — the Vercel paths (`/privacy-policy`, `/contact`, `/about`) and the shop
   paths alike, throwing away whatever signal they carried instead of redirecting it.

**The root cause behind the 404s was not the URLs, it was the start command.** `site/Dockerfile`
wrote its server block to `/etc/nginx/templates/default.conf.template`, relying on nginx's
`docker-entrypoint.sh` to run `envsubst` over it at boot. But the IaC sets
`start: "nginx -g 'daemon off;'"`, and a custom start command **replaces the image's ENTRYPOINT** — so
the entrypoint never ran, envsubst never ran, the template was silently ignored, and nginx served its
stock default config. `try_files $uri $uri.html` has therefore never once been in effect, which is
why `/privacy` 404'd while `/privacy.html` worked.

Fixed by writing `site/nginx.conf` straight to `/etc/nginx/conf.d/default.conf` at build time, with a
literal port 80 and no dependency on the entrypoint. `nginx -t` now runs during the build, so a bad
config fails the build instead of deploying a broken site.

**Redirects added** — `/privacy-policy`, `/contact`, `/book-a-demo`, `/terms-of-service` to their new
equivalents; `/shop`, `/cart`, `/checkout`, `/my-account`, `/product/*`, `/product-category/*` and
`/wp-*` to the homepage. Everything else resolves through `try_files`.

**Canonicals point at the `.html` form**, which is what physically exists. Extensionless URLs now work
as aliases, and the canonical tag tells Google which of the two to index, so the alias does not create
duplicate content.

**Still needs the owner:** verify the domain in Google Search Console, submit the sitemap, and use
"Request indexing" on the homepage. Without that, the sitemap is a file nobody has asked for.

---

## 2026-09-22 — Footer padding and single-column layout on phones

**Outcome** — footer content now sits 24px from the screen edge on every page instead of flush
against it, and stacks in one column below 560px.

**Cause was a shorthand overriding a shorthand.** `.wrap` supplies the site's 24px side gutter
(`padding: 0 24px`). The footer elements carry both classes — `class="wrap foot-in"` — and `.foot-in`
set `padding: 64px 0 44px`, whose horizontal `0` silently reset the gutter. Same in `.foot-base` with
`padding: 20px 0`. Switching both to `padding-block` leaves the side gutter alone.

Worth remembering for any element that combines `.wrap` with a layout class: use `padding-block`, not
the `padding` shorthand, or the gutter disappears.

**Also: two columns at 375px.** The only footer breakpoint was `max-width: 960px` → `1fr 1fr`, so a
phone still got two cramped columns. Added a 560px breakpoint for a single column with tighter gaps,
and stacked `.foot-base` vertically.

**A verification mistake worth recording.** The first sweep across all nine pages reported every
footer as failing its gutter check. It was measuring the padded *container*, which correctly starts
at x=0 and insets its content with padding — not the content itself. The test was wrong, not the
code. Re-measured against a child element and all nine passed. Measure the thing that is supposed to
move, not its wrapper.

**Verified** — all 9 pages at 375px: content at x=24, right edge at 351, no sideways scroll; desktop
re-checked for column count and padding.

---

## 2026-09-22 — Fixed sideways scrolling on mobile

**Outcome** — no page on the site scrolls horizontally at 375px any more, and every legal table fits
without scrolling. Desktop is unchanged: sticky nav and the ticker band both still work.

**Two separate causes, and the first one was not obvious.**

1. **The `.ticker` band.** It carries `transform: rotate(-1.2deg) scale(1.02)`, so its *bounding box*
   is ~384px wide on a 375px screen even though it clips its own contents. That 4px was dragging the
   whole page sideways. Only `index.html` has it.
2. **The legal tables.** `support.html` overflowed by 128px and `privacy.html` by 74px. Cause was
   `table-layout: auto` plus `sahulatcart2026@gmail.com` — an unbreakable string that forced one
   column wide and pushed the table to 475px.

**`clip`, not `hidden`.** The nav is `position: sticky`. `overflow-x: hidden` on html/body would make
an ancestor a scroll container and silently break it. `overflow-x: clip` does not create a scroll
container, so sticky survives — verified by scrolling and checking the nav stayed pinned, not just by
reading the computed style. An `@supports not (overflow: clip)` fallback covers older engines.

**Clipping alone made it worse, briefly.** With the page clipped, `support.html`'s third column was
simply cut off and unreadable — the scroll was gone but so was the content. The tables needed their
own fix: each is now wrapped in a `.table-wrap`, and cells got `overflow-wrap: anywhere` so long
emails break across lines instead of forcing a column open. After that every table fits at 375px and
the wrapper's scroll is only a safety net.

**The stale-stylesheet trap caught me again.** The first verification said the fix had not applied —
`overflow-x` still read `visible`. The CSS was fine; `python -m http.server` sends no cache headers,
exactly as CLAUDE.md warns. Every later check re-fetched the stylesheets with a cache-busting query
before measuring.

**Verified** — all 9 pages at 375px: no horizontal scroll, 7 tables all fitting; desktop re-checked
for sticky nav, ticker and overflow.

---

## 2026-09-22 — sahulatcart.com repointed from Vercel to Railway

**Outcome** — `www.sahulatcart.com` now serves the Railway static site; all nine pages return 200 with
a valid certificate. `sahulatcart.com` redirects to `www` via a Namecheap URL Redirect Record.

**What was already on the domain.** Not a placeholder — a separate, branded Next.js Sahulatcart site
on Vercel, using the brand fonts, from a codebase that is not in this repo. Worth knowing it still
exists in the Vercel account; nothing was deleted, only DNS was repointed.

It was missing exactly what Meta verification checks: `/terms`, `/about` and `/data-deletion` all
404'd, and it carried no legal entity, phone or non-affiliation disclaimer. Its own footer linked to
"Terms", which 404'd — a dead legal link on the domain being submitted for verification. That is why
the owner chose to replace rather than patch it.

**The Railway plan blocked the obvious approach.** The custom-domain limit was already reached after
adding `www`, so the apex could not be added as a second Railway domain. Solved with a Namecheap URL
Redirect Record on `@` pointing at `https://www.sahulatcart.com` — free, no plan upgrade.

**Records changed** (rollback values in [DNS-ROLLBACK.md](DNS-ROLLBACK.md)):
- `www` CNAME: `1f83ec8a952704d4.vercel-dns-017.com` → `nztzmw1x.up.railway.app`
- `_railway-verify.www` TXT: added
- `@` A `216.198.79.1`: deleted, replaced with a 301 URL Redirect Record

The five MX records and the SPF TXT were left untouched and verified intact afterwards; deleting
those would have broken email forwarding on the domain.

**Verifying through a stale cache.** Every local check kept showing Vercel long after the records
were correct, because the old CNAME carried a 30-minute TTL. Querying the authoritative nameservers
directly, then `curl --resolve` against the Railway IP with the right SNI, confirmed the cutover was
already working while the local resolver still disagreed. Worth remembering: during a DNS cutover the
local resolver is the least reliable thing to trust.

**Known gap, not fixed here.** Extensionless URLs 404 on the Railway site (`/privacy.html` works,
`/privacy` does not) even though `try_files $uri $uri.html` is in `site/Dockerfile`. The old Vercel
site used clean URLs, so inbound links to `/privacy-policy` and similar are now dead. Deliberately not
touched during the cutover — changing nginx and DNS together makes a failure ambiguous. Give Meta the
`.html` URLs until it is fixed.

**Also outstanding:** the admin portal is still on `appadmin-production-0a30.up.railway.app` rather
than `app.sahulatcart.com`, and the custom-domain limit blocks that too.

---

## 2026-09-21 (night) — Testimonials made illustrative; Sahulatkaar rename completed

**Outcome** — three jobs, all verified: fabricated testimonials replaced with labelled scenarios,
`PRODUCT_NAME` default corrected, and the old brand name gone from every file except the changelog.

**Testimonials.** `index.html` carried five quotes attributed to named people in named cities —
"Ahmed H., Garments, Lahore" and so on. With a Meta review coming, invented social proof attributed
to real-sounding individuals is a misrepresentation risk. They are now scenario cards (🌙 Raat ka
order, 🤝 Bhao-taao, 🎤 Voice note, 🧾 Payment verify, 📈 Upsell) labelled by shop type with no
personal names, under a bilingual caption stating plainly that they are illustrations and not
customer testimonials. The marquee markup and CSS are untouched — same 5 cards duplicated for the
scroll.

**`PRODUCT_NAME` default was `'Sahulatkaar'`** in `config.ts`. `.env` overrode it, so nothing was
visibly broken — which is exactly why it was worth fixing: any deploy that forgot the variable would
have silently served the old brand to customers.

**The rename** — 40 replacements across 20 files (docs, spec, README, package.json, two code
comments, package-lock). Checked first that `X-Sahulatkaar-Signature` was **not implemented anywhere**
— it appears only in `docs/spec/03-backend-api.md` for a service-to-service auth that was never
built, so the rename is pure prose with no breaking surface.

**The rename broke a sentence and the check caught it.** CLAUDE.md line 24 deliberately read
`Sahulatcart (formerly "Sahulatkaar")`. A blanket replace turned it into `formerly "Sahulatcart"` —
nonsense. Restored. A blanket rename over text that *discusses* the rename needs re-reading, not just
a count of replacements. CHANGELOG.md was excluded from the sweep on purpose so the history stays
readable.

`package.json` also still described the brand as an "internal codename" that was "not final". Both
untrue since the brand book landed.

**Verified** — `npm run typecheck` exit 0; 8 test files, 71 tests passing; site renders with 10 cards
(5 × 2) and the disclaimer present.

---

## 2026-09-21 (night) — CLAUDE.md brought back in line with reality

**Outcome** — the standing reference no longer contradicts the codebase. Rewrote the Branding
section, added Deployment and "Legal pages and Meta Tech Provider status" sections, and corrected
four gotchas that had become false.

**What was actually wrong**
- It said the brand name was "not final" and that the rebrand had been **rolled back**. The rebrand
  has been live since `55973c0`. It also described the old truck-art palette, the Urdu-glyph
  placeholder logos and the 🛺 emoji favicon — none of which are still the case.
- It said **"Railway is not auto-deploying"** and "do not assume a push makes anything visible".
  Railway deploys fine; pushes were verified landing on the live URLs today. Replaced with the traps
  that *did* bite: a start command in the `buildCommand` slot, IaC nulls not persisting, and
  `--skip-deploys`.
- The site's portal links were documented as pointing at `alluring-happiness-production-9190` — the
  **previous owner's** admin. They point at the current one, and `site.js` rewrites them to
  `localhost:3000` when served locally.
- `/readyz?llm=1` was described as merely "useful for diagnosing" with no mention that each call
  costs quota.

**Caught while writing it, not from memory** — the deployment table first said the backend builds
from `backend/Dockerfile`. It does not; it uses **Railpack**. Checking `.railway/railway.ts` before
committing is the only reason that did not become the next piece of stale documentation.

**Newly documented and easy to break**
- The old truck-art CSS variable names (`--rose`, `--amber`, `--sky`…) are **aliases remapped onto
  brand tokens**, not dead code. Replacing an alias with a raw hex is how the palette drifts.
- The admin's `echo docker-build` buildCommand is a deliberate no-op, not junk to tidy away.
- `GEMINI_MODEL` defaults to `gemini-2.5-flash` in `config.ts`, which is retired for new Google
  accounts; `.env` overrides it to `gemini-3.5-flash`.
- The admin cannot log in locally without the backend running — it needs `/api/v1/config`.

---

## 2026-09-21 (night) — Legal entity added: Nubrix Technologies (Pvt) Ltd

**Outcome** — the operating company is now named across the whole site: footer of all four marketing
pages, `about.html` company table, and — importantly — as the contracting party in `terms.html` and
the data controller in `privacy.html`. Phone `+92 333 3051094` added as a `tel:` link everywhere.
Governing law narrowed from "courts of Pakistan" to the courts at **Lahore**.

**Why the legal pages had to change too.** They previously said "we/us/Sahulatcart mean the operator
of this service" — which names nobody. A contract needs a party. Terms now bind Nubrix Technologies
(Pvt) Ltd, and the privacy policy identifies it as controller. Sahulatcart is the trading name.

**Two values still outstanding, and both can fail verification** — owner expects both on
**Saturday 26 September 2026**:
- **Registered address is only "Lahore, Pakistan".** Meta matches the address on the site against the
  incorporation certificate. A city is not an address; the full street address is needed.
- **NTN / registration number not supplied.** Still a `.tbc` pill on `about.html`.

Also due from the owner: live domain and Gemini billing (both expected 2026-09-22). Meta submission
is blocked until the address and NTN land, so Saturday is the earliest realistic submission date.

**One judgement call flagged to the owner** — supplied as "Nubrix Technologies PVT LTD", rendered as
"Nubrix Technologies (Pvt) Ltd". SECP certificates normally read "(Private) Limited" or "(Pvt) Ltd",
and Meta matches character for character, so the exact form on the certificate has to win. If the
certificate differs, this is a one-line change in six files.

---

## 2026-09-21 (night) — Site audit against Meta Tech Provider verification

**Outcome** — `site/about.html` and `site/support.html` added; a business-identity block added to the
footer of all four marketing pages; the four dead `href="#"` About links wired up. No dead links
remain anywhere on the site.

**Why these two pages specifically**
Meta business verification checks that the website carries the **legal business name, registered
address and business phone**, and that they match Business Manager and the uploaded documents
exactly — mismatch is the most-cited rejection reason. None of the three appeared anywhere on the
site. They now appear in the footer of every page and in a table on `about.html`.

Separately the WhatsApp Business Messaging Policy requires a maintained, accurate **customer support
contact**. There wasn't one beyond a demo-booking form, hence `support.html`, which also documents
opt-in rules, prohibited categories and number-quality guidance — useful to merchants and a positive
signal to a reviewer that we enforce policy rather than ignore it.

**The dead links mattered more than they look.** All four marketing pages footer-linked About to
`href="#"`. A reviewer clicking a dead link on a site under verification is a bad signal, and About
is exactly where they go looking for the legal entity.

**Unfillable values are deliberately loud.** Registered name, NTN, address and phone are wrapped in
a `.tbc` class that renders as dashed amber pills, so they cannot ship unnoticed. They must be filled
before submitting to Meta; only the owner has the values and they must match the documents.

**Verified** — all 9 pages 200, every internal link resolves to a real file, `legal.css` now linked
from the marketing pages too (the footer block needs it), footer block confirmed rendering with 3
placeholders.

---

## 2026-09-21 (night) — Legal pages: User Agreement, Privacy Policy v2, Data Deletion

**Outcome** — three legal pages on the marketing site, written against Meta's actual Tech Provider
obligations rather than a generic template: `site/terms.html` (new), `site/privacy.html` (rewritten
to v2), `site/data-deletion.html` (new). Shared styling extracted to `site/assets/legal.css`. The
`<a href="#">Terms</a>` placeholder in all four other pages' footers is now wired up.

**The finding that mattered**
Reading the WhatsApp Business Solution Terms turned up a hard prohibition: a provider must not let
Business Solution Data be used to "create, develop, train, or improve any machine learning or
artificial intelligence systems". Google's **Gemini free tier explicitly does the opposite** — it
uses submitted content to improve its products, and human reviewers may read it. Paid tier does not.

So running this product on the Gemini free tier is not just a quota problem (20 requests/day, already
logged), it is a **breach of Meta's terms** — buyer names, addresses, phone numbers and payment
screenshots are going somewhere that trains on them. Enabling billing fixes both at once. Until it is
enabled, section 5 of the privacy policy ("the provider does not use this content to train") describes
the intended state, not the current one.

**Other things the research changed**
- Pakistan has **no enacted** data protection statute — the PDP Bill is still before the legislature.
  So the policy does not claim compliance with a law that does not exist; it commits to the bill's
  principles and names PECA 2016 instead.
- Meta app review wants a **Data Deletion Instructions URL** as a distinct page, not a privacy-policy
  section — hence `data-deletion.html`.
- Meta requires the buyer/merchant **controller-vs-processor split** to be explicit, so both pages
  lead with it rather than burying it.
- WhatsApp message content lives in Meta's data centres and **data localisation in Pakistan is not
  available**; that has to be disclosed, not glossed over.
- The prohibited-goods list is taken from Meta's Commerce Policy, not invented.

**Contact address** — `sahulatcart2026@gmail.com` everywhere a contact address is shown: the three
legal pages, the demo form, and the investor deck's title and closing slides.

A repo-wide scan for email addresses turned up more than the site. The previous owner's **personal
Gmail was on the investor deck's closing slide** ("Sahulatkaar · Farhan Kazim · farhan.kazim1@…")
and in a sample API response in `docs/spec/03-backend-api.md`. The demo page's mailto form was also
still pointed at `hello@sahulatkaar.pk`, so contact-form enquiries had been going to him. All
replaced; the spec's sample JSON now uses neutral placeholder data rather than anyone's real
address. `db/seed.mjs` and `docs/FOUNDER-REQUIREMENTS.md` had the old brand in example addresses.

Left alone deliberately: `you@shop.com` in the admin login field, which is a form placeholder, not a
contact. The `Sahulatkaar` → `Sahulatcart` rename across `docs/` is still outstanding — it is a
separate job and was not in scope here.

**Still to do (needs the user)** — governing law says "courts of Pakistan" generically; a city should
be named. A branded address on the domain would look more credible than Gmail once DNS is set up.

**Verified** — all three pages render, every table-of-contents anchor resolves to a real heading,
every internal link resolves to a real file, no horizontal overflow at 375px, all 7 site pages 200.

---

## 2026-09-21 (night) — Added docs/PITFALLS.md

**Outcome** — [docs/PITFALLS.md](docs/PITFALLS.md), linked from the top of CLAUDE.md so any
collaborator or AI agent reads it before their first change.

**Why** — this session cost hours to avoidable mistakes, and the changelog records them scattered
across entries where nobody would find them before repeating one. PITFALLS.md pulls them into one
place as rules, grouped by secrets / deployment / monitoring / git / verification / communication.

**The worst ones, for the record**
- `railway variables` printed API keys and tokens into the transcript — twice. Everything had to be
  rotated. Mask before reading config, not after.
- The marketing site was redeployed four times without reading the build log, which had named the
  cause (`/etc/nginx/templates/: nonexistent directory`) on the first failure.
- The admin was taken fully offline by cycling redeploys, and a guessed "health check" fix
  (`healthcheckPath: /healthz` against a build with no such route) created the failure it was meant
  to fix. It was working — on an old build — before any of that.
- Background monitors polling `/readyz?llm=1` every 15s burned the entire 20-requests-per-**day**
  Gemini free quota, making a working bot look broken.
- `npx tsc` pulled a squatted `tsc@2.0.4` and a shell `&&` chained off `tail`, producing a confident
  but false "typecheck: PASS".

**Nothing functional changed.** Docs only.

---

## 2026-09-21 (evening) — Admin rebrand deployed; admin outage caused and fixed

**Outcome** — site, admin and backend all live and rebranded; admin login verified
end to end.

**Root cause of ~8 failed admin deploys**
Railway held `buildCommand: "npm run start -w @app/admin"` — a *start* command in
the *build* slot, left over from setting a Custom Start Command in the dashboard.
Railway ran the web server as a build step, so the build never completed and every
deployment was marked FAILED while the build log looked like a clean Next build.

Setting that field to `null` through IaC **silently did not persist** — it
reappeared in `railway config plan` after every apply. Setting it to a harmless
`echo docker-build` stuck on the first try. If an IaC field keeps reappearing in
the plan, it is not being applied; set a real value rather than null.

**Knock-on:** with no successful deployment, nothing served the admin, so
`/api/v1/config` returned nothing, the portal could not construct its Supabase
client, and login failed with a generic error. The credentials were never at
fault — they were verified directly against Supabase throughout.

**The hassle / what was done badly**
- The admin was taken **completely down** for several minutes. Before that it was
  serving the old branding but working. Cycling redeploys without reading the
  failure reason caused this.
- "Health check" was guessed as the cause and `healthcheckPath: "/healthz"` was
  set against a build that had no such route — actively creating the failure it
  was meant to fix. `healthcheckPath` had been `null` all along. Reverted.
- `admin/app/healthz/route.ts` was added during that detour. It is harmless and
  worth keeping, but it was not the fix.
- **`git checkout <branch> -- <paths>` silently reverts fixes made since.** It
  restored the site's Login links to the *previous owner's* deployment and reset
  the Privacy footer link to `#`. Caught only by auditing afterwards.

**Rule learned:** read the platform's failure reason before changing anything. The
build log named the cause on the first failure for the site, and the CLI's own
`config plan` was showing the bad `buildCommand` for the admin the whole time.

---

## 2026-09-21 (later) — Brand guidelines v1.0 applied to site and admin

Re-applied the rebrand that was built on 09-17 and rolled back on 09-18. Taken
from `backup/pre-rollback-2026-09-18` rather than rewritten.

**Changed**
- Brand tokens + the three sanctioned gradients in both stylesheets; existing
  semantic names mapped onto them. Site accents re-mapped: rose -> Signal Green,
  amber -> Mint, sky -> Teal.
- Kaisei Decol + Poppins + JetBrains Mono replace Bricolage Grotesque + Inter.
- Real cart mark + favicon + apple-touch-icon; Sahulatkaar -> Sahulatcart;
  Urdu-script copy removed (Roman Urdu kept).
- Two-tone wordmark on all 5 site pages and in the admin.
- `privacy.html` was written *after* the rollback so it was still on the old
  identity — rebranded separately.

**The hassle**
`git checkout <branch> -- <paths>` brings back the file as it was on that
branch, which **silently reverted three fixes made since**: the site's Login
links went back to pointing at the *previous owner's* admin deployment, the
Privacy footer link went back to `#`, and privacy.html was not covered at all
because it did not exist on that branch. Caught by auditing for old identity
markers after the checkout rather than trusting it. **Cherry-picking an old
branch onto a diverged main needs a regression pass, not just a conflict check.**

**Decisions kept from the original implementation**
- The **icon is flat teal, never gradiented** (§09). Gradients belong to the
  wordmark only.
- On the **dark** nav the wordmark uses `--grad-glow`, not `--grad-cart`: cart
  passes through forest `#113320` at its 55% midpoint, which swallows the
  letterforms at 20px. Glow is the book's designated gradient for dark surfaces,
  so each sanctioned gradient is used on the surface it was drawn for.
- The trust gradient carries its specified **70% opacity** — that is what makes
  the fade subtle, and it is easy to miss when transcribing hex stops.
- Primary buttons are **Signal Green**, not teal: teal on white is 3.33:1, which
  the book marks "Avoid" for text.
- CSS `background` shorthand **resets `background-clip`** — the wordmark must use
  `background-image` or the gradient paints as a solid block.

**Verified** admin typecheck 0, shared build 0, backend tests 71/71, site renders
with `--color-teal #249E87`, Poppins, 12px radius and the wordmark present.

---

## 2026-09-21 — Migrated onto our own infrastructure

The project was inherited from a previous owner. Everything ran on his Supabase,
his Meta app and his Railway account, none of which we can access. This moves it
onto ours end to end.

**Infrastructure**
- New **Supabase** project: 5 migrations applied, auth hook enabled, 22 tables
  with RLS forced, 5 storage buckets, seeded merchant + 3 products.
- New **Meta** app: webhook registered, `messages` field subscribed, WABA linked.
- New **Railway** project (`exemplary-charm`) with three services — backend,
  admin and site — all building from `sahulatcart/sahulatcart_app`.
- Repo moved to the org: `sahulatcart/sahulatcart_app`.
- Admin login created and linked as owner of the seeded merchant.

**How it actually went** (the short version, because the dead ends matter)

Nothing failed loudly. Every problem presented as something else: the backend
said "Online" while unable to reach the database; the admin crashed with the
*backend's* error message; the bot replied politely to every message while
having no working AI behind it; deploys reported SKIPPED or FAILED with empty
logs. Roughly a day went into chasing symptoms instead of causes.

Two mistakes were mine and are worth naming. Background monitors polling
`/readyz?llm=1` every 15s silently consumed the entire daily Gemini quota, which
made a working bot look broken. And the site was "fixed" and redeployed four
times before anyone read its build log — which had named the real cause
(`nonexistent directory`) on the very first failure. **Read the build log first.**

**Root causes found (each cost real time)**

- **`railway.json` at the repo root broke every other service.** It set
  `startCommand: node backend/dist/index.js`, which applied to any service built
  from the repo root — so the admin *and* the site both booted the backend and
  died on missing Supabase vars. Deleted; each service now declares its own start
  command in `.railway/railway.ts` (Railway Infrastructure-as-Code).
- **`SUPABASE_URL` on Railway was truncated to `https://`.** Zod's `.url()`
  accepts that, so the backend booted and reported healthy while every query
  failed. A service can be "Online" and completely broken.
- **Supabase's direct DB host is IPv6-only.** `db.<ref>.supabase.co` resolves but
  is unreachable on IPv4 networks (`ENOTFOUND`). Migrations must use the session
  pooler (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<ref>`).
- **`gemini-2.5-flash` is retired for new Google accounts.** The API says so
  explicitly. Existing accounts are grandfathered, which is why it worked for the
  previous owner. Moved to `gemini-3.5-flash`.
- **Gemini free tier is 20 requests per DAY per model**, not per minute — quota id
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. That is ~10 customer
  messages/day. The previous owner's account had the older, far larger allowance;
  commit `209d72c` ("free-tier resilience") shows they hit limits too, just at a
  survivable volume. **Billing must be enabled for this product to function.**
- **`/readyz?llm=1` makes a live Gemini call.** Polling it for monitoring silently
  consumes the daily quota. Do not poll it.
- **The site Dockerfile `sed`-edited `/etc/nginx/conf.d/default.conf`**, which does
  not exist in current `nginx:alpine`; the `&&` chain short-circuited and nginx
  never started. Now uses `/etc/nginx/templates/` + envsubst — and that directory
  must be `mkdir -p`'d first, it does not exist either.

**Also fixed**
- `.env.example` described Anthropic (unimplemented) and omitted Gemini entirely.
  Railway reads it to suggest service variables, so fresh deploys were
  pre-populated with the wrong ones.
- Added `site/privacy.html` (required for Meta app publishing; the footer linked
  "Privacy" to `#` on every page).
- Site "Login" links pointed at the **previous owner's** admin deployment.

**Live URLs**
- site `https://site-production-d318.up.railway.app`
- admin `https://appadmin-production-0a30.up.railway.app`
- backend `https://appbackend-production-dae8.up.railway.app`

**Known issues / TODO**
- **Gemini billing not enabled** — the bot only sends `fallbackText()` templates
  until it is. This is the single blocker to a working product.
- Railway CLI `redeploy`/`up` frequently return FAILED or SKIPPED with empty logs;
  forcing a variable change is what reliably triggers a deploy.
- Admin password is weak and was set in plain sight; rotate before real data.
- Custom domains (`www`/`app`/`api`.sahulatcart.com) not configured. Changing the
  backend domain requires re-pointing the Meta webhook or inbound silently stops.
- `db/seed.mjs` omits the `catalog-imports` bucket (created manually).
- `hello@sahulatkaar.pk` on the contact page is still the previous owner's address.

---

## 2026-09-18 — Rolled back to the pre-session state

**Changed**
- `9bbbfe8` reverts the four commits pushed on 09-16/09-17. The tree is now byte-identical to `df33be8`
  (2026-07-06), the state before this work began.
- Recreated this file and [CLAUDE.md](CLAUDE.md) from scratch afterwards, describing the **current**
  (reverted) code rather than the rebranded version.

**Reverted by `9bbbfe8`**
- `1276028` apple-touch-icon · `485763c` Railway investigation log · `a842bd0` CLAUDE.md + CHANGELOG.md ·
  `4622f29` cart logo replacing the placeholder marks

**Decisions**
- **Revert, not reset + force-push.** A force-push would erase the commits from GitHub and break anyone
  who had pulled. A revert undoes the content while preserving history, and is itself reversible with
  `git revert 9bbbfe8`.
- **Everything preserved** on the local branch `backup/pre-rollback-2026-09-18` (8 commits), including
  the full Sahulatcart rebrand, which was never pushed.

**Important context for whoever reads this next**
The rollback did **not** change the live Railway site. Railway had been serving `df33be8` throughout —
verified repeatedly: `/logo.svg` and `/apple-touch-icon.png` both 404, and the deployed login page still
contained CSS that had been deleted days earlier. None of the reverted work ever ran in production, so it
cannot have caused any production behaviour.

**Also cleaned**
- `admin/.next` held 50MB of production build output from the rebrand. It is gitignored, so `git revert`
  could not touch it, and Next.js would have served those stale chunks from a repo that no longer
  contained that code. Removed, along with a stale `shared/dist`, which was then rebuilt from source.

**Known issues / TODO**
- **Railway auto-deploy is broken** — the single most important open item. See the entry below.
- The Sahulatcart rebrand is implemented and verified but unshipped, on the backup branch.

---

## 2026-09-16 → 09-17 — Logo, icons and a full rebrand (all subsequently reverted)

Kept for reference: this describes work that is no longer in the codebase. Recoverable from
`backup/pre-rollback-2026-09-18`.

**What was built**
- Replaced the placeholder marks with the real cart logo — the site had rendered a hardcoded Urdu **س**
  glyph and the admin `PRODUCT_NAME.charAt(0)`, each inside a gradient tile. Added `logo.svg`,
  `favicon.svg`, an og:image and a 180×180 `apple-touch-icon.png`, and created `admin/public/`, which
  did not exist. Replaced the inline 🛺 emoji favicon on all four site pages.
- Applied the Sahulatcart brand guidelines v1.0: the 8 brand tokens and 3 sanctioned gradients,
  Kaisei Decol + Poppins + JetBrains Mono, the two-tone gradient wordmark, and the
  Sahulatkaar → Sahulatcart rename. Removed all Urdu-script copy (Roman Urdu kept).

**Findings worth keeping even though the code is gone**
- The **standalone icon is flat teal, never gradiented** — the gradients belong to the wordmark. Easy to
  get backwards.
- Both wordmark gradients are drawn for **light** surfaces. `--grad-cart` passes through forest
  `#113320` at its 55% midpoint, which swallows the letterforms at 20px on a dark nav.
- The `"Sahulat"` trust gradient is **70% opacity**, not full — that is what makes the fade subtle. Easy
  to miss when transcribing the hex stops.
- The CSS `background` **shorthand resets `background-clip`**, so a gradient set that way paints as a
  solid block instead of filling glyphs. Use `background-image`.
- iOS renders a transparent apple-touch-icon as **solid black**; it needs a baked-in background.
- Teal `#249E87` on white is **3.33:1** — the guidelines mark it "Avoid" for body text.

**Railway deploy investigation (unresolved)**
- `git ls-remote` confirmed GitHub had the commits, yet the live admin kept serving the old build:
  `/logo.svg` 404 and the login HTML still contained the exact gradient placeholder that had been
  deleted. Deleted CSS cannot return from a browser cache, so this was a stale build, not caching.
- Ruled out: both Dockerfiles use `COPY . .`; `.dockerignore` does not exclude `admin/public/`; the repo
  has no GitHub Actions to gate a deploy; `next build` succeeds locally.
- Remaining suspects are all Railway-side — auto-deploy disconnected, service watching another branch, or
  a failing build. Needs dashboard access: **Deployments**, then **Settings → Source**.
- Known deployed admin URL (hardcoded in the site nav):
  `alluring-happiness-production-9190.up.railway.app`. The marketing site's URL is recorded nowhere in
  the repo.

---

## 2026-07-06 — Production fixes, demo features, marketing site, pitch materials

- **Product matching**: added plural stemming (shirts→shirt, shirtein→shirt) after a live failure where
  "Mujhe kuch shirts dikhain" returned "shirts abhi nahi hain". Substring matches now require ≥4 chars,
  fixing "capri pants" matching "Cap".
- **Money/negotiation P0s**: messages with no offer and no discount ask now HOLD instead of advancing the
  concession curve (questions were walking the price to the floor); HOLD prices persist as
  `last_bot_offer`; total-vs-per-unit offers are divided before reaching the engine.
- **Order-flow dead-ends**: cancel and human-handoff escapes added to the three order states, which skip
  intent classification.
- **Features**: voice-note transcription (transcribed before storing, so it flows through every state),
  bargaining personality dial (pure config, engine untouched), post-order upsell, quantity-aware quotes,
  product knowledge + shop knowledgebase with grounded Q&A, Shopify CSV import.
- **Marketing site**: 4-page static site with the truck-art identity. **Pitch**: 11-slide deck and a
  5-year financial model.

---

## 2026-07-03 — Multi-tenant auth, portal redesign, Phase 5b/5c

- Dual auth (Supabase JWT or `ADMIN_API_TOKEN`); `merchant_id` always derived from verified auth, never
  client input; by-id endpoints return 404 cross-tenant. Invite-only merchant creation.
- PDF order slips via **pdfkit**, chosen over a headless browser to avoid shipping Chromium. CSV catalog
  import, Meta catalog sync, onboarding wizard.
- Live inbox with human takeover — the bot goes silent on `human_takeover` conversations.
- Portal redesign: design system, sidebar shell, toast system. Fixed inbox scrolling, which had used
  `scrollIntoView` and scrolled the whole page.

---

## 2026-07-02 — Phases 0 through 5a, and deployment shakeout

- **P0** monorepo, Supabase schema + RLS + auth hook, Fastify skeleton. Brand name made config
  (`PRODUCT_NAME`) so a rename is one variable.
- **P1** deterministic negotiation engine + 21 cases covering the spec's scenario table, a fuzz invariant
  and a prompt-injection guard.
- **P2** WhatsApp webhook: signature verification over raw bytes, fast-ACK, tenant routing, per-item
  idempotency.
- **P3** orchestrator FSM + Gemini adapter + price-match guard + Roman-Urdu fallbacks.
- **P4** orders and payments: COD and bank-transfer-by-screenshot, private storage for screenshots,
  merchant verify/reject. Order-flow states skip the classify call to cut cost — which is why they later
  needed their own regex escapes.
- **P5a** admin API + Next.js portal.
- **Deployment lessons**: `next.config` rewrites bake at build time (hence the dynamic proxy route);
  Node 20 → 22 because `supabase-js` needs native WebSocket; the Railway run image needs the whole
  hoisted workspace `node_modules`.
