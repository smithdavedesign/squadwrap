# squadwrap — research

## Summary
- A "Wrapped" for a friend group built from what friends *choose to submit* (funny prompts, photos), not from reading chats: an organizer invites by link, an AI writes one award per person as story-format slides, plus a group yearbook page.
- Existing tools are chat-export analyzers (WhatsApp/LINE mostly) or anonymous rating apps; none found combine a submitted-answers, invite-link, award-per-person format that works for any messenger.
- Demand for the *format* is proven (Spotify Wrapped: 200M engaged users in 24h, 500M+ shares); willingness to pay is only weakly evidenced (chat-wrap apps charge ~€6 or €5–15; Friend Wrapped Gold $3.99/week). Confidence is Low on revenue.

## Evidence of the problem
- The format is a mass cultural moment: Spotify said Wrapped 2025 had over 200 million engaged users in the first 24 hours and was shared 500M+ times (TechCrunch, via search summary). Launch was 2025-12-03; data cutoff Oct 31 (low-quality sources, treat as approximate). https://techcrunch.com/2025/12/04/spotify-says-wrapped-2025-is-its-biggest-yet-with-200m-users-in-its-first-day
- People already try to get this for friend groups: ZapZipped, Yapd, Unwrapped, WA Wrapped, MyChatWrap and Wrapped for LINE all turn a chat export into a recap with awards/personality slides. Wrapped for LINE shows 100K+ downloads, 4.6/5 from ~600 ratings. https://spark.mwm.ai/en/apps/wrapped-for-line/6741377217
- Gap: the Yapd maker's Product Hunt post and search summaries say iMessage gets nothing, and chat-export tools force people to hand over private chats. A German review of WA Wrapped flagged an opaque developer, unclear data handling and values that looked random. https://www.netzwelt.de/news/226171-vorbild-spotify-gibt-whatsapp-wrapped-100125.html
- No first-hand "I wish there was…" thread was found in this run; the evidence of unmet need is the number of near-copies, not complaints.

## Who pays
- Buyer: the organizer of a friend group, roommates, a team or club (the seed's hypothesis). Price to test: $12–$25 per group (or free basic + paid HD/printed yearbook).
- Evidence of payment for something similar today (weak, all individual-priced):
  - WA Wrapped: free download, full analysis needs a subscription of just under €6 (netzwelt, above).
  - WhatsAnalyze: full analysis €5–15, browser-based (same article).
  - Friend Wrapped (iPhone): optional "Gold" subscription $3.99/week; only 2 ratings, so little traction. https://apps.apple.com/us/app/-/id6475646063
  - Yapd: free wrap, paid credits and a long-form "Encore" essay; no prices published. https://www.producthunt.com/posts/1152899
  - Physical group gifts: a personalized "4 friends" Etsy print from £9.99; a personalized group gift on eBay at £17.99. https://etsy.com/listing/1591611462/personalised-4-friends-wall-art-girl
- Honest read: $12–$25 per group is above the observed €6 per person; the per-group framing (one payer, many recipients) is the unproven bet. A free basic wrap with a paid keepsake is the safer test.

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| Yapd (WhatsApp export, browser-parsed) | free + credits | needs chat export, WhatsApp only; no submitted-answers flow |
| ZapZipped | not published | WhatsApp group chats only |
| WA Wrapped (iOS) | ~€6 sub | iOS only, chat upload, trust issues |
| Unwrapped (web) | not stated | WhatsApp export, 10MB limit |
| Wrapped for LINE | free app | LINE only |
| Friend Wrapped (iOS) | free, Gold $3.99/wk | anonymous ratings between app users, needs everyone to install |
| AskUs / Votee / Votely | free + IAP | polls and "most likely to" voting, no award slides or yearbook |
| Howbout Wrapped 2025 | unclear | calendar-based, only for Howbout users |
| Spotify Wrapped Party | free | music data only |

Links: https://apps.appfollow.io/ios/wa-wrapped-2025/6739847325 · https://apps.apple.com/us/app/-/id6446650376 · https://howbout.app/blog/howbout-moments/howbout-wrapped-2025-is-here-/

## Technical notes
- Static web app (no install): organizer creates a group, gets an invite link, friends submit answers to 5–8 prompts and optional photos. The AI turns answers into one award per person plus a group page. Rendering to 1080x1920 story images can run server-side with an image-rendering library on a free tier.
- Text generation on free models via LiteLLM; one call per group. Photos are the friends' own, no image generation.
- Storage: a small DB (Supabase free tier) for submissions; delete after 30 days by default.
- Payments: Stripe Checkout, one-time per group.
- Optional later: browser-side chat-export parsing that sends only counts to the model (as the seed specifies); skip in M1.

## Risks & open questions
- Fill-in rate: unknown. A generic shared link may draw ~25% vs ~40% for personal invites in one medical survey, and customer surveys 10–30% (not social-app data). If few friends answer, the awards are thin. https://pmc.ncbi.nlm.nih.gov/articles/PMC11276369 · https://simplesurvey.com/fr/blog/blog-survey-response-rate-benchmarks-tips
- Willingness to pay: only individual-priced weak evidence; competitors give a free wrap away.
- Timing: Wrapped landed Dec 3 in 2025 (approximate); a ~7-week window from now (2026-10-12) makes a late-November launch tight but feasible for an M1 this small.
- Seasonality: demand collapses after December; editions (trips, graduations) are speculative.
- Content safety: roasts between friends; need adult-only, report/takedown, no minors' data. Submitted photos are personal data: retention limit and delete link.
- Copycat risk: the format is trivially cloneable and ChatGPT's year-end review is normalizing it. https://techcrunch.com/2025/12/22/chatgpt-launches-a-year-end-review-like-spotify-wrapped

## Sources
- https://techcrunch.com/2025/12/04/spotify-says-wrapped-2025-is-its-biggest-yet-with-200m-users-in-its-first-day
- https://techcrunch.com/2025/12/22/chatgpt-launches-a-year-end-review-like-spotify-wrapped
- https://www.netzwelt.de/news/226171-vorbild-spotify-gibt-whatsapp-wrapped-100125.html
- https://apps.apple.com/us/app/-/id6475646063
- https://www.producthunt.com/posts/1152899
- https://spark.mwm.ai/en/apps/wrapped-for-line/6741377217
- https://apps.appfollow.io/ios/wa-wrapped-2025/6739847325
- https://apps.apple.com/us/app/-/id6446650376
- https://howbout.app/blog/howbout-moments/howbout-wrapped-2025-is-here-/
- https://etsy.com/listing/1591611462/personalised-4-friends-wall-art-girl
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11276369
- https://simplesurvey.com/fr/blog/blog-survey-response-rate-benchmarks-tips
