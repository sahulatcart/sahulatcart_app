# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left open.
Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries for 2026-07 and earlier were reconstructed from git history and commit messages.

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
