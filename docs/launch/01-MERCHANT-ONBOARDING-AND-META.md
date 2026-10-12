# 1. Merchant onboarding and Meta

[Back to the roadmap](README.md) · [Next: sales and merchant tools](02-CUSTOMER-SALES-AND-MERCHANT-TOOLS.md)

The merchant should see a guided shop setup. They should never need to generate an access token, edit a database, copy a WABA ID or ask an engineer to enable the bot. The technical steps below belong behind that experience.

**Current position:** the portal uses email/password login; merchant creation requires a platform administrator; the setup wizard saves settings and enables the bot without proving WhatsApp readiness. The sender and media downloader use a shared platform token. The database has number/secret structures that can support the future design, but the complete connection flow is not implemented.

## The intended merchant journey

1. Open Sahulatcart and choose **Continue with Facebook**.
2. Approve login, return to Sahulatcart, and get a shop created automatically.
3. Review the merchant terms and provide business information and a support contact.
4. Choose **Connect WhatsApp** and see a short explanation of number eligibility and expected Meta steps.
5. In Meta's window, authorize the appropriate business portfolio, WABA and phone number, completing verification when required.
6. Return to a status screen while Sahulatcart securely finishes the connection; complete Meta billing prerequisites where applicable.
7. Add products, stock, discount limits, delivery rules and supported payment methods.
8. Send a guided test inquiry and complete a test order.
9. Enable the bot when every readiness check passes.
10. Use the dashboard for orders, payment review and exceptions; see **Reconnect WhatsApp** if authorization becomes invalid.

Facebook portal login and WhatsApp authorization have different jobs. The portal session identifies the owner. The WhatsApp business credential authorizes backend operations on their business assets. Do not call either a guaranteed permanent login or tell a merchant to paste a PAT.

## Account and shop tasks

### AUTH-01 — Configure and implement Facebook portal login

**Owner:** Engineering. **Gate:** Internal; Public access configuration before Public. **Depends on:** OPS-01/02, Meta app setup.

- [ ] Configure the Facebook identity use case and Supabase provider for the actual deployment URLs.
- [ ] Confirm public-profile/email requirements and consent behavior; handle a missing or unconfirmed email with a useful next step. Do not create fake emails.
- [ ] Use the supported OAuth/session flow, validated redirect destinations and state protections; remove credentials/codes from URLs after processing.
- [ ] Show loading, consent cancelled, popup blocked, provider outage and login failed states without exposing provider secrets.
- [ ] Persist/refresh the app session appropriately; test logout and an expired session on phone and desktop.
- [ ] Keep account creation separate from permission to enable WhatsApp automation.

**Done when:** a new user can sign in, a returning user reaches the same account, and cancelled/failed login leaves no usable unauthorized session. Test a non-app-role user after the app's public access is configured. [Supabase's Facebook setup](https://supabase.com/docs/guides/auth/social-login/auth-facebook) documents the provider and email-permission configuration.

### AUTH-02 — Create one merchant account automatically and safely

**Owner:** Engineering. **Gate:** Internal. **Depends on:** AUTH-01 and SEC-01 design.

- [ ] Add an authenticated first-login provisioning operation that derives identity from the verified session.
- [ ] Create the merchant and owner membership in one database transaction, with uniqueness constraints that prevent concurrent duplicate creation.
- [ ] Repeated callbacks and browser retries return the existing merchant instead of another empty shop.
- [ ] Initialize the shop as setup-incomplete and the bot as disabled. Set explicit currency, timezone and safe negotiation defaults.
- [ ] Recover cleanly when Auth succeeds but shop creation fails; let the user resume provisioning.
- [ ] Refresh any claims needed by the session after membership creation. Do not require a client-selected merchant ID to grant access.

**Done when:** concurrent first-login requests produce exactly one shop/membership; an interrupted setup can be resumed; a forged merchant ID cannot attach the user to another shop.

### AUTH-03 — Handle existing accounts, recovery and identity changes

**Owner:** Engineering + Founder. **Gate:** Public. **Depends on:** AUTH-01/02, D14.

- [ ] Map existing invited/test owners to the new flow without abandoning their catalog or orders.
- [ ] Define secure account linking. Matching an email alone must not silently transfer shop ownership; use the identity provider's verified linking behavior and reauthentication as appropriate.
- [ ] Choose a verified recovery route for an owner who loses Facebook access. Define the evidence required for support-assisted recovery and audit the action.
- [ ] Keep WhatsApp disconnect, portal logout and permanent account deletion as separate actions with clear consequences.
- [ ] Test an owner changing profile/email, being disabled, losing a session and returning after a long absence.

**Done when:** an existing merchant retains the same shop and orders through the supported login/recovery process; deactivated owners cannot continue using an old session for merchant API access.

### AUTH-04 — Enforce the merchant lifecycle everywhere

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** AUTH-02, SEC-01.

- [ ] Define setup-incomplete, active, paused, suspended and deletion-pending behavior.
- [ ] Check merchant and owner status at API and messaging boundaries, including queued work.
- [ ] Distinguish a merchant's pause from a platform suspension and a broken Meta connection; show the actual reason.
- [ ] Audit ownership/status changes and prevent ordinary owners granting themselves platform privileges.
- [ ] Permit appropriate read/export/support access during a pause without allowing new automated sales.

**Done when:** disabling an account stops new bot actions even if a queued event or old session remains; other shops continue operating.

### AUTH-05 — Make shop setup resumable and complete

**Owner:** Engineering + Founder. **Gate:** Pilot. **Depends on:** AUTH-02, SALE-01/03/04, META-08.

- [ ] Save each step on the server and restore it on return or another device.
- [ ] Collect shop name, contact, language/tone, service areas, delivery fees, return policy, payment methods and business hours where relevant.
- [ ] Keep COD-only setup valid; require usable bank payment instructions only when bank transfer is offered.
- [ ] Provide a sample catalog, import template and progress checklist; remove unexplained technical fields from merchant screens.
- [ ] Surface validation failures next to the field; never silently overwrite completed setup with default/blank values.
- [ ] Let the merchant preview the buyer-facing shop information before activation.

**Done when:** an owner can leave halfway through setup, return on a phone and finish without an engineer editing data.

## Meta platform and WhatsApp tasks

### META-01 — Confirm the actual Meta app and business prerequisites

**Owner:** Founder + Engineering; approval is External. **Gate:** Internal configuration; required approvals before outside-merchant use.

- [ ] Record the owner business portfolio, app ID, verified domain, contact email, intended app use cases and current verification/review status.
- [ ] Ensure the founder controls the accounts and recovery methods; enable appropriate administrator account protection.
- [ ] Resolve inconsistent names/addresses across the website, legal documents and Meta submission.
- [ ] Complete the required Tech Provider/access-verification and business-verification steps shown for this app. Record each as pending/approved/action-needed, not one generic “Meta verified” flag.
- [ ] Confirm requested WhatsApp permissions for the chosen flow, including messaging/management and any additional permission that the current official configuration actually needs. Do not request unrelated Page/Instagram permissions.
- [ ] Confirm a supported Graph API version and an upgrade calendar rather than inheriting the existing default version indefinitely.

**Done when:** the account-specific prerequisite list is documented and required access is actually granted for the next testing/launch stage. No date of approval is promised. Meta's [partner overview](https://whatsappbusiness.com/partners/become-a-partner/) distinguishes Tech Provider onboarding from the wider partner tiers.

### META-02 — Implement the Connect WhatsApp flow

**Owner:** Engineering. **Gate:** Internal implementation; Pilot authorization. **Depends on:** AUTH-01/02, META-01, SEC-02.

- [ ] Configure Facebook Login for Business/Embedded Signup as required by the current app flow.
- [ ] Start an expiring, single-use connection attempt tied to the authenticated owner and shop.
- [ ] Validate browser messages against Meta's documented origin and payload format; handle closed windows, denied permissions, expired codes and repeated callbacks.
- [ ] Send the authorization code to the backend over HTTPS. Exchange it server-side; never expose the app secret or resulting business token in client storage, URLs or logs.
- [ ] Verify the returned grant and inspect the authorized assets server-side. Treat browser-reported WABA/phone IDs as hints until verified.
- [ ] Resume safe partial setup without reusing consumed codes or duplicating a number mapping.

**Done when:** a supported merchant can complete connection; another logged-in merchant cannot substitute IDs or claim the first merchant's authorization. [Meta's Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/collection/du6gzjv/embedded-signup) identifies this as the supported embedded business-onboarding mechanism; exact implementation must follow the current developer documentation.

### META-03 — Support phone-number eligibility honestly

**Owner:** Engineering + Founder. **Gate:** Pilot for cohort paths; Public for advertised paths. **Depends on:** META-01/02, D02/03.

- [ ] Ask whether the number is new, used in WhatsApp Business App, used in ordinary WhatsApp, or already connected to an API provider.
- [ ] Test the supported new-number path including ownership verification and registration requirements.
- [ ] Verify current coexistence availability/conditions for the chosen app, account and region before promising that the merchant can keep using their Business App.
- [ ] If coexistence is supported, test owner replies, duplicate events, app-originated message behavior, takeover and history limitations.
- [ ] For an existing provider/API number, document an explicit migration route and any downtime, PIN, template/history or billing impact.
- [ ] If a path is unsupported, explain alternatives before the merchant changes their existing setup. Never instruct them to delete a working account as a generic first step.
- [ ] Document recovery when a number is already linked to a different Sahulatcart shop; require ownership validation before reassignment.

**Done when:** every number type advertised at launch has a demonstrated route or a clear eligibility boundary. Unknown eligibility is shown as requiring review, not as a failed merchant action.

### META-04 — Finish connection on the backend

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** META-02/03/05, REL-01.

- [ ] Persist the validated merchant/WABA/phone-number relationship with uniqueness constraints.
- [ ] Subscribe the app to the relevant account webhook events and confirm message/status routing.
- [ ] Register the phone where required by the chosen flow; handle two-step verification/PIN securely and according to current documentation.
- [ ] Track incomplete billing, permissions, registration, display-name/account restrictions and token errors as distinct actionable states.
- [ ] Make each setup operation retryable without undoing an already working step.
- [ ] Perform a merchant-triggered test message round trip, not an unsolicited message to an arbitrary buyer.

**Done when:** an inbound test message maps to the right shop, the reply uses that shop's authorized number and the dashboard shows which prerequisites really passed.

### META-05 — Implement per-merchant credentials throughout the product

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** SEC-02 and META-02.

- [ ] Encrypt business tokens using authenticated encryption and a managed server-side key; record key version and rotation metadata.
- [ ] Store expiry/validity metadata when supplied by Meta, without assuming that “no expiry” means access can never be revoked.
- [ ] Add a server-only credential resolver scoped to the merchant and verified asset mapping.
- [ ] Use it for text/image/document sends, media retrieval, catalog operations, templates and connection management.
- [ ] Make a missing/invalid merchant credential stop that merchant's operation. Do not silently fall back to the platform token for another merchant.
- [ ] Test token rotation and invalidate cached credentials immediately when access is removed.

**Done when:** two unrelated merchant assets operate with independent authorization; swapping credentials or asset IDs fails; a revoked shop does not affect other shops.

### META-06 — Make Meta billing understandable

**Owner:** Founder + Engineering. **Gate:** Pilot. **Depends on:** META-01/04, BIZ-03, D10.

- [ ] Confirm the direct Tech Provider billing arrangement for this app and guide each merchant to satisfy their WABA payment prerequisites.
- [ ] Separate Sahulatcart's subscription fee from Meta messaging charges in onboarding, pricing and support material.
- [ ] Record payment/billing blocks and link to the relevant Meta resolution screen where available.
- [ ] Avoid promising that every message is paid or that every message is free. Maintain a dated cost model based on current Pakistan/category rates.

**Done when:** the pilot owner understands who bills them and a billing block cannot produce a false “ready” state. Only Solution Partners can extend a line of credit according to [Meta's partner page](https://whatsappbusiness.com/partners/become-a-partner/); use the [current pricing page](https://whatsappbusiness.com/products/platform-pricing/) for rates and charging rules.

### META-07 — Prepare App Review and production access

**Owner:** Joint; decision is External. **Gate:** Pilot/Public as required by the tested asset/access model. **Depends on:** working AUTH-01, META-02/04/05 and core sales demo.

- [ ] Build the actual requested capability before describing it to reviewers.
- [ ] Provide accessible reviewer instructions and a supported test setup; keep credentials out of source control and public videos.
- [ ] Record a concise demonstration of login, connecting assets, receiving/sending a message and the business use of each requested permission.
- [ ] Include template/account management demonstrations only for permissions/capabilities actually requested and implemented.
- [ ] Validate privacy, deletion, support and app-domain URLs from outside the founder's logged-in session.
- [ ] Track submission IDs, dates, reviewer feedback, permissions granted and required periodic reviews/attestations.
- [ ] Retest after moving to the public/live configuration with an eligible merchant who is not merely an app administrator or tester.

**Done when:** the permissions needed by the real launch flow are approved and an ordinary eligible merchant completes it. Business verification by itself does not satisfy this gate.

### META-08 — Enforce a truthful Go live gate

**Owner:** Engineering. **Gate:** Pilot. **Depends on:** AUTH-05, META-04/05/06 and SALE-01/03/04/08.

- [ ] Calculate readiness on the backend; never trust a browser flag declaring setup complete.
- [ ] Check active owner/shop, valid WhatsApp mapping/access, required account/billing prerequisites, webhook readiness, sellable catalog, delivery configuration and at least one valid payment method.
- [ ] Require an explicit merchant decision to enable the bot after a test round trip.
- [ ] Show completed checks and specific blockers with a next action. A timeout should show “checking” or “needs attention”, not success.
- [ ] Reevaluate essential connection conditions after activation and pause safely when they fail.
- [ ] Prevent direct API calls from bypassing readiness by setting botEnabled.

**Done when:** an unconnected shop cannot become “live” through either the UI or a crafted settings request; a ready shop can activate without engineering help.

### META-09 — Reconnect, disconnect and account-health lifecycle

**Owner:** Engineering. **Gate:** Pilot for revocation/stop; Public for full owner lifecycle. **Depends on:** META-04/05 and AUTH-04.

- [ ] Detect invalid tokens, missing permissions, disabled numbers, relevant account/quality events and persistent sending failures.
- [ ] Show when the connection last worked and a clear reconnect action; distinguish provider downtime from revoked authorization.
- [ ] Reauthorization replaces credentials safely without creating a new shop, number duplicate or losing orders.
- [ ] A disconnect stops new sends and pending jobs for that connection immediately; remove subscriptions/grants only as appropriate for the assets involved.
- [ ] Avoid disrupting another connected number/shop when a WABA or app subscription is shared.
- [ ] Explain merchant number ownership, data retention and how to leave the service; implement data deletion separately.

**Done when:** revoking permission, reconnecting and disconnecting have been tested end to end, including queued messages and cached tokens.

### META-10 — Templates, contact permission and messaging policy

**Owner:** Engineering + Founder. **Gate:** Pilot; complete delayed-update flow before Public. **Depends on:** META-05, SALE-11, REL-03.

Provider rule baseline: ordinary replies are limited to the 24-hour customer-service window; outside it, use approved templates. Automation needs a clear escalation route. Honor contact permission and opt-outs, provide accurate business identity and protect sensitive identifiers. These checks follow the [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).

- [ ] Apply one shared outbound policy check to bot replies, owner replies, retries and order/payment notifications.
- [ ] Define necessary order/payment update templates and submit them per merchant/WABA as required; track language, category and approval/paused/rejected state.
- [ ] Select the correct template when payment review occurs after the free-form reply window; fall back to a visible owner task if it cannot be sent.
- [ ] Record the required contact permissions and opt-out state; treat further marketing consent separately from ordinary order service.
- [ ] Review merchant payment-instruction and screenshot handling against the policy's sensitive-identifier restrictions. Do not collect buyer PINs, OTPs or unnecessary financial/identity details; use a suitable secure hosted instruction/evidence flow where the approved design requires it.
- [ ] Check permitted merchant categories and current business/solution terms, including the chosen merchant-specific AI use case.
- [ ] Do not let template approval, pricing exemptions or a successfully delivered API request bypass local policy checks.

**Done when:** a delayed payment decision reaches the buyer through an allowed, tested path or becomes an actionable owner notification; the system never silently pretends delivery succeeded.
