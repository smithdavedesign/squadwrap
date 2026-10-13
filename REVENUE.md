# squadwrap: road to the first dollar

**Plain verdict: the evidence says nobody has yet shown they will pay.** The review scored 4/10, the research rates revenue confidence Low, and I found nothing new. The plan below is the best case at a low price, built to learn quickly whether a single organizer will pay at all. Confidence that someone pays at least once in December: moderate (a few friends of David are enough). Confidence in $12–$25 per group: low.

## Who pays (Q3)
Not "organizers" in general. The buyer is one person aged about 20–35 who runs a group chat of 4–12 (a flat, a friend group, a club or small team) and posts year-in-review content in December. The first one I can actually name is whoever organizes a group David is in. Until David names three such people, the buyer is unproven. I can't name a real person from the evidence, and the review gave this 3/10.

## What they pay today (Q2)
- Mostly nothing: a meme or a Spotify Wrapped screenshot in the chat.
- Chat-export wraps: WA Wrapped, subscription just under €6; WhatsAnalyze €5–15 (netzwelt, in RESEARCH.md). Yapd is free with paid credits.
- Friend Wrapped Gold, $3.99/week (2 ratings, little traction). A photo-recap iOS app charges $2.99/week ([App Store](https://apps.apple.com/us/app/-/id6756099706)).
- Keepsakes: Zapptales chat PDF £14.9, softcover from £24.9 ([Zapptales](https://www.zapptales.com/travel-chat-book/)); Chatbooks yearbooks from $17 ([Chatbooks](https://chatbooks.com/yearbook)); personalized friends print about £9.95 on eBay.

Read: digital, one-shot, individual wraps sell at about $3–6. $12+ is only seen for physical or book keepsakes. The $12–$25 in the PRD sits at the keepsake price, which the product does not deliver (no print in the MVP).

## Price
**$6 once per group** (Stripe Checkout payment link), to unlock HD and no-watermark exports for every member. It undercuts the €6 per person chat-wraps, since one payer covers 4–12 people, and it sits below the $12+ keepsake range. Stripe takes about $0.48, leaving about $5.50. Test $9 on the second batch of groups if the first five buy without hesitation. Don't start at $12–$25: nothing supports it.

## Narrowest version worth paying for (Q4)
The built MVP is already narrow. The weak point is that the free preview may be enough to post. So the paid lever must be something people want in the post itself: clean 1080x1920 slides with no watermark, for all members, plus the yearbook page. Make the free preview clearly watermarked and low-resolution, but still enough to show people the product and get the friends in.

Before more feature work, run the manual concierge test the review suggested: "send me 4 funny answers from your group and I'll write your awards", then ask for $6 for the clean slides. That is the fastest honest path to learn whether payment happens.

## Shortest path
1. Finish launch-readiness: og:image, robots.txt and sitemap.xml (the launch checks list these three as missing). Test the Stripe flow end to end in test mode, then live.
2. David decides the price ($6), creates the Stripe product and payment link, and maps it in RepoHQ.
3. Dogfood: David runs one real wrap with his own group, watching without helping. Count how many friends fill in the prompts.
4. Post in the channels below, aimed at **Nov 15–Dec 1**. Wrapped season is about Dec 1–25 and the window is short.
5. Concierge: DM the first 10 organizers directly and offer to set up the group for them.
6. First dollar = a stranger's payment, not David's friends, though a friend's counts as the first signal.

## Must have before charging
Checkout and webhook unlock tested live, privacy and terms (already live), adults-only checkbox, report/takedown link, 30-day deletion working, a refund line in the terms (refund on request, no questions), and a hosting plan that allows taking payments. Vercel Hobby forbids commercial use, so the host is an open item for David (policy.json "hosting"); a payment link on a non-Vercel host or a paid plan decision is needed before the first charge.

## Kill criteria
Stop if, by Dec 15, fewer than 5 groups reach 3 submissions, or zero groups pay after at least 20 organizers were directly asked. Also stop if launch slips past Dec 1 (the season is gone) and fold "award per person" into tiebreak instead. Don't carry it into 2027 without paid proof.

## Risks
- Free competitors and the free preview cap what anyone will pay.
- Fill-in rate unknown; below 3 submissions there is no wrap.
- Seasonality: income only in December.
- Copycats, and ChatGPT's year-end review normalizing the format.
- Roasts and photos of friends: moderation and takedown burden for a solo operator.
- Free-model awards may read as repetitive.
- Hosting must allow commercial use.

## Assignment
Put the concierge offer into David's own group chats this week, ask three organizers by name whether they would send the link tonight, and write down the answers.
