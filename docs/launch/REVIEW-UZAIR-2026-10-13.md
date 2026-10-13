# Review of Stream P work, 13 October 2026

From Fazal (lead). Covers PR #18 (P1), #19 (P2 part 1), #21 (P2 part 2), and the open PR
`feat/p3-alerts` (P3). Every PR was typechecked (backend and admin), the backend suite was run, and
the admin was built with `next build`, which is the check that caught the production incident
below. Each item has a file and a one-line fix. Severity: **blocker** stops a merge or is already
hurting production; **should-fix** lands in the next PR; **nit** whenever convenient.

The overall picture is good: tenant isolation is right everywhere, the readiness gate is computed
from data and fails closed, `paymentMethods()` is one source of truth, `notify()` is a clean choke
point, tests go through the real server, and your CHANGELOG entries are honest. The problems below
are specific and fixable in a day.

## Already fixed by me today (nothing to do, read so you know)

| What | Where | Fix branch |
|---|---|---|
| **The admin production build broke** after #21: `export function WhatsAppConnect` in `app/settings/whatsapp/page.tsx`. A page file may export only the page; `tsc` is happy, `next build` is not. The admin deploy at 16:24 **failed** and Railway kept serving the old build, so none of part 2's UI was live. | `admin/app/settings/whatsapp/page.tsx:49` | `fix/admin-build-whatsapp-connect`: component moved to `admin/components/WhatsAppConnect.tsx`. Rule added to CLAUDE.md. **Always run `cd admin && npm run build` (then `rm -rf admin/.next`) before pushing admin changes.** |
| **The go-live gate was a deadlock.** A self-signup shop starts with `botEnabled:false`; `runOrchestrator()` returned early for everyone while off; step 7 needs an order from the owner's phone; only the bot places orders. No new shop could ever go live. The readiness tests inserted order rows directly, so they never saw it. | `backend/src/orchestrator/orchestrator.ts:198`, `lib/readiness.ts` | `fix/go-live-test-order`: the owner's own phone (`merchants.phone`, digits) gets the bot while it is off; everyone else gets silence. Flow test added. |
| **"ji nahi" placed a COD order.** `YES_RE` was anchored at the start only, so "ji nahi", "ok pehle size batao", "han lekin kitne din?" all confirmed on a COD-only shop. | `orchestrator.ts:622` | Same branch: anchored at both ends, negations refused, tests added. |

## P3 `feat/p3-alerts` (open): merge after these

Mechanical: typecheck clean, 28 files / 289 tests pass, `next build` passes once the admin hotfix is
merged first (it merges into your branch with no conflicts). Rebase on main after the two fix PRs land.

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | should-fix | `backend/src/config.ts:45` | `ADMIN_ORIGIN` is back as `z.string().url().default(...)`. It still exists on Railway from the CORS days; if its value were not a single valid URL the backend would exit at boot. (I checked the live shape today; see the note after this table.) | Use `.url().optional()` with the fallback in code, or a new name `PORTAL_URL`. |
| 2 | should-fix | `site/privacy.html:182` | The policy promises no new sub-processor for buyer data without updating the list. Alert emails carry `delivery_name`, the buyer's wa_id and message text through Resend, which is not listed. | Add a Resend row to §7 before `RESEND_API_KEY` is set, or keep buyer PII out of email bodies. |
| 3 | should-fix | `admin/app/page.tsx:95` | `PushNudge` shows whenever the browser supports push, never checks `vapidPublicKey` (not set yet, so every merchant sees "Push is not set up on the server yet"), and shows for staff although only owner/manager are alerted. | Show only when `/config` returns `vapidPublicKey` and role is owner/manager. |
| 4 | should-fix | `backend/src/routes/notifications.ts:23-101` | No `isManager()` on any route; staff can save prefs and register devices that never fire. `POST /notifications/test` has no cooldown: one looped member can burn the shared Resend quota (100/day free). | `if (!isManager(ctx)) return forbid(reply)`; per-member cooldown on `/test` (1 per 30 s, in-memory Map). |
| 5 | should-fix | `notifications.ts:55` | Any `https://` endpoint of any length is accepted and later POSTed to on demand via `/test`: a small SSRF/reflector. | Cap endpoint 1024 chars, keys ~200; allow only `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`. |
| 6 | should-fix | `admin/public/sw.js:16` | `tag: url`, and every handoff maps to `/inbox`, so a second "Bot needs help" silently replaces the first on the lock screen. | Tag with the notification row id (send `id` in the payload) or `renotify: true`. |
| 7 | should-fix | `backend/src/lib/notify.ts:38`, `index.ts:26` | Digest state is a process `Map` plus an unref'd 5-minute timer: up to 5 minutes of queued emails are dropped on every deploy. Shutdown doesn't wait for in-flight sends. | Export `flushPendingDigests()` and await it in the SIGTERM handler after `drainWebhooks`. |
| 8 | should-fix | `backend/src/lib/push.ts:28` | No payload size cap (the payment body embeds the full buyer message; >4 KB is rejected by the push service), TTL 1 h, no urgency (Android Doze delays it). | Cut `body` to ~300 chars; `{ TTL: 86400, urgency: 'high' }`. |
| 9 | should-fix | `admin/components/AppShell.tsx:61` | Logging out leaves the device subscribed: on a shared phone the next person keeps getting this shop's orders with buyer names. | `disablePush()` (errors caught) before `signOut()`. |
| 10 | should-fix | `admin/public/manifest.json:10` | SRS asks for 192/512 PNGs from `logo-1024.png`; the badge is the colour icon, which Android shows as a white square. | Add the PNGs (`sips` on a Mac) and a monochrome badge. |
| 11 | nit | `notifications.ts:46,62` | Raw Postgres `error.message` returned to the client. | Log it, send a generic message. |
| 12 | nit | `notifications.ts:61` | Upsert on `endpoint` lets a member of shop B move shop A's row if they know the endpoint (unguessable, so low risk). | Refuse when the existing row has another `merchant_id`. |
| 13 | nit | `notify.ts:11` | `NotificationType` redeclared instead of imported from `@app/shared`. | Import it. |
| 14 | nit | `settings/notifications/page.tsx:40` | `test()` has no `catch`; the push switch stays clickable when `channels.push` is false. | Add the catch; disable the switch. |
| 15 | nit | `sw.js:26` | `navigate()` on an uncontrolled window rejects silently. | `focus().then(c => c.navigate(url)).catch(() => clients.openWindow(url))`. |
| 16 | nit | `notify.ts` `renderDigest` | "1 new notifications". | Pluralise. |
| 17 | nit | CHANGELOG | Records the result, not the dead ends. | Add what fought back. |

**Coordination:** my M5 branch adds one direct `notifications` insert in `backend/src/lib/usage.ts`
and conflicts with P3 in `orchestrator.ts`, `config.ts`, `railway.ts`, `CLAUDE.md` and the dashboard.
I will rebase M5 after P3 lands and switch that insert to `notify()`; you need not touch M5.

**Done well:** every one of the nine existing notification inserts was switched to `notify()`; the
fan-out is fire-and-forget with a test hook; channels skip cleanly when unconfigured, so the backend
deploys safely without keys or the migration; the migration matches the SRS column for column; the
digest is tested with fake timers; redaction paths were added for the subscription keys.

## P2 part 2 (PR #21, merged): follow-up PR needed

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | blocker (ops) | `db/backfill/2026-10-13-live-merchant-attestations.sql` | The pilot's attestation back-fill has **not been run** and nothing records it. The gate is live, so if the pilot's bot is paused it cannot be re-enabled: no attestations, no category/hours/phone, no persona style. The `where` needs `META_DEFAULT_PHONE_NUMBER_ID`; the seed's email is a simpler key. | Run it (`where email = 'pilot@sahulatcart.test' … returning id`), record "UPDATE 1" with the date in the CHANGELOG, then walk the pilot through the wizard. Until then **nobody presses Pause on the pilot.** |
| 2 | should-fix | `routes/admin.ts:490`, `:521` | A live shop can be left with no payment method: `codEnabled:false` or deleting the last bank account never rechecks readiness, so every buyer is handed off at checkout. | 409 for either change when it would leave zero methods on a shop whose bot is on; warn in `PaymentPanel`. |
| 3 | should-fix | `lib/readiness.ts:72` vs `orchestrator.ts` | Two defaults for `codEnabled`: readiness needs `=== true`, the bot and `PaymentPanel` use `!== false`. | One shared `codOn(settings)` helper. |
| 4 | should-fix | `admin/app/settings/whatsapp/page.tsx:151` (now `components/WhatsAppConnect.tsx`) | `Frame` is declared inside the render, so the subtree remounts on every state change: the PIN input loses focus after each digit and AppShell refetches on every keystroke. | `const body = <>…</>; return embedded ? body : <AppShell>…{body}</AppShell>`. |
| 5 | should-fix | `routes/onboarding.ts:123` and `admin.ts:285` | Logo and product image uploads accept any `image/*`, including SVG with scripts, into the public bucket. | Allow only png/jpeg/webp. Also delete the previous logo key, or use a fixed key with `?v=`. |
| 6 | should-fix | `admin.ts:506` | `bot_persona` (incl. the greeting that goes to buyers and into the prompt) is merged wholesale; the 200-char limit exists only in the browser. | Validate name ≤40, style enum, greeting ≤200 server-side. |
| 7 | should-fix | `settings/page.tsx:182` + `DeliveryZones` | Two "default delivery charge" inputs; `DeliveryZones` never resyncs its state, so one can overwrite the other with a stale value. | Remove the old input from the negotiation card and from `saveNeg`. |
| 8 | should-fix | `lib/readiness.ts:26` | `testOrder` accepts only `confirmed/awaiting_payment/paid`; once P4 moves the owner's order to `dispatched`, the step turns red and a later pause locks the shop out again. | `status not in ('draft','pending_confirmation','cancelled','returned')`. |
| 9 | should-fix | `routes/admin.ts:497` | Readiness is computed on the stored row, then the PATCH is applied, so one request can switch the bot on and break a check at once (`{botEnabled:true, codEnabled:false}` with no bank). | Compute readiness against the merged settings, or 400 when the same body changes both. |
| 10 | should-fix | `lib/readiness.ts:45` | One readiness call loads every placed order with its customer, about 10 queries total, on every dashboard/settings/onboarding load. | Look up the customer by `wa_id` first, then `.in('customer_id', ids).limit(1)`. |
| 11 | should-fix | `routes/onboarding.ts:35` | Duplicate areas are only prevented in app code (race), no DB constraint. | Migration: `create unique index on delivery_zones (merchant_id, lower(btrim(area_name)))`; map 23505 to 409. |
| 12 | should-fix | `admin/app/page.tsx:23,46` | Dashboard reads `botEnabled === true` while the backend treats missing as on; the live pilot is told "the bot stays off" while it is answering customers. | `!== false` everywhere; when on but not ready: "Your bot is live; finish setup so you can pause and resume it safely." |
| 13 | nit | `onboarding/page.tsx:328`, `DeliveryZones.tsx:65` | `<Trash2 />` without `aria-hidden`. | Add it. |
| 14 | nit | `onboarding/page.tsx:425` | `pretty()` on the pilot's `+1555…` renders `++1555…`. | Strip non-digits first. |
| 15 | nit | `DeliveryZones` | A blank charge becomes Rs 0; the form clears after a 409. | Validate; clear only on success. |
| 16 | nit | `orchestrator.ts:663` | A missing `orderId` hands off with "No payment method is enabled". | Separate note. |
| 17 | nit | `orchestrator.ts:66` | Numbers ≥50 in the merchant's greeting ("Rs 500 off") become sanctioned, so the bot repeats discount promises the engine won't honour. | Exclude the greeting from `sanctionedNumbers`. |
| 18 | nit | `onboarding.ts:74,85` | PATCH with an empty body calls `update({})`; DELETE ignores its error; `charge` has no upper bound. | 400 on empty patch; check the delete error; cap charge. |
| 19 | tests | `readiness.test.ts` | Missing: cross-tenant PATCH/DELETE on a zone (the test titled "not yours or gone" only covers gone); the bypass in #9; a positive `testOrder` match when `merchants.phone` is already digits; stale `pay_cod` tap after COD is turned off; sync called after a profile save. | Add them. |

**Done well:** `paymentMethods()` as one source of truth and the screenshot-wait COD switch you
found yourself; bank-only sends one message; "neither method" hands off instead of trapping the
buyer; the profile route validates tightly and stores digits-only phones; `lib/hours.ts` is clean
and tested including the Karachi edge; +18 tests, none weakened.

## P1 (PR #18, merged): follow-up items

| # | Severity | Where | Problem | Fix |
|---|---|---|---|---|
| 1 | should-fix | `lib/auth.ts:79` `resolveAuthUser()` | Never checks `email_confirmed_at`; proof of email ownership rests on the Supabase dashboard toggle alone. | `if (!data.user?.email || !data.user.email_confirmed_at) return null;` + test. |
| 2 | should-fix | `lib/auth.ts:92` `jwtAuthn()` | IC-7 not wired: any JWT without a membership gets `no_membership`, including a platform admin, who would then be bootstrapped into a shop. `NO_SHOP` is dead code because `merchantId` is typed `string`. | Check `platform_admins` first; return `{merchantId:null, isPlatformAdmin:true}`; widen the type; bootstrap returns 409 for platform admins. (I need this before M6.) |
| 3 | should-fix | tests | Nothing pins the admin-token login path, which `authenticate()` rewrote. | `x-admin-token` → 200 with `isPlatformAdmin:true`; non-JWT Bearer → 200; wrong token → 401 `UNAUTHORIZED`, not `no_membership`. |
| 4 | should-fix | `auth/confirmed/page.tsx:37`, `routes/signup.ts:25` | A user with missing metadata (dashboard-created, or an email already on `merchants.email`) gets a 400 and loops login → confirmed → 400 forever. | On 400 show a 3-field form (shop, owner, phone) that posts the body. |
| 5 | should-fix | `0012:8` + RPC | The unique index covers inactive rows but the RPC looks only at active ones: a deactivated member hits `unique_violation`, the handler finds nothing and raises; `signup.ts:28` echoes the raw Postgres text as a 400. | Detect the inactive membership and the email conflict in the RPC with distinct codes → 409 plain copy; 500 for anything else; note the one-shop-ever rule in CLAUDE.md. |
| 6 | should-fix | `test-support/fake-db.ts:112` | The twin doesn't model the one-shop index or the email uniqueness. | Make it throw as the SQL does. |
| 7 | should-fix | `lib/signup.ts:21` | `{"email":5}` crashes `.trim()` → 500. | `typeof email === 'string' ? … : ''`. |
| 8 | ops | Supabase | The built-in mailer only delivers to the project team's addresses, ~2/hour, so T1–T3 with an outside Gmail will fail silently; `/auth/confirmed` and `/auth/reset` must be in Supabase's Redirect URLs. | Custom SMTP (Resend, which P3 needs anyway) and the redirect URLs; record both. |
| 9 | product | `site/index.html:182` | "Start free" is the primary hero button while sign-up is closed: strangers fill a 7-field form before seeing "private pilot". | Keep "Book a demo" primary until launch day, or have `/signup` read `signupOpen` and say so up front. |
| 10 | nits | various | `delete from merchants` in the RPC's exception block is a no-op (the subtransaction already rolled back); checkbox `min-height:38px`; Eye icons without `aria-hidden`; "Wrong email or password" shown for `email_not_confirmed`; `/auth/reset` not gated on the recovery event; `/auth/confirmed` always goes to onboarding (returning users should get the dashboard). | As listed. |

## P2 part 1 (PR #19, merged)

Everything of substance is covered above (items 1, 8–12 in the P2 table came from this review).
The gate shipped to production before the pilot was made ready; the CHANGELOG entry for part 1
should say so.

## Order of events

1. Lead merges `fix/admin-build-whatsapp-connect` (admin deploys again) and `fix/go-live-test-order`.
2. You rebase `feat/p3-alerts`, fix P3 items 1–10, push; lead merges; lead applies 0014.
3. Lead rebases M5 on that, switches `usage.ts` to `notify()`; merges; applies 0011.
4. You open `fix/p2-followups` for the P2 table (run the back-fill first and record it).
5. You open `fix/p1-followups` for the P1 table; item 2 (IC-7) before M6 starts.
