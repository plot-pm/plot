# A stale pulse keeps the sections it had

> A failed scan does not freeze the board — it **re-derives** section membership from the pulse the banner has just called stale. A slice dispatched since that pulse has no commits of its own, `ahead = 0` reads as *landed*, and it appears under DONE. Measured 2026-09-25: five approved, unstarted plans rendered `delivered · merged` with no PR and none of their code on `main`.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #995
- **Sprint:** a-refusal-names-what-it-cannot-see

## Changelog

- When a scan fails, a row keeps the section the last successful scan gave it, and a row that did not exist then is shown as unplaced rather than sorted. The board stops moving live work into DONE while it cannot see.

Board impact: **this is entirely board behaviour.** No script, no scan, no domain rule changes.

## Motivation

**The banner and the sections disagree about what a failed scan means.**

```
Last scan failed: exited 127 — showing the last successful pulse below.
```

The banner treats the failure as *trust the old data*. The sections treat it as *re-derive from the old data*, and those are different operations. Re-derivation runs the classification rules again over a ref list that has moved on, and the rules are not safe on input the board has already labelled stale.

### What it produced, measured 2026-09-25

Five plans, approved and dispatched minutes earlier, rendered under DONE as `delivered · merged`:

```
$ git rev-list --count origin/main..$(git ls-remote --heads origin bug/the-rollup-is-asked-of-open-prs-only | cut -f1)
0
$ gh pr list --head bug/the-rollup-is-asked-of-open-prs-only --state all --json number -q length
0
```

No PR had ever existed, and `--state open` appeared **0 times** in `plot-fleet-scan.sh` — which is what one of those very slices exists to add.

### Why `ahead = 0` is not enough

`plot-fleet-scan.sh:3435-3439` records the reading:

> The landed-work case is not lost; it is answered by the TIP COMPARISON. A branch whose commits are all in `$MAIN` counts `ahead = 0`.

True of a branch that merged. **Also true of a branch that never started** — a claim cut from current `main` counts `ahead = 0` because it has no commits, not because its commits landed. `ahead = 0` means *nothing of its own*, which is either **finished** or **not started**, and the tip comparison cannot separate them.

The comment anticipates a break — *"if a future change makes `ahead` something other than 'commits `$MAIN` lacks', THAT is the invariant that would break"* — but the breaking case is not a change to `ahead`. It is a branch for which `ahead` was never anything else.

**That rule is the mechanism. The cause is that it runs at all on a stale pulse.** A fresh claim did not exist when the last good scan ran; nothing about it should be inferred from that scan's data.

### The estate already argues this, for the colder case

`AgentList.tsx:578-580`, on a board that has never completed a scan:

> **The sections are SUPPRESSED rather than filled.** Rendering `none` per section is a claim about the repository, and a board that never completed a scan has no basis for one.

That principle is right and it is already implemented — `coldState(fleet.ready, fleet.error)` at `:563`. **The gap is the warm case**: a board that scanned once and then failed keeps rendering sections, and those sections are a claim about a repository it can no longer see.

The cold fix was made after a measured incident — *"the truth for ten seconds, then indistinguishable from a working board, forever. Two readers concluded the release was broken; it was not."* This is the same failure one state later, and worse in one respect: an empty board looks broken, while a board showing live work as DONE looks **finished**.

## Design

### The rule

**On a failed or timed-out scan, a row keeps the section the last successful scan put it in.** Nothing is re-derived from data the board has labelled stale.

A row that did **not** exist at the last good pulse has no previous section. It is shown — hiding it would be its own lie — but as **unplaced**, under a heading that says the board cannot classify it yet. It is never sorted into a section, and least of all DONE.

This is strictly safer in both directions: a genuinely merged slice stays in DONE where the last good scan put it, and a freshly dispatched one stays out.

### Where it goes

The classification already happens in one place per row, and the last successful pulse is already retained — that is what the banner renders from. What is missing is **carrying the section forward** rather than recomputing it.

`coldState` is the model: a named state that decides whether sections may be rendered at all. This adds the warm-stale arm alongside it.

### What this does NOT do

- **It does not change `plot-fleet-scan.sh`.** The `ahead = 0` reading is discussed above because it is the mechanism, but it is correct on a fresh pulse and this plan leaves it alone. Whether the scan should ask the host to separate *finished* from *not started* is a separate question with its own cost.
- It does not change the banner, which is already honest.
- It does not suppress sections wholesale on a warm failure. That was the cold answer and it is wrong here: the board has real data, it is merely old, and hiding it would discard a working view over one failed poll.
- It does not touch `auto-deliver`. That it acts on this reading is the reason this matters, not a thing to fix here.

### Open questions

- [ ] **How long may a pulse stay stale before the view is worse than nothing?** The cold case has no threshold because it has no data. A warm one degrades with age, and the board already shows `scanned 286s ago`. Whether a ceiling exists — and whether it suppresses or merely warns — is not answered here.

## Done when

- A board whose scan fails renders every row in the section the last successful scan gave it, asserted against a fixture where the two derivations differ.
- **A row absent from the last good pulse is shown as unplaced, never sorted** — and a test asserts specifically that a claim-only branch does not reach DONE.
- A board that has never scanned still suppresses sections, unchanged: `coldState`'s behaviour is not altered.
- A successful scan re-derives everything as it does today, asserted byte-for-byte on an unchanged fixture.
- The reproduction from #995 is a test: a branch with a ref, zero commits, no PR, against a stale pulse.

## Slices

### A failed scan keeps the last sections (Branch: bug/a-failed-scan-keeps-the-last-sections)

- `bug/a-failed-scan-keeps-the-last-sections` — carry each row's section forward from the last successful pulse when the current scan failed or timed out, rather than re-deriving it; a row unseen by that pulse renders unplaced and never in a section; `coldState`'s never-scanned arm unchanged; tests for the carried-forward case, the unplaced case, the #995 reproduction, and an unchanged successful scan

## Notes

- Found by an operator reading five approved, unstarted plans under DONE and asking *"we just approved 4 plans, now 3 are done already?"* — then, on being shown the mechanism, naming the fix: *"shouldn't they just stay in the original section?"*
- **The 127 that exposed it was a separate fault**, now fixed by a restart: the board held `PLOT_SCRIPTS_DIR` pointing at `~/.claude/plugins/marketplaces/…`, which no longer exists since the marketplace moved to `plugins/cache/`. A long-lived board keeps the plugin path it started with and cannot detect the move. That is worth its own issue and is not this plan.
- **The same session showed a second, worse board failure** — `POST /api/dispatch` blocking the event loop until even `/` timed out at 0% CPU. Also not this plan, also worth filing.
