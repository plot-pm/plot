# A released plan tells its tracker

> A plan names the issue it answers, ships, and reaches `Released` — and the issue stays open. The write exists in both tracker connectors and `plot-host.sh`; no lifecycle step calls it. Measured: 22 released plans name an issue, and one of them left its ticket open.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #935
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Started:** 2026-09-24, Jan Wloka, `bug/the-scan-reports-an-open-issue`

## Changelog

- Delivering or releasing a plan records the outcome on the tracker issue the plan names, through the tracker connector that already implements the write. Measured 2026-09-24: `a-gate-matches-an-invocation` released in 2.19.0 naming `Issue: #935`, and #935 is still open five days later — found by a sprint sweep rather than by anything in Plot.

Board impact: **yes.** The board's inbox already removes an issue once a plan names it; an issue whose plan shipped is a different state and the board is where a person would see it.

## Motivation

**This is the estate's recurring shape, and CLAUDE.md names it**: *"where a rule exists and nothing calls it, that is a defect to report."*

Every piece is built:

| Piece | State |
|---|---|
| `plot-host.sh issue-status` | implemented — *"THE ONE WRITE TO A TRACKER"* |
| `statusWrite` on the GitHub connector | implemented (`tracker-github.ts:72`) |
| `statusWrite` on the Jira connector | implemented, calls the host (`tracker-jira.ts:86`) |
| A plan's `Issue:` field | parsed as `issues[]`, carried by **23 plans** |
| A lifecycle step that calls any of it | **none** |

`deliver.ts` and `release.ts` mention the tracker **zero times**. So the chain is complete from the domain outward and has no beginning: nothing ever asks.

## Design

### What was measured — RECOUNTED by a panel, and the first draft was wrong three ways

```
plans                           331   (draft said 322)
  naming an issue                33   (draft said 23 — +43%)
  released and naming one        18   (draft said 22; 21 counting delivered)
open tickets                     10   (draft said 7)
  finished plan, issue open       1 → #935          ← the one number that held
```

**Every error moves against the plan's own case per capita** — more issue-naming plans, still one miss — so this is a correction rather than a refutation. But **a plan whose stated evidence is three-quarters wrong cannot be approved on that evidence**, which is why this round is an amend.

Nine of the ten open tickets are today's own drafts.

### The port takes a PR — RESOLVED, and the two connectors want different things

`packages/domain/src/ports/tracker.ts:41-46`:

```ts
export interface StatusWrite {
  /** The pull request the status is about, as its address. */
  prUrl: string;
  status: string;
}
```

The draft assumed this addresses an issue. **A panel found it addresses a pull request, and reading the two connectors resolves what to do about it:**

| Connector | What it does with `prUrl` | Its real subject |
|---|---|---|
| **Jira** (`tracker-jira.ts:78`) | `keyIn(write.prUrl)` — **mines an issue key out of the URL** | the **issue** |
| **GitHub** (`tracker-github.ts:90`) | passes it to `plot-update-board.sh` — *"Update GitHub Projects board status for a PR"* | the **PR** |

**So `prUrl` is not the subject; on the Jira side it is a carrier the connector parses a subject out of.** A plan reaching `Released` already names its issues directly in `issues[]` — a *better* address than a URL to be mined, not an incompatible one.

**The resolution: `StatusWrite` gains an optional issue address, and neither connector is broken by it.** Jira prefers the explicit key over parsing; GitHub keeps writing a PR's Projects status, because on that side the PR genuinely is the subject and `plot-update-board.sh` has no issue equivalent.

**That asymmetry is the real finding**, and it narrows the plan: **a released plan can tell a Jira tracker and cannot tell a GitHub Projects board**, because the GitHub arm's write is about a PR by construction. This estate is GitHub, which is why #935 could not have been written even with the caller in place.

### The gap itself is confirmed, harder than the draft claimed

A juror checked from three directions:

- `statusWrite` has **zero production callers** — only the port interface, the four connectors, and one test
- `deliver.ts`, `release.ts`, `transitions/release.ts`, `entities/release.ts` and the board's `deliver.ts` contain **zero** matches for `tracker|issue`
- `git log -S 'statusWrite'` shows the port's own construction and nothing else; `git log -S 'issueStatus'` returns nothing

**No sibling arm already ships it** — unlike four other plans panelled today.

Two citations in the draft's table were also off: `statusWrite` on GitHub is in `adapters/tracker/`, not `adapters/`, and the Jira one is at `:77` with `:86` being the `issue-status` call inside it.

### Where this belongs

The layering rule decides it and there is no latitude:

- **The decision is the domain's.** *Should this issue's status change, and to what?* is a rule over a plan's phase and its `issues[]` — pure, unit-testable, no I/O.
- **The write is the connector's.** `statusWrite` exists on both connectors and is reached through the tracker port. Nothing new is built there.
- **The caller is the lifecycle step.** `deliver` and `release` are where a phase changes, so they are where the question is asked.

### The shape of the fix

Add one call at the end of the transition that already succeeded:

1. the plan's phase reaches `Delivered` or `Released`
2. the plan names `issues[]` — **absent means nothing to do, and that is the common case**
3. the domain decides the status word
4. the tracker port writes it; the connector reports what happened

### Four refusals, each for a measured reason

- **A plan naming no issue does nothing.** 299 of 322 plans, so this is the default path and must cost nothing.
- **A repository with no tracker does nothing.** `trackerNone` answers `unaskable` on every operation *including the write* — a silent success there would claim a status reached a tracker somebody configured.
- **A failed write does not fail the delivery.** The plan is delivered; the tracker is a copy. A transition that rolls back because a remote service was down would make the tracker authoritative over Plot's own state, which inverts the relationship. **It reports and continues.**
- **The status word is the tracker's, not Plot's.** `statusWrite` already takes a configured status name, because *Done* is not a universal word. A hardcoded one is the defect this must not introduce.

### What this does NOT do

- **It does not close the issue.** `plot-host.sh` already draws this line: Plot *"creates no ticket, closes none, and touches no comment, label or assignee"*. A status is the one fact the tracker owns a copy of. **Closing stays a person's act** — and if that is wanted, it is a different plan with a different argument.
- **It does not backfill.** #935 wants closing by hand; this is about the next one.
- **It does not add a gate.** A delivery must not be refused because a tracker is unreachable.
- **It does not make `Issue:` required.** 299 plans carry none and are correct.

### Open Questions

- [ ] **What should a GitHub estate do?** The Jira path works with an issue address; the GitHub arm writes a PR's Projects status and has no issue equivalent. Either the plan is Jira-only and says so, or `issue-status` gains a GitHub implementation — a bigger change than this plan. **Slice 1's reconcile section serves both**, which is another argument for its ordering.
- [ ] **Delivered, released, or both?** Delivered means the code merged; Released means it shipped to users. A tracker's *Done* probably means the second, but a team watching progress may want the first.
- [ ] **Is one miss enough to justify this?** Stated plainly because it is the honest question: the alternative is a `/plot-reconcile` section reporting released plans with open issues, which costs less and catches the same case a person then acts on. **A reporting section may be the better first slice.**

### Done when

- A plan naming an issue, reaching the configured phase, has that issue's status written through the tracker port.
- **A plan naming no issue, and a repository with no tracker, both do nothing** — and both are unit tests, because they are the common path.
- **A failed write reports and the delivery still succeeds.** The regression this must not cause.
- The status word comes from configuration, never from a literal in the rule.

## Slices

### The reconcile scan reports a released plan with an open issue (Branch: bug/the-scan-reports-an-open-issue)

- `bug/the-scan-reports-an-open-issue` — a read-only section naming every plan at `Delivered` or `Released` whose `issues[]` are still open on the tracker; gated on the host being reachable, reports and never writes. **First because it catches the case at a tenth of the cost**, and because it keeps working where the write is refused

### A finished plan writes its issue status (Branch: feature/a-finished-plan-writes-its-issue-status)

- `feature/a-finished-plan-writes-its-issue-status` — the domain rule deciding the status from a plan's phase and `issues[]`, called by the deliver and release workflows, written through the tracker port; unit tests for the no-issue, no-tracker and failed-write arms

## Notes

- **Panelled 2026-09-24: `amend`.** The conclusion survived and the evidence did not: three of four headline numbers were recounted wrong, two citations were off by a directory or a line, and the port turned out to take a `prUrl` rather than an issue key — which blocks slice 2 until a port decision is made. The juror's own summary is the fair one: *a correction, not a refutation.*
- Found by a sprint sweep on 2026-09-24 cross-checking every open ticket against the plan estate, not by anything in Plot. That is the finding restated: **the only detector was a person looking.**
- **The slice order is a hedge and says so.** The Open Question asks whether one miss justifies a write path at all. Slice 1 answers the same need read-only; if it proves the case is rare, slice 2 can be dropped without having built anything that writes to a remote service.
- The gate that guards this lifecycle fired on this plan's own research: a `grep` naming the deliver script in a search argument was refused as a controller-owned action. That is #935 — a Must Have in the same sprint — reproducing itself while a plan about its sibling was being written.
