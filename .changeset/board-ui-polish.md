---
"plot": minor
---

The agent view stops making you work out what it already knows.

Three frictions in the Agents tab, all of the same kind: the view held the information and left the reader to reconstruct it.

**The footer counted up, not down.** `scanned 2s ago · PR data 74s ago` is honest about staleness and silent about the thing that matters while you watch a fan-out — *when does this change next?* Both ages now carry a countdown, and the pair is the point: how old is this, and when does it move. The git countdown is derived from `FLEET_POLL_MS`, which the client owns, and it answers *when can this display change* rather than *when does git get re-read* — `/api/fleet` reads a cache the server rescans on its own timer, and that is the only question the client can answer honestly.

**The PR countdown needed a field, and must not guess without it.** `PR_REFRESH_MS` is 60 s and backs off to 120 s when the host reports a rate limit, so a client assuming 60 s would count to zero and sit there through the wait — rendering *"I don't know"* as *"any moment now"*, which is the exact failure this view exists to remove. `FleetSchema` gains one optional field carrying the server's own intention, read from `prNextAt` — the single gate the fetch obeys, so it reports the truth rather than a second copy of the cadence that could drift from it. **Absent, no PR countdown is shown at all**: an older server, or a board built before this change, still tells the truth with the age alone. Both counters stop when the agents tab is not open, because `App.tsx` already stops polling and a counter ticking toward a refresh that is not coming is the same false statement.

**Rows were grouped only by waiting-state.** Fifteen branches across seven plans put six slices of *one* plan in `QUIET (6)` while three rows of another sat apart in `DONE`. The plan name was on every row, so the grouping existed in the data and was left for the eye to do. Rows now group by plan inside each waiting-group — by plan and not by story, because the waiting-groups answer *what needs me next* and the useful unit within that is the thing whose waves are being worked. Plans are ordered by their most urgent row, so a plan holding one stale branch cannot outrank one whose branch just moved, and rows keep their age order inside a plan. **A group with one plan gets no sub-heading** — chrome that never varies is noise — and `DONE` is grouped like every other group, because a rule with an exception for the group nobody reads is a rule someone has to remember.

**Every link now goes where its text says.** One link per row, on the wrong word: the branch name opened the PR while `PR #130` beside it was plain text. Both halves were surprising. The branch name links to the branch, `PR #<n>` links to the pull request, and a test asserts the two targets *differ* — "a link exists" passes on the bug.

**The branch URL is read from the origin, not derived from the PR URL.** That derivation was rejected because it only works for rows that *have* a PR, and `not-started`, `quiet` and fresh claims — where "go look at the branch" is most useful — have none. `git remote get-url origin` is read once per scan, beside the branch ages, never per row, and the host's own word for the page is used (`/tree/` on GitHub, `/branch/` on Bitbucket Cloud), keeping the host verbatim so a GitHub Enterprise install links to itself. An origin whose shape the board does not recognise — a self-hosted Bitbucket, whose branches live under `/projects/KEY/repos/name/branches` — yields no link at all rather than a guessed URL shape. **A merged branch gets no branch link**: its remote page is gone, and the standing rule in this contract is that a missing address renders as plain text rather than an invented one. `green` stays plain text and that is a deliberate stop — the row carries no checks URL, and adding one is a change through `plot-host.sh` and the pulse rather than a display change.

**Clicking a plan opened the rendered markdown and left the board.** The Agents tab is a live view that polls every 4 s; navigating away costs the reader the thing they came to watch. The plan now opens in `PlanModal` in place, and the modal gains a **Show in board** button that closes it, switches tabs, filters to the plan's story and lands on the card.

**The filter alone is not the feature.** `plot-board` has nine plans, so filtering to a story still leaves you scanning a column. The button also names the plan in the URL — `?plan=<slug>`, the same sync the story and sprint filters use — and the matching card scrolls into view with a highlight ring. Naming it in the URL is what makes the landing shareable and survivable: a reload keeps you on the card. The highlight is transient, clearing on the next interaction rather than persisting as a second kind of filter, and `prefers-reduced-motion` suppresses the scroll *animation*, not the scroll — arriving at the card is the point. A `?plan=` matching nothing is **ignored**, because an empty filtered column would read as "this story has no plans".

A fleet row is not a card — it carries `planFile`, and `PlanModal` takes a `Card` — so the card is looked up from the board data. **Where the board has no matching card the plan name stays a plain link to `/plan/<file>`** rather than opening an empty modal; a plan outside the walked directories has a row and no card. "The board has not loaded yet" is deliberately not the same answer: against a real repo `/api/board` takes seconds, so a click made in that window is held and resolved once the cards land, never spent navigating away from a live view.

Verified by running the built board against this repo, not only against the fixture: sixteen rows over eight plans, countdowns ticking, `DONE` carrying five plan sub-headings, every live branch linked to `github.com/plot-pm/plot/tree/<branch>` and every merged one plain, the modal opening in place and its button landing on the highlighted card.

<!--
bumps:
  skills:
    plot: minor
-->
