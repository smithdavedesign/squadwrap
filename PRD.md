# squadwrap — PRD

## Problem
Every December people post their Spotify Wrapped, and friend groups want the same thing for themselves. Today's options either need a private chat export (WhatsApp/LINE only, trust issues) or are anonymous rating apps everyone must install. Nobody in a friend group has an easy, messenger-agnostic way to produce a funny, postable "our year" with an award per person.

## Target user
The organizer of a friend group of 4–12 (friends, roommates, a team or club), the person who always makes the plan. Moment: late November to December, when everyone is posting year-in-review content and the organizer wants something for the group chat. Friends are secondary users: each answers a few prompts and gets their own award slide.

## Competitors & gap
Chat-export tools (Yapd, ZapZipped, WA Wrapped, Unwrapped, Wrapped for LINE) are mostly WhatsApp/LINE-only and read private chats; Friend Wrapped and AskUs are app-install poll games; Howbout is calendar-only (see RESEARCH.md). Gap: a no-install, any-messenger flow built from what friends choose to submit, ending in one story-sized award slide per person plus a group yearbook page.

## MVP scope
- Organizer creates a group (name, year, member count) and gets an invite link.
- Friends open the link with no account, enter a display name, answer 5–8 funny prompts (who cancels most, the year's lore, main-character moment) and optionally add a photo.
- AI (free model) turns the answers into one award per person with a title and two-line citation.
- Story-format (1080x1920) PNG per person, downloadable and shareable, with a small "make yours" credit.
- Group yearbook page: a private link showing all awards and photos.
- Organizer can generate once at least 3 friends have submitted; sees who has not answered with a copyable nudge message.
- Stripe one-time purchase per group (test $12–$25) to unlock HD/no-watermark exports; basic preview free.
- Safety: adults-only checkbox, report/takedown link on every page, submissions deleted after 30 days.

## Non-goals
- Reading or parsing chat exports (later experiment only).
- Native apps, accounts, or social feeds.
- AI image generation.
- Printed products in the MVP.
- Roasts of non-participants, minors, or anything about health, abuse or money.

## Success metrics
- At least 50% of invited friends submit answers within 3 days (an assumption to test; survey benchmarks are 10–40%).
- At least 1 in 4 created groups reaches 3+ submissions, so a wrap can be made.
- At least 60% of generated wraps have at least one slide downloaded or shared.
- Each wrap brings in on average 0.3 new groups through the "make yours" credit.
- First 5 paid groups by Dec 15, and at least 3% of generated groups buying at $12–$25 over the season.

## Open questions
- Will the organizer pay per group, or only for a keepsake (HD, printed yearbook)?
- What fill-in rate do invited friends really reach?
- Is a late-November launch realistic, and what happens to demand after December?
- How much funny content can free models write without repetitive awards?
