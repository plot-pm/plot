# A stale pulse keeps the sections it had

> A failed scan does not freeze the board — it **re-derives** section membership from the pulse the banner has just called stale. Measured 2026-09-25: five approved, unstarted plans rendered `delivered · merged` with no PR and none of their code on `main`. **What classified them is not yet known** — a panel refuted this plan's first explanation — but re-deriving sections from data the banner has called stale is how a board reports work it cannot see.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #995
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Started:** 2026-09-25, Jan Wloka, `bug/a-failed-scan-keeps-the-last-sections`

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

### The mechanism is NOT established, and an earlier draft of this plan named the wrong one

That draft blamed `plot-fleet-scan.sh:3435-3439`'s tip comparison: `ahead = 0` on a
claim-only branch reading as *landed*. **A panel juror refuted it and the refutation
holds.** `packages/domain/src/rules/branch-state.ts:215` returns **`claimed`** when
`realCommitsAhead === 0`, and `merged` is returned only at `:183` (a merge subject was
found) or `:187`/`:233` (`pr === 'MERGED'`). A branch with a ref, no commits and no PR
cannot reach `merged` by that path. **So the stated reproduction does not reproduce the
reported symptom**, and the first task of this slice is to find the arm that does.

Two candidates, neither verified:

- **The pulse's refs are simply old.** A branch dispatched after the last good scan is not
  in that pulse at all, so it is a row the board has never seen — this plan's own *unplaced*
  case rather than a mis-classification. If this is what happened, the DONE rows were
  something else and need their own explanation.
- **`classify` reaches `done` by PHASE.** `fleet.ts:4366` and `:4558` both return the `done`
  group when `planPhase` is `delivered` or `released`, and the observed note read
  `delivered · merged` — *delivered* is a phase word. **Against it:** all five plans read
  `Approved` on `main`, not `delivered`, so this needs a stale or mis-read phase to fire.

**Settling this needs the board reproduced under a failed scan**, which was not available
at panel time. The rule below is worth building on its own argument; it must not be sold as
the fix for five rows whose cause is unidentified.


### The estate already argues this, for the colder case

`AgentList.tsx:578-580`, on a board that has never completed a scan:

> **The sections are SUPPRESSED rather than filled.** Rendering `none` per section is a claim about the repository, and a board that never completed a scan has no basis for one.

That principle is right and it is already implemented — `coldState(fleet.ready, fleet.error)` at `:563`. **The gap is the warm case**: a board that scanned once and then failed keeps rendering sections, and those sections are a claim about a repository it can no longer see.

The cold fix was made after a measured incident — *"the truth for ten seconds, then indistinguishable from a working board, forever. Two readers concluded the release was broken; it was not."* This is the same failure one state later, and worse in one respect: an empty board looks broken, while a board showing live work as DONE looks **finished**.

## Design

### The rule

**On a failed or timed-out scan, a row keeps the section the last successful scan put it in.** Nothing is re-derived from data the board has labelled stale.

A row that did **not** exist at the last good pulse has no previous section. It is shown — hiding it would be its own lie — but as **unplaced**, under a heading that says the board cannot classify it yet. It is never sorted into a section, and least of all DONE.

**This is not strictly safer, and the plan does not claim it is.** It trades one wrong answer for another: a slice that genuinely merged during the outage keeps its old section and reads as still working. The trade is deliberate — a stale *working* row understates progress, while a stale *done* row hides work somebody is waiting on, and only the second is acted on by `auto-deliver`.

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
- **The arm that produced the five DONE rows is identified and named in the plan**, before the rule is built. A branch with a ref, zero commits and no PR reads `claimed` (`branch-state.ts:215`), so that fixture does not reproduce the symptom and cannot be the test.

## Slices

### A failed scan keeps the last sections (Branch: bug/a-failed-scan-keeps-the-last-sections)

- `bug/a-failed-scan-keeps-the-last-sections` — carry each row's section forward from the last successful pulse when the current scan failed or timed out, rather than re-deriving it; a row unseen by that pulse renders unplaced and never in a section; `coldState`'s never-scanned arm unchanged; tests for the carried-forward case, the unplaced case, the #995 reproduction, and an unchanged successful scan

## Notes

- **Panelled 2026-09-25: `amend`, `Evidence: read`** — the machine was at load 31 with eight agents, so the juror was told to read rather than run, and it declared that honestly instead of claiming measurements it had not taken. **It refuted this plan's mechanism.** The draft blamed `ahead = 0` reading as landed; `branch-state.ts:215` returns `claimed` for exactly that shape and `merged` needs a merge subject or `pr === 'MERGED'`. Verified here: the file is 302 lines, so the juror's `:337`/`:385` citations are wrong while its substance is right. It also caught that *"strictly safer in both directions"* was false. Verdict: `.plot/panels/a-stale-pulse-keeps-the-sections-it-had/juror.md`.

- Found by an operator reading five approved, unstarted plans under DONE and asking *"we just approved 4 plans, now 3 are done already?"* — then, on being shown the mechanism, naming the fix: *"shouldn't they just stay in the original section?"*
- **The 127 that exposed it was a separate fault**, now fixed by a restart: the board held `PLOT_SCRIPTS_DIR` pointing at `~/.claude/plugins/marketplaces/…`, which no longer exists since the marketplace moved to `plugins/cache/`. A long-lived board keeps the plugin path it started with and cannot detect the move. That is worth its own issue and is not this plan.
- **The same session showed a second, worse board failure** — `POST /api/dispatch` blocking the event loop until even `/` timed out at 0% CPU. Also not this plan, also worth filing.
