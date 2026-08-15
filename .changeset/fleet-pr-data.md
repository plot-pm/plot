---
"plot": minor
---

The Agents tab fills its two empty groups: PR state now says whether a person or a machine is the blocker.

`plot-host.sh pr-list --rich` carries check status and review decision, so the board never talks to the host itself — Principle 3 keeps that knowledge in one place, and a board shelling out to `gh` would silently become GitHub-only.

**Check state has four cases, and two of them mean a person is the blocker.** A PR with an *empty* rollup is neither green nor running: GitHub starts no workflow for a bot PR until a human approves the run, which happened in this repo today. Reporting that as pending would show "CI running" indefinitely while nothing ran, and nobody would look — so it lands in *waiting on you* with the note **no checks**, saying why it is not green rather than implying it is. `ACTION_REQUIRED` is the same situation from the other side and is likewise not pending. One red check among green ones counts red.

Where the host cannot report checks at all (Bitbucket), the answer is `unknown` and the row says *unavailable*. An honest gap beats an invented verdict.

**Review state is shown and never gates.** A row carries *awaiting review*, *changes requested* or *approved* as a note beside its age, because an agent waiting on a review is exactly what the person reading the tab can resolve. But membership comes from checks alone: approved is approved with or without a review — a recorded approval is the plan's `Approved:` record, not a host review — and nothing downstream may treat the note as a condition.

**The two sources cache separately, each with its own age and error.** Git and the host fail independently, so a `gh` hiccup must not stale git data that was available the whole time. The footer reports both ages; a failed PR fetch keeps the last good map rather than blanking it, which would look like state changing instead of data missing.
