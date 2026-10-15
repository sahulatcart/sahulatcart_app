# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left open.

## 2026-10-15 — Merchant UI pass, PR 3 of 3: the pages

Branch `feat/merchant-ui-pages`, from `main` at `2373351` (after #51). The last of the three:
the page-by-page pass against the brand guideline (v1.0, "one accent action per screen", off-white
surfaces, Poppins everywhere but empty-state headlines). Portal only; the backend is untouched
(46 files / 522 tests).

**What changed.**
- **One green button per screen.** The adds were competing with the saves: "Add account"
  (Settings and the onboarding payment step), "Add" (onboarding delivery zone) and the dashboard
  queue's "Review payment" are ghost now. Each settings card keeps its own Save; the order page
  keeps Verify and the stage button, which never show together with a second green one.
- **Second sweep of inline styles**, with the classes it needed: `.grow` / `.grow-sm` (form fields
  sharing a row), `.row-top`, `.link-ico`, `.inline-ico`, `.grid-1`, `.gap-1`, `.ml-1`, `.mt-3`,
  `.w-auto`, `.js-start`, `.small`, `.normal`, `.ink-2`, `.pointer`, `.ta-right`. The inbox's
  takeover notice is `.notice.brand` instead of three inline colours. Merchant pages went from
  236 inline styles (before PR 1) to 158; what is left is sizes of skeletons and progress bars,
  chart widths and the like, which belong inline. The auth pages (login, signup, reset, confirmed)
  were not touched: they are a separate layout and a later pass.
- Checked, found already right, left alone: the chat bubbles (14 px radius, tails, bot tint vs
  agent solid), empty states in Kaisei Decol with Poppins everywhere else, `.link` in forest
  (not teal) on light, and the AA tokens from the console critique, which the merchant pages
  share.

**Hassles.** The sweep now also merges into `className={\`…\`}` templates, which is what the
first pass had skipped (the bot pill, the stage filter). Screenshots still time out in the browser
pane, so every page was checked by its rendered text, console and computed styles against the
mock backend.

**Not done, on purpose.** No visual redesign of any page: the structure (cards, tables, the
inbox split) matches the guideline already, and a redesign without screenshots to judge it would
be guesswork. The pending `/platform` → `/admin` path rename is next, as agreed.

## 2026-10-15 — Merchant UI pass, PR 2 of 3: the dashboard answers "what needs me?"

Branch `feat/merchant-dashboard-triage`, from `main` at `97c6c5a` (after #50). The dashboard
opened with six equal tiles, three of them counts of things waiting on the merchant, and no way to
act on any of them without a trip through Orders or the Inbox. Like the console after its critique,
it now leads with the queue. Backend route test added; suite 46 files / 522 tests.

**What changed.**
- `GET /api/v1/admin/dashboard` returns `queue: { payments, chats, fulfil }`: the oldest five
  orders with a claimed payment, the oldest five chats in human takeover with unread messages, and
  the oldest five orders in confirmed/paid/preparing. Three more queries on the same request;
  the counts it already returned are unchanged. `routes/admin.test.ts` covers membership, order
  and tenant isolation.
- The page opens with a **Needs you** card: each group has its full count, a link to the page
  that lists them all, and one action per row: "Review payment" (the screenshot has to be seen, so
  it links to the order), "Reply" (opens that chat), "Start preparing" (acts in place, since it
  needs no input) and "Dispatch" (links, since it needs a courier). Empty, it says so in one line.
- `/inbox?c=<conversation id>` opens that chat; the page reads it once on mount from
  `window.location` rather than `useSearchParams`, which needs a Suspense boundary at build.
- The three "to do" tiles are gone from the stats row (the queue replaced them); "Active chats"
  became "Chats the bot is handling", which is what the count is.
- CSS: `.feed` (a list reset) and `.queue-head` for the group headings; the rows reuse Fazal's
  `.feed-item` / `.feed-actions` from the console inbox.

**Hassles.** The new fixtures broke an earlier test in the same file that asserts the *whole*
order list for shop A, so they moved into a `beforeAll` inside the queue's own `describe`, which
runs after those tests. The browser pane's screenshots timed out for the whole session (the page
rendered; the window was likely behind another), so the page was verified from its text and the
clicks' results, not pictures.

**Not done, on purpose.** Paid buyer notices (`pending_buyer_notice`) are not in the queue; the
order page shows them, and they are rare until templates are approved.

## 2026-10-15 — Merchant UI pass, PR 1 of 3: foundations

Branch `feat/merchant-ui-foundations`, from `main` at `742667f` (after #49). Uzair asked for the
merchant dashboard to reach the standard of the console critique (#49), starting with the sidebar
foot, whose "Switch to console" link wrapped onto three lines beside "Log out" and the theme toggle.
Portal only; the backend is untouched, so the test count stays at 46 files / 521 tests.

**What changed.**
- The sidebar foot stacks: the switch link on its own row, log out and the theme toggle on the
  row beneath (`.foot-row`), in both shells. The old `flex: 1` on every `.nav-link` was the cause.
- Every merchant section names the browser tab ("Inbox · Sahulatcart") through a `layout.tsx`
  beside its page, as the console does. The dashboard keeps the root title.
- `ConfirmDialog` in `components/Dialog.tsx` (one question, one button over Fazal's `Dialog`)
  replaces `window.confirm` for cancel order, delete product and block customer, and now also
  guards reject payment (with an optional reason, where "screenshot not valid" was hardcoded) and
  bank-account removal, which had no confirmation at all. Block/unblock gets an Undo toast.
- `phone()`, `ago()` and `day()` moved from `ConsoleParts.tsx` to `lib/format.ts` and are
  re-exported there, so the console's imports did not move. The inbox shows "+92 300 1234567" and
  "4 min ago" instead of a raw `wa_id` and nothing; notifications show relative times.
- Eleven spacing and layout utilities in globals.css (`.m0 .mb-0 .mb-1 .mb-2 .mt-1 .mt-2 .nowrap
  .no-wrap-row .fill .block .w-full`, on the 8 px grid) replaced 80 of the 316 inline `style={{}}`
  attributes across the merchant pages. The remaining 239 are one-offs (skeleton heights, progress
  bars, grid templates); PR 3 takes the ones its page redesigns touch.

**Hassles.** The style sweep was a script matching exact `style={{ marginTop: 8 }}` strings and
merging the class into an existing `className="…"` on the same tag; it left a stray space before
`>` on 80 tags, fixed with one sed. `node` on Windows refuses a bare `C:/…` path in an `import`,
it needs `file:///C:/…`. `git grep` confirmed no original line contained the `" >` sequence
before the sed touched them. The before/after screenshots came from a throwaway mock backend in
the session scratchpad (per CLAUDE.md's recipe; still not committed).

**Not done, on purpose.** Removing a bulk tier is an unsaved form edit, so it got no dialog.
Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries for 2026-07 and earlier were reconstructed from git history and commit messages.

---

## 2026-10-14 — The founders' console after its design critique: triage, guardrails, act-in-place, identity, AA contrast

Branch `feat/console-critique-fixes`. All five commands from the `/impeccable critique admin/app/platform`
run (20/40, three P1s) in one PR, by the owner's choice of "everything found". 46 test files, 521
tests (17 new). No migration.

**Triage (layout).** Shops opens with an attention strip (Not selling · Invoices due, with how many
are claimed · Plan requests · failing jobs), each a filter; problem shops sort first. Every row answers
**"selling, or not selling and why"** from the new [lib/selling.ts](backend/src/lib/selling.ts)
`sellingStatus()`: `botMode()` (billing only, as the orchestrator needs) combined with the WhatsApp
connection, worst first. Before this, a shop whose token Meta revoked showed "Bot mode: sell" in green.
The row also carries the shop's due invoice (amount, claimed reference, how long ago) and plan request,
and only the money action (Mark paid / Apply plan); live search with a "/" shortcut. The separate
Invoices card is gone: one shop's state lives in one row. The list endpoint gained `selling`,
`subscription`, `dueInvoice` and `plans`.

**Guardrails (harden).** A native `<dialog>` ([components/Dialog.tsx](admin/components/Dialog.tsx):
top layer, Esc, focus held and returned) replaces every `window.prompt`/`confirm` in the console.
Mark paid states the reference and warns when there is none; changing a plan shows the price and limit
before it sends; suspending lives only on the shop page and shows the chats active today, the buyers
mid-checkout (`impact` on the detail endpoint) and a live preview of the banner the owner will see;
opening sign-up is a switch with its state in words and a confirm; your own admin row is tagged "(you)"
and cannot be removed. Reversible writes offer **Undo** in the toast (Toast gained an optional action).

**Act in place (shape).** The inbox is a feed where each alert carries its action: Mark Rs N paid,
Apply Pro, Message owner (a `wa.me` link with the owner's phone, now on inbox rows as `ownerPhone`),
Open jobs; acting marks the row read, and each row has its own mark-read. Founder alerts for WhatsApp
are rewritten to say who must act ("WhatsApp token revoked, bot stopped … Only the owner can fix it"),
not to repeat the merchant's instruction. `/platform/invoices` now returns `plans`.

**Identity and product truth (bolder).** The console's sidebar and top bar are forest in both themes,
with a Console chip on phones and its own browser-tab titles (a `layout.tsx` per route). The shop page
leads with the selling status, shows chats as bubbles, and for each chat the **negotiation evidence**
from the engine's own audit columns (list, floor, both offers, agreed, "Kept to floor"). The catalog
shows each product's **floor**, computed by the engine's `computeFloor()` fed by the orchestrator's
`coerceDefaults()`, now exported so the console can never disagree with the bot.

**Polish.** Signal Green deepened to `#1F7A33` (`--primary`, `--success-ink`) wherever it carries text:
white on `#268D3C` was 4.2:1 and the success pill 3.9:1, now 5.4:1 and 4.9:1; the brand token itself
is unchanged. Nav section labels moved off `--faint` (whose own comment says "never body text").
`.pad` and `.help` were used outside `.card`/`.field` and styled nowhere; now defined. Readiness shows
icon + words, collapsible sections show counts, a chevron and remember their state, meters for
conversations, messages and AI calls, plain-word audit details and jobs with relative times that
refresh themselves, React keys on expandable rows, responsive `.rtable` tables that become labelled
blocks under 760px.

**Hassles.**
- Port 3000 was taken by an unrelated project of the owner's (`Desktop/ERP`), so the visual check
  ran the admin on 3001 through a temporary launch entry; nothing of theirs was touched.
- At a 1024px window the redesigned shops table was 20px wider than its container and scrolled
  sideways. Folding the activity column into the shop cell and giving the bot status a minimum
  width made it fit exactly (measured, `scrollWidth == clientWidth`).
- A screenshot showed an empty reason field in the Suspend dialog after typing; reading the DOM
  showed the text was there and the screenshot was simply taken too early. Not a bug.
- The inbox prefixes titles with the shop name, so the first draft of the new titles read
  "Ali Store: Bot can't send: …"; reworded so no title has a colon of its own.
- An inline `justify-content` beat the phone-width CSS for inbox actions; fixed with a class, not
  `!important`.
- Checked the whole console against a throwaway mock backend (fixture data, CLAUDE.md "Checking the
  portal visually"), desktop, 375px and dark; the detector found nothing and the computed colours
  were re-measured in the page. The critique snapshot closed itself once the files changed.

---

## 2026-10-14 — Review follow-up on PR #46: the console redirects only on a real "not allowed"

Branch `fix/console-redirect-only-on-403`. The lead's review of #46 (the console's own shell, merged
before review) found no bugs and one small fix. `AppShell variant="platform"` sent the user to `/`
on **any** failure of `GET /api/v1/platform/me`: a network blip, a 429 or a 5xx bounced a founder to
the merchant side (and a founder with no shop then bounced back through `NO_SHOP`). Now only a
**403** (`PLATFORM_ONLY`) redirects; a non-OK answer of any other kind, or a network error, leaves the
page as it is. A 401 still goes to `/login` inside `api()`. The server guards every console route
regardless, so the redirect was only ever cosmetic. Admin only; no test suite there, so the proof is
`tsc`, `next lint`, `next build`, and the live status codes the check relies on (no login 401,
founder 200; a non-founder's 403 is covered by `platform.test.ts`).

---

## 2026-10-14 — M7 step 4: the Graph API version is required in production

Branch `fix/graph-version-required`. `config.ts` defaulted `META_GRAPH_API_VERSION` to `v21.0`
silently. Railway sets `v25.0`, so nothing was wrong on production, but a lost variable (we had just
deleted two on purpose) would have sent every Meta call to an old version with no clear cause.

- The variable is now **required when `NODE_ENV=production`** and must look like `vNN.N` anywhere
  (refined in the schema next to `TOKEN_ENCRYPTION_KEY`). Outside production it falls back to the
  exported `DEV_GRAPH_API_VERSION = 'v25.0'`, never `v21.0`. `parseEnv()` is exported so the rule is
  tested without `loadConfig()` exiting the process. `vitest.config.ts` sets the dummy explicitly.
- `backend/src/config.test.ts` (new, 5 tests): production without it fails naming the variable;
  production with it uses that exact value; six malformed values are refused; the dev fallback;
  the token-key rule still fires alongside it.
- **Checked against the real Railway settings before pushing** (fetched as JSON, validated with
  `parseEnv`, only the verdict printed, temp file deleted): production passes and resolves to
  `v25.0`; the same settings without the variable would not boot.

**Dates, from Meta's Graph API changelog (2026-10-14).** v25.0 is available until **29 July 2028**;
v26.0 came out 29 July 2026; v21.0 ends **21 January 2027**. An earlier message in the session said
v21.0 was "due to be retired around now"; that was wrong, it has three months left. Production stays
on v25.0: moving to v26.0 changes every Meta call and needs a real connect-and-send test first.

**Still the owner's, same step:** switch on "Require App Secret" in the Meta app's Advanced settings
(every call already sends `appsecret_proof`).

---

## 2026-10-14 — Live: sign-up moved into the panel; the two Railway variables deleted

Uzair's U3 (PR #43) deployed at 15:10. The panel still read both values from Railway
(`source: env`) and `platform_settings` was empty, so the lead first copied the live values in
through the panel's own `PUT /api/v1/platform/signup` (pilot token): `open false` and the same five
allow-listed emails, checked identical to the env list before and after without printing them. The
route wrote its `signup_settings_changed` audit row (count only). The panel then reported
`source: db` for both.

Then `SIGNUP_ALLOWLIST` and `SIGNUP_OPEN` were deleted from `@app/backend` with
`railway variable delete` (the `railway config plan` route failed: the `railway/iac` SDK is not
installed in the checkout, and installing it would have touched the lockfile). The deletes
redeployed the backend (15:14, SUCCESS). Checked on the new container: an allow-listed address is
allowed, a stranger is refused, `/api/v1/config` says `signupOpen false`, the panel still says
`source: db`. `.railway/railway.ts` no longer declares the two (a comment says why), so a future
`config apply` will not recreate them; `.env.example` marks them as fallback only.

---

## 2026-10-14 — Review follow-ups on U1 and U2: the shop view fails closed; repeat clicks alert nobody

Branch `fix/panel-review-followups`. The lead's review of PRs #40 (U1) and #42 (U2), both merged
before review, found no bugs and two should-fix items; both fixed here. 43 test files, 497 tests
(8 new); 44 files, 504 tests after merging U3. No migration.

- **The shop view fails closed** (`routes/platform-shops.ts`). The page promises "every look at this
  page is recorded", but the `platform_view` audit insert was not checked: a failed write still
  returned the shop and its chats, with nothing logged. Now a failed write is logged and the route
  answers **503 `AUDIT_UNAVAILABLE`** with none of the data, for the shop detail and for a chat read.
  The page shows the server's reason instead of a generic "Could not load".
- **Repeat claims and plan requests alert nobody** (`routes/billing.ts`). A claim left the invoice
  `due`, so every press of "I've paid" (a double click, a retry, a resubmit) wrote another founders'
  inbox row and email; the same for "request plan". The two `plan_change_requested` audit rows on
  live are probably this. Now each is up to two conditional UPDATEs: first `reference is null` (the
  first claim), then `reference <> new` (a changed reference, titled "Invoice reference changed").
  The same reference again answers 200 `{ unchanged: true }`, keeps the first `claimed_at`, and
  alerts nobody. Plan requests do the same on `requested_plan` (null first, because `null <> 'pro'`
  is not true in SQL); a repeat writes no audit row either.

**Hassles.** `billing.test.ts` seeds once in `beforeAll` and its later console tests read that state,
so the new tests first leaked a claimed reference and a cleared subscription into them. They now run
in their own block that snapshots the four tables and restores them after each test; the audit log
also had to be cleared at the start, or the earlier test's row was counted. The fail-closed tests patch
`from('audit_log')` on the FakeDb instance, which works because route modules hold that instance as
their client. All five behaviour tests were run against the old route code first and failed there.

**Not fixed (nits, for Uzair):** expandable table rows use `<>` without a key (also in the M6 shops
list); a tracked product with unknown stock shows ∞; a failed job's founders' alert is muted for an
hour even when the DB outage stopped it being delivered; concurrent 190s duplicate the alert; a
network error leaves "Mark all read" busy.

---
## 2026-10-14 — The founders' console gets its own shell

Branch `feat/platform-shell`, from `main` at `ac930b6` (after U3 #43). Not in the panel plan:
Uzair asked for the console to stop sharing the merchant dashboard's nav, since five console
sections beside eight merchant pages was getting messy. Portal only; the backend is untouched.
Admin typecheck, `next lint` and `next build` clean.

**What changed.**
- `AppShell` takes `variant: 'merchant' | 'platform'`. The platform variant has its own nav
  (Shops, Inbox, Access, Audit, Jobs), the tag "Platform console" under the wordmark, the founders'
  inbox count on its Inbox link, and makes none of the merchant calls (no shop status, no merchant
  notifications, no bell in the top bar). Anyone who is not a platform admin is sent home. The
  merchant variant lost the "Platform console" nav section. One shell, not two: the drawer, the
  theme toggle and the logout are shared.
- The two areas meet through one link in the sidebar foot: "Switch to console" for a merchant who
  is also a platform admin, "Switch to my shop" for an admin who also owns a shop. Nobody else sees
  either.
- After login a platform admin with no shop lands on `/platform`; everyone else on their shop.
- The console wears the forest accent (mint in dark mode) through `.shell[data-area="platform"]`
  re-pointing the `--brand*` tokens in both theme blocks, so the two areas are never confused at a
  glance. Brand tokens untouched; no raw hex in a rule.
- The tabs row is gone: `PlatformTabs.tsx` deleted, the seven console pages wrap in
  `<AppShell variant="platform">` and nothing else changed in them, Fazal's three included.

**Hassles.** None. The variant touched one file for the shell and one line per page.

## 2026-10-14 — U3: the sign-up gate from the panel

Branch `feat/signup-gate-db` (docs/launch/PLATFORM-PANEL-UZAIR.md, U3), from `main` at `79ff749`
(after U2 #42). 44 test files, 496 tests (7 new). Both typechecks, `next lint` and `next build`
clean. No migration: `platform_settings` came with 0020, which is applied.

**What landed.**
- `signupGate(db)` in [lib/signup.ts](backend/src/lib/signup.ts): reads `platform_settings`
  (`signup_open` a boolean, `signup_allowlist` a list of emails); per key the stored value if it
  is well-formed, else the env var; every active platform admin's email is always allowed on top,
  so an invited admin can create their auth user and land on the existing 409 → `/platform` path.
  Cached for a minute in process (`/api/v1/config` is public); the PUT and GET routes clear it.
  `signupAllowed()` is unchanged and still synchronous.
- The three call sites take the gate: `/signup/check`, `/signup/bootstrap`, and `signupOpen` on
  `/api/v1/config`, which the sign-up page reads for its "private pilot" notice.
- `GET` and `PUT /api/v1/platform/signup` at the end of `routes/platform-ops.ts`. The PUT
  validates (a boolean, up to 500 valid emails, lowercased, deduped), upserts the two keys, clears
  the cache and writes an audit row with the **count**, never the list, the same rule as
  `/api/v1/config`.
- `admin/components/SignupSettings.tsx`, mounted in the slot Fazal left on the Access page: the
  "anyone may sign up" box, the allow-list one per line, and under each a line saying whether the
  value comes from the panel or still from Railway.

**Hassles.**
- The new gate test in `auth.test.ts` answered 429: that file already makes most of one IP's ten
  sign-up calls a minute, and two more tipped it. The new calls carry their own
  `x-forwarded-for`. Any further test in that file that hits a sign-up route needs the same.
- `FakeDb`'s `upsert()` takes one row, not an array: the two-row upsert stored nothing usable and
  the GET after the PUT still said "env". Two single-row upserts instead. Worth remembering for any
  route that upserts a batch.

**Open (Fazal's ops item).** Once the live values are saved from the panel, remove `SIGNUP_OPEN`
and `SIGNUP_ALLOWLIST` from Railway so the panel is the only source.

## 2026-10-14 — U2: the founders' inbox

Branch `feat/platform-inbox` (docs/launch/PLATFORM-PANEL-UZAIR.md, U2), from `main` at `d472dfc`
(after F1+F2 #38 and U1 #40). 43 test files, 489 tests (10 new). Both typechecks, `next lint` and
`next build` clean. No migration: `platform_notifications` came with 0020 (F1). **The live triggers
need 0020 applied**; until then every `notifyPlatform()` logs one warning and the caller carries on.

**What landed.**
- `notifyPlatform()` in [lib/notify.ts](backend/src/lib/notify.ts): the founders' twin of
  `notify()`. Prefixes the title with the shop name, inserts the `platform_notifications` row
  (warn and continue on error), then emails every active `platform_admins.email` through the
  existing `emailMembers()` under the digest key `'platform'`, so the five-in-five-minutes rule
  and `flushPendingDigests()` on SIGTERM apply with no new code. Never push: those subscriptions
  belong to merchant members. Joins `inflight`, so `flushNotifications()` awaits it in tests.
- Four kinds, four trigger sites: `invoice_claimed` and `plan_requested` in `routes/billing.ts`;
  `whatsapp_attention` from a dead token (`credentials.ts`), a policy or partner-removed event
  (`account-events.ts`, once per shop on the WABA; the quality flag is left out on purpose, the
  merchant fixes that one) and a rejected, paused or disabled template (`templates.ts`);
  `job_failed` from `lib/job-runs.ts` (Fazal's file), reported at most once per job per hour so a
  database outage does not write sixty rows an hour from the sweeper.
- Routes in `routes/platform-ops.ts`: `GET /platform/inbox?count=1`, `GET /platform/inbox` (newest
  100 with the shop name), `POST /platform/inbox/read` (all, or up to 100 ids).
- Portal: `/platform/inbox` with a kind pill per row, unread rows in bold, "Mark all read", and a
  link to the shop or the Jobs tab; the Inbox tab between Shops and Access; an unread count on the
  Platform console nav link, polled every 30 s for platform admins only and refreshed by the
  `platform-inbox` window event when the page marks rows read.

**Hassles.** None. The notify test harness already mocked email and timers, and the three
WhatsApp test files already seeded the exact rows the triggers read, so each trigger is one
assertion added to an existing case.

## 2026-10-14 — U1: the founders' read-only look inside a shop

Branch `feat/platform-shop-detail` (PLATFORM-PANEL-UZAIR.md, U1), from `main` at `95fabca`. Built
ahead of F1 on purpose: U1 needs nothing from F1 (the tabs component is not touched here, and the
audit table already exists), so it is not blocked on it. 41 test files, 458 tests (8 new). Both
typechecks, `next lint` and `next build` clean. No migration.

**What landed.**
- [routes/platform-shops.ts](backend/src/routes/platform-shops.ts), own `requirePlatformAdmin` hook,
  five GETs under `/api/v1/platform/merchants/:id`: the shop (merchant row, members, bank accounts
  without numbers, zones, subscription, last 12 invoices, usage, conversations this month against
  the plan limit, `botMode`, readiness, connection), `/orders` (placed only, with the status and
  payment filters), `/conversations`, `/conversations/:cid` (newest 200 messages oldest-first,
  **no** `unread_count` write) and `/products` (with `cost` and a thumbnail). The shop id comes
  from the URL only; an unknown id is 404 everywhere and another shop's chat under this id is 404.
- Every detail read and every chat read inserts one `audit_log` row: actor `platform`, action
  `platform_view`, entity `merchant` or `conversation`, `user_id` the admin's auth user (null for
  the pilot token). That is the record of who looked at buyer data.
- `admin/app/platform/shops/[id]/page.tsx`: Overview, WhatsApp (with readiness pills), Billing
  (with usage and invoices) and Settings cards from the one payload; Orders, Chats and Catalog as
  collapsed sections fetched on first open; a chat row expands to its messages read-only. The shop
  name on the platform list links here. A link to the audit trail (F1's page) at the bottom.

**Hassles.**
- The first test run leaked the bank account number: `FakeDb` ignores the column list in
  `select()` and returns whole rows. Postgres would have filtered it, but the route now picks the
  named columns itself (`pick()`), so the test proves the omission instead of trusting the driver.
  Worth remembering for any route that selects a subset of a sensitive table.

**Open.** The "Audit trail for this shop" link points at `/platform/audit`, which arrives with F1.
## 2026-10-14 — Live: F1 + F2 deployed (PR #38), migration 0020 applied, heartbeats confirmed

The owner applied **0020** at about 14:30 PKT, *before* merging PR #38 (the plan said after; the
order does not matter, the migration only adds things and the old code never touched them). PR #39
(the two plan files) and PR #38 merged at 14:45; both deploys SUCCESS by 14:49, backend uptime reset.
Verified on live right after: `job_runs` has all four rows with `ok true` (billing, retention and
unpaid expiry from the boot run, the sweeper from its latest minute); `GET /platform/jobs`,
`/platform/admins` (one active admin, bound) and `/platform/audit` answer 200 with the pilot token
and 401 anonymously. The audit log already held two `plan_change_requested` rows from the pilot's
billing page. Branches `feat/platform-panel-fazal` and `docs/platform-panel-plan` deleted.

Uzair opened PR #40 (`feat/platform-shop-detail`, U1) within the hour; the P4/P5 follow-up
branches from the part 2 review are still to come.

---

## 2026-10-14 — Platform panel, Fazal's part (F1 + F2): job heartbeats, audit reader, invited admins

Branch `feat/platform-panel-fazal`, from `main` at `95fabca` (after Uzair's rename, PR #37). Plan:
[docs/launch/PLATFORM-PANEL-FAZAL.md](docs/launch/PLATFORM-PANEL-FAZAL.md). Both F1 and F2 in one
PR by the owner's decision. Migration **0020** (Fazal applies after merge; dry-run against the live
schema in a rolled-back transaction before the PR). 42 test files, 471 tests.

**What landed.**
- **Migration 0020**: `platform_notifications` (for Uzair's U2), `job_runs`, `platform_settings`
  (for U3), `platform_admins.auth_user_id` nullable plus a unique index on `lower(email)`. RLS on,
  `service_role` grants, no SQL function.
- **Job heartbeats** ([lib/job-runs.ts](backend/src/lib/job-runs.ts)): `runJob(db, name, interval, fn)`
  upserts one `job_runs` row per job at the start (`finished_at` null) and the end (`ok`, `error` or
  `summary`). Never throws; a failed write is logged once per job per process and the job still
  runs, because a deploy lands before its migration here. Wrapped: the replay sweeper (60 s),
  retention (3600 s; `purgeLogs` now returns its two counts), unpaid expiry (3600 s), billing
  (21600 s). The old per-job `.catch(... 'x job failed')` lines are gone; `runJob` logs the failure.
- **[routes/platform-ops.ts](backend/src/routes/platform-ops.ts)** (own file, `requirePlatformAdmin`):
  `GET /platform/audit` (filters `merchantId`, `action`; keyset `before`; `limit` 1–100, default
  50; `{ rows, nextBefore }` with `businessName` flattened), `GET /platform/jobs`,
  `GET/POST /platform/admins`, `DELETE /platform/admins/:id` (soft; 409 `self`, 409 `last_admin`;
  audit rows with `merchant_id null`).
- **Invite by email** ([lib/auth.ts](backend/src/lib/auth.ts) `platformAdminFor(authUserId, email?, emailConfirmed)`):
  a row with `auth_user_id` null is bound to the auth user at the first login **only when Supabase
  says the email is confirmed**; the bind is a conditional update (`auth_user_id` still null) so two
  first logins cannot both take the row. `jwtAuthn()` passes the JWT's email and confirmation;
  `signup/bootstrap` passes `true` (it already refused unconfirmed users), so an invited admin who
  tries to create a shop still gets 409 `PLATFORM_ADMIN`.
- **Portal**: `PlatformTabs` (Shops, Access, Audit, Jobs; Uzair inserts Inbox), `/platform/jobs`
  (result pill: ok / failed / overdue when a run is older than twice its interval / running),
  `/platform/audit` (shop and action filters, Load more, `?merchantId=` through `useSearchParams`
  inside `Suspense`), `/platform/access` (admins table, add, remove behind `confirm()`, and the
  marked slot where U3 mounts `SignupSettings`). The nav link says "Platform console".

**Hassles.**
- `limit=0` on the audit route is not "one row": `parseInt` gives 0, `|| 50` makes it the default.
  The first test assumed otherwise; the route is right, the test was fixed to say so.
- The heartbeat must be written through the plain `.upsert()` result, not awaited inside a throw
  path: supabase-js answers a missing table with `{ error }`, not an exception, so both the
  error-result and the thrown-exception cases are covered and tested with a stub client.

**Open.** Fazal: apply 0020 after merge, then confirm four `job_runs` rows within the hour. Uzair:
U1 (shop detail), U2 (inbox, which also adds the `job_failed` call in `job-runs.ts`), U3 (sign-up
gate), per [PLATFORM-PANEL-UZAIR.md](docs/launch/PLATFORM-PANEL-UZAIR.md).

---

## 2026-10-14 — U0: the portal is "Merchant Dashboard"

Branch `fix/merchant-dashboard-name` (PLATFORM-PANEL-UZAIR.md, U0). Three strings, nothing else:
the page title (`${PRODUCT_NAME} — Merchant Dashboard`) and description in `admin/app/layout.tsx`,
the wordmark tag in `admin/components/AppShell.tsx`, and the manifest description (it said
"Merchant portal", not "Merchant admin"). `AuthLayout.tsx` and the login page carried no such
string; a grep for "Merchant admin", "Merchant portal" and "— Admin" over `admin/app`,
`admin/components` and `admin/public` is now empty. Admin typecheck, lint and `next build` clean.

## 2026-10-13 — Live: the pilot shop is kept free; finished branches deleted

Owner decision after 0017: the pilot shop's subscription was set by hand from `trial` (ending
2026-11-12) to `active` with `current_period_end = 2099-01-01` and `trial_ends_at` cleared
(`UPDATE 1`, verified). With that, the billing job never invoices it or moves it to `past_due`,
and `botMode()` keeps selling. The pilot plan's 300-conversations-a-month allowance still
applies; raise the plan in the console if the pilot ever nears it.

PR #35 (the opt-out fix, both review documents, and the M5/M6/P3 live record that had sat on
`docs/m5-m6-live`) merged. Deleted on GitHub: `docs/m5-m6-live`, `fix/opt-out-cancels-pending-order`
and the seven already-merged feature branches. `docs/market-ready-plan` (the SRS files) is still
unmerged and was left alone.

---

## 2026-10-13 — Fix: an opt-out mid-checkout left the order placed with its stock held

Found by the lead's review of PR #29 (P5). "band karo" is both a stop word (`STOP_RE`, whole
message) and a cancel word (`CANCEL_RE`), and the stop check runs first; before P5 a buyer saying
"band karo" while a bank order waited for its screenshot cancelled it, after P5 they were opted out
and the order stayed `awaiting_payment` with stock reserved until the expiry job, with no word to the
merchant. The cancel block is now a shared `cancelPending()` used by both paths, so an opt-out during
checkout cancels, releases stock, writes history and tells the merchant; the goodbye also says how
to come back ("'start' likh dein"). Two flow tests. 34 files, 386 tests.

Also applied today after PRs #28/#29 merged: migrations **0015** and **0016**, verified. Checked on
live right after: the catalog route returns all 5 products (it would have answered an empty list
before 0016), and no customer is opted out (both are `unknown`, treated as in).

---
## 2026-10-13 — fix/p1-followups: Fazal's P1 review table

Branch `fix/p1-followups`, from `main` at `3bcbe6d` (sibling of the open P8 #32 and
fix/p2-followups #33; they touch different files). 38 test files, 428 tests (4 new, 3 extended).
Both typechecks, `next lint` and `next build` clean. Migration **0019** replaces
`create_merchant_for_user()`.

**What changed (review number in brackets).**
- [1] `resolveAuthUser()` refuses a user without `email_confirmed_at`: proof of email ownership is
  the confirmation, not the project's dashboard toggle. Every test user that bootstraps now carries
  the field; an unconfirmed one gets 401 and creates nothing.
- [2] Done by M6 (a platform admin without a shop is `kind: 'platform'`, 403 `NO_SHOP` on merchant
  routes, 409 on bootstrap). Nothing to do.
- [3] Tests pin the admin-token path: `x-admin-token` → 200 `isPlatformAdmin`, the token as a non-JWT
  Bearer → 200, a wrong token → 401 `UNAUTHORIZED` (never `no_membership`).
- [4] `/auth/confirmed` on a 400 (an auth user with no shop details) shows a three-field form and
  posts it, instead of the login → confirmed → 400 loop. `bootstrap()` takes the details.
- [5] Migration 0019: the RPC raises `SC001 inactive_membership` and `SC002 email_in_use` before
  inserting (and for the unique_violation a race leaves); `signup.ts` maps them to 409 with plain
  copy, and anything else to a 500 that never echoes Postgres text. The no-op
  `delete from merchants` in the exception block is gone.
- [6] The fake twin throws the same two codes, and `FakeDb.rpc()` turns a throw into `{ error }`.
- [7] `signupAllowed()` treats a non-string email as empty; `{"email":5}` is a plain "not allowed".
- [9] `/signup` reads `signupOpen` on load and, while closed, says "private pilot, book a demo" above
  the form. The site's "Start free" button is unchanged.
- [10] Login maps `email_not_confirmed` to "Confirm your email first…"; the three Eye icons are
  `aria-hidden`; the checkbox rule sets `min-height: 0`; `/auth/reset` accepts only a recovery link
  (the `PASSWORD_RECOVERY` event or `type=recovery` in the hash); bootstrap returns `existing`, and
  `/auth/confirmed` sends a returning owner to the dashboard and a new one to the wizard.

**Hassles.** Requiring `email_confirmed_at` broke the platform-console tests, whose mocked users
had no such field; every bootstrap-capable test user now has one, which is the point of the check.

**Open (ops, [8]).** Supabase's built-in mailer delivers only to the project team's addresses at
about two an hour: custom SMTP through Resend (the key P3 already needs) and `/auth/confirmed` +
`/auth/reset` in Supabase's Redirect URLs, both recorded here once done.
## 2026-10-13 — fix/p2-followups: Fazal's P2 review table, items 2–19

Branch `fix/p2-followups`, from `main` at `3bcbe6d`. 38 test files, 430 tests (6 new, 3 extended).
Both typechecks, `next lint` and `next build` clean. Migration **0018** (a unique index on
`delivery_zones (merchant_id, lower(btrim(area_name)))`).

**Item 1 (the blocker) is ops, not code.** The attestation back-fill
`db/backfill/2026-10-13-live-merchant-attestations.sql` is now keyed on the seed's email as the
review suggested, with `returning id`, so it needs no value from Railway. **It has still not been
run.** Fazal runs it, records "UPDATE 1" and the date here, and walks the pilot through the wizard.
Until then nobody presses Pause on the pilot.

**What changed (review number in brackets).**
- [2] A live shop keeps one way to pay: `PATCH settings {codEnabled:false}` and deleting the last
  active bank account answer 409 `last_payment_method` when the bot is on and the other method is
  absent. The portal shows the server's reason through the usual error toast.
- [3] One `codOn(settings)` in `lib/validation.ts` (`codEnabled !== false`), used by readiness,
  the orchestrator and the routes. Readiness used to need `=== true`, so a shop without the key
  was "not ready" while its bot was already taking COD.
- [4] `WhatsAppConnect`: the chrome is a function applied once, not a component declared inside
  the render, so the PIN input keeps focus and AppShell stops refetching on every keystroke.
- [5] Image uploads (product photos and the logo) accept only png, jpeg and webp
  (`IMAGE_TYPES`); SVG is refused. A new logo removes the previous file from the bucket.
- [6] `bot_persona` is validated server-side: name ≤ 40, style one of three, greeting ≤ 200.
- [7] The duplicate "Default delivery" input is gone from the negotiation card; the Delivery card
  is the only writer of `defaultDeliveryCharge`.
- [9] Switching the bot on is a request of its own: a body that also changes a setting readiness
  reads (`codEnabled`, `deliveryConfigured`, `attestations`), the persona or the name is 400. The
  wizard's `{ botEnabled, onboardingCompletedAt }` still passes.
- [10] Readiness's test-order check is two small lookups (the owner's customer row by `wa_id`,
  then one placed order of theirs) instead of every placed order with its customer.
- [11] Migration 0018; both zone writes map `23505` to the existing 409.
- [12] The dashboard reads `botEnabled !== false` like the backend. A live shop that is not yet
  "ready" is told to finish setup so it can pause and resume safely, not that its bot is off.
- [13, 14, 15] `aria-hidden` on the two `Trash2` icons; `pretty()` strips non-digits before adding
  "+"; the zone form refuses a blank charge and keeps its text after a 409.
- [16] A missing draft order at the payment step hands off with its own note, not "no payment
  method is enabled".
- [17] The merchant's greeting is no longer a source for `sanctionedNumbers()`: "Rs 500 off this
  week" in it would have let the bot repeat a discount the engine will not honour.
- [18] Zone PATCH and profile PATCH with nothing to change are 400; the zone DELETE checks its
  error; `charge` is capped at Rs 10,000.
- [19] Tests: cross-tenant zone PATCH/DELETE are 404 and leave the row alone; the one-request rule;
  a positive test-order match when the phone is already digits; a stale `pay_cod` tap after COD
  was switched off explains and sends the bank details; `syncBusinessProfile` is called after a
  profile save (mocked and counted); the SVG refusal and the old-logo removal; the two 409s; the
  persona limits.

**Hassles.** The first version of [9] refused any other key beside `botEnabled`, which broke the
wizard's own go-live request (`onboardingCompletedAt` rides along). Narrowed to the keys readiness
actually reads. The cross-tenant zone test left the other shop's row in the table and tripped a
later count; it now removes it.

**Open.** [1] (ops, above). [8] was done in P4. The PaymentPanel does not warn ahead of the 409; the
server's message is shown when it happens.
## 2026-10-13 — P8: bot and catalog fixes (opening stance, inbox order, order status, chat memory, safe re-import)

Branch `feat/p8-bot-fixes`, from `main` at `3bcbe6d` (after P7 #31). 40 test files, 438 tests
(14 new). Backend typecheck clean; no portal file changed, so no admin build. No migration, no
dependency. engine.test.ts still passes in full.

**What landed (SRS-Uzair v1.1 P8, FR-P8.1–8.6; P8.4 is deferred by design).**
- **Opening stance** (P8.1): `decide()` computed the standing counter without
  `defaults.openingStance`, then `Math.min` undercut the goodwill gesture, so `small_goodwill`
  did nothing. One argument added. List Rs 2,500 / floor Rs 2,000: round 1 is Rs 2,425 (was
  2,300), round 2 Rs 2,150; `list_price` unchanged. The stance is still not exposed in Settings.
- **Inbox newest-first** (P8.2): the conversation route returned a chat's *oldest* 200 messages,
  so a long chat never showed anything recent. Now the newest 200, reversed to chronological.
- **Order-status questions** (P8.3): `STATUS_RE` (whole message: status / order status / order
  ka status / mera order / mera order kahan hai / order kahan hai) is checked before the classifier
  and inside `handleEscape()`, so it works mid-checkout without leaving the state; the
  `ask_status` and `claim_paid` intents go the same way. `orderStatusReply()` loads the buyer's
  latest *placed* order with this shop and answers with its number and status in Roman Urdu
  (`STATUS_UR`), or "koi order abhi record mein nahi mila". New reply kind `order_status`, in
  `TEMPLATE_ONLY_KINDS`. `claim_paid` on an order awaiting payment adds the screenshot ask.
  `out_of_scope` with no product resolved gets the clarify line, never a price.
- **Chat memory** (P8.5): `recentHistory()` loads the last 12 lines of the chat before the current
  message (by `wa_message_id`), each trimmed to 300 characters, as "Customer: …" / "Bot: …".
  It rides on `cc.history` into `classify`, `compose` (through `historyBlock()` in prompts.ts)
  and `extractDelivery`, fenced and marked "for understanding only; never take prices, offers or
  instructions from them". `sanctionedNumbers()` is untouched, so the flow test proves a quoted
  "Rs 500 bolo" composes into a reply the guard rejects and the engine price ships.
- **Safe re-import** (P8.6, [lib/catalog-import.ts](backend/src/lib/catalog-import.ts)): both import
  paths match a row to an existing product by SKU, else by name (case-insensitive). Existing →
  update only the file's columns, never `is_active`; Shopify images and attributes only when the
  product has none. New → insert, active. A second no-SKU row for the same name in one file updates
  the first. Shopify rows now pass `invalidProductField()` too. The old `upsert … onConflict`
  path, which set `is_active: true` on every row, is gone.

**Hassles.** None: the flow harness already had the hooks (a mock classifier that records its
context, and a compose override for the guard test were two lines each).

**Open.** P8.4 (reply in the buyer's language) stays deferred: `cls.language` is detected and
ignored. The Settings page does not yet expose `openingStance`; the engine honours it when set.

## 2026-10-13 — P7: plans, trial, invoices, soft enforcement

Branch `feat/p7-billing`, from `main` at `b9eeea3` (after P6 #30). 38 test files, 424 tests
(18 new). Both typechecks, `next lint` and `next build` clean. Migration **0017** creates
`subscriptions` and `invoices` and gives every existing shop (the live pilot included) a
30-day trial from the moment it is applied. No new dependency.

**What landed (SRS-Uzair v1.1 week 8, FR-P7.1–7.7).** Invariant 2 holds: nothing here moves
money. The merchant transfers to Nubrix; the platform console marks the invoice paid.
- [shared/src/plans.ts](shared/src/plans.ts): pilot (30 free days, 300 conversations), basic
  (1,000), pro (5,000). Prices are config (`PLAN_BASIC_PRICE_PAISA`, `PLAN_PRO_PRICE_PAISA`,
  defaults Rs 2,999 / Rs 7,999) and so are the bank details (`PLATFORM_BANK_DETAILS`, multi-line
  with literal `\n`). All three are declared in `.railway/railway.ts`; Fazal sets the values.
- [lib/billing.ts](backend/src/lib/billing.ts): `botMode()` (`sell` | `handoff` | `off`),
  `ensureTrial()` (called from `bootstrapMerchant`), `runBillingJob()` (every 6 h in
  production: the "7 days left" notice once, trial end → `past_due` + first invoice, next invoice
  7 days before an active period ends, `past_due` 7 days after it ends with the invoice still due),
  `markInvoicePaid()` (invoice paid, plan active to the invoice's `period_end`, merchant told).
  Every step is idempotent on a column it sets, so the job can run as often as it likes.
- **A lapsed pilot is invoiced for Basic.** Pilot has no price, so "the first invoice due" at
  trial end has to be for a paid plan; the subscription's plan follows the invoice when it is
  marked paid. Assumption, flagged in the PR.
- **Enforcement** in the orchestrator, after the M5 quota check and only outside the three
  order-flow states: `billingMode()` → `handoff()` with the reason (unpaid invoice, or the
  month's conversation allowance). A buyer mid-checkout finishes. Messages are stored as always.
  A shop with no subscription row sells; the mode never fails closed.
- **Conversations this month** = chats with `last_message_at` in the period month (a shortcut,
  marked in code: it also counts a merchant's reply to an old chat; a SQL count of distinct inbound
  `conversation_id`s is the upgrade when a shop nears its limit).
- Routes: [routes/billing.ts](backend/src/routes/billing.ts) (`GET /admin/billing`, claim a
  reference, request a plan, managers only for writes) and three on `routes/platform.ts`
  (`GET /platform/invoices`, mark paid, change plan). A plan request is a
  `subscriptions.requested_plan` plus an audit row that the console lists; there is no
  "platform admin" notification channel, so that is the notification.
- Portal: `/billing` (plan, dates, two meters, invoices with "I've paid" + reference, plan
  request, bank details), a Billing nav link, a dashboard banner while in hand-over mode, and an
  Invoices card on the platform console (due invoices with the claimed reference, Mark paid, plan
  requests, a plan select per shop).

**Hassles.** None worth the name: the flow tests seed 300 conversation rows to hit the pilot
limit, which is fine at FakeDb speed. The `PLATFORM_BANK_DETAILS` transform turns a literal
`\n` into a newline because Railway's variable editor keeps single-line values.

**Open.** Migration 0017 (Fazal). Env values for the prices and bank details. The live pilot
merchant's 30 days start when 0017 is applied; if that is not wanted, set its row `active` with a
far `current_period_end` by hand and record it here.

## 2026-10-13 — P6: Sentry, rate limits, per-IP lockout, the missing tests, CI

Branch `feat/p6-reliability`, from `main` at `9cee8b4` (after P5 #29). 36 test files, 406 tests
(22 new). Both typechecks clean; `next lint` clean with no warnings; `next build` clean. No
migration. Three new dependencies: `@fastify/rate-limit`, `@sentry/node`, `@sentry/nextjs`
(plus `eslint` / `eslint-config-next` as admin devDependencies).

**What landed (SRS-Uzair v1.1 week 7, FR-P6.1–6.7).**
- **Sentry** ([lib/sentry.ts](backend/src/lib/sentry.ts)): `initSentry()` in index.ts before the
  server is built, `setupFastifyErrorHandler` for 5xx route errors, unhandled rejections through
  the SDK's defaults. `SENTRY_DSN` empty = off. Request bodies hold addresses and phones, so
  body, cookie, query and user collection are off and `beforeSend` drops `request.data` as a
  second guard. Release = `RAILWAY_GIT_COMMIT_SHA`. Admin: `instrumentation.ts` (+
  `onRequestError`), the three `sentry.*.config.ts` files, `withSentryConfig` in
  next.config.mjs with source maps and telemetry off, so the build never talks to Sentry.
  `NEXT_PUBLIC_SENTRY_DSN` is baked at build time. Both DSNs are declared in
  `.railway/railway.ts` and `.env.example`; the values, the Sentry project and the "email on new
  issue" alert rule are Fazal's (ops), as is the external uptime check on `/readyz` (FR-P6.2).
- **Rate limits** ([lib/rate-limit.ts](backend/src/lib/rate-limit.ts), `@fastify/rate-limit`,
  global): signup 10/min/IP, login 10/min/IP, WhatsApp connect 5/min, everything else 300/min; the
  webhook, `/healthz`, `/readyz` and `/` are exempt. The key is `bucket:m:<merchantId>` once
  signed in, else `bucket:ip:<ip>`, so a signup burst never eats the API allowance. 429s come
  back as `{ error: { code: 'RATE_LIMITED' } }` through a small `setErrorHandler` in server.ts.
  `trustProxy: true` so `req.ip` is the first X-Forwarded-For hop Railway sets.
- **Admin-token lockout per IP** (`isAdminToken(tok, ip)`): ten wrong guesses lock that IP for
  15 minutes; the owner elsewhere still gets in. The map prunes itself past 10,000 entries.
- **`authenticate()` is memoised per request** (WeakMap) so the limiter can ask who is calling
  before the route's own gate does, without a second Supabase round trip.
- **Tests**: `routes/admin.test.ts` (auth matrix, cross-tenant 404s and lists, manager-only
  routes, the 11th login is 429 and another IP is not, the per-IP lockout) and
  `whatsapp/webhook.route.test.ts` (a signed Meta payload through the HTTP route: signature →
  claim → process → one reply; a redelivery is a duplicate; an unknown number is ignored; the
  webhook carries no rate-limit header).
- **CI**: `.github/workflows/ci.yml` runs `npm ci`, build:shared, both typechecks, the backend
  suite and `next lint` on every PR and on pushes to main. Root `npm run lint` now runs the
  admin lint. Branch protection requiring it is Fazal's (GitHub settings).
- **Single instance** (FR-P6.7): Railway exposes `RAILWAY_REPLICA_ID` but no replica count, so the
  boot logs a loud warning naming everything that is per process (buyer queue, lockout, rate
  limits) whenever the id is present. CLAUDE.md says what a second replica would need.

**Hassles.**
- Sentry SDK v11 renamed `sendDefaultPii` to `dataCollection` (typecheck caught it) and moved
  `withSentryConfig` to the `@sentry/nextjs/config` subpath: importing it from the package root
  under ESM gives "is not a function" with no hint where it went.
- `@fastify/rate-limit`'s `errorResponseBuilder` result is *thrown*, so it needs
  `statusCode: 429` or Fastify answers 500. Returning the `{ error }` body directly looked right
  and was a 500. The `{ error }` shape is built in `setErrorHandler` instead.
- The redelivery test sent a second reply: `FakeDb` had no unique constraints, and the webhook's
  idempotency *is* the `webhook_events.event_id` constraint. The fake now raises `23505` for
  that one table; other uniques (merchant_users one-shop) are still the P1 follow-up.
- The lockout cannot be observed through HTTP any more: ten wrong logins from one IP hit the
  10/min limit at the same time as the lockout. It is tested on `isAdminToken()` directly.

**Open.** Fazal: Sentry project + DSNs on Railway + alert rule; uptime check; branch protection.
A second replica needs the per-buyer queue, lockout and rate-limit store moved to the database
or Redis before it is safe.

## 2026-10-13 — P5: opt-out enforcement, STOP keyword, and the small gaps

Branch `feat/p5-opt-out`, from `main` at `8d43f34` (after P4 #28). 34 test files, 384 tests
(15 new). Both typechecks clean; `next build` clean. Migration **0016** (one nullable column,
`products.deleted_at`). M4's orchestrator PR was already on main, so IC-8's merge order holds.

**What landed (SRS-Uzair v1.1 week 6, FR-P5.1–5.8).**
- **Opt-out and block are store-only, before any LLM call.** The first thing `runTurn()` does is
  read the customer: `is_blocked`, or `wa_opt_in_status='out'`, bumps `unread_count` and
  returns. The flow test counts classifier calls to prove no AI call is made. The exact words
  `start` / `shuru` re-opt in (`wa_opt_in_source='keyword'`) with one welcome.
- **STOP keyword** (`STOP_RE`, whole message only: stop / unsubscribe / band karo / bandh karo /
  msg mat karo) runs in every state before the order-flow handlers and the classifier. One
  goodbye, then silence. `optOut()` is shared with the classifier's `stop` intent. "order band
  karo" during checkout is still a cancel because the pattern is anchored.
- **Opt-in capture** in `upsertCustomer()` (webhook): an `unknown` customer becomes `in` /
  `inbound_message` on their first message; an `out` one is never flipped back by a message.
- **Soft-delete a product**: `DELETE /api/v1/admin/products/:id` in
  [routes/catalog.ts](backend/src/routes/catalog.ts) sets `is_active=false, deleted_at`; the two
  product reads in admin.ts filter `deleted_at is null`. The bot already filtered on
  `is_active`. Managers only; a Delete button per catalog row.
- **Block / unblock**: `POST /api/v1/admin/customers/:id/block|unblock` in
  [routes/customers.ts](backend/src/routes/customers.ts), managers only (the SRS is silent on
  roles; moderation felt like a manager's call, easy to loosen). The inbox lists show "opted
  out" / "blocked" pills, the chat head shows the opt-in state and date, with a Block/Unblock
  button. The conversation routes now embed those customer columns.
- **Dashboard "today" in Pakistan time**: `startOfTodayKarachi()` in `lib/hours.ts` (a fixed
  +05:00, Pakistan has no DST), tested at 23:30 and 00:30 PKT. The UTC helper in admin.ts is gone.
- **Bot name and greeting** editable from Settings → Bot (two fields and a Save). The SRS said to
  reuse the wizard's step-6 component; it also carries the two negotiation limits that Settings
  already has elsewhere, so the two fields were the smaller change. Server-side persona
  validation is still the P2 follow-up.
- **Double-order guard**: the flow test proves a buyer with an open COD order for 2 of 3 units
  gets "sirf 1 available" when asking for 3 more. No code change was needed; the reservation had
  already reduced `products.stock`.

**Hassles.**
- The flow test for "STOP in every state" first assumed a price question lands in `negotiating`;
  it lands in `product_qa`, and only an offer moves to `negotiating`. Both are now in the table.
- `FakeDb` has no column defaults, so a customer created through `upsert` has no
  `wa_opt_in_status` at all, while Postgres gives `unknown`. The opt-in check treats a missing
  value as unknown, and the follow-up update is keyed on id alone (messages per buyer are already
  serialised, so the STOP-between-two-writes race cannot happen in one instance).
- A heredoc holding the edit script tripped bash's quote parsing (a stray apostrophe in a
  comment), so the scripted edits were written with the Write tool instead.

**Open.** Migration 0016 (Fazal). Block role: managers only, say if staff should have it too.

## 2026-10-13 — P4: order stages and unpaid-order expiry

Branch `feat/p4-order-stages`, from `main` at `fb509c9` (after P3 #22 and M6 #27). 33 test files,
369 tests (58 new: 36 stage transitions, 7 expiry, 6 routes, plus the matrix). Both typechecks
clean; `next build` clean. Migration **0015** must be applied (three nullable text columns on
`orders`: `courier`, `tracking_ref`, `eta_text`); nothing else changes in the schema.

**What landed (SRS-Uzair v1.1 week 5, FR-P4.1–4.5).**
- [orchestrator/order-stages.ts](backend/src/orchestrator/order-stages.ts): `markPreparing`,
  `markDispatched`, `markDelivered`, a strict chain (`STAGE_FROM`: preparing from confirmed/paid,
  dispatched from preparing, delivered from dispatched). Each is one conditional UPDATE through the
  same `transition()` the payment actions use, so a double-click is a 409, and each writes an
  `order_status_history` row (the dispatch row's note is "courier · tracking"). Courier, tracking
  and ETA are clipped to 60/80/80 characters server-side.
- Dispatch tells the buyer in Roman Urdu with the courier and ETA, through the existing
  `notifyBuyer()` with the `order_sent` kind: free-form text while the 24-hour window is open;
  otherwise `pending_buyer_notice='order_sent'` and the paid button M4 already built on the order
  page. No new template, no new path.
- [lib/jobs.ts](backend/src/lib/jobs.ts) `expireUnpaidOrders()`: hourly in production only, like the
  sweeper and retention. A bank-transfer order still `awaiting_payment`/`unpaid` for longer than the
  merchant's `settings.unpaidExpiryHours` (6–72, default 24) with **no `payment_claims` row** is
  cancelled with reason "payment not received in Nh", its stock released, a system history row
  written, the merchant notified through `notify()`, the buyer told only if the window is open
  (`fallback: 'none'` — an expired draft is not worth a paid notice or a merchant nag), and the
  conversation reset to `completed` so the next message starts fresh. A screenshot waiting for
  review is never touched, however old.
- [routes/orders.ts](backend/src/routes/orders.ts): `POST /api/v1/admin/orders/:id/preparing|dispatched|delivered`,
  own `requireMerchant`, staff allowed. **Cancel is now managers only** (`orderAction(true, …)`),
  per SRS FR-P4.1; the old comment in routes/admin.ts said staff could cancel unpaid orders. Any
  non-terminal status can be cancelled now (`CANCELLABLE` gained pending_confirmation, paid and
  dispatched), since a paid order the shop cannot fulfil has to be cancellable somewhere.
- Dashboard counts `toPrepare` (confirmed/paid) and `toDispatch` (preparing); the order detail
  returns `history`; the orders list takes `?status=` (it already did) and the page got a stage
  filter. Order page: a stepper on the existing `.steps` CSS, one next-action button, the dispatch
  form (courier, tracking, estimate), and a collapsed history. Settings → Payments: the expiry hours.
- Readiness's test-order check now accepts preparing/dispatched/delivered (review P2-8).

**Hassles.**
- `setCheckoutState` in payment-service was private; the job needs it, so it is exported along
  with `transition`, `OrderRow` and `notifyBuyer` (which gained `notice` and `fallback`
  parameters, defaults unchanged for existing callers).
- The expiry test for "window closed" failed first: `notifyBuyer` judges the window on the real
  clock, while the job takes an injected `now`. The test seeds `placed_at` against the injected
  clock and `window_expires_at` against `Date.now()`. Do not "fix" the job to take the window from
  its own clock; the window is a WhatsApp fact, not a job parameter.
- No Python on this Windows machine (the Store alias answers instead) and the admin pages are CRLF,
  so multi-line edits were scripted with node and a line-ending-preserving replace.

**Open.** Migration 0015 (Fazal). The expiry job and the stage routes are not visually re-checked
in the portal beyond `next build` and the typecheck; the order page's stepper reuses the onboarding
`.steps` rule, so a change there moves both.

## 2026-10-13 — M6: the platform owner's console and suspension

Branch `feat/m6-platform-console`. 28 test files, 299 tests (9 new). Both typechecks clean;
`next build` compiles `/platform`.

Built: `requirePlatformAdmin()` and the platform path in `jwtAuthn()` (a `platform_admins` row with
or without a shop; the pilot token keeps working), `routes/platform.ts` (`/me`, the merchant list
with connection, owner, last message, orders and messages this month, connect attempts, suspend
with a reason, unsuspend), suspension enforced in the orchestrator and in `requireMerchant()` with
a small allow-list so the portal can still show why, the `/platform` page with search and the
suspend switch, the Platform link in the nav for admins, a suspension banner on every portal page,
and `api()` sending a platform admin without a shop to `/platform` instead of looping. IC-7 from
Uzair's P1 review is closed here: the bootstrap route refuses a platform admin with 409.

Hassles, all in the test harness: route modules capture `getServiceClient()` once at registration,
so a test that replaces the fake DB instance per test talks to a stale one (three failures that
looked like empty tables); `FakeDb.reset()` fixes that pattern. The fake lacked `gte`/`lte` (the
orders-this-month query); added. The fake's clock starts on 2026-09-01, so a seeded order is "last
month" unless `created_at` is set. And the local `backend/node_modules` was lost twice to the
tracked-symlink episode; `npm ci` restores it.

To add the owner as a platform admin after merge, one SQL (never a migration):
`insert into platform_admins (auth_user_id, email) select id, email from auth.users where email = '<owner email>';`
Record the date here when run. `platform_admins` has 0 rows today, so the console is empty and
unreachable by JWT until then; the pilot admin token reaches it.

---
## 2026-10-13 — P3 review fixes (Fazal's review of 13 Oct, items 1–16), merged with main

`feat/p3-alerts` was merged with `main` (the go-live fix, the admin build fix, M5), then the
review's P3 items were applied before the merge into `main`:

- **`ADMIN_ORIGIN` is optional again** with the fallback in `portalOrigin()` (config.ts). It has
  existed on Railway since the CORS days; a required `.url()` would have turned a stale value into
  a boot failure.
- **Resend is listed as a sub-processor** in `site/privacy.html` §7, since alert emails carry the
  buyer's name and, for an undeliverable message, its text. The policy promises not to add one
  silently, so this goes in before `RESEND_API_KEY` is set.
- **Manager-only, everywhere.** All alert routes now `isManager()`; staff were able to save prefs
  and register devices that could never fire. `POST /notifications/test` has a 30 s cooldown per
  member and channel (in-memory), so a looped tab cannot burn the shared Resend quota (100/day free).
- **Push endpoints are allow-listed**: only `fcm.googleapis.com`, `*.push.services.mozilla.com`,
  `*.push.apple.com` and `*.notify.windows.com` over https, ≤1024 chars, keys ≤256 — the previous
  "any https URL" was a small reflector through `/test`. A device already registered to another
  shop is refused (403) instead of silently re-homed by the upsert.
- **Each alert gets its own notification** on the lock screen: the payload carries the row `id` and
  the service worker tags with it (`renotify: true`). Before, every handoff tagged `/inbox` and a
  second "Bot needs help" replaced the first.
- **Queued digests survive a deploy**: `flushPendingDigests()` is awaited in the SIGTERM handler
  after `drainWebhooks()`. The 5-minute timer was `unref`'d, so up to five minutes of emails died
  with the process.
- **Push payload**: body cut to 300 chars (push services reject >4 KB; the window-closed notice
  embeds the buyer's message), `TTL: 86400`, `urgency: 'high'` (Android Doze held the 1 h/normal one).
- **Logging out forgets this device's subscription** before `signOut()`, so on a shared phone the
  next person does not keep getting this shop's orders.
- **Real icons**: 192/512 PNGs and a monochrome 96 px badge were generated from
  `site/assets/logo-1024.png` with .NET's `System.Drawing` from PowerShell (there is no image
  tooling in the repo; this is the Windows equivalent of `sips`). Android drew the colour icon as a
  white square in the status bar; the badge is a white silhouette.
- Nits: generic DB error messages (the raw Postgres text was returned), `NotificationType` imported
  from `@app/shared`, `test()` has a catch and the channel switches are disabled when the server
  lacks that channel, `focus().then(navigate).catch(openWindow)` in the worker, "1 new notification".
- **M5's one direct `notifications` insert** (`lib/usage.ts` `warnQuota`) was switched to
  `notify()` here rather than in a later M5 rebase, since `notify()` exists on this branch; usage
  alerts lead to `/settings/messages`.

**What fought back.** The merge conflicted only on the changelog and the dashboard's icon import.
After it, the backend typecheck lost `@fastify/helmet` and vitest died with
`ENOTDIR: mkdir backend/node_modules`: commit `9ad4a96` on `main` had added `backend/node_modules`
to git as a **symlink** to a path on Fazal's Mac (`.gitignore` has `node_modules/`, but a forced add
bypasses it). Windows checks a symlink out as a 67-byte text file, so npm could not create the
nested `backend/node_modules` directory where the lockfile puts helmet. Removed from git here;
`npm install` then rebuilt the tree. If a checkout ever shows `backend/node_modules` as a file,
that is why.
`next build` is now part of the pre-push check (Fazal's rule after #21 broke the admin deploy):
`cd admin && npm run build`, then `rm -rf admin/.next` so the dev server is not poisoned.

---

## 2026-10-13 — P3: merchant alerts — `notify()`, Web Push, email, the digest rule

**Outcome** — a merchant no longer has to keep the portal open to learn of an order. Every
notification now goes through one function, [lib/notify.ts](backend/src/lib/notify.ts) `notify()`
(IC-3), which writes the portal row and then sends a Web Push to each owner's/manager's devices and
an email to their address, by their preferences. Never WhatsApp (decided 2026-10-13). Branch
`feat/p3-alerts`, week 4 of SRS-Uzair v1.1. Needs the VAPID and Resend variables on Railway
(Appendix B) and migration 0014; without them the channels are silently skipped and only the portal
row is written, exactly as before.

**How it is built.** `notify()` awaits the `notifications` insert and starts the fan-out in the
background (`void …catch(log)`, FR-P3.7); tests wait for it with `flushNotifications()`. Members are
`merchant_users` with role owner/manager, `is_active`, and `notification_prefs` (`{ push, email }`,
both on by default; staff never get alerts). Push goes through the `web-push` package
([lib/push.ts](backend/src/lib/push.ts)); a 404/410 from the push service deletes that
subscription. Email is Resend's HTTP API with plain `fetch` ([lib/email.ts](backend/src/lib/email.ts)),
plain text plus a minimal HTML version with the portal link (`ADMIN_ORIGIN`). **The digest rule:**
more than five emails in five minutes for one merchant → the rest wait and go out as one
"N new notifications" email when the window closes; push is not batched. The counter is
in-process, which is right for the one backend instance we run. The nine producers (handoff,
new order, payment claim, cancel, the window-closed notice, M1's dead-token flag, M3's account
events and disconnected reminder, M4's template status) were switched; `grep "from('notifications').insert"`
now finds only `notify.ts`.

**Routes** in a new [routes/notifications.ts](backend/src/routes/notifications.ts) (own auth hook):
`GET/PATCH /admin/notification-prefs`, `POST/DELETE /admin/push-subscriptions` (one row per device,
upsert on the endpoint), `POST /admin/notifications/test { channel }`. All need a portal login — the
shared admin token has no member to alert, so it gets 400. `/config` adds `vapidPublicKey`.

**Portal.** `public/sw.js` shows the payload and opens its `url` on tap, focusing an open portal
window if there is one; `public/manifest.json` makes the portal installable (standalone, teal
theme). The icons are the existing SVG and the 180px apple-touch-icon — no 192/512 PNGs were
generated, since the repo has no image tooling; Chrome accepts the SVG, iOS uses the PNG.
`lib/push.ts` registers the worker, subscribes with the server's key and posts the subscription.
Settings → Notifications: the two channel switches, this device's state (on / available /
blocked / unsupported / "add to Home Screen first, iOS 16.4+"), and a test button per channel. The
dashboard shows a one-time "turn on phone notifications" callout while push is possible but off.

**Tests.** `lib/notify.test.ts` (fan-out per prefs, staff and other shops excluded, 410 deletes
the subscription, unconfigured channels skipped, an email failure never reaches the caller, the
digest after five in five minutes with fake timers, individual emails again afterwards) and
`routes/notifications.test.ts` (malformed subscription, upsert per device, prefs read, test push,
test email 409 while unconfigured, unsubscribe, prefs patch). Suite: 28 files, 289 tests.

**Still to do for the "done when" (needs the owner/Fazal):** generate the VAPID pair
(`npx web-push generate-vapid-keys`) and set it with `RESEND_API_KEY` on Railway; apply 0014; verify
the domain in Resend so `ALERT_EMAIL_FROM` can move off the test sender; then T18 on Android Chrome
and an iPhone with the portal on the Home Screen.
---

## 2026-10-13 — M5: the message meter and the AI budget; the admin build fixed

Branch `feat/m5-usage-meter`. 27 test files, 288 tests (14 new). Both typechecks clean; `next
build` compiles (after the fix below).

Built: migration `0011_message_usage.sql` (one row per number per month, `bump_message_usage()`
atomic increments with a per-day AI counter), `lib/usage.ts` (`bumpUsage`, 80%/100% warnings,
`getUsage`, `outboundThisMonth`, the `withLlmBudget`/`chargeLlmCall` AsyncLocalStorage budget),
`routes/usage.ts`, counting hooks in `client.ts` (successful sends only), `webhook.ts` (inbound, and
the budget around voice transcription) and the orchestrator (before classify, compose and address
extraction), the after-quota handoff for new conversations, `afterFreeQuota` and `llmDailyCap`
settings with validation, the dashboard meter card, a "Messages and AI" card in Settings, and a
"paid" badge next to Send in the inbox once the free 1,000 are used. The fake DB got the RPC twin.

**Production incident found on the way.** The admin deploy after PR #21 (P2 part 2) **failed** at
16:24 and Railway kept serving the previous admin build, so none of part 2's portal work was live
although `main` looked fine: the PR exported `WhatsAppConnect` from `app/settings/whatsapp/page.tsx`
for the onboarding wizard, and `next build` refuses extra exports from a page file ("does not
match the required types of a Next.js Page") while `tsc` passes. Found because M5's own build check
failed with that message before any M5 change touched the page. Fixed on
`fix/admin-build-whatsapp-connect` by moving the component to `admin/components/WhatsAppConnect.tsx`;
proven with a real `next build`; merged into this branch too. The rule is now in CLAUDE.md.

One test slip: the after-quota flow test inserted a usage row after the checkout's AI charges had
already created one, so two rows matched and the lookup returned nothing; the fixture now updates
the existing row.

Not done: migration 0011 is **not applied** (apply after merge). The first-day numbers will be
small; the pilot number's sends count from the deploy onward, nothing is back-filled.
---

## 2026-10-13 — Fix: the go-live gate could never be passed; "ji nahi" confirmed COD orders

Found by the lead's review of PR #21 (P2 part 2). Two customer-facing bugs, fixed on
`fix/go-live-test-order` with flow tests; 26 files, 276 tests.

**The deadlock.** A self-signup shop starts with `botEnabled:false` (0012), and `runOrchestrator()`
returned early for everyone while the bot is off. The go-live gate's step 7 needs a test order from
the owner's phone, and only the bot can place an order. So the owner texted their shop, got
silence, and no new shop could ever go live; the readiness tests inserted order rows directly and
never saw it. Now the owner's own phone (`merchants.phone`, compared as digits) gets the bot while
it is off; everyone else still gets silence.

**The yes regex.** `YES_RE` was anchored only at the start, so "ji nahi", "ok pehle size batao" and
"han lekin kitne din?" all placed a COD order on a COD-only shop. It is now anchored at both ends
and refuses any negation word.

---

## 2026-10-13 — P2, part 2: the seven panels, COD enforced, the greeting, the live-merchant back-fill

**Outcome** — onboarding is complete end to end. Every panel of the wizard saves on its own
(FR-P2.8), the bot offers only the payment methods the merchant switched on, the merchant's own
greeting and today's hours open each chat, and the WhatsApp business profile gets the new address
and hours. Branch `feat/p2-onboarding-panels`, week 3 of SRS-Uzair v1.1.

**Panels.** 1 Shop: name, owner, phone (stored digits-only), address, category (fixed list), hours
per day with a closed toggle, logo upload, and the attestations shown as accepted with their date —
`PATCH /api/v1/admin/profile` and `POST /api/v1/admin/settings/logo`, both in
[routes/onboarding.ts](backend/src/routes/onboarding.ts). After a profile save `syncBusinessProfile()`
(IC-9) runs best-effort; it now prefers `merchants.address` and `business_hours` (folded to
"Mon–Thu 10:00–22:00, Sat 11:00–18:00" by `formatHours()`) over the knowledgebase text — a small
edit in Fazal's `connect.ts`, noted in the PR. 2 WhatsApp: M2's page became an exported
`WhatsAppConnect` component with an `embedded` flag; the page is a one-line wrapper. 3 Products: the
catalog's add form and CSV import inline, plus the list. 4 Delivery: moved to
`components/DeliveryZones.tsx`, which Settings now shows too (FR-P2.7). 5 Payment: COD switch, bank
accounts, and a payment note. 6 Bot: name, style presets, greeting, max discount and rounds. 7 Test
order: the shop number, a wa.me link, and M3's "send test message".

**The bot, enforced (FR-P2.3 step 5).** `paymentMethods()` in the orchestrator reads
`settings.codEnabled` (default on) and the default active bank account. Both: two buttons as M4
built. COD only: a text "confirm karne ke liye haan likh dein", and a plain yes (`YES_RE`, anchored
to the start of the message) places the COD order. Bank only: no question at all — the order is
placed and the details go out in one message. Neither: handoff with a notification naming the
cause (readiness blocks going live in that state, so this is a safety net). Asking for a disabled
method gets one "maazrat" line and the other method. **One trap found while testing:** typing "COD"
while waiting for a screenshot switched the bank order to COD through `handlePaymentProof()` even
with COD off; that path now checks the same function. `settings.paymentInstructions` is appended
under the bank details.

**Greeting (step 6, FR-P2.5).** `bot_persona.greeting` was saved by the old wizard and never read.
The `greeting` reply spec now carries `greetingText` and `hoursText` ("Hum aaj 10:00–22:00 khule
hain.", from `todayHoursText()` in [lib/hours.ts](backend/src/lib/hours.ts), Pakistan time), the
fallback uses both, the prompt asks for them close to verbatim, and `sanctionedNumbers()` counts
their digits as merchant text so the guard does not throw the hours away.

**Back-fill (FR-P2.10).** `db/backfill/2026-10-13-live-merchant-attestations.sql` records the two
attestations for the pilot merchant (created by the seed, never through signup). Fazal runs it once
after 0013, with the number id filled in; everything else the owner does through the wizard.

**Tests.** 8 flow tests (COD off → straight to bank details; COD typed during the screenshot wait
does not switch; COD-only confirm with "haan"; bank refused when only COD; neither → handoff; the
payment note; the greeting with hours; the default greeting unchanged), 4 profile/logo route tests,
6 for `lib/hours.ts`. Suite: 26 files, 274 tests.

---

## 2026-10-13 — M4: templates, the 24-hour cost rule, fewer messages per sale

Branch `feat/m4-templates`. 22 test files, 213 tests (21 new). Both typechecks clean; `next build`
compiles the order page and the WhatsApp page.

Built: migration `0010_message_templates.sql`; `whatsapp/templates.ts` (two UTILITY definitions,
`ensureTemplates` after the handshake, `resubmitTemplate` with `_vN` names, `applyTemplateStatus`
from the webhook, `approvedTemplate`); `createTemplate` (A.7), `sendTemplate` (A.8) and
`sendButtons` (A.9); `notifyBuyer()` rewritten around the cost rule with `pending_buyer_notice` and
`notifyBuyerNow()` behind `POST /orders/:id/notify-buyer`; `META_UTILITY_RATE_PAISA`; the order
GET carries `windowExpiresAt`, `pendingBuyerNotice`, `noticePricePaisa`; the orchestrator's
`askPaymentMethod()` with buttons and the tap-id read; two merged sends; the order page's
"Free to confirm until…" note and the paid button; the WhatsApp page's template list with Resubmit.

Baseline, measured in the flow tests before the change and asserted after: typed "bank transfer"
sent 2 messages (details, then the ask), now 1; COD confirmation without a PDF sent 2 (slip, then
caption), now 1; a verified payment with a PDF sent 2 (text, then the PDF), now 1 document with the
text as caption. The button tap replaces the "COD ya bank?" clarification round-trips, which the
tests cannot count but the pilot will.

Three old tests asserted the old behaviour and were updated, not deleted: the verify assertion
looked at `h.sent.at(-2)` for the text (now the PDF caption at `-1`); the window-closed notification
title changed from "Could not message the buyer" to "Buyer's window closed"; and a template
rejection now needs a `message_templates` row (M3's stop-gap notified without one).

Not done, by design: FR-M4.8's "ask for status" hint in the confirmation is left out until P8
builds the status reply, or buyers would be invited to send a message that today gets a price
quote; M5's per-message counting; `order_sent` notices are only *sent* here, P4 sets them at
dispatch (its `courier`/`eta_text` columns do not exist yet, so the template's third parameter falls
back to a generic line). The templates are created against Meta only once a real number connects
(M7), so `message_templates` stays empty in production until then. Migration 0010 is **not
applied** yet; apply after merge.

Migrations **0012 and 0013** (Uzair's P1 and P2, merged as PRs #18 and #19) were applied to the live
database on 2026-10-13 right after their merge, before M4, because the deployed code needed them
(the bootstrap RPC and the two `merchants` columns). Verified: the one-shop index, the function
executable by `service_role` only, `logo_url` and `address`. The applied order is therefore 0009,
0012, 0013, then 0010 and 0011 later; the runner tracks names, not sequence, so that is fine.
---

## 2026-10-13 — P2, part 1: readiness checks, delivery zones, the go-live gate, the wizard shell

**Outcome** — the bot can no longer be switched on by setting a flag. `GET /api/v1/admin/readiness`
computes seven checks from the data itself ([lib/readiness.ts](backend/src/lib/readiness.ts)) and
`PATCH settings { botEnabled: true }` answers **409 `not_ready`** with the failing steps until all
pass. Delivery zones got their missing writes. The onboarding page is now a checklist that follows
the server's verdict. Branch `feat/p2-onboarding`, week 2 of SRS-Uzair v1.1. Panels 1–7 proper,
COD enforcement in the bot and the greeting text are week 3.

**The seven checks and what they read.** profile: `business_name`, `phone`, `category`, at least
one day in `business_hours` (`{ mon: { open, close } }` — a day marked `{ closed: true }` does not
count), and the two attestations from signup. whatsapp: IC-4 status `connected` — M2/M3 are on
`main`, so this is the real status, not the IC-10 stub; `connecting` says "send one message from your
phone", `needs_attention` is shown as a problem with Meta's message. catalog: one active product with
a price. delivery: one serviceable zone **or** `settings.deliveryConfigured` (the explicit "one
charge for everywhere" choice). payment: `settings.codEnabled` or an active bank account. persona:
`bot_persona.name` **and** `.style`. testOrder: an order in `confirmed`/`awaiting_payment`/`paid`
whose customer's `wa_id` is the owner's phone, compared as digits (`samePhone()`), so `+92 300
1234567` matches `923001234567`.

**Routes** live in a new [routes/onboarding.ts](backend/src/routes/onboarding.ts) with its own
`requireMerchant` hook (Part 0.3): readiness, and `GET/POST /admin/delivery-zones`,
`PATCH/DELETE /admin/delivery-zones/:id` (managers only; `area_name` 2–60, `charge` ≥ 0 paisa,
the same area in any case is 409 `DUPLICATE`, because the bot matches areas by whole words and two
spellings would make the match arbitrary). `GET settings` now carries the `readiness` block
(FR-P2.6) so the settings page can disable the bot toggle and say why.

**Portal.** `/onboarding` is a left checklist (Done / To do / Problem) with the active panel on the
right; on phones the list becomes a horizontal stepper. `?step=` deep-links a panel; otherwise the
first open step opens. The Delivery panel is complete: zones table with serviceable toggle and
delete, add form in rupees (stored as paisa), default charge, free-delivery threshold and the
"everywhere" checkbox. The other panels show the server's reason and a link to the page that handles
it today, until week 3 fills them in. "Go live" sends `botEnabled: true` and, on 409, jumps to the
first failing step. The dashboard card now reads readiness: "N of 7 steps done", linking to the first
open step, and disappears exactly when ready **and** the bot is on (FR-P2.4).

**Tests.** [lib/readiness.test.ts](backend/src/lib/readiness.test.ts): each check flips on its own
data (21 tests, over FakeDb through the real routes), the 409 gate, "off" never needs readiness, zone
CRUD with the duplicate and staff refusals. FakeDb needed nothing new: its many-to-one embed already
resolves `customers(wa_id)` on orders. Suite: 24 files, 235 tests.

**Checked visually** against a throwaway mock backend (not committed; it serves fixtures with two
zones and four failing steps) at desktop and phone width.

---

## 2026-10-13 — P1: self-service signup, email confirmation, password reset, automatic shop

**Outcome** — a shop owner can sign up at `/signup`, confirm by email, and land on onboarding with
their own empty shop; "Forgot password?" works end to end. Built on branch `feat/p1-signup` from
SRS-Uzair v1.1 (Stream P, week 1). Not yet deployed; migration 0012 not yet applied.

**How it fits together.** Accounts live in Supabase Auth, as before. The backend only does two
things: gate who may join (`POST /api/v1/signup/check`, `SIGNUP_OPEN` / `SIGNUP_ALLOWLIST`), and
turn a confirmed login into a shop (`POST /api/v1/signup/bootstrap` → `create_merchant_for_user()`
RPC, migration 0012). The shop's name, owner and phone travel in the auth user's metadata, set by
the signup form, so the bootstrap call needs no body. The new shop has `botEnabled:false`
(and 0012 changes the column default to match), so no shop answers buyers before onboarding.

**Decisions taken while building, per the SRS:**
- **One user, one shop, enforced by the database.** `merchant_users` was unique only on
  `(merchant_id, auth_user_id)`; two bootstrap calls racing could make two shops. 0012 adds a
  unique index on `auth_user_id` and the RPC catches the violation and returns the shop that won.
- **Phone numbers are digits only** ([lib/phone.ts](backend/src/lib/phone.ts)): `+92 300 1234567`,
  `0300-1234567` and `923001234567` all store as `923001234567`, which is what WhatsApp sends as
  `wa_id`. P2's test-order check compares with `samePhone()`.
- **The auth gate moved out of `routes/admin.ts`** into `requireMerchant()` in
  [lib/auth.ts](backend/src/lib/auth.ts), so new route files apply it themselves. A valid JWT with no
  shop now gets `401 { code: 'no_membership' }` instead of a plain 401, and the portal's `api()`
  sends that case to `/auth/confirmed` (which bootstraps) instead of `/login` — that was the login
  loop. A caller with no `merchantId` gets 403 `NO_SHOP`; nothing produces that today, but M6's
  platform admin without a membership will.
- **Attestations** (no prohibited goods, opt-in only) are two required checkboxes on the form and
  land in `settings.attestations` with a timestamp; P2's readiness check reads them.
- **`POST /api/v1/admin/merchants`** (platform admin) now also creates the shop with the bot off.

**Portal.** `/signup`, `/auth/confirmed`, `/reset`, `/auth/reset`; `/login` gained the two links.
The two-column sign-in screen became `components/AuthLayout.tsx`, shared by all five pages. The
signup page asks `/signup/check` *before* calling Supabase, so a refused email never leaves a
stray auth user. A repeat signup is detected two ways: Supabase's `user_already_exists`, and the
quieter "user with zero identities" answer it gives when email confirmation is on.

**Site.** "Start free" on the home hero and the first pricing plan, pointing at the portal's
`/signup`; `site.js` keeps the path when it rewrites railway links to localhost.

**Tests.** [lib/auth.test.ts](backend/src/lib/auth.test.ts) runs the real routes with `app.inject()`
over FakeDb, with `./supabase` mocked so `auth.getUser()` answers from a table of test tokens:
`no_membership` for a user without a shop, 403 `signup_closed` off the allow-list, one shop and one
owner row for an allow-listed user, a second bootstrap returning the same shop, and the same JWT
passing the gate afterwards. [lib/phone.test.ts](backend/src/lib/phone.test.ts) covers the formats.
FakeDb gained the RPC twin. Suite: 18 files, 147 tests; both typechecks pass.

**Still to do for P1's "done when":** Fazal flips Supabase's "Confirm email" on and runs 0012;
`SIGNUP_ALLOWLIST` set on Railway; the full signup tried on the deployed portal with a Gmail
"+tag" address (T1–T3).

**Merged with `main` the same day** after M1–M3 landed: `lib/phone.ts` existed on both sides
(Fazal's `digitsOnly`/`samePhone`, mine with the 0300→92300 fold); the merged file keeps his
exports and makes `samePhone()` use the fold. His simpler `requireMerchant()` was replaced by this
one, which `routes/whatsapp.ts` already applies. `/config` now carries both `signupOpen` and the
Embedded Signup ids. Suite after merge: 23 files, 214 tests.

---

## 2026-10-13 — M3: connection page, account events, send test, disconnect, profile sync

Branch `feat/m3-connection-status`. 21 test files, 192 tests (22 new). Both typechecks clean;
`next build` compiles the page.

Built: `parseAccountEvents()` (the three account-level webhook fields, keyed by `entry.id`),
event claiming under the new `item_type='event'` with a payload-hash id, `account-events.ts`
(quality FLAGGED/UNFLAGGED/UPGRADE/DOWNGRADE/ONBOARDING with tier mapping; account
DISABLED/VIOLATION/RESTRICTION/PARTNER_REMOVED/VERIFIED; template REJECTED/PAUSED notify until M4
stores templates), `sendTestMessage()`, `disconnectWhatsApp()`, `syncBusinessProfile()` (A.12,
called after the handshake and exposed for P2), the daily reminder for a disconnected number, the
three routes, and the connected card's Send test / Reconnect / Disconnect buttons with a quality dot.

Design points worth knowing: UNFLAGGED restores only a quality flag, so a dead token is never
"fixed" by a quality webhook; `processClaimed()` marks each event row processed or error like a
message; a test message after the merchant's 24-hour window has closed cannot be free-form, so
131047 is handled by returning the number to `connecting` and asking them to text the shop again
rather than reporting a failure.

Hassle: none worth recording; the FakeDb already supported `data->>action` filters from an earlier
feature, which the reminder dedupe needed.

Not done: the four webhook fields are not yet subscribed in the Meta dashboard (M7 step 3), so no
account event reaches production until then; `message_templates` rows (M4) do not exist, so a
template approval is silent and only a rejection is surfaced.

---

## 2026-10-13 — M2: "Connect WhatsApp" through Meta Embedded Signup

Branch `feat/m2-connect`. 20 test files, 170 tests (21 new in `connect.test.ts`). Backend and
admin typechecks clean; `next build` compiles the new page.

Built: `whatsapp/meta-graph.ts` (A.1–A.5 with `appsecret_proof`, typed `GraphError`),
`whatsapp/connect.ts` (`connectWhatsApp`, `retryConnect`, `handleConnectHandshake`,
`getConnectionStatus`), `routes/whatsapp.ts` (own route file + `requireMerchant()` extracted to
`lib/auth.ts`, the SRS Part 0.3 rule; Uzair's P1 no longer needs to do that), `lib/phone.ts`
(digits-only comparisons), the handshake hook in `webhook.ts` (`resolveTenant` now carries `status`
and the merchant phone), `/api/v1/config` exposing the public Meta ids, `META_EMBEDDED_SIGNUP_CONFIG_ID`
in config, and the portal page `settings/whatsapp` (SDK load, origin-checked message listener,
choose-a-number, PIN field, retry, handshake polling, connected card) with a link card on Settings.

What the tests pin down: the exact order of Meta calls; every business-token call carries
`appsecret_proof` and no token in the URL; hint mismatches keep nothing; another shop's number is
never taken over and the new token is deleted; the same code twice does one exchange; 133005 →
PIN field → retry with the PIN finishes; a second connect retires the old number and its secret;
the handshake only matches the merchant's own phone (digits only) and only while `connecting`;
131042 → the Meta Billing instruction with `flag_reason='policy'`.

Hassle: `numbers[0]` under `noUncheckedIndexedAccess` left `chosen` possibly undefined through the
rest of the function (13 errors); a guard after the choice fixed it. Nothing else fought back.

Not done, by design: M3's quality/account webhooks, Disconnect and Send-test buttons (the connected
card says so); `META_EMBEDDED_SIGNUP_CONFIG_ID` is not yet declared in `.railway/railway.ts` because
`preserve()` on a variable that doesn't exist yet is untested, and the value only exists after M7
step 2. **Not tested against Meta**: the Graph shapes are from the docs as of mid-2026; the first
real run (after business verification, M7) is the check. The one pilot merchant is untouched and
still sends on the env token.

---

## 2026-10-13 — M1: per-merchant WhatsApp credentials

First feature of the SRS (Stream M). Branch `feat/m1-credentials`. 19 test files, 149 tests.

What changed: `lib/crypto.ts` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), `whatsapp/credentials.ts`
(`storeToken`, `lookupToken`/`tokenForNumber`, `forgetNumber`, `markTokenInvalid`), `client.ts`
rewritten around one `send()` that resolves the token per number and reports `errorCode`,
`media.ts` takes the `phoneNumberId`, catalog sync uses the merchant's own token, migration
`0009_whatsapp_connect.sql` (the whole M1–M3 schema, as Appendix C defines it, so M2/M3 add no
file). `TOKEN_ENCRYPTION_KEY` is now required when `NODE_ENV=production` and validated.

The one thing that would have taken production down: the SRS said the key is "32 bytes, base64",
and the first validation accepted only base64. The key on Railway (and in `.env`) is 64 characters,
which is **hex** from `openssl rand -hex 32`; base64-decoding it gives 48 bytes and the refine would
have failed, so the backend would have exited at boot on the next deploy while Railway kept serving
the old container. Found by checking variable *lengths* on Railway (never values) before committing.
`parseKey()` now accepts both encodings, and `loadConfig()` was run locally with
`NODE_ENV=production` against the real `.env` to prove it boots.

Two test slips fixed on the way: `Buffer[i] ^= …` trips `noUncheckedIndexedAccess`, and the 190
test left the stubbed `fetch` answering 401 when it sent from the second merchant.

**Live:** PR #14 merged 2026-10-13; migration 0009 applied to the live database the same day and
verified (both enum values, the attempts table locked for anon/authenticated, the two columns, the
index). Still pending: the pilot merchant still sends on the env token (until M2), and `notify()` does not exist
so `markTokenInvalid` writes the `notifications` row directly, as `handoff()` does.

---

## 2026-10-12 — One plan to replace eight, built so Meta approval is a settings change

The owner wasn't satisfied with the 10-05/10-06 launch plans and wanted a product that is complete
before Meta approval, so that approval only means "update the API". Two audits were run first, one
of the plans and one of the code, plus the Meta Tech Provider roadmap PDF and the live services.

What the audits found. The old plans used seven overlapping numbering schemes for the same work,
scheduled Meta App Review behind weeks of internal refactoring, had no fallback if Meta stalled,
and were already stale: four of their "current problems" were fixed earlier the same day. The code
is more multi-tenant than the docs admit (inbound routing is per `phone_number_id`) and less than
the schema suggests (`whatsapp_secrets`, `TOKEN_ENCRYPTION_KEY`, `platform_admins`, `codEnabled`,
`merchants.plan`, `merchants.status`, the opt-out flag and the saved greeting all exist and nothing
reads them). Every outbound message uses the one env token.

The key realisation: Meta approval unlocks no new APIs, only who we may use them for. So every
Meta-facing feature can be built and tested now with the test number and merchants added as app
testers, and approval day is three dashboard settings plus `SIGNUP_OPEN=true`.

`docs/launch/PLAN.md` is the result: Track A (Meta, 7 steps, owner-gated on the NTN/address/billing
items that have been open since September) and Track B (7 milestones, each with one "done when"
test), App Review submitted at week 4, a fallback of Sahulatcart-owned numbers if Meta stalls, ten
decisions made so nobody waits, and about 14 weeks to paid-ready with one engineer. The eight old
files moved to `docs/launch/archive/`.

Also found while checking the live state: the owner put Cloudflare in front of the domain at some
point, so `https://sahulatcart.com` now works and mail runs through Cloudflare Email Routing. CLAUDE.md
and the SEO memory said it still failed; both corrected. The `.tbc` placeholders for NTN and address
are still on the site.

---

## 2026-10-12 — Daily database backups on the owner's Mac

The Supabase project is on the free plan, which keeps no backups. Until now the live database was
the only copy of every order, customer and login.

Added `db/backup.sh`. It runs `pg_dump` (custom format) of the `public` schema plus data-only
`auth.users` and `auth.identities`, writing to `~/Sahulatcart-Backups/<date_time>/`. Each run writes
to a hidden folder and is renamed only after `pg_restore --list` can read both files. Backups are
kept 30 days, and old ones are deleted only after a new backup succeeds, so a broken connection can
never erase the history. `db/backup-schedule.sh` installs a LaunchAgent that checks hourly and backs
up once a day. A Mac that was asleep or off at a fixed hour still gets its backup. A failure shows a
macOS notification.

What made it fiddly:
- **No `pg_dump` here, and no Homebrew bottle.** `brew install libpq` on this Intel Mac (macOS 26)
  built OpenSSL and libpq from source, which took about 20 minutes. It produced pg_dump 18.6. The
  server is Postgres 17.6, and pg_dump must be the same major version or newer.
- **macOS blocks background jobs from reading `~/Desktop`**, where the repo lives. A LaunchAgent
  pointing at `db/backup.sh` or `.env` there fails with "Operation not permitted". So `install`
  copies the script, plus the connection string as an owner-only `backup.env`, to
  `~/Library/Application Support/Sahulatcart/`. It must be re-run after editing the script or
  changing the DB password.
- The first schedule test wrote to a scratch folder and was confirmed to produce a backup *from
  launchd*, not only from a terminal, before the real install.

Verified: first backup `2026-10-12_1446`, 132 KB in 54 s (mostly network to ap-south-1). It holds
the same 23 tables as the live `public` schema, and both dumps convert fully back to SQL with
`pg_restore`. The installed agent's first run exited 0, skipping because today's backup existed.
**Not tested:** a restore into a real database. The steps in db/README.md need a spare Supabase
project to prove.

Gaps: Storage files (product images, payment screenshots, slips) are not backed up, and backups
only happen while the Mac is on. A cloud schedule, such as a GitHub Action with an encrypted dump,
would remove the second limit.

---

## 2026-10-12 — Supabase project moved to the company account

The Supabase project (ref `cfvwxwpmwqfghstwutdp`) sat in a different account from the one the owner
first checked, and it had no record in the repo. It was found by elimination. The Railway CLI here is
logged in as `sahulatcart2026@gmail.com`, and both services were set up together on 09-21. It was then
moved with Supabase's **Transfer project** into an organization owned by `sahulatcart2026@gmail.com`.

The first transfer attempt was refused: "Project is currently connected to GitHub". Supabase's GitHub
integration had to be disconnected first. It was unused (no `supabase/` folder; migrations are run by
hand), so the disconnect changed nothing else.

The plan at one point was to "delete the project from the other email". That would have destroyed
the live database, and the free plan has no backups. The transfer moves the project instead, keeping
ref, URL, keys and data, so `.env` and Railway needed no change.

Verified after the transfer: the live backend's `/readyz` reports `db: ok` without a restart (uptime
~12 days). The admin's `/api/v1/config` returns 200. Locally, the service role reads `merchants`
(1 row) and `webhook_events` (65), the 0008 column exists, and the anon key is still refused (`42501`).

Left for the owner: remove the old email from the new organization's Team, then delete the old, now
empty organization. Delete the organization only, never the project.

---

## 2026-10-12 — No lost webhooks, no sales on unknown stock

Two risks flagged in the 10-05 roadmap review, both fixed with tests (16 files, 125 tests).

**Webhook.** The route sent Meta its 200 *before* writing the `webhook_events` row. The replay sweeper
only covers recorded rows, so a DB blip or a crash in that gap lost the message silently, and Meta
never retried because it had its 200. CLAUDE.md said "claim first", which was true only *after* the
ACK. Now `claimWebhookPayload()` records every message before the route answers. Any failure (insert
or tenant lookup) answers 500, so Meta redelivers. Rows already written dedupe as before, and the
unwritten message waits for the redelivery instead of being processed now, which would reply twice.
A failed tenant lookup used to look like "unknown number" (ignored, or dead-lettered by the replay
sweeper as "not replayable"). It now throws, so it's retried rather than dropped. Statuses are still
applied when their row can't be written; losing one is harmless.

**Stock.** If the `reserve_stock` RPC errored, checkout logged it and confirmed the order without
reserving, so the last unit could be sold twice. That was a fallback for before 0008 was applied,
and 0008 has been live since 09-29. Now the order is put back to draft (number, `placed_at` and
payment fields cleared, filtered on the status we just set) and checkout stops, matching the
order-number failure. An attempt to also filter on `stock_reserved = false` failed in the test fake,
which has no column defaults. It's unnecessary anyway: an errored RPC rolled back and reserved nothing.

Not deployed by this change. The backend redeploys when the PR merges (it touches `backend/`).

---

## 2026-10-06 — Implementation sequence for all 31 completion features

Added `docs/launch/IMPLEMENTATION-PLAN.md` with work packages W00–W10, prerequisites, demonstrations,
Meta review checkpoints and complete F01–F31 coverage. Added a separate engineering appendix with
existing code touchpoints, proposed persistence/API contracts, migration groups and targeted tests.
The sequence fixes order/stock correctness and durable messaging before self-service signup, then
brings the Meta connection flow forward for review while the remaining product work continues.

The schema/auth review exposed two details that a generic signup plan would miss: current merchant
defaults enable the bot, and the existing API auth resolver requires merchant membership before a
brand-new authenticated user can provision a shop. The implementation plan explicitly handles both,
preserves existing owners/data and distinguishes mock-tested integration from approved live access.

Documentation only: no application feature, database migration, provider setting or deployment was
changed. Existing local changes and the user's Meta roadmap PDF were preserved.

---

## 2026-10-06 — Feature-only market readiness plan

Added `docs/launch/FEATURE-PLAN.md`, distilling the detailed launch roadmap into 31 product features
grouped by merchant accounts, WhatsApp, shop setup, customer sales, orders/payments, the owner workspace,
security/reliability and paid subscriptions. Each feature states the required behavior and whether it
needs building or completion of existing code. The delivery sequence starts with order/stock correctness
and message recovery; paid subscription features are separate from free-pilot requirements.

Linked the shorter plan from the repository README and launch roadmap. This is documentation only;
feature implementation and live-readiness status have not changed.

---

## 2026-10-05 — Detailed roadmap for the Pakistani market launch

Added `docs/launch/README.md` and four separate work plans for merchant/Meta onboarding,
customer sales, security/operations, and testing/pilot/commercial launch. Each task has an owner,
release gate and completion condition. The plan records current code evidence, 15 founder decisions,
40 acceptance scenarios, dependencies and provisional effort ranges. It preserves the owner's scope:
no staff-management requirement, merchant-owned fulfillment, and manual bank-payment verification.

The review found a mismatch between the old single-shop launch plans and the requested self-service
release. It also confirmed two concrete code risks to fix before a real pilot: webhook success is sent
before durable persistence, and checkout can continue after a stock-reservation RPC error. The new plan
does not present proposed onboarding or passing unit tests as proof of live readiness. Current public
Meta policy/partner/pricing and Supabase/Railway documentation informed the provider-dependent parts;
the detailed Meta Tech Provider developer page could not be retrieved, so exact account-specific
permissions and coexistence behavior remain explicit implementation-time checks.

This change is documentation only. No credentials, database, deployed service or Meta account changed.
Validation: all local links and task references in the five roadmap files resolve; the plan contains
71 unique tasks and 410 checklist items; the tracked diff passes the whitespace check. Application tests
were not rerun for this documentation change (the preceding code assessment recorded 121 passing tests).

---

## 2026-10-05 — Proposed post-verification onboarding and sales architecture

Added separate merchant and customer target-flow diagrams. The merchant diagram separates Facebook
portal login from Meta Embedded Signup, shows automatic shop creation at first login, and makes the
merchant-owned WABA/number connection a readiness gate. The customer diagram shows one shared webhook
with routing by phone-number ID, merchant-scoped credentials/data, durable event handling, code-enforced
prices, stock reservation, and manual bank-transfer verification. These are design documents; the
corresponding self-service onboarding and per-merchant token code have not been built.

---

## 2026-10-05 — Separate merchant and customer architecture diagrams

The first combined diagram (`docs/CURRENT-ARCHITECTURE.md`) was too dense to read. Replaced it with
`docs/MERCHANT-SIDE-ARCHITECTURE.md` and `docs/CUSTOMER-SIDE-ARCHITECTURE.md`, each showing only the
main path and a short explanation. The diagrams describe current behavior: Supabase email/password
login, Gemini-assisted messages, code-enforced pricing, and an invite-only merchant-creation API.

---

## 2026-10-01 — Deploy facts recorded; a redeploy trap found in the watch paths

The three admin changes of 09-30 now each record how they shipped and what was checked live (see
their **Live:** notes). CLAUDE.md gained the meaning of Railway's deploy statuses, a description of
what a mock backend needs (the one used on 09-30 was never committed and is gone), and an updated
branding date.

**The trap.** While checking why the backend showed SKIPPED, `.railway/railway.ts` turned out to give
each service a `watchPatterns` of only its own folder (`/backend/**`, `/admin/**`, `/site/**`). So a
push that changes only `shared/`, the root `package.json` or the lockfile redeploys nothing, although
both apps build from them. It hasn't bitten yet. It would look exactly like the 09-21 to 09-28
episode: the old container keeps serving and everything looks healthy. Until the patterns include
`/shared/**` and the root files, redeploy by hand after such a push. Changing the patterns is a
`railway config apply`, so it was left for the owner's go-ahead.

**Fixed the same day.** The backend and admin now also watch `/shared/**`, `/package.json`,
`/package-lock.json` and `/tsconfig.base.json`. The admin also watches `/.dockerignore`, because its
Dockerfile copies the whole repo. The site is unchanged; it reads only `site/`. Docs-only pushes
still skip everything.

The first `railway config plan` showed again that an apply would **delete `@app/admin.FIX`**, an
undeclared variable nobody can explain (nothing in the code reads it). Applying as-is would have
deleted it as a side effect. It's now declared `preserve()`, so the reviewed plan was exactly two
watch-path updates and 0 to destroy. Whether `FIX` should exist at all is still the owner's call.

---

## 2026-09-30 — Admin dark mode

A light/dark toggle now appears on every portal page: in the sidebar footer and the phone top bar,
and at the top right of the login page. A saved choice wins. With nothing saved, the portal follows
the device setting, and switches live if the device changes. A small inline script in `<head>` sets the
theme before first paint, so a dark page never flashes white.

**How:** every colour that was hard-coded in a rule became a semantic token (`--surface-hover`,
`--warning-border`, `--primary-hover`, `--toast-bg`, `--agent-bubble`, `--chart-2`…). `:root[data-theme="dark"]`
then re-points the tokens onto a navy base. Brand tokens are untouched.

**Things that would have broken in dark if the colours had just been inverted:**
- The **wordmark** gradients are drawn for light surfaces. "Sahulat" fades to navy and vanishes on
  navy. The marketing site already had the brand's dark treatment (white "Sahulat", `--grad-glow`
  "cart"), so the portal reuses it rather than inventing one.
- **Primary button hover** went to forest, which sinks into a navy page. Dark hover is a deeper green.
- **Toasts and the skip link** used `--ink` as their background. In dark, `--ink` is near-white, so
  the white text would have disappeared.
- The **unread badge**: dark-mode `--danger` is a light red for text, and white on it fails contrast.
  Badges use `--danger-solid`, which stays dark red in both themes.
- **Analytics' bank-transfer bar** was forest and turns mint in dark. Accent text (`--brand-ink`) is
  forest in light and mint in dark for the same reason.
- `.btn.danger` (filled) was unused. It was deleted rather than themed.

**A false alarm while checking:** the browser console showed 216 "connection refused" errors. They
were left over from stopping the local test server with the tab still open. Watching the network for
35 s showed only the normal 30 s badge poll, returning 200.

**Live:** PR #11 merged 16:03. Admin deploy `ae4af4b9` reported SUCCESS. Checked on the live portal
on 2026-10-01: `/login` serves the theme script in `<head>` and the toggle, and the stylesheet carries
the `[data-theme=dark]` rules. Signed-in pages weren't checked live, since that needs the owner's
login. In `railway deployment list`, the two earlier admin deploys now show **REMOVED**. That only
means a newer deploy replaced them, not that they failed. The backend shows **SKIPPED** for all three
pushes, because none touched `backend/`.

---

## 2026-09-30 — Inbox: stronger chat borders

The owner found the inbox lines too faint on the live portal. The card outline, the divider between
the list and the chat, the chat header, the composer and the customer bubbles now use
`--border-strong` instead of `--border`. The bot's tinted bubbles also got a matching border. This is
scoped to the inbox (`.card.inbox`); other cards keep the lighter line.

Also fixed: "Hand back  to bot" showed a double space. The hidden-on-phones `to bot` span was its own
flex item, so the button's gap was added on top of the space. Deleting the space would have made
screen readers say "Hand backto bot". Both words are now wrapped in one span.

**Live:** at the owner's request this went straight to `main` (`f36752d`) with no pull request. It was a
fast-forward, since `main` hadn't moved. Admin deploy `057f3b3b` reported SUCCESS, and the live
stylesheet was confirmed to have the new `--border-strong` rules.

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

**Live:** PR #10 merged 15:40. Admin deploy `d3e4cc90` reported SUCCESS. The live `/login` serves the
new markup and stylesheet, and Poppins loads in all four weights. That confirms the fallback font seen
locally really was only the sandbox's network.

**The mock backend is gone.** It lived in a session scratchpad folder, not in the repo, and was
deleted with it. CLAUDE.md ("Checking the portal visually") says what a replacement needs.

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
