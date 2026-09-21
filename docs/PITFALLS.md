# Pitfalls — read before working on this project

Every rule here comes from a real mistake made on this codebase, most of them on
2026-09-21 while migrating it onto new infrastructure. They are written as rules
because each one cost hours, took a service down, or leaked a credential.

**If you are an AI agent or a new collaborator: read this file before your first
change.** It is short on purpose.

---

## 1. Secrets

### Never run a command that prints secret values

Running `railway variables` dumps every environment variable **including API keys
and tokens** into the transcript. This happened twice in one session, leaking a
Gemini API key, a Meta App Secret and a Meta access token.

**Rule:** before running anything that reads configuration, pipe it through a
filter that prints only key *names*, lengths or a pass/fail — never values. Write
the mask first, not after seeing the output.

```bash
# BAD — prints values
railway variables --service x

# GOOD — shape only
railway variables --service x --kv | awk -F= '{print $1" (len "length($2)")"}'
```

### Never ask for, or accept, secrets in chat

Credentials pasted into a conversation live in its history and cannot be
retracted; rotation is the only remedy. Have the user write them straight into
`.env` (gitignored) or the platform dashboard.

To collect one interactively without it being echoed, use a script with
`read -rs` and write it to `.env` directly. There is prior art in this repo's
history for doing exactly that.

### Debug from error messages, not values

Every fault in this project — 404s, 502s, stale builds, failed auth — was
diagnosed without seeing a single credential. The error text is enough.

---

## 2. Deployment (Railway)

### Read the platform's failure reason BEFORE changing anything

This is the single most expensive lesson here.

- The marketing site was "fixed" and redeployed **four times**. Its build log had
  named the cause on the **first** failure: `can't create
  /etc/nginx/templates/default.conf.template: nonexistent directory`.
- The admin failed **~8 deploys**. `railway config plan` had been showing the bad
  `buildCommand` the entire time.

**Rule:** on any failed deploy, the first action is to read the build log *and*
the deploy log. Do not edit, redeploy, or theorise first.

```bash
railway service <name>          # link it
railway logs --build            # build-stage failure
railway logs --service <name>   # runtime failure
railway config plan             # config drift
```

### Never cycle redeploys hoping for a different result

Repeatedly forcing deploys without diagnosis took the **admin portal completely
offline** for several minutes. Before that it was serving an old build but
working perfectly.

**Rule:** a working-but-imperfect service is more valuable than a broken one.
Diagnose before you touch it.

### Never guess at a cause and "fix" it speculatively

"Health check" was guessed as the reason admin deploys failed, so
`healthcheckPath: "/healthz"` was set — against a build that had no such route.
That **created** the failure it was meant to fix. The field had been `null` all
along, visible in `railway config plan`.

### If an IaC field reappears in the plan, it is not being applied

Setting `buildCommand` to `null` in `.railway/railway.ts` silently did not
persist — it showed up in every subsequent `railway config plan`. Setting it to a
real value (`"echo docker-build"`) stuck immediately.

**Rule:** always run `railway config plan` *after* an apply. If a change is still
listed, it did not take. Try a concrete value instead of null.

### A start command in the build slot breaks everything, quietly

The admin had `buildCommand: "npm run start -w @app/admin"`. Railway ran the web
server as a build step; the build never finished; every deploy failed **while the
build log looked like a clean, successful Next.js build**. This is the single
hardest failure in this repo to spot.

### `--skip-deploys` means nothing restarts

Setting every variable with `--skip-deploys` batches them but means **no container
ever picks them up**. The backend ran a stale image for hours — with a deleted API
key — while its configuration on Railway was perfectly correct.

**Rule:** after batching variables, set one *without* the flag to force a cycle.

### "Online" does not mean working

`SUPABASE_URL` was truncated to `https://`. Zod's `.url()` accepts that, so the
backend booted, reported healthy, and failed every database query. Always verify
behaviour (`/readyz`), not status.

---

## 3. Monitoring

### `/readyz?llm=1` makes a live Gemini call — never poll it

Background monitors hitting it every 15 seconds consumed the **entire daily
Gemini quota** (20 requests/day on the free tier). The bot then fell back to
canned replies, which looked exactly like the bot being broken. Hours were spent
chasing a fault that was caused by the monitoring.

**Rule:** before polling any endpoint in a loop, check what it costs. Use
`/readyz` (no query string) for liveness.

---

## 4. Git

### `git checkout <branch> -- <paths>` silently reverts newer fixes

Restoring rebrand files from an old branch also reverted three fixes made since —
including repointing the site's Login links back at the **previous owner's** admin
deployment, and resetting the Privacy footer link to `#`. Files that did not exist
on that branch (`privacy.html`) were missed entirely.

**Rule:** after cherry-picking or checking out from a divergent branch, run a
regression pass for known-fixed issues. A clean merge is not a correct merge.

### Never `git stash` during a revert or cherry-pick

Doing so stashed the staged revert and left a confusing half-applied state that
looked like the operation had failed.

### Verify, do not assume, what is deployed

A marketing site was curled all session and assumed to be the user's. It belonged
to the **previous owner's** Railway account. Confirm which project, account and
repo a URL actually belongs to before drawing conclusions from it.

---

## 5. Verification

### Never report a pass you did not verify

`npx tsc` pulled a **squatted `tsc@2.0.4` package** instead of the TypeScript
compiler, and a shell `&&` chained off `tail` rather than the compiler — producing
a confident "typecheck: PASS" when nothing had been compiled.

**Rule:** capture and check the actual exit code. Run tools from
`node_modules/.bin/`, never bare `npx`, which silently installs whatever matches
the name.

```bash
cd admin && ../node_modules/.bin/tsc -p tsconfig.json --noEmit; echo "exit: $?"
```

### Test against an endpoint that accepts what you are testing

The Supabase anon key was tested against `/rest/v1/`, which only accepts
`service_role`. It correctly returned 401 and was wrongly reported as an invalid
key. The hint in the response said exactly this.

### Read the whole error, including the hint and the quota id

The Gemini quota was reported as 20 **per minute**, leading to "test it, it'll be
fine". The quota id said `GenerateRequestsPerDayPerProjectPerModel` — 20 per
**day**. One unread field, one wrong recommendation, one wasted test cycle.

---

## 6. Communication

### Answer at the length asked for

The user asked for short, direct answers repeatedly and kept receiving long ones.
When someone asks for brevity, that is a requirement, not a preference.

### Do not construct identifiers you can ask for

A Supabase hostname was built from the project ref (`db.<ref>.supabase.co`)
instead of asking for the connection string. It was IPv6-only and unreachable,
costing a detour. Ask for the real value.

### Check the source before assuming a name or convention

The brand name was assumed to be "SahulatCart". The brand book states
**"Sahulatcart"** — one word, capital S, lowercase c, and explicitly *not* the
camel-case form.

---

## Quick checklist before any deploy-related change

1. Read the build log **and** the deploy log.
2. Run `railway config plan` — is there drift?
3. Is the service currently working? If yes, what exactly are you improving?
4. Will this command print a secret?
5. Will this loop cost quota?
6. Did you check the exit code, not just the output?
