# squadwrap — Roadmap

Suggested stack: Next.js on Vercel Hobby (free hosting, one codebase); Supabase free tier (Postgres for submissions); LiteLLM free-model alias for award text; an image-rendering library for story PNGs (no browser needed); Stripe Checkout (pay per use); Vitest + Playwright for tests.

## M1 — Create, invite, submit, award (one weekend)
Deliverables: group creation, invite link, anonymous submission form (5 prompts), award generation (model call stubbable), award list per group.
Exit criteria:
- POST /groups with name "Flat 4B" returns an id and an invite URL containing a token.
- POST /groups/:id/submissions with 3 different display names and answers returns 201 each; a 4th submission reusing a display name returns 409.
- POST /groups/:id/generate with 2 submissions returns 422; with 3 returns 200 and exactly 3 awards, one per display name, each with a non-empty title and citation.
- With the model stubbed to return malformed JSON, generate returns 502 and no partial awards are stored.
- GET /groups/:id/awards for an unknown id returns 404.

## M2 — Story slides
Deliverables: 1080x1920 PNG per award with the person's photo, watermark and "make yours" credit; download button.
Exit criteria:
- GET /groups/:id/awards/:name.png returns image/png with width 1080 and height 1920.
- A submission with a photo yields a PNG larger than the same award without a photo.
- PNGs for a locked group carry the watermark flag; unlocked groups do not.

## M3 — Yearbook page and nudges
Deliverables: private yearbook page, pending-friends list with copyable nudge text.
Exit criteria:
- GET /y/:token lists all awards for the group; a wrong token returns 404.
- GET /groups/:id/pending with member count 5 and 3 submissions returns a pending count of 2.
- The yearbook page includes a report link and a noindex meta tag.

## M4 — Payment and safety
Deliverables: Stripe Checkout per group, webhook unlock, 30-day deletion job, adults-only checkbox.
Exit criteria:
- A completed checkout.session webhook sets the group to unlocked; replaying it is idempotent.
- A webhook with a bad signature returns 400 and does not unlock.
- Running the cleanup job deletes submissions and photos of a group created 31 days ago and leaves a 29-day-old group untouched.
- Submitting without the adults-only checkbox returns 400.
