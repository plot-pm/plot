---
"@plot-pm/board": patch
---

**A board whose server has died now says so.** Until now it looked exactly like a working one.

The Agents tab had no rendering at all for a failed fetch. `AgentList` read `fleet.error` only to choose the pre-first-scan message; after the first successful scan the error state was unrepresented, and the tab kept drawing its last payload — with a countdown clamped at `next in 0s`, which reads as *about to refresh*, and ages that went on advancing against a scan that had stopped happening. The sibling Board tab reported the outage while Agents hid it.

It cost a real misdiagnosis on 2026-08-16: two screenshots were reported as regressions ("the heading is still there", "the plan link is still missing"), and neither was true on the live board — both were the frozen last render of a page whose server had stopped. Three hypotheses (stale bundle, JSX guard, minification) were spent before anyone checked what was actually running.

**The failure that had no vocabulary.** `fleet.error` is the server *answering* to say its own scan failed — a payload arrived, saying so. A dead server answers nothing, and no field inside a document the client never received can report that. So the signal now comes from where the fetch happens: `App` records when `/api/fleet` last answered and whether it has failed since, and passes the silence to the tab as `staleSeconds`. The two failures render as separate banners, because they send the reader to check different things and both can be true at once.

Four decisions, each reached by discarding the obvious answer:

- **The first failed fetch is enough** — no two-strikes rule. The outcomes are not symmetric: a hiccup shows a banner that clears itself four seconds later, while a dead server that looks healthy for two poll intervals costs a diagnosis.
- **It recovers by itself** on the next successful fetch, with no reload. The polling never stopped, so the page can observe its own recovery; with a first-failure threshold, a "stale until reload" rule would strand the view on every hiccup.
- **The first-load message stays separate.** *Waiting for the first fleet scan…* is a different statement from *this data is old* — one has never had an answer, the other has one it no longer trusts. Merging them would let an empty view claim staleness it cannot have.
- **Degrade, do not hide.** The last payload stays on screen; it is still the best information available. What changes is the confidence around it — the countdowns disappear rather than freezing (a held number is still a prediction), the ages stop advancing and say they are frozen, and the banner reports how long ago the last answer arrived.

Pinned by seven browser tests driving the shipped artifact, six of which fail against the old code on their own assertion — including the ones the plan called out as the ones a naive test passes without: on **one** failure, on the **recovery** and not only the failure, on the ages actually **freezing**, and on the first-load message staying distinct.

<!--
bumps:
  skills: {}
-->
