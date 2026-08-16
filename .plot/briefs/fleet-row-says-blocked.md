## Implementation brief — fleet-knows-what-collides (wave 2b)

- **Plan (canonical):** `docs/plans/2026-08-16-fleet-knows-what-collides.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #142 merged (two interrogation rounds)
- **Branch:** `feature/fleet-row-says-blocked` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`infra/board-artifact-merge`) merged as #144. Your sibling
`feature/dispatch-reports-work-in-flight` is a separate branch on
`plot-dispatch.sh` — not yours.

### What to build

A row must stop reading **`eligible — nobody has taken it`** when a dispatch
would be refused or unwise. The sentence makes two claims and only one is
reliably true: *nobody has taken it* is correct, *eligible* often is not.

The failure is not cosmetic — **the row is indistinguishable from a genuinely
free one.** On the live board `feature/agent-view-phase-ui` (blocked by an agent
holding `AgentList.tsx`) and `feature/plot-sprint-support` (free since February)
rendered the identical note. One waited on a machine, the other on a person, and
the tab exists to tell them apart.

It is also the mismatch this repo already rejects elsewhere: the Start button
appears only on eligible rows, because offering an action the tool will decline
teaches people to distrust the offer. A row that says *eligible* is that offer
in text — and it now literally carries a `Start work` control.

**Two causes, one state.** `blocked by an earlier wave` already exists for the
within-plan case; the vocabulary is missing its counterpart for these:

**1. Work in flight holds files.** Derived from the measured side only — for
every branch with a claim, its local ref and its worktree give the exact files
in play, committed and uncommitted. The row does not claim the candidate *would*
conflict; nothing can know that (the candidate branch does not exist yet). It
says work is in flight with files open, and says so rather than pretending to
certainty. Conservative on purpose: it may mark a safe branch blocked, and that
is the right direction to err — an over-cautious row still leaves the operator
free to start it, and unlike today it tells them what they are deciding against.

**2. The plan is still a Draft.** Seen live: `working-rows-show-motion` was
drafted, its plan PR still in CI, and its two branches immediately appeared as
*eligible*. `plot-plan-meta.sh` reports `phase: draft`, no `Approved:` record,
no `Started:`. NOT STARTED means *discovered, planned, ready for an agent to
pick up* — a plan under review has not reached that point, and `plot-dispatch`
would refuse those branches.

**The data for the Draft case already exists and nothing reads it.** Since #140
the pulse reports each plan's own `phase`, deliberately as data — *"It is
reported, never decides"*. So this is a condition in `classify()`, not a scan
change.

The waiting age gives the tell, honestly and by accident: it is measured from
the `Approved:` record, so a Draft's rows render `—` while `plot-sprint-support`
renders `6mo`. The row already knows it cannot answer; it just says "age
unknown" instead of "not approved yet".

**Derived, never stored.** The pulse is stateless by design: re-compute from
refs and worktrees on every scan, exactly like wave state. A branch stops
reading blocked the moment the work it collided with lands, with nothing to
clear.

**The note names what holds it** — the branch, not merely the fact. *Blocked*
alone invites the next question, and the scan already has the answer.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because a weaker implementation passes without them:

- **A DRAFT plan's branches do not read `eligible`** — assert against
  `phase: draft` with no `Approved:` record; an implementation reading only git
  state passes everything else and misses this.
- **A blocked branch does not read `eligible`**, and its note **differs** from a
  genuinely free branch's — the two rendered identically on the live board.
- **The blocked note names what holds it.**
- **A branch stops reading blocked once the collision lands** — assert against a
  second scan; a stored flag passes the first assertion and fails this.

Plus: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present; macOS
bash 3.2, so no `declare -A`.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists.**

### Scope guard

`classify()` in `packages/board/src/server/fleet.ts`,
`skills/plot/scripts/plot-fleet-scan.sh` if the collision data needs reporting,
and their tests.

**`classify()` is contested, and this is the sharp one.**
`bug/fleet-sees-unpushed-commits` (PR #149) is adding `local_ahead` to the *same
function* and has not merged — it is currently CONFLICTING on the built artifact
and rebasing. Read its diff before you start (`git diff
origin/main...origin/bug/fleet-sees-unpushed-commits`), keep your change to the
group-decision arms it does not touch, and rebase onto it once it lands rather
than racing it.

`feature/agent-groups-collapse` also touches `fleet.ts`, but only the row
**sort** — no overlap with `classify`.

There is an irony worth naming: this branch exists to stop the board inviting
dispatches into exactly this situation, and it was itself dispatched into one.

`.gitattributes` marks the built artifact `-merge`: on a conflict there, take
either side, run `pnpm build:board`, `git add` it, continue. Do not read that
diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
