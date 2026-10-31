# squadwrap: launch readiness

The product does what it did before: an organizer makes a group, friends answer through the invite link, the organizer makes the awards, and one payment per group takes the watermark off. What changed is what a public launch needs around it.

## What I did

1. **Search and sharing.** Each public page (`/`, `/privacy`, `/terms`) has its own `<title>` and meta description, a canonical URL, Open Graph tags and a `summary_large_image` Twitter card, both with a 1200×630 share image. Each also carries JSON-LD for a `SoftwareApplication` with one `Offer`: 6.00 USD, once per group. Everything uses Next.js conventions:
   - page `metadata` (built by `publicPageMetadata` in `lib/site.tsx`), with `metadataBase` in the root layout;
   - `app/opengraph-image.tsx`, which draws the share image with code at build time (no copied image);
   - `app/robots.ts` (allow everything, point at the sitemap) and `app/sitemap.ts` (the three public pages).

   The site address comes from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, so the canonical URLs and the sitemap follow a custom domain once it's made the production domain. Private-link pages (`/groups`, `/join`, `/y`) keep their noindex header and get no canonical URL.
2. **Privacy and terms**, both already linked from the footer on every page:
   - **Privacy** now covers the visit count (below), with its three events and exactly what they carry. It also says squadwrap sets no cookies, and gives the contact: [GitHub issues](https://github.com/smithdavedesign/squadwrap/issues), with a warning never to post a group's links there.
   - **Terms** now give the price from REVENUE.md ("$6 once per group"), its refund line ("Refund on request, no questions asked"), a "No warranty" section, and the same GitHub contact.
3. **Payment: the Buy button.** Once the awards exist, the organizer page shows **"Buy the unlock, $6"**. It opens the URL in `STRIPE_PAYMENT_LINK` in a new tab, with `?client_reference_id=<group id>` added so the payment names the group it unlocks.
   - The button is hidden when the variable is unset or isn't an https URL. The link is read on the server, so nothing is hard-coded and no `NEXT_PUBLIC_` copy is needed.
   - The Stripe webhook now also unlocks **Payment Link** sessions, but only one-time payments of at least $6 in USD. On a shared Stripe account, a cheaper link opened with a group's id still unlocks nothing.
4. **RepoHQ visit signal** (`lib/signal.ts`). It sends a fire-and-forget `POST` with JSON `{"slug":"squadwrap","kind":…,"referrer":…}` to `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal`, using `keepalive`, `credentials: 'omit'` and no Referer header. There are three events:
   - `visit`: once per browser session (sessionStorage), from every page.
   - `activate`: once per browser (localStorage), on the product's core action, **a successful "Make the awards"** (the AI turning the friends' answers into awards).
   - `checkout`: every click on Buy.

   `referrer` is `document.referrer` only when its origin is another site, else `null`, so squadwrap's own links (which are keys) never leave the page. Nothing is sent when `navigator.webdriver` is true, when `NEXT_PUBLIC_VERCEL_ENV` isn't `production`, when localStorage `repohq:notrack` is set, or when storage can't be read.
5. **Deployment:** `.provision` holds the two lines the pipeline runs through the credential broker (the Vercel project, and a request for the $6 Stripe payment link).
6. **Tests:** `tests/launch.test.ts` (new) checks:
   - the public pages render, with unique titles and descriptions, canonicals, share tags and JSON-LD;
   - robots.txt and the sitemap, through Next's own serializers;
   - the share image is a 1200×630 PNG;
   - the Buy button: hidden without `STRIPE_PAYMENT_LINK`, linked with the group when set, gone once the group is unlocked, and only https links accepted;
   - every rule of the signal, against a stand-in browser;
   - the privacy and terms wording, and `.provision`.

   `tests/payments.test.ts` gained the Payment Link webhook cases (unlock, replay, a delayed payment, and cheaper, other-currency, missing-amount or subscription sessions ignored). Its unlock-button tests were updated for the new rules.
7. **Screenshots:** `npm run screenshots` saved the 6 PNGs in `docs/screenshots/`, and the README's Screenshots section now shows the $6 Buy button. The run builds the app and starts `next start` with a placeholder `STRIPE_PAYMENT_LINK` (`https://example.com/pay`). Before taking the screenshots, it checks over real HTTP:
   - every public page's title, description, canonical, `og:*` and `twitter:*` tags, and JSON-LD;
   - robots.txt, sitemap.xml and the share image;
   - that the invite page has noindex and no canonical URL;
   - that the Buy link carries the group.

   I opened every PNG and the share image: the footer links show on the start page, and the Buy button on both awards shots.

## Decisions I made (nobody to ask)

- **Price: $12 → $6 once per group.** REVENUE.md sets $6 ("don't start at $12–$25"), and this go-live specifies a $6 Offer and a $6 payment link. Keeping $12 on the page would have contradicted both. It's one constant, `UNLOCK_PRICE` in `lib/prompts.ts`.
- **Refunds: on request, with no 14-day limit**, per REVENUE.md's refund line. Requests go to the support address on the Stripe receipt. GitHub issues are public, so the terms keep payment details out of them.
- **The Buy button sits on the organizer page, not the home page.** The unlock is per group, so a payment has to name its group (`client_reference_id`). A Buy button on the home page would take $6 and unlock nothing. The home page states the price instead.
- **Which payment path shows:**
  - the Payment Link (the go-live wiring, and what RepoHQ maps) when `STRIPE_PAYMENT_LINK` is set;
  - otherwise the existing Stripe Checkout button, when both Stripe secrets are set;
  - otherwise **no button**. Before, a button showed that could only answer "payments aren't set up".
- **The webhook trusts a Payment Link session only if it paid ≥ the price in USD.** The M4 review had made the webhook ignore untagged sessions, so that a cheaper link on a shared Stripe account couldn't unlock a group. The amount check keeps that protection while letting our own link work. Guessing a group id (128 random bits) isn't feasible, and whoever does pay has paid at least the price.
- **The visit signal runs on every page, private-link pages included.** Friends arrive through invite links and never see the home page; counting them is counting real use. The message holds no page address, so no key leaves.
- **robots.txt doesn't disallow the private paths.** A crawler has to fetch such a page to see its noindex header, and listing the paths would only advertise them.
- **Screenshot runs use `squadwrap.example`** as the production domain (a reserved name) instead of `squadwrap.app`, which we don't own.

## How to check it

```bash
npm ci                 # works with install scripts disabled
npm test               # 327 pass, 1 opt-in preview skipped; no network, no secrets
npm run typecheck      # clean
npm run build          # /robots.txt, /sitemap.xml, /opengraph-image, /privacy, /terms prerendered
npm run screenshots    # needs CHROMIUM_PATH; checks the launch tags over HTTP, writes docs/screenshots/*.png
npm run smoke          # optional: next dev, the whole flow over HTTP (Buy link included)
```

After deploying:
- Open `https://<host>/robots.txt`, `/sitemap.xml` and `/opengraph-image`, and view the source of `/`, `/privacy` and `/terms`.
- Paste `https://<host>/` into a link-preview checker (or a chat) to see the card, and into Google's Rich Results Test for the JSON-LD.
- Make a test group with 3 answers, then "Make the awards". The browser's network tab should show one `activate` POST to idea-factory.1426davejobs.workers.dev (plus a `visit` at the start of the session). Click Buy and a `checkout` follows. None of these appear on a preview deployment.

## What's left for David

1. **Paste the Stripe payment link into Vercel** as `STRIPE_PAYMENT_LINK` (Production), then redeploy. The broker request in `.provision` asks for it: **$6 USD, one-time**. The webhook only unlocks a link that charges at least $6 in USD.
2. **Turn on automatic unlocks:** add a Stripe webhook endpoint `https://<host>/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in Vercel as `STRIPE_WEBHOOK_SECRET`. This was already requested in M4. Until it's set, unlock paid groups by hand: the payment's `client_reference_id` in Stripe is the group id, and the SQL is in BUILD.md under "Handling reports and payments".
3. **Stripe settings:** a support email, and email receipts switched on. The terms send refund requests to the receipt's support address.
4. **Hosting that allows payments.** Vercel Hobby forbids commercial use (BUILD.md, REVENUE.md), so decide on this before taking real money.
5. **In your own browser** on the production site, run `localStorage.setItem('repohq:notrack', '1')` in the console so your own use isn't counted.
6. **GitHub issues:** privacy and terms send people to https://github.com/smithdavedesign/squadwrap/issues, so the repo needs to be public with issues on.
7. **A custom domain**, if you want one: add it in Vercel and make it the production domain, then redeploy. The canonical URLs, sitemap, robots.txt and JSON-LD follow it.
8. Still open from M4, if not done yet: `CRON_SECRET` in Vercel, which runs the 30-day deletion.

## Self-review (gstack pre-landing checklist)

**Step 0, scope.**
- **Reused:** the footer, privacy and terms pages, the screenshot script, `metadata`, and the webhook's atomic unlock.
- **Complexity check:** triggered, at about 30 files touched. 8 are new: `lib/site.tsx`, `lib/signal.ts`, `app/visit-signal.tsx`, `app/opengraph-image.tsx`, `app/robots.ts`, `app/sitemap.ts`, `tests/launch.test.ts`, `.provision`. Each one is a deliverable of this task, so I proceeded.
- **Search check:** web search wasn't used. I went from in-distribution knowledge plus the Next.js 16 docs shipped in `node_modules/next/dist/docs` (metadata, opengraph-image, robots, sitemap, JSON-LD).
- **Distribution:** no new artifact.

**Pass 1, CRITICAL: none found.**
- No new SQL; the unlock is still the single atomic `UPDATE … WHERE unlocked_at IS NULL`.
- No new status transitions.
- `dangerouslySetInnerHTML` only renders our own static JSON-LD, with `<` escaped.
- No LLM output is involved.
- `SignalKind` is a new set of values, read only inside `lib/signal.ts`.
- `UNLOCK_PRICE` was traced through every consumer: Checkout's amount and idempotency key, the webhook's amount check, the pages, the JSON-LD and the tests.

**Pass 2, informational** (left as is, written down):
- [P3] (8/10) `app/groups/[id]/dashboard-actions.tsx` BuyButton: a Payment Link has no idempotency key, so an organizer who pays in two tabs pays twice. The second payment logs an `already_unlocked` warning, and the operator refunds it, as before.
- [P3] (7/10) Someone who opened the payment link earlier can still finish paying in a group's last 2 days, when the button is no longer shown. Refunds are on request.
- [P3] (6/10) `lib/signal.ts`: a JSON body to another origin needs a CORS preflight, so the RepoHQ endpoint has to answer `OPTIONS`. That is the specified contract; if it doesn't, the signal fails silently and the page is unaffected.
- [P3] (6/10) The signal relies on Vercel exposing `NEXT_PUBLIC_VERCEL_ENV` at build time ("Automatically expose System Environment Variables", which is on by default). If that setting is off, nothing is sent.
