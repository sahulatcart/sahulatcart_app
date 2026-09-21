# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left open.
Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries for 2026-07 and earlier were reconstructed from git history and commit messages.

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
