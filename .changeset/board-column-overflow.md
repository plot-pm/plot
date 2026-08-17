---
"plot": minor
---

Long board columns now show their most recent cards and offer the rest.

**`Released` only ever grows.** Thirteen delivered plans today, and every one of them was worth seeing once; none is worth scrolling past forever. A column past the threshold now renders its most recent cards plus a control for the remainder — not a scrollbar, which hides the count, and not a hard cut, which hides the work.

**The threshold is five, and it is measured rather than chosen.** The plan deliberately named no number, on the grounds that the right one depends on how tall a column gets before it stops being scannable — a question for a browser, not for a plan file. Measured against the live board at 1440×900, 1728×1117 and 1920×1080: a plan card renders 161–226px tall (median 176) and the columns begin 110px down the page, so the number of cards fully visible without scrolling is **four** on a 900px laptop and **five** on a 1080p display, at every width tried. Six overruns the fold on all three. Five is therefore the largest number that costs nothing on the common desktop, and it takes the page from 1.8–2.2 viewports tall to roughly one.

**Recency is by the phase's own date**, which is the part that makes the cut honest: a column claiming to show the latest five while showing five arbitrary ones is worse than showing all thirteen, because the reader cannot tell the difference. `Released` sorts by its release date, `Endgame` by its delivery date, `Design` and `Development` by approval. `Discovery` has none — a Draft plan has recorded no transition, so there is nothing it is recent *by* — and those cards keep the order they arrived in.

Cards gain a single `phaseDate` field rather than four date fields, and the server picks which record fills it. One field per phase would put the phase→record mapping in every consumer, and a column would then quietly sort by a clock that is not its own — a failure that looks exactly like a sorted column. There is deliberately **no fallback** down to the filename's date prefix: that prefix is when a plan was *written*, which for the plans in `Released` today is months from when they shipped. `""` is the honest answer, and a card carrying it sorts last rather than sorting wrong. The same rule the fleet's row sort follows for an unknown age: *we do not know* is not *newest*.

**The header count keeps counting the whole column.** `Released (13)` above five cards states plainly that eight are hidden; a header that counted the five would read as *there are five*, which is the exact failure truncating must not introduce. The control below says the number too — `Show 8 older`, not `Show more` — because that is the fact a reader deciding whether to click actually needs, and *older* is what tells them the eight are the oldest rather than an arbitrary remainder. This matches how the Agents tab's collapsing groups word the same idea (`QUIET (7)`) rather than inventing a second vocabulary for "how many are hidden".

**It applies to any column past the threshold, not to `Released` alone.** `Endgame` holds ten and will reach it next, and a rule with one hard-coded exception is a rule someone has to remember — and has to remove the week the exception stops being true.

**A highlighted card is never truncated away**, which the plan did not anticipate. The board scrolls to `#plan-<slug>` when a reader arrives via `?plan=` or the plan modal's *Show in board*, and a card the cut removed is not merely un-scrolled-to: `getElementById` returns null and the arrival lands nowhere, silently. That is reachable today — *Show in board* on a plan delivered in July aims at a card the newest five would not include. The highlighted card is kept **in addition** to the limit rather than in place of one of them, so following a link never costs the reader a card they would otherwise have seen.

Expansion is component state, not the URL and not `localStorage`. The query string holds what is worth *sending* to someone — `?tab`, `?lanes`, `?plan` — and "I unfolded Released" is not; nor is it worth persisting, since it is opened to answer one question and the truncated view is the one worth returning to.

<!--
bumps:
  skills:
    plot: minor
-->
