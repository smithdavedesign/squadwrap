# Verdict: PASS — score 4/10

One sentence: a seasonal, trivially cloneable novelty with no evidence anyone wants it or will pay $12–$25 per group, and a 7-week window that collides with David's "distribution before more MVPs" hold.

Evidence strength is low throughout. RESEARCH.md itself rates confidence Low and found no first-hand "I wish there was…" thread.

## Q1 Demand Reality — 3/10
The cited proof is Spotify Wrapped's reach (TechCrunch, 200M engaged users), which proves the format is popular, not that a friend-group version is wanted. The only demand signal is the number of near-copies (Yapd, ZapZipped, WA Wrapped, Unwrapped, Wrapped for LINE). Copies show supply, and Friend Wrapped has 2 ratings. Wrapped for LINE has 100K+ downloads, but it is an individual chat-export app. Nobody has asked for this, paid for it or been upset by its absence. Evidence that would change my mind: 5+ organizers who say they'd send the link tonight, or a repeated unprompted complaint that chat-export wraps don't work for iMessage.

## Q2 Status Quo — 4/10
Real workarounds exist: chat-export wraps, group polls and "most likely to" apps (AskUs, Votee), and Etsy/eBay group gifts at £9.99–£17.99. But the status quo is mostly "post a meme in the group chat for free". The paid comparables are all individual-priced (~€6, $3.99/week), and competitors give the wrap away free. The per-group $12–$25 bet has no support in RESEARCH.md.

## Q3 Desperate Specificity — 3/10
"The organizer of a friend group of 4–12" is a category, not a person. No named human, no consequence, no pain. The moment is a social flex, not a problem anyone is avoiding. This is "solution in search of a problem" and it leans on a famous brand's halo.

## Q4 Narrowest Wedge — 6/10
The wedge is already narrow: invite link, 5 prompts, one AI award per person. It ships in a weekend. The weakness is that the payment lever (HD/no watermark) is thin: the free preview is likely enough to post.

## Q6 Future-Fit — 3/10
ChatGPT's year-end review is normalizing the format, and platforms (Spotify Party, Instagram, Howbout) can add group versions. A one-weekend clone has no moat. Demand collapses after December, so the product earns once a year, if at all.

## Q5 (what to watch in M1)
Watch whether invited friends actually fill in the prompts without being nagged. Count how many of the first 5 groups reach 3 submissions, whether the organizer rewrites or discards awards, and whether anyone posts a slide. The surprise to look for is what they share and where: screenshots into the group chat rather than public posts means the "make yours" loop does not work.

## Premises
1. Friend groups want a Wrapped of their own. Plausible, but unverified.
2. Friends will fill in prompts for a link from the organizer. Unproven; the research cites 10–40% survey rates from unrelated contexts, and awards go thin below 3 respondents.
3. One organizer will pay $12–$25 for HD export. Unsupported; every comparable is free or individually priced and cheaper.
4. A "make yours" credit produces viral loops (0.3 new groups per wrap). Unsupported guess.
5. A late-November launch is feasible. True technically, but the demand window is about 3–4 weeks.

## Alternatives
- **Minimal: free-only static page.** No payment, no DB beyond submissions, no Stripe. Tests only whether groups complete a wrap. Cheap, but it doesn't test willingness to pay.
- **Ideal: full product** with story renders, yearbook, Stripe and a deletion job. Four milestones, plus a commercial-use host because Vercel Hobby forbids taking payments (policy.json "hosting").
- **Extend an existing repo: tiebreak.** It is David's viral poll idea with a closer "people answer a prompt via link" mechanic. Fold "award per person" into it as a feature instead of a new product, and put the distribution effort there. tiebreak is also the focus product in `growth.focus`.
- **Lateral: a ready-made prompt template pack** (Notion/Canva) sold on Etsy. Tests whether anyone pays at all for $0 build cost.

## Narrowest wedge
A single page where an organizer pastes 3–8 friends' answers (collected by hand in their group chat) and gets a text award per friend. No link flow, no payments. It tests only whether the output is funny and shareable.

## M1 feasibility
- One-person weekend: yes. M1 is four REST endpoints, a stubbed model and a small DB.
- Zero cost: M1 yes (Vercel Hobby, Supabase free, free model via LiteLLM). M4 charging does not: it needs a commercial-use host, which is the paid-tier question for David. The M1 demand test itself is zero-cost.
- The one test that proves M1: `POST /groups/:id/generate` with 3 submissions returns exactly 3 awards; with a malformed model response it returns 502 and stores nothing.
- Policy: `build.startNew` is false until tiebreak has 50 visitors a week, so a new build would wait anyway.

## Risks
- Seasonality: earning window is about December.
- Fill-in rate, which decides whether the product works at all.
- Copycat risk and platform risk.
- Content safety on roasts between friends and photos, plus an adults-only and takedown burden for a solo operator.
- Free competitors cap the price.
- Usage cost on David's shared subscription.

## Kill criteria
Drop it if, after 14 days, fewer than 50 visitors are judged, signups are below 5% (policy `validation.build.minSignupRate`), or no organizer says they'd pay when asked. Also drop it if the launch can't happen before about Dec 1, because the season will be gone.

## Assignment
Before building anything, post a "send me 4 funny answers from your group and I'll write your awards" offer in 2–3 friend groups or communities. If at least 3 groups respond in a day, revisit.
