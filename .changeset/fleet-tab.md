---
"plot": minor
---

The board has a second tab: **Agents** — what each branch is waiting for.

Artifacts move in days, agents in minutes. Forcing both onto one surface answers each question halfway, so they become two tabs — which also lets them poll at different rates: the board every 30 s, the fleet every 4 s, and only while its tab is open. That poll is cheap because `/api/fleet` reads a server-refreshed cache rather than running a scan per request.

Rows are grouped by **the reason each one waits**, because each group implies a different action: review it · nothing · nothing · go check whether it died · decide whether to start it · nothing at all. Sorted that way the list is workable top to bottom, and when only *working* is populated you can walk away.

Every group renders even when empty, `waiting on a machine` included — it needs PR data that does not exist yet, and an absent group would read as "nothing is waiting on CI", a claim this step cannot make. The footer carries the pulse age, so a stale view says so rather than looking live.

Two things were wrong the moment the tab was first rendered, and neither would have failed a test that was not looking at a screen:

- **Merged branches sat under *quiet*.** Technically right — no recent commit — and the wrong answer: "go check whether it died" is not a prompt for work that landed. Merged work now has its own **done** group, which asks nothing of you.
- **A note read `no commit for 30300 min`.** Minutes are the right unit for the first hour and arithmetic the reader has to do after that. Ages now scale to hours and days.
