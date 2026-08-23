# The column that promises a place and can never hold one

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #127 merged
- **Started:** 2026-08-16, jwloka, `bug/board-shows-discovery`
- **Delivered:** 2026-08-16
- **Released:** 2026-08-18, v2.5.0

## Problem

The board renders five columns. One of them can never contain anything.

```
DISCOVERY  0        DESIGN  2        DEVELOPMENT  3     ENDGAME  1     RELEASED  7
No plans
in this phase.
```

`Board.tsx` renders every column the API returns, unfiltered — so Discovery is
a real column with a real count. And `toBoardPhase` maps `draft → Design`,
`approved → Design | Development`, `delivered → Endgame`, `released →
Released`. **No plan phase maps to Discovery, ever.** The column is not empty
because nothing is happening; it is empty because nothing *can* be.

Meanwhile the same board carries a second meaning for the same word:
`Swimlanes.tsx` removes Discovery from the plan columns
(`BOARD_PHASES.filter((p) => p !== 'Discovery')`) and uses it as the row
header, where the story name *is* the Discovery cell. Two views, two meanings,
one name.

### Design holds two different things, and the real work is in neither

Measured on the live board. The two cards in Design:

| Card | Phase | Approved |
|------|-------|----------|
| `opus5-longhorizon-hardening` | Approved | 2026-07-25 |
| `plot-sprint-support` | Approved | **2026-02-11** |

Neither is being designed. Both are **finished designs waiting for capacity** —
one for three weeks, one for six months.

And the two plans where design is actually happening appear in no column at
all: `fleet-sees-merged-branches` (#126) and `fleet-sees-local-work` (#121),
both `Phase: Draft`, both under PR review.

So a column marked 👤 *human-led* — the one whose scarce resource is a person's
attention — shows work that needs none, and hides the work that is consuming it
right now.

### Draft is the discovery phase; nothing reads it that way

The obvious repair is a new plan type for spikes. It is the wrong shape, and
what is actually in a Draft phase shows why:

```
#126 idea/fleet-sees-merged-branches   5 commits, 545 lines, 0 code
#121 idea/fleet-sees-local-work        2 commits, 141 lines, 0 code
```

And what those five commits did: built throwaway fixtures, measured a
first-parent filter and **discarded** it, tested a second-parent check and
**discarded** it, measured 197 ms against 79 ms, found that GitFlow breaks the
design. That is not transcribing a plan already held — it is finding out what
the plan should be, and most of it was thrown away. **That is a spike**, merely
carried in a plan file.

So no new vocabulary is required, which matters:
[`plot-planning-model`](../stories/plot-planning-model/STORY-plot-planning-model.md)
holds that every term must earn its place. A plan in Draft is not a commitment;
it is the investigation deciding whether there is one, and approval is the
moment discovery ends.

## Design

Two changes, and both are needed: either alone leaves the column empty.

### 1. Map Draft to Discovery

```ts
case 'draft':
  return 'Discovery';
case 'approved':
  return started ? 'Development' : 'Design';
```

Design then means exactly one thing — *designed, not yet started* — which is
what its two current cards actually are. The human-led/agent-led boundary is
untouched: Discovery, Design and Endgame stay 👤, Development stays 🤖.

The swimlane view needs its filter removed in the same change, or the two views
disagree in a new way: today Discovery-as-row-header is coherent *because* the
column holds nothing. Once it holds Draft plans, a row header that silently
drops them is a second bug wearing the first one's clothes.

### 2. Source plan files from the idea branches too

Remapping alone changes nothing visible, because **a Draft plan under PR review
is not on the default branch at all**. `collectPlanFiles()` walks
`docs/plans/{active,delivered,}` on the filesystem — one branch's working tree.
Confirmed exhaustively: of every plan file on `main`, **not one is in phase
Draft**. Draft is not rare here, it is unreachable from that source.

Those plans are exactly what lives on the idea branches, and the branches say
so cleanly. Enumerated over both:

```
idea/fleet-sees-merged-branches
  14 plan files identical to main
  2026-08-16-fleet-sees-merged-branches.md   phase=Draft  on-main=0   ← exactly one
idea/fleet-sees-local-work
  14 plan files identical to main
  2026-08-16-fleet-sees-local-work.md        phase=Draft  on-main=0   ← exactly one
```

Each idea branch carries **exactly one** plan file absent from the default
branch, and it is exactly the Draft one. Everything else matches `main` because
the branch was cut from it. So the rule needs no new convention:

> plan files on branches under the configured idea prefix that are **not** on
> the default branch — that set *is* the Draft plans.

`Branch prefixes` is already config (`idea/, feature/, bug/, docs/, infra/`),
so this stays project-agnostic (Principle 5), and the phase is still read from
the file exactly as for every other plan. Nothing is inferred from the branch
name beyond *where to look* — which is what keeps this from becoming a
convention the board enforces.

**Read the local mirror, never the network.** Measured:

```
git ls-remote --heads origin 'refs/heads/idea/*'    459.3 ms   ← network
git for-each-ref refs/remotes/origin/idea/*           8.0 ms   ← local
git ls-tree / git show                                7.1 ms
```

57×, and the local answer is already correct: the fleet scan fetches every run,
so `refs/remotes/origin/*` is as fresh as the pulse. Total ≈ 8 ms + 7 ms per
idea branch — ~22 ms for today's two, against the ~1 s the board already
spends. This is the same git-only discipline that makes `plot-fleet-scan.sh`
affordable to poll every 5 s, and it must not be traded away for a
`ls-remote` that looks more authoritative.

### The trap: `plot-plan-meta.sh` needs a real file

The parser takes paths, not content (`Usage: plot-plan-meta.sh <plan-file>…`),
so a git-sourced plan must be written somewhere before it can be parsed. Tested
— it parses correctly from any path:

```
$ git show origin/idea/…:docs/plans/2026-08-16-….md > /tmp/probe.md
$ plot-plan-meta.sh /tmp/probe.md
phase: draft | type: bug | story: plot-gates | branches: ['bug/fleet-merged-branch-state']
```

But the returned `file` field is then the **temp path**, and the card renders
`card.path` verbatim (`PlanCard.tsx`). Left alone, a Discovery card would
display `/var/folders/…/probe-plan.md` instead of
`docs/plans/2026-08-16-….md`. The repo-relative path must be restored after
parsing — the plan's identity is its canonical path, not wherever it was
staged.

### Generalises to `same branch` plans, and that is deliberate

An `Impl: same branch` plan rides `feature/<slug>` rather than an idea branch,
so its Draft phase is invisible for the identical reason. The rule as stated —
*plan files on a prefixed branch, absent from the default branch* — already
covers it. Do not narrow the implementation to `idea/` only; the prefix list is
config and all of it should be searched.

## Waves

### Implementation (Branch: bug/board-shows-discovery, PR: #130)
- `toBoardPhase` maps Draft to Discovery, the
  swimlane filter goes, plan files are additionally sourced from prefixed
  branches via the local ref mirror, canonical paths restored after parsing;
  tests in `packages/board`

One branch. The two changes are a single behaviour — a column that fills — and
splitting them would ship a remap that changes nothing visible, then a source
change whose effect cannot be seen without the remap. Neither half is testable
alone.

## Done when

- **A Draft plan under PR review appears in Discovery.** Demonstrate against
  the real repo: #126 and #121 both render as Discovery cards. Do not assert
  it from the code.
- **Design shows only approved-not-started plans**, and the two cards there
  today stay put.
- **The swimlane view shows the same plans as the column view.** Assert both
  renderers over one board payload; a Draft plan visible in columns and absent
  from swimlanes is the current bug inverted.
- **The card's path is the repo-relative plan path**, never the staging path
  used for parsing. Assert the exact string — this fails silently and looks
  merely untidy rather than wrong.
- **No network call is added to the board's poll path.** Pin it: the
  implementation uses `for-each-ref`, not `ls-remote`. Measuring is not enough,
  because the wrong call is only ~450 ms slower and would pass any generous
  timing assertion while quietly making a 5-second poll a network dependency.
- **A repo with no idea branches behaves exactly as today.** The common case
  for adopters; the new source must be additive and silent when empty.
- **An `Impl: same branch` plan in Draft is found too** — same rule, branch
  under any configured prefix.
- **A branch with no plan files is skipped without error**, as are prefixed
  branches whose plan files all exist on the default branch (no duplicate
  cards). De-duplication is by canonical path, matching `collectPlanFiles`'s
  existing contract.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.

## Notes

Third instance in one day of a single underlying question, and worth naming as
such: a deleted ref is not missing work
([`fleet-sees-merged-branches`](2026-08-16-fleet-sees-merged-branches.md)), and
the default branch is not all the plans. Manifesto Principle 1 says git **is**
the database — in both cases the reader was consulting one branch's working
tree and treating absence there as absence of the thing.

Scope: this plan owns the *rendering*. Whether Plot's vocabulary should gain a
term for decision-producing work is
[`plot-planning-model`](../stories/plot-planning-model/STORY-plot-planning-model.md)'s
open question. The answer recorded there — that Draft already is that phase —
is what makes this plan a bug fix rather than a feature, and if that answer
changes, this plan changes with it.

Runs concurrently with `bug/fleet-merged-branch-state` (#126) and
`feature/update-board-test`: this one is `packages/board/**` only, the other two
are `skills/plot/scripts/**` and `test/reconcile/**`. The built board artifact
is the one file parallel branches collide in, and only this plan rebuilds it.
