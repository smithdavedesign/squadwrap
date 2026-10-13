# squadwrap — build notes

## Plan

M4 of 4 (MVP run): payment and safety.
- The organizer can pay once per group ($12, Stripe Checkout) to take the watermark off every slide, and Stripe's webhook unlocks the group.
- A daily job deletes each group 30 days after it was made.
- Friends must tick an "I'm 18 or older" box before their answers are accepted.
- Because the app now takes money, it also gets privacy and terms pages and a footer on every page.

The plan was reviewed with gstack "Step 0: Scope Challenge", "1. Architecture review" and "3. Test review". The run is non-interactive, so each question has a recorded answer. The M1–M3 plans and reviews are kept at the end ("M3 record", "M2 record", "M1 record").

### Step 0 — Scope challenge

1. **What already solves a sub-problem?**
   - **[Layer 1]** `groups.unlocked_at` (M2) is the paid flag. Slides, the yearbook and the organizer page already read it (watermark, "preview" notes), so the webhook only has to set it. `UPDATE groups SET unlocked_at = now() WHERE id = $1 AND unlocked_at IS NULL` is one atomic statement: a replayed or concurrent delivery matches no row and changes nothing. M2's plan already named this statement.
   - **[Layer 1]** Stripe Checkout, the hosted page:
     - no card form and no PCI scope on our side;
     - receipts, refunds and disputes are handled in Stripe's dashboard;
     - the price goes inline (`price_data`), so no product has to be set up in the dashboard first.
   - **[Layer 2]** The official `stripe` SDK (23.0.0, zero dependencies, no install scripts).
     - `webhooks.constructEvent` checks the HMAC over the raw body with a timing-safe compare and a 5-minute timestamp tolerance, which is the replay protection.
     - `webhooks.generateTestHeaderString` signs test payloads, so the tests run the real verifier, not a mock.
     - Hand-rolling the HMAC would take about 25 lines. But the signature check is the payment's only security boundary, so we use the documented path.
   - **[Layer 1]** `ON DELETE CASCADE` (M1–M3): submissions (and the photos stored in them), awards and reports all go with their group. The cleanup job is a single `DELETE FROM groups WHERE (created_at AT TIME ZONE 'UTC')::date + 30 <= today (UTC)`. It deletes by UTC day so that the date people are shown is exactly the day it happens (changed in review from "older than 30 days at run time", which deleted up to a day after the date shown).
   - **[Layer 1]** Vercel Cron (`crons` in `vercel.json`): free on Hobby, at most once a day, and it sends `Authorization: Bearer $CRON_SECRET`.
   - **[Layer 1]** A `required` checkbox on the friend form for the browser; the server check is the real gate.
   - **[EUREKA] Delete the whole group, not only its submissions.** The roadmap says "submissions and photos". But a group with its answers gone is a dead link that still holds:
     - the group name;
     - the three keys;
     - the reports, with reporters' contact details, which M3 said must go too.

     Deleting the group row cascades to everything in one statement, and every link then answers 404, like a wrong key. The privacy promise becomes one sentence: everything is deleted 30 days after the group is made. The organizer page and the yearbook show the date.
   - **[EUREKA] Unlock from the signed event alone.** Stripe's guide fetches the session again to expand its line items. We sell one thing, and the signed event already carries `client_reference_id` (the group) and `payment_status`. So the webhook needs only the signing secret, not the API key, and makes no network call.
     - It still follows Stripe's rule: act on both `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and only when `payment_status` isn't `unpaid`. A delayed payment method (bank debit) completes first and pays later.
2. **Minimum change set:**
   - `POST /groups/:id/checkout` → `{ url }` of a Stripe Checkout Session ($12 USD, `client_reference_id` = group id), behind the organizer key;
   - `POST /webhooks/stripe`: verify, then unlock (idempotent);
   - `GET /cron/cleanup` + `vercel.json` cron: delete groups whose 30 days are up;
   - `adult: true` required on both submit endpoints (400 `adults_only`), and the checkbox on the friend form;
   - organizer page:
     - an "Unlock for $12" button once the awards exist;
     - "unlocking…" on the return from Checkout;
     - an "unlocked" note;
     - the deletion date;
   - yearbook: the deletion date;
   - `/privacy`, `/terms`, and a footer in the root layout linking them and the takedown route.

   **Not in M4 (deliberately):**
   - **Live mode.** Vercel Hobby forbids taking payments (its fair-use guidelines count "requesting or processing payment from visitors" as commercial use). M4 runs in Stripe **test mode**; going live is David's call (Vercel Pro, or a free host that allows commercial use). It's requested in `.provision`.
   - **Re-locking on a refund or dispute.** Refunds are made in the Stripe dashboard, and the operator can re-lock with one SQL statement (see "Handling reports and payments").
   - **Not built at all:**
     - a payments table: Stripe's dashboard is the ledger;
     - tax, coupons, other currencies and price experiments;
     - our own receipts: Stripe sends them once they're switched on in its dashboard.
   - **A general report form** for pages without a yearbook. The only page that shows other people's content is the yearbook, and it has its own report link. The footer's "Report a problem" leads to the terms' takedown section.
   - **Also left out:**
     - an organizer "delete now" button;
     - deletion reminders;
     - storing the 18+ confirmation (every stored submission had to send it);
     - an index on `groups.created_at` (a daily scan of a small table).
3. **Complexity check: triggered.**
   - New files (10):
     - 3 route handlers (checkout, webhook, cron);
     - 2 static pages (privacy, terms);
     - `lib/payments.ts` and `lib/cleanup.ts`;
     - `vercel.json`;
     - `scripts/screenshots.mjs`;
     - one test file per area.
   - Changed files: about 10 (submit validation, friend form, organizer page and its client buttons, yearbook, layout, CSS, test helpers, smoke script).
   - New services: Stripe, and Vercel Cron.

   **Decision:** proceed. Each route file is under 15 lines. The logic sits in two small modules, each testable without a server. Two cuts were already made: no payments table, and no general report form.
4. **Search check (WebSearch):**
   - [Stripe, "Fulfill orders"](https://docs.stripe.com/checkout/fulfillment): handle both events in one idempotent function and only fulfil when `payment_status` isn't `unpaid`.
   - Webhooks in the Next.js App Router:
     - verify against `await req.text()`, never a re-serialized `req.json()`;
     - no body-parser config is needed;
     - `constructEvent` needs Node's crypto, and our routes run on Node.
   - Vercel Cron on Hobby: at most once a day, fired anywhere within the scheduled hour. A sub-daily schedule fails the deploy. Vercel recommends a `CRON_SECRET` and refusing every request when it isn't set.
   - [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines): taking payments needs Pro, so we stay in test mode (above).
5. **TODOS:** there's no `TODOS.md`. Items from M3's "What's left" are folded in:
   - reports deleted after 30 days, through the group cascade;
   - the four points the privacy page must make;
   - a footer on every page.
6. **Completeness:** every new error path has a test, beyond the exit criteria:
   - checkout: 404 ×3, 409, 502 and 503;
   - webhook: 400 ×5 and 503, plus a 200 for each ignored event kind;
   - cron: 401 ×2 and 503;
   - adults-only: 400 ×4.
7. **Distribution:** none. It's the same web app; `vercel.json` only adds the cron.

### Architecture

```
organizer  /groups/:id  (awards exist, still locked)
  "Unlock for $12" ─▶ POST /groups/:id/checkout                     (organizer key)
       404 unknown id · 409 already_unlocked · 503 payments_not_configured · 502 payments_unavailable
       └▶ Stripe: checkout.sessions.create { mode: payment, $12 USD price_data, client_reference_id: group id,
                                             metadata.app: squadwrap, success_url: /groups/:id?paid=1, cancel_url: /groups/:id }
       ◀─ { url } ─▶ browser goes to checkout.stripe.com ─▶ pays ─▶ back on /groups/:id?paid=1
  /groups/:id?paid=1 while unlocked_at IS NULL: "Payment received, unlocking…" (router.refresh every 2 s, up to 1 min)

Stripe ─▶ POST /webhooks/stripe   raw body + Stripe-Signature
   STRIPE_WEBHOOK_SECRET unset ─▶ 503 (Stripe keeps retrying for days; nothing written)
   constructEvent(raw, signature, secret) throws ─▶ 400 bad_signature, nothing written
        (missing header · another secret · tampered body · timestamp older than 5 min)
   type not completed / async_payment_succeeded ─▶ 200 ignored
   payment_status = unpaid ─▶ 200 awaiting_payment (the async event unlocks later)
   no client_reference_id ─▶ 200 ignored
   UPDATE groups SET unlocked_at = now() WHERE id = $ref AND unlocked_at IS NULL RETURNING id
        1 row ─▶ 200 unlocked · 0 rows ─▶ 200 already_unlocked (replay) or unknown_group (deleted, or another app's session)

Vercel Cron, daily 04:17 UTC ─▶ GET /cron/cleanup   Authorization: Bearer $CRON_SECRET
   CRON_SECRET unset ─▶ 503 · header missing or wrong ─▶ 401 (SHA-256 digests + timingSafeEqual)
   DELETE FROM groups WHERE (created_at AT TIME ZONE 'UTC')::date + 30 <= (now() AT TIME ZONE 'UTC')::date
        (the deletion day shown on the organizer page and the yearbook is that same UTC day)
        ─▶ cascades: submissions (+ photos), awards, reports ─▶ 200 { deletedGroups }

friend  /join/:token  "I'm 18 or older" (required) ─▶ body.adult must be exactly true,
        else 400 adults_only, checked before anything else (no lookup, no photo work)
```

**Data model:** no schema change. `groups.created_at` (M1) is the deletion clock, and `groups.unlocked_at` (M2) is the paid flag.

**Security:**
- **Checkout** needs the organizer key, like generate. The organizer id reaches Stripe, a payment processor, as `client_reference_id` and inside the return URLs; the privacy page says so.
- **Webhook:** the signature is the only trust.
  - Nothing is read from the body before it's verified.
  - The amount isn't re-checked, because only our server, holding the secret key, can create a session.
  - The event id is logged; the group id (the organizer key) never is.
- **Cron:** the secret is compared by SHA-256 digest with `timingSafeEqual`. Even a stolen secret only runs the deletion that's due anyway.

**Production failure scenarios:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| webhook | Stripe retries a delivery, or delivers two events for one payment | `WHERE unlocked_at IS NULL`: the 2nd is a no-op, still 200 (tested) |
| webhook | bank debit: completed now, money later | `unpaid` → wait; `async_payment_succeeded` unlocks (tested) |
| webhook | signing secret not set yet on the deploy | 503, so Stripe retries for up to 3 days and the unlock lands once it's set (tested) |
| webhook | wrong secret (CLI vs dashboard, test vs live) | 400 on every delivery; it shows in Stripe's webhook log. BUILD.md says which secret goes where |
| webhook | a shared Stripe account sends other apps' sessions, or a cheaper Payment Link opened with `?client_reference_id=<group id>` | only sessions tagged `metadata.app = squadwrap` (a URL can't set metadata) with `mode = payment` count, everything else → 200 `ignored`; an unknown group → 200 `unknown_group`; nothing changes (tested; tag check added in review) |
| return page | the organizer is back before the webhook lands | "unlocking…" and a refresh every 2 s; after a minute, "refresh in a moment" |
| checkout | a second click, a second tab, or Back from Stripe and click again | the same idempotency key (a hash of the group and request) makes Stripe return the same session for 24 h, so there's no second payment; 409 once unlocked (tested; added in review) |
| checkout | `STRIPE_SECRET_KEY` set but the webhook secret missing: payments that can never unlock | checkout counts as configured only with both secrets, else 503 (tested; added in review) |
| checkout | an unlock bought hours before the group is deleted | no unlock sold in a group's last 2 days: 409 `deleting_soon`, and the page says why (tested; added in review) |
| webhook | a paid session unlocks nothing new (paid twice, group gone) | logged as a **warning** with the event id, for a refund |
| checkout | Stripe down or slow | 502 `payments_unavailable` with "try again"; SDK timeout 20 s, 1 retry |
| cleanup | cron didn't fire one day | the next run catches up: the condition is "deletion day has come", not "is today" |
| cleanup | a group expires during a generate | the generate's transaction finds its group row gone → 404, nothing stored (was a 500 from a foreign-key error; fixed in review, tested) |
| cleanup | CRON_SECRET missing | 503, and nothing deleted; visible in Vercel's cron log. BUILD.md's deploy checklist covers it |
| adults-only | an old cached friend page without the box | 400 with "tick the box" message; a reload brings the new form |

### Test plan

Vitest with the same harness as M1–M3: real route handlers, PGlite, stub model.
- Webhooks are signed at runtime with the SDK's own `generateTestHeaderString` and a secret built from a prefix plus filler.
- The Stripe adapter is tested against a local HTTP server standing in for `api.stripe.com`, so no network and no real key are involved.

| Codepath | Test |
|---|---|
| **EC1** a signed `checkout.session.completed` → 200 and the group is unlocked (slides lose the watermark); replaying it (same and re-signed) → 200, `unlocked_at` unchanged, other groups untouched | `m4-exit-criteria.test.ts` |
| **EC2** bad signature (another secret) → 400, still locked | `m4-exit-criteria.test.ts` |
| **EC3** cleanup job: 31-day-old group's submissions and photos (and awards, reports, links) gone; 29-day-old group untouched | `m4-exit-criteria.test.ts` |
| **EC4** submitting without the adults-only checkbox → 400 (both endpoints), nothing stored | `m4-exit-criteria.test.ts` |
| webhook: tampered body, missing header, stale timestamp → 400; no secret → 503; `unpaid` then `async_payment_succeeded`; `no_payment_required`; other event types; no `client_reference_id`; unknown group → 200 and nothing changed; *(review)* sessions without the squadwrap tag or not `mode=payment` → ignored; a paid no-op logged as a warning; two deliveries at once unlock once | `payments.test.ts` |
| checkout: `{url}` from the payments client with the right group, price and return URLs; 404 (unknown id, invite or yearbook token as id), 409 unlocked, 503 not configured, 502 provider error (no organizer key in the log); nothing unlocked by starting one; *(review)* 409 `deleting_soon` in the last 2 days | `payments.test.ts` |
| Stripe adapter: the real SDK posts `mode=payment`, 1200 USD, `client_reference_id`, metadata and URLs to a local fake API; *(review)* the same idempotency key for repeat checkouts of a group; refuses a missing or non-https URL; configured only with both secrets | `payments.test.ts` |
| organizer page: unlock button (locked + awards), none before awards, "unlocked" note, "unlocking…" on `?paid=1`, deletion date | `payments.test.ts` |
| cleanup: 401 (no or wrong header), 503 (no secret), catch-up and a second run that deletes nothing; *(review)* the UTC deletion day, which is the date shown, at its boundaries; a generate whose group is deleted mid-call → 404; `vercel.json` schedules `/cron/cleanup` once a day | `cleanup.test.ts` |
| *(review)* `PGLITE_DIR` honoured locally, ignored on Vercel | `db.test.ts` |
| adults-only: `false`, `"true"`, `1` → 400; checked before photo decoding; friend form has the required checkbox | `m4-exit-criteria.test.ts`, `safety.test.ts` |
| privacy page names the AI provider, photos, Google Fonts, reports, Stripe and the 30 days; terms name 18+, $12, refunds, the takedown route; the layout footer links both on every page; the yearbook shows the deletion date | `safety.test.ts` |

Not automated:
- The redirect to Stripe and the payment itself, which need a Stripe test account. The deploy checklist covers them with Stripe's test card.
- **Is the UI real?** `npm run screenshots` drives the production build in Chromium.
- **Does the webhook work over real HTTP?** `npm run smoke` signs a real webhook against `next dev`.

## What the product does now (M1–M4)

1. **Organizer** opens `/` and creates a group: name, year, and optionally how many friends. They land on `/groups/<id>`, their private organizer page (bookmark it: the URL is the key).
2. The organizer page shows an **invite link** (`/join/<token>`) with a Copy button to paste into any group chat.
3. **Friends** open the invite link (no account, no app) and enter a display name. They answer 5 prompts and can add a photo, which is shrunk in the browser before upload. A name already used in the group (ignoring case and spacing) gets a friendly 409.
   - **New in M4:** they must tick **"I'm 18 or older"**. Without it the server refuses the answers (400 `adults_only`) before reading anything else. The form also says that answers and photos are deleted after 30 days.
4. **Who's missing, and a nudge (M3).** The organizer page lists who has answered, with a dashed "?" for every friend still missing when a member count was given. A ready-made **nudge message** with a Copy button sits below.
5. Once **3 or more** have answered, "Make the awards" asks the AI for one award per friend. "Remake" replaces them all, and a failed AI reply leaves the old ones in place.
6. Every award becomes a **1080×1920 story slide** (M2) with the friend's photo or initial. The Download buttons point at the yearbook's slide URLs, so a shared slide link never carries the organizer key.
7. **The yearbook (M3)**, at `/y/<token>`, has its own read-only key. It shows every award with the friend's photo, a Download slide button per award, a "Make your own group's wrap" link and a **"Report it or ask for a takedown"** link. It's kept out of search engines.
8. **Reports (M3):** `/y/<token>/report` stores what's wrong and, optionally, how to reach the reporter, at most 20 per group in any hour (see "Handling reports and payments").
9. **New in M4: the $12 unlock.** Once the awards exist, the organizer page offers **"Unlock for $12"**.
   - The button opens **Stripe Checkout** (Stripe's hosted page; no card data touches the app).
   - After paying, the organizer lands back on their page. It says "Payment received. Unlocking your slides…" and refreshes every 2 s until Stripe's webhook has arrived, then says **"Unlocked"**.
   - From then on, every slide of the group, remakes included, comes without the watermark: no overlay, no PNG flag, no header. The yearbook's "preview" note disappears too.
   - Repeat clicks reopen the same Checkout page, so nobody pays twice. No unlock is offered in a group's last 2 days; the page says why.
   - Payments run in **Stripe test mode** until going live is decided (see Deploy).
10. **New in M4: deleted after 30 days.** A daily job (Vercel Cron → `GET /cron/cleanup`, early each UTC day) deletes every group on the UTC day 30 days after it was made, along with all its answers, photos, awards and reports. Every link to it then answers 404.
    - The organizer page and the yearbook show the date, e.g. "deleted on December 28, 2026".
    - The home page, the friend form and the privacy page say so too.
11. **New in M4: privacy and terms pages, and a footer on every page.** The footer links **Privacy**, **Terms** and **Report a problem** (the terms' takedown section) and says squadwrap is for adults.
    - The terms cover: 18+, what may be posted, what the $12 buys and for how long, refunds within 14 days, takedowns, deletion.
    - The privacy page covers what's stored and who else sees it: the AI provider (Gemini), Google Fonts for non-Latin slide text, Stripe, and the hosting. It ends with the 30-day deletion.

**HTTP API** (JSON unless noted; errors are `{ "error": { "code", "message" } }`):

| Method & path | Success | Errors |
|---|---|---|
| `POST /groups` `{name, year?, memberCount?}` | 201 `{id, name, year, memberCount, inviteToken, inviteUrl, yearbookToken, yearbookUrl, dashboardUrl}` | 400 `invalid_input` / `invalid_json` |
| `POST /groups/:id/submissions` `{displayName, answers:{cancels, lore, mainCharacter, threeWords, secretAward}, photo?, adult: true}` | 201 `{displayName}` | **M4:** 400 `adults_only` unless `adult` is exactly `true` (checked first); 400 `invalid_input` (incl. bad photo), 404 `group_not_found`, 409 `duplicate_name` / `group_full` (20), 503 `photos_unavailable` |
| `POST /join/:token/submissions` (same body; used by the friend page) | 201 `{displayName}` | same as above |
| `POST /groups/:id/generate` | 200 `{awards:[{displayName, title, citation}]}` | 404 (also when the group is deleted mid-generate), 422 `not_enough_submissions`, 502 `model_bad_output` / `model_unavailable`, 503 `model_not_configured` |
| `GET /groups/:id/awards` | 200 `{group:{id, name, year}, awards:[…]}` | 404 |
| `GET /groups/:id/awards/:name.png` (organizer's slide URL; name URL-encoded, case-insensitive) | 200 `image/png` 1080×1920; locked: `x-squadwrap-watermark: preview` + PNG tEXt flag | 404 `group_not_found` / `award_not_found` / `not_found` |
| `GET /groups/:id/pending` | 200 `{memberCount, submitted, pending, answered:[names in order], inviteUrl, nudge}` | 404 `group_not_found` |
| `GET /y/:token` (HTML page) | 200: the yearbook | 404 |
| `GET /y/:token/:name.png` / `.jpg` | 200: the slide (as above) / the stored photo (`private, no-cache`, `ETag`, `nosniff`) | 404 |
| `GET /y/:token/report` (HTML) · `POST /y/:token/reports` `{reason, contact?}` | 200 form · 201 `{received: true}` | 400, 404, 429 `too_many_reports` |
| **M4:** `POST /groups/:id/checkout` | 200 `{url}`: a Stripe Checkout page (the same one again for repeat clicks within 24 h); send the browser there | 404 `group_not_found` (also invite/yearbook token as id), 409 `already_unlocked` / `deleting_soon` (last 2 days), 502 `payments_unavailable`, 503 `payments_not_configured` (needs both Stripe secrets) |
| **M4:** `POST /webhooks/stripe` (Stripe only: raw body + `Stripe-Signature`) | 200 `{received: true, outcome}` for every verified event; `outcome` is `unlocked`, `already_unlocked` (replay), `awaiting_payment` (delayed method), `unknown_group`, or `ignored` (another event type, or a session not tagged `metadata.app = squadwrap` with `mode = payment`) | 400 `bad_signature` (missing, wrong secret, tampered, older than 5 min), 503 `webhook_not_configured` |
| **M4:** `GET /cron/cleanup` (Vercel Cron: `Authorization: Bearer $CRON_SECRET`) | 200 `{deletedGroups}` | 401 `unauthorized`, 503 `cron_not_configured` |
| **M4:** `GET /privacy`, `GET /terms` (static HTML) | 200 | — |

- Every response under `/groups/*`, `/join/*` and `/y/*` carries `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` (`next.config.ts`).
- Three keys, each 16 random bytes (base64url):
  - **group id:** the organizer's; it also opens the checkout;
  - **invite token:** lets friends submit;
  - **yearbook token:** lets friends read.
- A key used in another's place gets a 404.

## Run it locally ($0)

```bash
npm install          # works with install scripts disabled (sharp ships prebuilt binaries; stripe and playwright-core are plain JS)
npm test             # 287 tests pass (+1 opt-in preview, skipped), ~20 s, no network, no database server, no Stripe
npm run dev          # http://localhost:3000
npm run smoke        # optional: next dev + a stub model, walks M1–M4 over real HTTP (40 checks)
npm run screenshots  # optional: production build driven in Chromium → docs/screenshots/*.png (needs CHROMIUM_PATH)
```

- **Database:** with no `DATABASE_URL`, `npm run dev` uses an on-disk PGlite (real Postgres in WASM) at `.data/pglite`, which is gitignored. Delete that folder to reset. Set `DATABASE_URL` to use any Postgres instead. Older databases are upgraded in place on the first request. M4 changes no schema.
- **AI model** (only needed for "Make the awards"; without one, generate answers 503). Pick one:
  - Free and local: install [Ollama](https://ollama.com), run `ollama pull llama3.2`, then start with `LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.2 npm run dev`.
  - Gemini free tier: put `GOOGLE_API_KEY` in `.env.local` (gitignored). Use your own key; never commit it.
  - Any OpenAI-compatible endpoint, such as a LiteLLM free-model alias: set `LLM_BASE_URL`, `LLM_MODEL` and, if needed, `LLM_API_KEY`.
- **Payments (M4), free in Stripe test mode.** Without `STRIPE_SECRET_KEY` the unlock button says payments aren't set up (503), and nothing else changes. To try the whole flow locally:
  1. Put your Stripe **test-mode** secret key in `.env.local` as `STRIPE_SECRET_KEY`.
  2. Run the free Stripe CLI: `stripe listen --forward-to localhost:3000/webhooks/stripe`. It prints a signing secret; put it in `.env.local` as `STRIPE_WEBHOOK_SECRET`.
  3. Pay with one of Stripe's documented test cards.

  Keep both values out of git (`.env*.local` is ignored).
- **Cleanup job (M4)** locally: start the dev server with a `CRON_SECRET` of your choosing in `.env.local`, then call `curl -H "Authorization: Bearer <that value>" localhost:3000/cron/cleanup`. It answers `{"deletedGroups": n}` and deletes local groups whose 30 days are up.
- **`npm run smoke`** runs `scripts/smoke-dev.mjs`. It starts `next dev` on port 3197 with a stub model on port 4197, plus a webhook secret and a cron secret made up for that run. Then it:
  - creates a group, gets a 400 for answers without the 18+ box, submits three answers (one with a photo, one named `Jo/Jo 100%`) and makes the awards;
  - checks the pending API, yearbook, slides, photos, reports, organizer page and headers;
  - **M4:**
    - checkout without Stripe → 503;
    - a webhook signed with the wrong secret → 400, and the slide is still watermarked;
    - a correctly signed one → `unlocked`, and the slide is clean;
    - its replay → `already_unlocked`;
    - the cleanup job → 401 without the secret, 200 with it;
    - the legal pages and the footer.

  It leaves a "Smoke Flat" group in the local database. Its cleanup check deletes any local group whose 30 days are up, as the job would.
- **`npm run screenshots`** runs `scripts/screenshots.mjs`:
  - `next build`, then `next start` on a throwaway PGlite (`PGLITE_DIR`) with a stub model;
  - drives Chromium from `CHROMIUM_PATH` (never downloads one), at 1280×800 and as an iPhone 13;
  - saves 6 PNGs to `docs/screenshots/` and stops everything.

  The scenes:
  - the home page;
  - a friend filling in the form, adding a photo, ticking 18+ and sending;
  - the organizer clicking "Make the awards", with the awards and the $12 unlock.

  The people are samples, the avatars are drawn, and the link fields are masked. It isn't part of `npm test`.
- **See the slide design without a server:** `SLIDE_PREVIEW_DIR=.data/preview npx vitest run tests/zz-preview.test.ts`.
- Other scripts: `npm run typecheck` (tsc 7) and `npm run build` (production build).
- `AGENTS.md` is written by `next dev` 16.4 itself (a note for coding agents). It is kept so the tree stays clean after a dev run.

**Environment variables** (names only; values come from the credential broker).

| Name | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | production | Neon Postgres. Prefer the pooled (`-pooler`) string. Tables are created and upgraded on first request. |
| `GOOGLE_API_KEY` | production (or the LLM_* trio) | Gemini free tier through its OpenAI-compatible endpoint |
| `LLM_MODEL` | optional | Overrides the model (default `gemini-flash-latest`). Required when `LLM_BASE_URL` is set. |
| `LLM_BASE_URL`, `LLM_API_KEY` | optional | Any OpenAI-compatible endpoint. Takes precedence over `GOOGLE_API_KEY`. |
| **M4:** `STRIPE_SECRET_KEY` | production, for payments | Creates Checkout Sessions. A **test-mode** key until going live is decided. Checkout answers 503 unless this **and** `STRIPE_WEBHOOK_SECRET` are set. |
| **M4:** `STRIPE_WEBHOOK_SECRET` | production, for payments | The signing secret of the `/webhooks/stripe` endpoint. Without it the webhook answers 503 and Stripe keeps retrying. |
| **M4:** `CRON_SECRET` | production | Vercel Cron sends it as `Authorization: Bearer …`. Without it the cleanup job refuses to run (503). |
| **M4:** `PGLITE_DIR` | local only | Lets a local production build (`next start`) use PGlite in that directory; used by `npm run screenshots`. Never set it on Vercel. |
| `VERCEL_PROJECT_PRODUCTION_URL` | set by Vercel | The slide credit uses the production domain |

## Deploy on a free tier

Vercel Hobby, Neon Free, the Gemini free tier, Vercel Cron (daily) and Stripe test mode all cost $0:
1. The pipeline runs `.provision` through the credential broker:
   - the Neon database (`DATABASE_URL`);
   - a Gemini key restricted to the Generative Language API (`GOOGLE_API_KEY`);
   - the Vercel project `squadwrap`, with both values as env vars.

   M4 adds three `request` lines for David: Stripe test-mode keys and the webhook endpoint, a `CRON_SECRET`, and the commercial-host decision. See Infrastructure.
2. Import the repo into that Vercel project. The framework is detected as Next.js, and the build command is `npm run build`.
   - `next.config.ts` `headers()` become Vercel routing rules.
   - **`vercel.json`** (new in M4) only holds the cron: `/cron/cleanup` at 04:17 UTC daily. Hobby allows one run a day and may fire it any time within that hour.
3. **Stripe, in test mode** (the dashboard's test-mode toggle):
   - Developers → Webhooks → add an endpoint `https://<production host>/webhooks/stripe` with the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   - Its signing secret goes into Vercel (Production) as `STRIPE_WEBHOOK_SECRET`, and the test-mode secret key as `STRIPE_SECRET_KEY`.
   - Each endpoint has its own secret: the CLI's, the test dashboard's and the live one's all differ, and a mismatch gives a 400 on every delivery.
   - Fill in the public business details and a **support email**, and turn on email receipts. The terms send refund requests to the receipt's support address.
4. Add `CRON_SECRET` (at least 32 random characters) in Vercel (Production), then **redeploy** so all new env vars apply. Under Settings → Cron Jobs, "Run" the job once; the log should show `Cleanup: deleted 0 group(s)…`.
5. **Smoke test by hand** on the deployment:
   - **M1–M3:**
     - create → join ×3 (one with a photo, one named like `Jo/Jo 100%`) → make awards → Download slide;
     - the yearbook link in a private window;
     - `curl -sI https://<host>/y/<token>` shows `x-robots-tag`;
     - a wrong token gives a 404.
   - **M4:**
     - the friend form won't send without the 18+ box;
     - "Unlock for $12" → Stripe's test page → pay with a test card → back on the organizer page, which says "Unlocked" within seconds;
     - a downloaded slide has no PREVIEW;
     - Stripe dashboard → the event → "Resend": the response is `already_unlocked`;
     - `/privacy` and `/terms` load, and the footer is on every page.
   - If photo uploads answer 503 `photos_unavailable`, sharp didn't load on Vercel. Pinning `sharp` to `0.34.4` is the known fix (see M2 review).

**Taking real money is not free on Vercel.** Vercel's fair-use guidelines count "requesting or processing payment from visitors" as commercial use, which Hobby doesn't allow. So M4 ships in **Stripe test mode**, where no real money moves. Going live is David's call, requested in `.provision`. Either:
- move to Vercel Pro; or
- move to a free host that allows commercial use (not evaluated here).

Then complete Stripe's live activation, and swap in the live secret key and a live-mode webhook endpoint's secret.

Storage: photos are about 50–120 KB each in Postgres. With the 30-day deletion, Neon Free's 0.5 GB only has to hold one month of groups.

## Handling reports and payments (operator)

Reports land in the `reports` table, and **nobody is notified yet** (see What's left). Check them in Neon's SQL editor (free) or with `psql`:

```sql
-- Reports, newest first, with the yearbook to look at (prefix with the site's host)
SELECT r.id, r.created_at, r.reason, r.contact, g.name, '/y/' || g.yearbook_token AS yearbook
  FROM reports r JOIN groups g ON g.id = r.group_id
 ORDER BY r.created_at DESC;

-- Take down one friend's photo (the slide falls back to their initial)
UPDATE submissions SET photo = NULL WHERE group_id = '<group id>' AND display_name = '<name as shown>';
-- Remove one friend entirely (their award goes with them)
DELETE FROM submissions WHERE group_id = '<group id>' AND display_name = '<name as shown>';
-- Remove a whole group now, without waiting for the 30 days (submissions, photos, awards and reports go with it)
DELETE FROM groups WHERE id = '<group id>';
-- Cut off a leaked yearbook link (the organizer page then shows the new one)
UPDATE groups SET yearbook_token = replace(gen_random_uuid()::text, '-', '') WHERE id = '<group id>';
-- Done with a report
DELETE FROM reports WHERE id = <report id>;

-- Payments (M4). A Checkout Session's client_reference_id in Stripe is the group id.
SELECT name, year, created_at, unlocked_at FROM groups WHERE id = '<client_reference_id>';
-- After refunding in the Stripe dashboard (Payments → the payment → Refund), lock the group again if wanted
UPDATE groups SET unlocked_at = NULL WHERE id = '<group id>';
-- Unlock by hand (e.g. a webhook that kept failing); the same statement the webhook runs
UPDATE groups SET unlocked_at = now() WHERE id = '<group id>' AND unlocked_at IS NULL;
-- What the next cleanup run will delete (deletion day, in UTC, has come)
SELECT id, name, created_at FROM groups WHERE (created_at AT TIME ZONE 'UTC')::date + 30 <= (now() AT TIME ZONE 'UTC')::date;
```

The cleanup job can also be run by hand: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<host>/cron/cleanup`. Deleting only what is due anyway, it is safe to repeat.

## Exit criteria

All M1–M4 exit criteria pass (`npm test`).

| Exit criterion (ROADMAP.md) | Test | Status |
|---|---|---|
| M1: POST /groups "Flat 4B" → id + invite URL containing a token | `m1-exit-criteria.test.ts` EC1 | ✅ pass |
| M1: 3 different display names → 201 each; 4th reusing a name → 409 | EC2 | ✅ pass |
| M1: generate with 2 submissions → 422; with 3 → 200 and exactly 3 awards, one per name, non-empty title and citation | EC3 (two tests) | ✅ pass |
| M1: model stubbed to return malformed JSON → 502, no partial awards stored | EC4 (two tests) | ✅ pass |
| M1: GET /groups/:id/awards for unknown id → 404 | EC5 | ✅ pass |
| M2: GET /groups/:id/awards/:name.png returns image/png with width 1080 and height 1920 | `m2-exit-criteria.test.ts` EC1 | ✅ pass |
| M2: a submission with a photo yields a PNG larger than the same award without a photo | EC2 | ✅ pass |
| M2: PNGs for a locked group carry the watermark flag; unlocked groups do not | EC3 (two tests) | ✅ pass |
| M3: GET /y/:token lists all awards for the group; a wrong token returns 404 | `m3-exit-criteria.test.ts` EC1 (two tests) | ✅ pass |
| M3: GET /groups/:id/pending with member count 5 and 3 submissions returns a pending count of 2 | EC2 | ✅ pass |
| M3: The yearbook page includes a report link and a noindex meta tag | EC3 (two tests) | ✅ pass |
| **M4:** A completed checkout.session webhook sets the group to unlocked; replaying it is idempotent | `m4-exit-criteria.test.ts` EC1 (two tests: unlocked, and slides lose the watermark header and PNG flag; the same delivery and a re-signed retry → `already_unlocked`, `unlocked_at` unchanged, another group still locked) | ✅ pass |
| **M4:** A webhook with a bad signature returns 400 and does not unlock | EC2 (signed with another secret → 400 `bad_signature`, still locked, slide still watermarked) | ✅ pass |
| **M4:** Running the cleanup job deletes submissions and photos of a group created 31 days ago and leaves a 29-day-old group untouched | EC3 (through `GET /cron/cleanup` with the cron secret; the old group's submissions, photos, awards, reports and links are gone; the 29-day-old group's counts are identical) | ✅ pass |
| **M4:** Submitting without the adults-only checkbox returns 400 | EC4 (both submit endpoints → 400 `adults_only`, nothing stored; the same body with the box → 201) | ✅ pass |

How the M4 criteria are tested:
- Webhooks are signed at runtime by the Stripe SDK's own `generateTestHeaderString`, with a secret assembled from a prefix and a filler, and are verified by the real `constructEvent`.
- Ages are set by moving `groups.created_at` back with `make_interval`.
- The page criteria use `getPage()` (see M3), which now also passes `searchParams`.

Verified beyond the tests:
- `npm run typecheck` is clean, and `npm run build` succeeds: 20 routes, with `/privacy` and `/terms` prerendered as static.
- **`npm run smoke` against a real `next dev` server: 40/40 checks pass.** That includes the signed webhook through Next's real request handling (the raw body survives), the replay, a forged signature, cron auth and adults-only.
- **`npm run screenshots`** (production build, Chromium, desktop + iPhone 13):
  - a friend fills the form, adds a photo, ticks 18+ and sends;
  - the organizer clicks "Make the awards", and five awards appear with the $12 unlock;
  - all 6 PNGs were checked by eye.

**Not verified here:**
- **Stripe itself.** There's no account here. The adapter is tested against a local fake of Stripe's API that records the request the real SDK sends.
- **The browser leg of payment:** the redirect to `checkout.stripe.com`, and the "unlocking…" refresh after paying.
- **Hosted services:** Vercel Cron firing, Vercel, Neon and a real model.

## Infrastructure

Requested in `.provision` (run by the pipeline after the build; no values are in the repo):
- `neon db squadwrap` → `DATABASE_URL` (Postgres, free tier)
- `gcp key squadwrap generativelanguage.googleapis.com` → `GOOGLE_API_KEY` (Gemini free tier, restricted to that API)
- `vercel project squadwrap`, plus `vercel env squadwrap DATABASE_URL` and `vercel env squadwrap GOOGLE_API_KEY`
- **M4, as `request` lines for David** (there's no broker command for these):
  - **Stripe test mode.** Asks for:
    - `STRIPE_SECRET_KEY` (test-mode secret key);
    - a webhook endpoint at `https://<production host>/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`;
    - that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`.

    Both go into the Vercel env (Production). Stripe test mode costs nothing.
  - **`CRON_SECRET`:** 32+ random characters in the Vercel env, so only Vercel Cron can run the deletion job.
  - **The commercial-use hosting decision**, needed before live payments (see Deploy).

  `vercel env` lines for these three values were left out on purpose: they can only be pushed once David has stored them.

## What's left

- **Before charging real money (David's decisions, outside the code):**
  - a host that allows commercial use;
  - Stripe live activation: business details, support email, receipts;
  - live keys and a live webhook secret.
  - Price and refund policy are code/terms decisions made here: $12 and 14 days. Change `UNLOCK_PRICE` in `lib/prompts.ts` and the terms if needed.
- **M4 follow-ups, not planned:**
  - re-locking a group automatically on a refund or dispute (`charge.refunded` / `charge.dispute.created`); today it's one SQL statement;
  - a general report form for pages without a yearbook (today: the footer leads to the terms' takedown section);
  - keeping paid groups longer than 30 days (today no unlock is sold in a group's last 2 days, and the date is shown next to the button);
  - an organizer "delete now" button, and deletion reminders;
  - storing the 18+ confirmation;
  - an index on `groups.created_at` if groups ever number in the tens of thousands.
- **Carried over, not planned:**
  - letting the organizer rotate or revoke the yearbook link (today the operator does it with SQL);
  - report notifications;
  - organizer-side removal of a friend or photo;
  - editing the member count, or a roster of names;
  - rate limiting, and caching rendered slides;
  - recovering a lost organizer link;
  - award quality with a real model;
  - drawing emoji on slides, and bundled CJK/Arabic fonts;
  - a Web Share button.

## Review

This is a self-review of the M4 change set against gstack's "Review Categories" and "Fix-First Heuristic".
- Everything is still untracked: `git status` shows only new files since the idea commit, plus the README. So `git diff` covers just the README's new Screenshots section, and the review read the M4 files directly.
- An independent read-only reviewer (a subagent given the same checklist and file list) reviewed it too; its findings are folded in below.

**Pass 1 (CRITICAL): no open findings.**
- **SQL:** every new statement takes `$n` parameters: the checkout lookup, the unlock `UPDATE`, the group check, and `DELETE … make_interval(days => $1)`. Nothing new is interpolated.
- **Races and status transitions.** The one new transition, locked → unlocked, is a single `UPDATE … WHERE unlocked_at IS NULL RETURNING id`.
  - Concurrent or replayed deliveries re-check the condition after the row lock, so exactly one reports `unlocked`. This is tested, with two deliveries at once.
  - Cleanup is one statement. Submissions and generate already lock the group row, so they serialize against it.
- **Webhook trust:**
  - Nothing is read before `constructEvent` has verified the HMAC over the raw text body, with a timing-safe compare and a 5-minute tolerance.
  - Four forgeries are tested: another secret, a tampered body, no header, a stale signature.
  - Only `client_reference_id` and `payment_status` are used from the event.
- **Secrets in logs:**
  - The webhook logs only the event id, type and outcome (tested: the group id never appears).
  - A failed checkout logs only the error's name, code and status, never its message, which can echo URLs that hold the organizer key (tested).
- **XSS:** no `dangerouslySetInnerHTML`. The only new navigation target is the Checkout URL, and the adapter now refuses one that isn't `https://` (fixed in review, tested).
- **Enum completeness:** new error codes:

  | Code | Status |
  |---|---|
  | `adults_only` | 400 |
  | `already_unlocked` | 409 |
  | `deleting_soon` | 409 |
  | `payments_not_configured` | 503 |
  | `payments_unavailable` | 502 |
  | `bad_signature` | 400 |
  | `webhook_not_configured` | 503 |
  | `unauthorized` | 401 |
  | `cron_not_configured` | 503 |

  - The client forms (the friend form, `UnlockButton`) read only `error.message`; nothing in `app/` switches on a code (checked).
  - The webhook `outcome` strings are read only by tests and the smoke script.
- **Adults-only:** both submit paths go through `assertAdult` before anything else: the invite path before its token lookup, the organizer path before parsing (tested on both, with unknown keys and broken photos).
- **Shell injection / LLM output:** not applicable. M4 adds no shell call and no new model output.

**Found and fixed during review.** Every fix has a test; where the fix changed behaviour, the test was written and seen failing first. Final run: **287 pass, 1 skipped** (the opt-in preview); typecheck clean, `next build` OK, `npm run smoke` 40/40, `npm run screenshots` OK.
1. [P2] (7/10, reviewer) **Double payment.** Every click created a new Checkout Session, and a 409 only came once a webhook had landed. A second tab, or Back from Stripe and another click, meant a second $12 for a no-op unlock.
   - The adapter now sends an **idempotency key**: a SHA-256 of the group and every request parameter.
   - Stripe returns the same session for 24 h, and a Checkout Session itself expires after 24 h.
   - Test: the real SDK against the fake API sends the same key twice for one group, and another for another group. The key never spells out the organizer key.
2. [P2] (6/10, reviewer) **The webhook unlocked any signed session that named a group.** On a shared Stripe account, a cheaper Payment Link opened with `?client_reference_id=<group id>` would have unlocked it.
   - Now only sessions tagged `metadata.app = squadwrap` (which a URL can't set) and in `mode = payment` count; anything else → 200 `ignored`.
   - The amount isn't re-checked: a tagged session can only come from our server, which sets the price.
   - Test: 5 foreign session shapes, none unlocks.
3. [P2] (9/10, self) **A generate racing the cleanup job answered 500.** If the daily job deleted a group while its awards were being written, the insert hit a foreign-key error. The transaction now checks its row lock and answers 404 `group_not_found`, with nothing stored. Test: the stub model runs the cleanup mid-call.
4. [P2] (7/10, reviewer) **Payments that could never unlock.** Checkout counted as configured with only `STRIPE_SECRET_KEY`. Without the webhook secret, every payment would be taken and never verified. Both are now required, else 503 (tested).
   - Also: a paid session that unlocks nothing new (`already_unlocked`, `unknown_group`) is logged as a **warning** with the event id, so the operator can refund it (tested).
5. [P2] (7/10, reviewer) **An unlock could be sold hours before deletion.** None is sold in a group's last 2 days now: 409 `deleting_soon`; the organizer page explains instead of offering the button, and the terms say so (tested).
6. [P3] (8/10, reviewer) **The deletion date shown was up to a day early.** The job deleted "older than 30 days" at 04:17 UTC, so a group made at 10:00 lived until the next day's run, past the date printed on its pages.
   - The job now deletes by **UTC day**: the day shown is the day it runs.
   - The earlier boundary test ("30 days + 1 h deleted, 29 days 23 h kept") encoded the old rule. It was replaced by a deterministic day-boundary test: groups made yesterday's, today's and tomorrow's deletion day, at midnight and at 23:59. That test also checks that the shown date equals the run day.
   - EC3 is unchanged and still passes.
7. [P3] (6/10, reviewer) **`PGLITE_DIR` on a Vercel deployment** would have run production on a throwaway per-instance database. It's now ignored wherever `VERCEL` is set, so a missing `DATABASE_URL` fails loudly there (tested).
8. [P3] (6/10, reviewer) **The privacy page named only Gemini** and only names and answers. It now says "the configured AI provider" (Gemini unless the operator set another), and that the group's name and year are sent too (tested).
9. [P3] (6/10, self) **The Checkout URL went to `window.location` unchecked.** The adapter now insists on `https://` (test: `null` and `javascript:` refused).
10. [P3] (7/10, self) **Back from Stripe with the Back button, the unlock button stayed stuck** on "Opening the payment page…" (back/forward cache). It's reset on `pageshow`. Not unit-testable.
11. [P3] (8/10, self) **The privacy page didn't link the terms page itself.** Caught by the test written first.
12. Found while building:
    - The sandbox Chromium resolves `system-ui` to a monospace font. The font stack now names each platform's UI font first, with the generic `system-ui` last.
    - A local production build had no database without `DATABASE_URL`, hence `PGLITE_DIR` (local only, tested).
    - The reviewer's stale-note finding (BUILD.md still said "500" for a generate during deletion) is fixed above.

**Pass 2 (INFORMATIONAL), left as is:**
- [P2] (8/10; decided, David's call) **Live payments need a commercial-use host.** Vercel Hobby forbids them. M4 runs in Stripe test mode; see Deploy and `.provision`.
- [P3] (6/10) **The organizer key reaches Stripe** as `client_reference_id` and in the return URLs. Stripe is a payment processor, and the privacy page says so. Avoiding it would need our own session table.
- [P3] (5/10) **Refunds and disputes don't re-lock automatically.** It's one SQL statement in "Handling reports and payments".
- [P3] (5/10, reviewer) **The organizer never ticks 18+ themselves.** Friends do, on every submission; the organizer usually answers too, and the home page and footer say adults only. A checkbox on group creation was left out (the roadmap asks for the friend form's).
- [P3] (5/10, reviewer) **Refund contact.** The terms send refund requests to the support address on the Stripe receipt, and the app shows no email of its own. David must set that address and switch on receipts in Stripe before going live (in the deploy checklist).
- [P3] (5/10, reviewer) **The concurrent-delivery test runs on PGlite's single connection.** It catches a check-then-set regression, but not true parallelism. The unlock is one `UPDATE … WHERE unlocked_at IS NULL`, which Postgres re-checks after the row lock.
- [P3] (4/10) **Stripe replays a saved response for a reused key.** A repeat click within 24 h after paying (before the webhook landed) gets the same, already completed session, never a second charge.
- [P3] (4/10) **Cleanup is one unbatched `DELETE`.** That's fine while 30 days of groups fit in Neon Free's 0.5 GB.
- **Not verified here:**
  - Stripe itself (the adapter is tested against a local fake of its API);
  - the redirect to Checkout and the "unlocking…" refresh after a real payment;
  - Vercel Cron, Vercel, Neon and a real model.
- **Carried over from M1–M3:**
  - concurrency is tested only on PGlite;
  - there's no rate limiting;
  - keys appear in request logs;
  - the model alias moves;
  - non-Latin slide text goes to Google Fonts (now on the privacy page).

## M3 record

### M3 plan

M3 of 4 (MVP run): the yearbook page and nudges. Friends get a private yearbook page with every award, photo and slide, plus a report link. The organizer sees how many friends are still missing and gets a nudge message to copy into the chat.
The plan was reviewed with gstack "Step 0: Scope Challenge", "1. Architecture review" and "3. Test review". The run is non-interactive, so each question has a recorded answer.

#### Step 0 — Scope challenge

1. **What already solves a sub-problem?**
   - **[Layer 1]** M2's `getSlide` and `renderSlide` already turn an award into a slide. The yearbook serves the same slides under its own link. Both slide routes now share one `slideResponse` helper, so the watermark and cache rules stay identical.
   - **[Layer 1]** `groups.member_count` has been stored since M1, so pending = member count − submissions. No new data is needed.
   - **[Layer 1]** Next's Metadata API: `robots: { index: false, follow: false }` produces `<meta name="robots" content="noindex, nofollow">`, as on the existing pages. The test renders the tag with Next's own resolver (`resolveRobots`, `createMetadataElements`).
   - **[Layer 1]** `next.config` `headers()` adds `X-Robots-Tag` and `Referrer-Policy` to every private-link path, with no middleware.
   - **[Layer 1]** In Postgres, `ADD COLUMN … NOT NULL UNIQUE DEFAULT <volatile>` evaluates the default once per existing row. A database from before M3 therefore gets a distinct yearbook token for every group in one statement, with no backfill code. `gen_random_uuid()` has been in core Postgres since 13, so it works on PGlite and Neon.
   - **[Layer 1]** M1's `CopyInvite` becomes `CopyLink`, which copies the yearbook link too. The nudge box uses the same clipboard pattern.
   - **[EUREKA]** Next *streams* metadata on dynamic pages. A normal browser can get the robots tag in the body, after the content. Next only places it in `<head>` for the "HTML-limited" bots it recognizes by User-Agent ([Next.js streaming guide](https://nextjs.org/docs/app/guides/streaming)). So the meta tag (the exit criterion) gets a header-level twin: `X-Robots-Tag: noindex, nofollow` on `/y/*`, `/groups/*` and `/join/*`.
     - The header also covers slide PNGs and photos, which have no `<head>`.
     - It's checked against a running dev server (see Exit criteria).
   - **[EUREKA]** The yearbook gets **its own token** instead of reusing the invite token. Each token grants one thing:
     - The invite link lets people *write*: anyone holding it can submit answers.
     - The yearbook link lets people *read* every award and photo.
     - A yearbook link is the one more likely to travel beyond the chat, and with separate tokens it can't let strangers add answers that would show up in the next remake. Likewise, an invite link forwarded early never shows anyone's photo.
     - This follows the W3C TAG's [Good Practices for Capability URLs](https://w3ctag.github.io/capability-urls/): unguessable, kept out of Referer headers and search indexes, and no third-party scripts.
2. **Minimum change set:**
   - schema: one column (`groups.yearbook_token`) and one table (`reports`);
   - `GET /groups/:id/pending` returns the pending count, who answered, and the nudge text;
   - `/y/:token`: the yearbook page;
   - `/y/:token/:name.png` and `/y/:token/:name.jpg`: the slide and the stored photo, served by **one** route;
   - `/y/:token/report`: a report form, which posts to `POST /y/:token/reports`;
   - the organizer page gets:
     - "still to answer" placeholders and a nudge box with a Copy button;
     - the yearbook link with a Copy button;
     - download buttons that point at yearbook URLs. This closes M2's review finding "slide URLs contain the organizer key".

   **Not in M3 (deliberately):**
   - **A roster of friend names.** The app only knows a count. The organizer sees who has answered, so they can tell who hasn't. Editing the member count after creation is also left out.
   - **Revoking or rotating the yearbook link.** The TAG recommends it. Until it's built, the operator can rotate a token with one SQL statement (see "Handling reports").
   - **Report notifications and automatic takedown.** Reports land in the `reports` table, where the operator reads them with the SQL in this file. A site-wide report footer and the privacy and terms pages come with M4.
   - **Slide thumbnails on the yearbook.** Each render is about 0.5 s of CPU, and a yearbook has up to 20 slides. The page shows the stored ≤720 px photo instead and renders a slide only when it's downloaded.
   - **Also left out:** sending nudges for the organizer (SMS or email), reminders, Web Share, and payment or unlock (M4).
3. **Complexity check: triggered.** M3 adds 7 files:
   - 5 Next.js route/page files (file-system routing takes one file per URL);
   - 1 client form;
   - `lib/nudge.ts`.

   It also modifies 8 files and adds no new classes or services. **Decision:** proceed. The logic lives in `lib/squad.ts` and `lib/nudge.ts`, and each route file is 10–30 lines. Two cuts were already made: photos share the slide route, and reports get an endpoint but no admin UI.
4. **Search check (WebSearch):**
   - Dynamic App Router pages stream metadata. A `notFound()` thrown before any Suspense boundary is still a real 404; after streaming starts it becomes a 200 with a noindex tag.
     - The yearbook has no `loading.tsx` and no Suspense above the lookup, so a wrong token gets a real 404. That's checked against the dev server.
     - Header-level `X-Robots-Tag` is the recommended guarantee for pages that must never be indexed (see EUREKA above).
   - For capability URLs, the W3C TAG and OWASP ask for ≥128-bit CSPRNG tokens (16 random bytes, as M1 already uses), HTTPS, no Referer leaks, no third-party scripts, keeping them out of indexes, and revocation (deferred, see above). The fallback tokens of pre-M3 groups are UUIDv4s: 122 random bits from `gen_random_uuid()`, which uses a strong random source. Those only exist where a database predates M3.
5. **TODOS:** there's no `TODOS.md`. Two items from M2's "What's left" are folded in: slides under a friend capability, and download buttons that don't carry the organizer key.
6. **Completeness:** every new error path has a test, beyond the exit criteria:
   - 404 for each wrong or crossed key;
   - 400 for report input;
   - 429 for the report cap;
   - 404 for a missing photo or award.
7. **Distribution:** none. It's the same web app.

#### Architecture

```
organizer  /groups/:id                                    (organizer key)
  ├─ "Who answered (3 of 5)": Ana Ben Cat ? ?    getDashboard → pending = max(0, memberCount − answered), or null if no count
  ├─ nudge box + Copy        nudgeText(group, answered, memberCount, origin + /join/:invite)   lib/nudge.ts (client-safe)
  ├─ GET /groups/:id/pending → { memberCount, submitted, pending, answered[], inviteUrl, nudge }
  └─ "Share the yearbook" + Copy → /y/:yearbook ; "Download slide" → /y/:yearbook/<name>.png

friends    /y/:yearbook                                   (read-only key; noindex meta + X-Robots-Tag header)
  getYearbook(token) → { name, year, unlocked, awards[{ displayName, title, citation, hasPhoto }] }  (no id, no invite token)
  ├─ <img src=/y/:t/<name>.jpg>  → stored JPEG (normalized in M2: ≤720 px, no EXIF); private, no-cache + ETag (304), nosniff
  ├─ Download slide → /y/:t/<name>.png → slide of the group found by yearbook token → renderSlide (M2), same watermark
  └─ "Report or ask for a takedown" → /y/:t/report (form) → POST /y/:t/reports { reason, contact? }
         → tx: lock group row, < 20 in the last hour → INSERT reports → 201   (400 bad input, 404 wrong token, 429 cap)
```

**Capabilities.** Each key opens only its own doors, and each "no" is a test:

| Key | Who has it | Grants |
|---|---|---|
| group id | the organizer | dashboard, generate, awards, pending, organizer slide URLs (M2) |
| invite token | the group chat | the friend form and submitting answers |
| yearbook token | the group, once the awards exist | awards, photos, slides, report form |

**Data model** (`migrate` adds what's missing, as in M2):
- `groups.yearbook_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '')`.
  - New groups get 16 random bytes (base64url) from the app, like the other keys.
  - The default fills the groups that existed before M3, and any group inserted without a token (an M2 instance still running during the rollout).
- `reports (id, group_id → groups ON DELETE CASCADE, reason, contact, created_at, UNIQUE (group_id, id))`. Reports go when their group goes.
  - The inline `UNIQUE (group_id, id)` exists for its index, which serves the cap count and cascading deletes. It's created with the table, so a cold start runs no `CREATE INDEX` (lesson from M2's review: that statement takes a SHARE lock every time). This was added in review.

**Production failure scenarios:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| yearbook link | posted outside the group | noindex meta + `X-Robots-Tag`, so it isn't indexed; read-only, so no answers can be injected; the report form lets the operator take it down or rotate it |
| yearbook link | a pre-M3 group has no token | the migration fills one per row; tested on an M1-shaped database |
| yearbook | opened before the awards exist | 200, "not ready yet"; no 404 for a link the organizer shared early |
| yearbook | 20 friends with photos | ≤720 px JPEGs (50–120 KB); repeat views are 304s (ETag); slides render only when downloaded |
| photo | taken down while browsers already have it | `no-cache` + ETag: every view revalidates, so it's gone at once (changed in review from `max-age=3600`) |
| yearbook | a friend's name has `/`, `%` or `#` | every link goes through `encodeURIComponent` (tested with such names) |
| yearbook slide | a stored photo can't be drawn | M2 fallback: re-rendered without the photo |
| report | one person floods the form | 20 reports per group per rolling hour (exact: counted under the group row lock), then 429. It's a window, not a lifetime total, so a flood can't block a real takedown request for more than an hour (changed in review from 50 per group, ever) |
| report | nobody reads the reports | known gap: "Handling reports" has the SQL; notification is listed under What's left |
| pending | member count missing, or lower than the number who answered | `pending` is null (count unknown) or floored at 0; the nudge works without a count and is null when nobody is missing |
| nudge | 20 long names | at most 6 names, then "and N others" |
| migrate | cold start on a current schema | no `ALTER`, no new `CREATE INDEX` (existing tests still pass) |

#### Test plan

Vitest, with M1/M2's harness: real route handlers in process, PGlite, and a stubbed model. **Pages are rendered too.** `getPage(path)` in `tests/helpers.ts` calls the real page component the way Next does:
- `notFound()` → 404, read with Next's own `isHTTPAccessFallbackError`;
- otherwise the element tree is rendered to HTML with `react-dom/server`;
- the page's `metadata` becomes `<head>` tags through Next's own `resolveRobots` + `createMetadataElements`.

| Codepath | Test |
|---|---|
| **EC1** `GET /y/:token` lists every award (names, titles, citations); a wrong token → 404 | `m3-exit-criteria.test.ts` |
| **EC2** `GET /groups/:id/pending` with member count 5 and 3 submissions → pending 2 | `m3-exit-criteria.test.ts` |
| **EC3** the yearbook page has a report link (it opens a working form) and a noindex meta tag | `m3-exit-criteria.test.ts` |
| yearbook: not-ready state; 4 awards after a remake; no organizer id or invite token in the HTML or the loader; organizer id or invite token used as a yearbook token → 404; preview note only while locked; "make yours" link; photo `<img>` only for friends with a photo; odd names encoded | `yearbook.test.ts` |
| `/y/:t/:name.png`: 1080×1920 PNG with the same watermark rules as M2; `/y/:t/:name.jpg`: the stored JPEG, `nosniff`, private; 404 for wrong token, organizer id as token, unknown name, no photo, other extensions | `yearbook.test.ts` |
| report: 201 and stored; 400 for missing/blank/too-long reason, too-long contact, non-string fields; 404 for wrong token; 429 after 20 in an hour, and accepted again once they're older; report page 200 with noindex, 404 for wrong token | `yearbook.test.ts` |
| the yearbook token used as an invite token or organizer id (form, submit ×2, page, generate, awards, slide, pending) → 404, nothing added; photo ETag → 304, and 404 at once after a takedown | `yearbook.test.ts` |
| pending API: 404 unknown id, invite or yearbook token as id; null pending without a member count; floored at 0; answered names in order; invite URL and nudge in the body | `yearbook.test.ts` |
| `pendingCount`, `nameList`, `nudgeText` (0 answered, 1 to go, N to go, unknown count, everyone in → null, >6 names) | `nudge.test.ts` |
| dashboard: pending placeholders and nudge text; download links on `/y/…` (never the organizer id); yearbook link section once the awards exist; `getDashboard().pending` and `.yearbookToken` | `yearbook.test.ts` |
| `next.config` headers: `X-Robots-Tag` and `Referrer-Policy` on `/y/*`, `/groups/*`, `/join/*` | `yearbook.test.ts` |
| migration: an M1-shaped database gets a distinct yearbook token per group; a fresh group's token is base64url and distinct from its other keys | `db.test.ts`, `yearbook.test.ts` |

Not automated: the Copy buttons (clipboard) and the look of the pages. There's no browser in the sandbox. A dev-server smoke run with `curl` checks real status codes, the robots tag in the HTML and the headers.

### M3 review

This is a self-review of the M3 change set against gstack's "Review Categories" and "Fix-First Heuristic". An independent read-only reviewer (a subagent given the same checklist) reviewed it too. Everything is still untracked (`git status` shows only new files since the idea commit, so `git diff` is empty), and both reviews read the M3 files directly.

**Pass 1 (CRITICAL): no open findings, from either review.**
- **SQL:** every new statement takes `$n` parameters: the yearbook lookups, the yearbook query, the report count and insert. The only interpolated SQL is still `migrate`'s `ALTER` (table, column and definition come from a constant list) and M1's placeholder list.
- **Races:** reports are counted under the group row's `FOR UPDATE`, so the cap is exact. Under READ COMMITTED the count sees a fresh snapshot after the lock is granted.
  - The yearbook token has a `UNIQUE` constraint. A collision between two 128-bit random tokens would surface as a 500, not a silent duplicate, and is negligible.
- **Status transitions:** none new. `unlocked_at` is only read.
- **XSS:**
  - There's no `dangerouslySetInnerHTML`. React escapes names, titles and citations.
  - Every `href`/`src` is built with `encodeURIComponent` under `/y/`. Names with `/ % # ?` are tested end to end, and a `/`-and-`%` name also went through a real dev server.
- **LLM trust boundary:** award text is only ever rendered as text or drawn on slides, never used as a URL or fetched.
- **Capabilities:** each of the three keys opens only its own routes, and every crossing is tested. The yearbook HTML and its loader never contain the group id or the invite token. The only client prop on `/y/*` is the yearbook token, which is already in the URL.
- **Shell injection:** not applicable.
- **Enum completeness:** the new codes (`photo_not_found`, `too_many_reports`, `not_found`) are read only for their `message` by the report form. Nothing in `app/` switches on `code` (checked).
- **Migration:**
  - On a pre-M3 database, the `ALTER` with the volatile default runs once: an exclusive lock and a rewrite of `groups`.
  - Once the schema is current, a cold start runs no `ALTER` and no `CREATE INDEX` (existing test).
  - `CREATE TABLE IF NOT EXISTS reports` takes no lock when the table exists.

**Found and fixed during review.** Each fix got a test, written together with the fix. Final run: **236 pass, 1 skipped (the opt-in preview)**, typecheck clean, `next build` OK, `npm run smoke` 26/26.
1. [P2] (7/10, reviewer) **Takedown channel could be blocked for good.** The cap was 50 reports per group, ever. One member could post 50 junk reports, and every later real takedown request would get a 429. It's now 20 per group per **rolling hour**, with the message "try again in an hour". Two tests: the cap, and acceptance again once the flood is older than an hour.
2. [P2] (8/10, reviewer) **The most important "no" wasn't tested:** the yearbook token used as an invite token or an organizer id. A test now covers the friend form, both submit routes, the organizer page, generate, awards, the organizer slide and pending: all 404, nothing added. The code was already correct.
3. [P3] (6/10, reviewer) **A taken-down photo lingered.** Photos were cached for an hour, so browsers that had a photo kept showing it after a takedown. Now: `private, no-cache` + `ETag`. Repeat views are 304s, and the photo returns 404 the moment it's removed (tested with the takedown SQL from "Handling reports").
4. [P3] (6/10, reviewer) **A nudge test could pass vacuously.** It now asserts that the nudge box itself is absent. A new test covers the nudge without a member count.
5. [P3] (6/10, reviewer) **A slide's link opens the whole yearbook.** That's better than M2, where it carried the organizer key, but it's still worth saying. The "post the saved image, not its link" hint is back on the organizer page and now also on the yearbook.
6. [P3] (5/10, reviewer) **`reports.group_id` had no index.** An inline `UNIQUE (group_id, id)` now gives one at table creation, with no cold-start `CREATE INDEX` (tested via `pg_indexes`).
7. [P3] Stale comments:
   - `newSecret` now mentions the yearbook token.
   - `slidePath` is kept: it builds the URL of the still-served M2 organizer route, whose encoding is tested. The app's links use `yearbookFilePath`.
   - The `yearbook_token` default also fills any insert without a token. The comment and the plan now say so.
8. Found while building:
   - Next 16's `connection()` throws outside a request, so page tests stub that one function.
   - Next streams the metadata of dynamic pages, hence the `X-Robots-Tag` header next to the meta tag.

**Pass 2 (INFORMATIONAL), left as is:**
- [P3] (7/10, reviewer; **false positive, no change**) Possible duplicate React keys between friend names and the "?" placeholders. They are two separate arrays inside the `<ul>`, and React scopes keys per array, so a friend named "0" can't collide with placeholder 0.
- [P3] (6/10, reviewer; deferred) **Slide renders are open to anyone with a yearbook link.** Each render is ~0.5–1 s of CPU with no cache, and a script looping over 20 names could eat into Hobby's CPU allowance. The fix is an ETag on (award, photo, lock state) or rate limiting. It's carried with M1's "no rate limiting" item.
- [P3] (6/10, reviewer; decided) **Reports are stored as one line** (`cleanLine`), like every other text field. They read fine in the SQL editor.
- [P3] (4/10, reviewer) **The first `ALTER` after a deploy has no `lock_timeout`.** It runs once per database and rewrites a small `groups` table. That's acceptable at MVP scale.
- [P3] (4/10, reviewer) **The nudge's invite link is relative until hydration**, as with M1's invite box. The Copy button runs after hydration, so what gets copied is absolute.
- [P3] (4/10, reviewer) **EC3's `<head>` check in `npm test` comes from the page's `metadata`,** through Next's own resolver and renderer. The real HTML (meta tag inside `<head>`) is checked by `npm run smoke`, which needs a dev server and isn't part of `npm test`.
- [P3] **The test harness imports three `next/dist` internals:** `resolveRobots`, `createMetadataElements` and `http-access-fallback`. A Next upgrade can move them, and the tests would then fail loudly.
- [P3] **The "pending friends" view is a count plus placeholders, not names.** There's no roster, by design (see Plan).
- [P3] **The organizer can't revoke a yearbook link** (W3C TAG advice). Only the operator can, with SQL.
- **Not verified here:** Vercel, Neon, a real model, and the Copy buttons in a real browser.
- **Carried over from M1/M2:**
  - concurrency is tested only on PGlite;
  - there's no rate limiting;
  - keys appear in request logs (organizer id, and now invite and yearbook tokens);
  - the model alias moves;
  - non-Latin slide text goes to Google Fonts.

## M2 record

### M2 plan

M2 of 4 (MVP run): story slides. Each award becomes a 1080x1920 PNG with the friend's photo, a watermark while the group is locked, and a "make yours" credit. The organizer page gets a download button per award.
Reviewed with gstack "Step 0: Scope Challenge", "1. Architecture review" and "3. Test review". The run is non-interactive, so each question has a recorded answer. M1's plan and review are kept at the end ("M1 record").

#### Step 0 — Scope challenge

1. **What already solves a sub-problem?**
   - **[Layer 1]** `next/og` `ImageResponse` ships with Next.js: satori lays out JSX/flexbox and resvg rasterizes it, with the Geist font bundled. It renders PNGs with no browser and no new dependency.
   - **[Layer 1]** sharp 0.35.5 was already installed as Next's optional image dependency, with prebuilt binaries and no install scripts. It's now a direct dependency, used to decode, check and re-encode uploaded photos.
   - **[Layer 1]** `node:zlib` `crc32` (Node ≥ 22.2) signs the PNG text chunk, so no PNG library is needed.
   - **[Layer 1]** Postgres `BYTEA` holds photos inside the M1 submission insert. It reuses M1's transaction, the duplicate-name 409 and `ON DELETE CASCADE`, so M4's 30-day deletion removes photos for free. There's no blob store to provision.
   - **[EUREKA]** `next/og` fetches every emoji from jsDelivr *while rendering*, and a failed fetch rejects the whole image. That happens after the headers were sent if you stream it. AI titles and display names will contain emoji, and `ImageResponse` doesn't let you replace its loader. So slide text drops pictographs, and a slide never depends on a CDN. Two tests prove it: one blocks the network and still renders; a guard shows `next/og` really does call out without the stripping.
   - **[EUREKA]** The "watermark flag" is a PNG `tEXt` chunk (`squadwrap:watermark` = `preview`), so it travels with the downloaded file. The response also gets an `x-squadwrap-watermark` header, and locked slides get a visible "PREVIEW" overlay.
2. **Minimum change set:**
   - two columns: `groups.unlocked_at` and `submissions.photo`;
   - an optional `photo` (data URL) on both submit endpoints, normalized on the server;
   - one route, `GET /groups/:id/awards/:name.png`;
   - a photo picker on the friend form and a download link per award.

   **Not in M2 (deliberately):**
   - Payment and unlocking go to M4. M4's webhook will set `unlocked_at`; tests set it directly.
   - An HD-versus-preview resolution difference: EC1 asks for 1080x1920 everywhere, so the paid difference is the watermark.
   - Friend-facing slide access goes to M3, with the yearbook, served under a friend capability, never the organizer id.
   - Not added: slide thumbnails on the dashboard (each render costs ~0.3–1 s of CPU, so slides render only when downloaded), stored or cached PNGs, a Web Share button, drawing emoji, bundled non-Latin fonts, editing or removing a photo after submitting, and Playwright.
   - Photo moderation is covered by M4's report/takedown link.
3. **Complexity check: triggered.** M2 touches 9 existing source files plus 2 new lib modules (`lib/photo.ts`, `lib/slide.tsx`), 1 route and 1 error class (`PhotoError`). **Decision:** proceed. Most edits are 5–30 lines. Keeping photo handling and rendering out of `lib/squad.ts` keeps each one unit-testable.
4. **Search check (WebSearch):**
   - `next/og` emoji and fonts are fetched at render time, and a thrown fetch fails the render ([burnaboystats#169](https://github.com/paulemmanuelng/burnaboystats/pull/169), [nuxt og-image#97](https://github.com/nuxt-modules/og-image/issues/97), [Vercel: emoji in OG images](https://vercel.com/kb/guide/using-emoji-in-image)). That led to stripping emoji (above).
   - sharp 0.35.x with Turbopack on Vercel: one report of `ERR_DLOPEN_FAILED: libvips-cpp.so` at runtime (Next 16.2 + pnpm), fixed for them by going back to 0.34.4 ([sharp#4567](https://github.com/lovell/sharp/issues/4567), [vercel#14001](https://github.com/vercel/vercel/issues/14001)).
     - Our local build trace does include `libvips-cpp.so`, but an x64 Vercel deploy can't be verified here.
     - **Decision:** sharp is loaded lazily. If it fails, only photo uploads fail (503 `photos_unavailable`); everything else keeps working.
     - `next/og` itself falls back to resvg-wasm when sharp can't be imported (it wraps `import('sharp')` in try/catch).
   - Footgun found by a test: satori rejects `justifyContent: space-evenly`.
5. **TODOS:** there's no `TODOS.md`. Deferred work is listed under "What's left".
6. **Completeness:** every new error path (400 photo, 404 ×5, 503 photos) has a test, not just the three exit criteria.
7. **Distribution:** none. It's the same web app, and no new artifact type.

#### Architecture

```
friend browser  /join/:token
  photo picked → <img> decode (EXIF-upright) → canvas ≤720 px → JPEG data URL (~100 KB)
  POST /join/:token/submissions  {displayName, answers, photo?}
        │
        ▼
 lib/squad.ts addSubmission
   1. validate text ........................................... 400
   2. decodePhotoField: ≤3 MB, data-URL + base64 shape ......... 400   (lib/photo.ts)
   3. before any image work: group exists? (404), room left and
      name free? (409 group_full / duplicate_name)
   4. normalizePhoto: JPEG/PNG/WebP magic only → header ≤12 MP
      → sharp (loaded lazily): auto-orient, ≤720 px, flatten on
        white, JPEG q82, all metadata (EXIF/GPS) dropped .. 400 / 503
   5. M1 transaction: lock group, same checks again, INSERT … photo BYTEA (unique index → 409)

 organizer browser  /groups/:id  →  "Download slide" = <a download href="/groups/:id/awards/<name>.png">
 GET /groups/:id/awards/:name.png  (app/groups/[id]/awards/[file]/route.ts)
   → must end in .png ............................................. 404
   → getSlide: group by id (404), award by name_key (404, case/space-insensitive)
   → renderSlide (lib/slide.tsx): slideText strips emoji → satori tree → next/og → PNG 1080x1920
        photo can't be drawn → render again without it (logged)
   → locked (unlocked_at IS NULL): "PREVIEW" overlay + tEXt squadwrap:watermark=preview + x-squadwrap-watermark header
   → cache-control: private, no-store
```

**Data model.** `migrate` adds each new column only when `information_schema` says it's missing, so M1 databases upgrade in place. Once the schema is current, a cold start runs no `ALTER TABLE` and takes no exclusive lock (both tested).
- `groups.unlocked_at TIMESTAMPTZ NULL`: NULL means locked. M4's webhook should set it with `WHERE unlocked_at IS NULL`, which makes replays idempotent.
- `submissions.photo BYTEA NULL`: the normalized JPEG, usually 50–120 KB. It's deleted with the submission.

**Slide layout:** the group name and "2026 wrapped", the photo in a gold ring (or the friend's initial), the name, "takes home", the title, the citation, and "Make yours at <host>". The host is the project's production domain on Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, a Vercel system variable), otherwise the request host.
- The credit sits 200 px above the bottom edge, clear of story-app UI, and only moves lower when the text needs the room.
- Font sizes step down, and the photo shrinks, for long texts. At the longest allowed lengths, the credit stays on the slide (tested).

**Security:**
- Slides live under the organizer's capability (the group id). The invite token used as an id gets a 404 (tested). Friends get no slide URL in M2.
- Uploaded bytes reach a decoder only if they start with JPEG, PNG or WebP magic bytes. SVG (which can reference other files), GIF, TIFF and PDF are refused.
- The header-declared size is checked before any pixel is decoded (decompression bombs). sharp's `limitInputPixels` is a second guard.
- Stored photos carry no EXIF or GPS. Raw uploads are never served back, only drawn into slides.
- Satori turns text into vector paths, so there's no HTML/SVG injection from names or AI text. No URL from a user or the model is ever fetched.
- The one remaining outbound request: for non-Latin scripts, `next/og` downloads a Noto font subset from fonts.googleapis.com, and the request contains those characters. It's bounded by `maxDuration = 30`; see the Review.
- `Cache-Control: private, no-store`: the URL is the organizer's key and the image may contain a friend's photo.

**Production failure scenarios:**

| Codepath | Realistic failure | Handled by |
|---|---|---|
| photo upload | 5–12 MB phone photo | the browser shrinks it to a ≤720 px JPEG first; the server caps uploads at 3 MB (Vercel's body limit is 4.5 MB) → 400 with a message |
| photo upload | a format the browser can't decode | the form says "could not be read"; the server accepts only JPEG/PNG/WebP |
| photo upload | decompression bomb (tiny file, huge header) | header ≤ 12 MP checked before decoding → 400 |
| photo upload | photos posted to a full group, a taken name or a made-up id | 404/409 decided before any image is decoded |
| photo upload | sharp's native binary fails to load on the deploy | lazy load → 503 `photos_unavailable` for photo uploads only; the friend can resend without the photo |
| slide render | emoji in a name or AI title, CDN down | emoji stripped before rendering; no CDN call |
| slide render | stored photo can't be drawn | re-rendered without the photo, warning logged |
| slide render | non-Latin text, Google Fonts slow or down | `next/og` catches font errors (glyphs left blank); a hang is cut off at `maxDuration = 30` |
| slide render | very long title or citation | smaller type and photo; credit still on the slide |
| slide render | made on a preview deploy | credit uses the production domain, not the preview host |
| slides vs awards | organizer remakes the awards | slides render from the current awards on every request; nothing cached goes stale |
| migrate | M1 database without the new columns | columns added when missing |
| migrate | cold start while a generate holds the group lock | no `ALTER TABLE` once the schema is current, so no exclusive lock and no lock cycle |

#### Test plan

Vitest, same harness as M1: real route handlers in-process, PGlite, stubbed model. Test photos are generated at runtime with sharp (Gaussian noise compresses about as badly as a real photo). PNGs are checked with a real decoder (libvips/libpng via sharp), and EC1 also reads the IHDR bytes directly.

| Codepath | Test |
|---|---|
| **EC1** `GET /groups/:id/awards/:name.png` → `image/png`, 1080×1920 | `m2-exit-criteria.test.ts` (IHDR + full decode) |
| **EC2** with a photo → larger PNG than the same award without | `m2-exit-criteria.test.ts` (two identical groups; only Ana's photo differs) |
| **EC3** locked → watermark flag; unlocked → none | `m2-exit-criteria.test.ts` (two tests: tEXt chunk + header present / absent) |
| photo field: none/null/"" → no photo; non-string, non-data-URL, non-image data URL, non-base64, broken base64, empty, over 3 MB (two paths) → error | `photo.test.ts` |
| normalize: shrink to 720, never enlarge, EXIF orientation applied and EXIF dropped, PNG/WebP accepted, transparency on white; GIF, SVG, text, broken JPEG refused; 100 MP and just-over-12 MP headers refused before decoding | `photo.test.ts` |
| submit with a photo: stored normalized and not echoed; via the invite link; none sent → NULL; bad photo → 400 and nothing stored; duplicate name with a photo → 409, first photo kept; unknown group / taken name / full group with an undecodable photo → 404/409 (proves no decoding happens first) | `photo.test.ts` |
| sharp can't load → `normalizePhoto` 503, submit with a photo 503 `photos_unavailable` (nothing stored), submit without a photo still 201 | `photo-unavailable.test.ts` |
| slide content: group, year, name, title, citation, credit; "PREVIEW" only when locked; `<img>` only with a photo, initial otherwise | `slide.test.ts` |
| `slideText` emoji/flags/skin tones/ZWJ sequences stripped, accents kept; `withPngText` read by a real decoder, pixels intact, non-PNG refused | `slide.test.ts` |
| render: emoji with the network blocked (plus a guard showing `next/og` would fetch); non-Latin text with the network blocked still renders and only Google Fonts is asked; corrupt photo → fallback (asserted); watermark visibly changes pixels; credit above the bottom 200 px; credit on the slide at maximum lengths; `creditHost` prefers the production domain | `slide.test.ts` |
| route: case-insensitive name; names with spaces, dots, `/`, `%` through `slidePath`; `private, no-store`; 404 for unknown group, invite token as id, unknown name, before generation, non-`.png`; unlocking removes the flag; `getDashboard().unlocked` | `slide.test.ts` |
| migration from an M1-shaped database keeps rows and adds both columns; no `ALTER TABLE` once current | `db.test.ts` |

Not automated:
- **The friend form's photo picker** (canvas resize) and **the download link markup.** No browser is available in the sandbox; both are type-checked and compiled by `next build`.
- **The visual design.** It was checked by eye from rendered PNGs: normal, locked with a photo, unlocked with an initial, maximum lengths, corrupt photo. `tests/zz-preview.test.ts` writes such samples on demand and is skipped in `npm test`.

### M2 review

Self-review of the M2 change set against gstack's "Review Categories" and "Fix-First Heuristic". Everything is still untracked (`git status` shows only new files since the idea commit), so the review read the M2 files directly instead of a `git diff`. An independent read-only reviewer (a subagent given the same checklist) reviewed it too.

**Pass 1 (CRITICAL): no open findings, from either review.**
- **SQL:** every value is a `$n` parameter. The only interpolated SQL is the M1 placeholder list and `migrate`'s `ALTER TABLE` for missing columns, whose table, column and type come from a constant list in `lib/db.ts`.
- **Races:** the pre-checks added before photo decoding are only an optimization. The transaction repeats them under the group row lock, and the unique index stays the last word on duplicate names.
- **Status transitions:** only `unlocked_at`, which M2 reads but never writes. M4 must write it with `WHERE unlocked_at IS NULL`.
- **XSS:** React escapes the new dashboard markup. Slide text becomes vector paths in satori; it's never HTML.
- **LLM trust boundary:**
  - AI titles and citations are drawn as text, never fetched or interpreted.
  - Emoji are stripped, so model output can't trigger the emoji CDN.
  - The only output-dependent request is the Google Fonts glyph fallback below: a fixed host, with the text as a query parameter.
- **Image input:**
  - Only JPEG/PNG/WebP magic bytes reach libvips, so no SVG with file references, no PDF and no TIFF.
  - The header size is checked before decoding, and sharp only ever receives Buffers, never paths.
  - satori only sees `data:` URLs built from stored bytes, and librsvg refuses non-`data:` hrefs.
- **Capabilities:** slides are under the organizer id, and the invite token used as an id gets a 404 (tested).
- **Shell injection:** not applicable.
- **Enum completeness:** the new error codes (`photos_unavailable`, `award_not_found`, `not_found`) are read only for their `message` by all three client forms (checked).

**Found and fixed during review.** Each fix that changes behaviour got a test that failed first. Final run: **170 pass, 1 skipped (the opt-in preview)**, typecheck clean, `next build` OK.
1. [P1] (8/10, web search) sharp is a native module, and 0.35.x has a reported `ERR_DLOPEN_FAILED` on Vercel with Turbopack. With a static import, a failed load would have crashed `lib/squad.ts` and every route with it. sharp is now loaded lazily: a failure gives 503 `photos_unavailable` for photo uploads only (`photo-unavailable.test.ts`).
2. [P2] (8/10) `next/og` fetches every emoji from jsDelivr during the render, and one failed fetch rejects the whole image. Emoji are stripped from slide text, with a test against a blocked network plus a guard test.
3. [P2] (6/10, reviewer) The photo cap was 40 MP, checked after decoding work could start, and before the cheap 409 checks. Now:
   - the cap is 12 MP;
   - group/room/name are checked before any image is decoded (three tests send an undecodable photo and expect 404/409, not 400);
   - the upload size is checked before any regex runs.
4. [P3] (7/10, reviewer) `ALTER TABLE … ADD COLUMN IF NOT EXISTS` takes an ACCESS EXCLUSIVE lock at every cold start. Together with `CREATE INDEX IF NOT EXISTS`'s SHARE lock on `awards`, it could deadlock with a generate in progress. `migrate` now alters only missing columns (test: no `ALTER` once current).
5. [P3] (6/10, reviewer) Photos were stored at 1080 px but drawn at 480 px. They're now stored at 720 px: about a third of the bytes, still sharp in the circle.
6. [P3] (5/10, reviewer) `zlib.crc32` needs Node 20.15+, so `engines` is now `>=20.15` (package.json and lockfile).
7. [P3] (5/10, reviewer) The credit printed the request host, so preview deploys would print their own URL on shared slides. It now uses `VERCEL_PROJECT_PRODUCTION_URL` when set (tested).
8. Found by tests and visual checks:
   - satori rejects `justifyContent: space-evenly`;
   - the credit could collide with a 300-character citation, so it now flows below the text and the photo shrinks for long texts (tested at the limits);
   - the browser shrink uses `<img>` decoding, since `createImageBitmap`'s `imageOrientation` isn't supported everywhere.

**Pass 2 (INFORMATIONAL), left as is:**
- [P2] (8/10, reviewer; accepted trade-off) **Non-Latin text on slides calls Google Fonts.** For scripts Geist lacks (CJK, Arabic, Hebrew, Thai, Devanagari, many symbols), `next/og` fetches a font subset from fonts.googleapis.com, with those characters in the URL. Consequences:
  - It's a network dependency without a timeout, bounded by `maxDuration = 30`.
  - It's a disclosure of those characters to Google.
  - On failure, `next/og` logs the text and draws the glyphs blank. The slide itself still renders (tested with the network blocked).
  - Dropping those characters instead would leave names in those scripts blank.

  Proper fix (later): bundle Noto fallback fonts and call satori directly. M4's privacy page must mention it.
- [P3] (6/10, reviewer; mitigated) **Slide URLs contain the organizer key.** Chat-app in-app browsers may open the PNG instead of downloading it, and sharing that tab's link would share the key.
  - Now: the dashboard says to share the saved image, not the link.
  - M3: serve friend-facing slides under the yearbook/friend token and point the download buttons there.
- [P3] (5/10, reviewer) **Names containing `/` or `%`** work through the test router, which copies Next's route-matcher. Next decodes each segment with `decodeURIComponent`, which was checked in its source. Vercel's edge handling of `%2F` isn't verified, so it's in the deploy smoke test.
- [P3] (6/10) **Slides render on every download**, about 0.3–1 s of CPU, with no cache, by design: awards can be remade at any time. Cache by a hash of the award, photo and lock state if traffic ever matters.
- [P3] (5/10) **sharp rasterizes and `next/og` picks it over resvg-wasm when it's importable.** Tests run that path. If sharp fails on Vercel, slides fall back to resvg-wasm, which isn't exercised here. Vitest can't mock the native import inside `next/og`.
- [P3] (5/10) **`next/og` caches fetched fallback fonts in a module-level Map that never shrinks** (per instance). That's harmless at MVP traffic.
- [P3] (5/10) **`.data/preview/` holds sample PNGs** from the visual check. It's gitignored.
- **Not verified here:**
  - the photo picker and download button in a real browser (no browser or server in the sandbox);
  - sharp on Vercel x64;
  - a real Neon database.

  All three are in the deploy smoke test above.
- Carried over from M1: concurrency is tested only on PGlite, there's no rate limiting, the organizer id appears in request logs, and the model alias moves.

## M1 record

### M1 plan

M1 of 4: create a group, invite friends by link, collect 5 answers each, generate one AI award per person, list the awards.

**Step 0 — Scope challenge (M1)**
1. **What already solves a sub-problem?** The repo had no code, only docs. Built-ins were used wherever one existed:
   - **[Layer 1]** Next.js route handlers (Web `Request`/`Response`) for the API, so there's no extra server framework.
   - **[Layer 1]** A Postgres `UNIQUE (group_id, name_key)` index gives the duplicate-name 409, so there's no check-then-insert race.
   - **[Layer 1]** A Postgres transaction writes awards all-or-nothing (the "no partial awards" criterion).
   - **[Layer 1]** `node:crypto` `randomBytes` for the group id and the invite token.
   - **[Layer 1]** OpenAI-compatible Chat Completions called with `fetch` in JSON mode, with no SDK. It works with Gemini's free tier, a LiteLLM alias, or local Ollama.
   - **[Layer 2]** `pg` `Pool` with `@vercel/functions` `attachDatabasePool`. This is Neon's documented setup for Vercel Fluid compute.
   - **[EUREKA]** Tests (and local dev) run against **PGlite**, real Postgres compiled to WASM, rather than an in-memory fake. Two of the five exit criteria depend on Postgres behaviour: the unique index (→ 409) and transaction rollback (→ no partial awards).
2. **Minimum change set:** the 4 roadmap endpoints, plus 1 friend-facing submit endpoint, plus 3 bare pages: create, organizer dashboard, and the friend form.
3. **Complexity check: triggered.** About 20 source files (one per Next.js route/page). Logic lives in 4 server modules plus one client-safe constants file. **Decision:** proceed.
4. **Search check (WebSearch):**
   - Neon recommends `pg` + `Pool` + `attachDatabasePool` on Vercel Fluid compute (pooled connection string).
   - Gemini's OpenAI-compatible endpoint is `…/v1beta/openai/chat/completions`. Flash models are free with rate limits.
   - The default model is the moving alias `gemini-flash-latest`, overridable with `LLM_MODEL`.

**Security architecture (capability URLs, no accounts, per the PRD):**
- The group `id` is 16 random bytes (base64url) and acts as the **organizer's secret**. It gates the dashboard, generate, the awards list and (M2) the slides.
- The `inviteToken` is a separate 16 random bytes and is the **friends' capability**. The friend page and `POST /join/:token/submissions` resolve it on the server, so friends never learn the organizer id.
- Pages send `referrer: no-referrer` and `robots: noindex`.
- LLM output is plain text, shape-checked, and rendered as escaped text (M2: drawn as vector paths). It's never treated as HTML or a URL and never fetched.
- Every SQL statement is parameterized.

**Generate flow (all-or-nothing):**
1. Read the group and its submissions (404, or 422 if fewer than 3).
2. Call the model with no transaction open.
3. `parseAwards`: a strict parse and shape check, one award per 1-indexed friend id, clamped lengths. Any failure gives a 502 and nothing is written.
4. In one transaction:
   - lock the group row;
   - if a newer generate already stored awards covering a friend this one didn't see, keep those;
   - otherwise replace the awards with one parameterized multi-row `INSERT`.

### M1 review

Self-review plus an independent read-only reviewer: no CRITICAL findings. Fixed during review, each with a test:
1. PGlite's mkdir isn't recursive. It crashed `npm run dev` on a fresh clone.
2. Awards are matched by 1-indexed friend id, not by the name the model echoes. The duplicate-name key strips all default-ignorable characters.
3. A slower generate can't overwrite newer awards.
4. `migrate` is serialized with `pg_advisory_xact_lock`.
5. Generate errors are separated: model call → `model_unavailable`, parse → `model_bad_output`, our own bug → 500.
6. The `pg` adapter destroys a connection whose `ROLLBACK` failed.
7. Literal zero-width/bidi characters were replaced with code-point checks.

Informational items left at M1:
- concurrency proven only against PGlite (single connection), with an opt-in real-Postgres suite suggested;
- schema DDL runs on every cold start;
- no rate limiting;
- the organizer id appears in request logs;
- `gemini-flash-latest` is a moving alias;
- prompt word limits and code clamps are separate numbers by design;
- the `pg`/Neon adapter and the pages are unverified at runtime here;
- friend answers go to the configured model provider (privacy page in M4).
