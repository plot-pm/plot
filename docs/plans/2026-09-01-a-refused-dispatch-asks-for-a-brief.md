# A refused dispatch asks for a brief

> The brief gate refuses and nothing writes the brief, so a briefless branch
> stays eligible forever and no one is told why.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-09-01, Jan Wloka, `feature/a-brief-has-one-name`
- **Started:** 2026-09-01, Jan Wloka, `feature/a-refused-dispatch-asks-for-a-brief`

## Changelog

- A dispatch refused for a missing brief now asks an agent to write one, through
  a configured `Brief command`, instead of skipping the branch silently.

Board impact: `auto-dispatch.ts` gains a call site and the fleet payload gains a
reason; `plot-dispatch.sh` gains one optional invocation. The plan format, the
template and `docs/plans` layout are untouched.

## Motivation

### The gate exists on both paths and neither writes

**`plot-dispatch.sh:305`** — *"a missing brief PREPARES but does not START: the
worktree and claim above are correct and stay; only the launch is refused."* It
reads `origin/<main>` rather than the working tree, requires non-empty rather
than merely present, and both directions were measured 2026-08-27.

**`auto-dispatch.ts:569`** — `findMissingBriefs()` removes briefless branches
from the candidate set before any spawn is budgeted.

Both are correct. **Neither has a next step**, and `plot-dispatch.sh:75` says why
it cannot be the one to take it:

> this script cannot write a hand-off brief and never will. A brief is
> interpretation (which alternatives a plan rejected, which measurement killed
> them) and bash cannot reach one at all.

### The silent half, stated precisely

A hand dispatch refused for a missing brief prints a refusal an operator reads.
**Auto-dispatch prints nothing about its own decision** — `auto-dispatch.ts:442`
drops the branch from `startable` and the plan is skipped with no reason
recorded.

**The branch itself is NOT invisible, and an earlier draft of this plan said it
was.** `BriefStateSchema` carries `present` / `missing` / `unknown` per branch,
and `WaitingOnSchema` has `needs-brief` as a row verdict — both rendered. A
person reading the board can already see that a branch needs a brief.

**So what is missing is one step narrower:** the row says *this branch needs a
brief*; nothing says *auto-dispatch skipped this plan for that reason*. An
operator watching the fleet make no progress on an eligible plan has to infer
the connection from a row hint they may not be looking at.

### Measured 2026-09-01, and the failure this plan does NOT fix

Three briefs written by hand that day used `feature-…`/`docs-…`/`bug-…`
filenames. `brief_path()` is `${1##*/}` — the branch after its last slash, prefix
dropped — so the gate could not see any of them. **271 of the 280 briefs on main
are unprefixed**; the 9 exceptions were all invisible to the gate that exists to
find them.

**Measured again before approval: 6 of the 278 briefs on main carry a prefix,
and not one of them names a branch that still exists.** Those refs were deleted
after their PRs merged, so the residue harms nothing today — the *"fix the six"*
framing an earlier draft used is cleanup, not a blocker.

**And the writer's defect is in the DOCUMENTATION.** Found while briefing the
Naming slice: three readers already agree on the last path segment —
`plot-dispatch.sh:336` (`${1##*/}`), `auto-dispatch.ts:549` and
`attention.ts:55` (both `branch.split('/').pop()`). **`/plot-implement` step 4
instructs the opposite:** *"the branch name with `/` flattened to `-`"*. Under
that instruction `feature/the-refusals-are-domain-rules` becomes
`feature-the-refusals-…`, which no reader computes.

So the skill tells its author to write a file the gate cannot see, and three
briefs were written that way on 2026-09-01 by an agent following it. **Fixing
the code without fixing that sentence leaves the defect generating new cases**,
which is why the skill edit is in the Naming slice rather than deferred.

**The defect that matters is in the writer, not the residue.** Three briefs were
written by hand that day under names the gate cannot read, which means a
`Brief command` writing through the same wrong convention would produce a file
the gate then reports as missing — and it would do so on every call, silently.
**One function computing the name for writer and reader is what makes the
callback safe**, and that is why it lands first.

### And the failure a callback cannot catch

The teardown brief on `bug/a-test-teardown-does-not-call-rmsync` was written
against a plan claiming **80 `fs.rmSync` sites and 1 `rmTree` call site**. The
tree that day held **76 and 88** — the conversion had largely landed through
other work, and `rmTree` had moved from `helpers.mjs:455` to `:496`.

**An existence check passes a brief like that happily.** Staleness is the failure
that actually costs time, and it is not decidable by grep. This plan handles it
as a heuristic and says so, rather than claiming a gate it does not have.

## Design

### One config key, the shape three keys already use

`Idea command`, `Story command` and `Approve command` each name how to run an
agent headless for one prompt. `Brief command` joins them:

    - **Brief command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

**Absent means the capability is unavailable, never an error.** `commission.ts`
already models this with a named refusal — `no-idea-command` — and the same
shape applies: a project with no `Brief command` behaves exactly as today.

### What it is asked to do

Run `/plot-implement <slug>` for the branch, whose step 4 already owns brief
authorship. **This plan adds no second brief writer**, which is the whole reason
it is a config key rather than a new script: `/plot-implement` is where the
interpretation lives, and a second author would drift from it.

### Absent and stale are two triggers, and only one is a gate

| | decidable by | this plan |
|---|---|---|
| **absent** | `git cat-file -s` on `origin/<main>` — already implemented | **gates**: refuse, then call |
| **stale** | brief's last commit older than the plan's | **reports**: never refuses |

**Staleness must not gate, and the measurement is unambiguous.** Compared on
2026-09-01, every one of the three live briefs was older than its plan:

| brief | brief commit | plan commit |
|---|---|---|
| `a-test-teardown-does-not-call-rmsync` | 12:34 | 12:36 |
| `the-refusals-are-domain-rules` | 12:34 | 12:19 → later edits |
| `a-machine-has-an-identity` | earlier | 12:26 |

**All three are correct**, and all three plan edits were bookkeeping — a PR
annotation, a measurement note, a re-measure before approval. **A timestamp gate
would have refused 3 of 3**, every one a false positive, on the day it shipped.
A gate that refuses everything is one people disable in its first week.

**And it would still have missed the real case.** The teardown brief was written
AFTER its plan and was nonetheless wrong: it cited 80 `fs.rmSync` sites where the
tree held 76, because **the code moved, not the plan**. Freshness relative to the
plan is the wrong input — the brief's claims are about the repository, and
nothing compares those to the repository.

**So a gate here is not merely weak, it is aimed at the wrong thing.** What would
actually gate is a brief whose *stated measurements* disagree with the tree, and
that requires understanding which numbers in a paragraph are claims — judgement,
not grep. Hence: report, and say plainly that the report is a hint.

### Not chosen: have the script write a stub

Rejected. A stub brief is *present and non-empty*, so it passes the gate and
starts a worker into a specification that says nothing — strictly worse than the
refusal it replaces, because the refusal is visible and the stub is not.

### Not chosen: make auto-dispatch spawn the brief agent inline

Rejected for budget. `auto-dispatch.ts` spends a bounded number of spawns per
pass; a brief agent is a `claude -p` session of unknown length. It is **queued
and reported**, and the operator or the next pass acts on it — the same posture
`commission.ts` takes.

## Branches

### Naming

- `feature/a-brief-has-one-name` — one function computes the brief path from a branch, used by `plot-dispatch.sh`, `auto-dispatch.ts` and `/plot-implement`, with a test that every brief in `.plot/briefs/` matches a name the gate would read. **First because of the WRITER, not the residue:** a `Brief command` writing under the wrong convention produces a file the gate then reports as missing, on every call, silently. The 6 prefixed briefs on main name no branch that still exists and are cleanup carried along, not the reason. → #603

### Asking

- `feature/a-refused-dispatch-asks-for-a-brief` — the `Brief command` key, read via `plot-config.sh`; `plot-dispatch.sh` invokes it when the brief gate fires; a `no-brief-command` refusal when unconfigured.

### Reporting

- `feature/auto-dispatch-says-why-it-skipped` — **the skip REASON, not the brief state.** `BriefStateSchema` and `needs-brief` already carry per-branch brief presence to the row, and both render; what nothing records is that `auto-dispatch.ts:442` dropped a plan from its candidates for that reason. The smallest of the three, and it was over-scoped in the plan's first draft.

## Done when

- **A dispatch refused for a missing brief names what it did next** — called the
  command, or refused with `no-brief-command`. Asserted on both paths.
- **A brief written by the callback lands where the gate reads it**, proven by
  dispatching the same branch again and having it start.
- **Every brief in `.plot/briefs/` matches its branch under the gate's own
  rule**, asserted by a test rather than by review — and the writer computes its
  name through the same function the gate reads, which is the property the test
  protects.
- **Auto-dispatch records why it skipped a plan**, where today it silently
  reduces `startable`. The per-branch `briefState` already reaches the row; this
  is the plan-level decision.
- Staleness is reported and **never refuses**; the report names the plan commit
  it compared against.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm build:board`, changeset.

## Notes

**The gate is not the thing being added.** It exists, on both paths, and it is
careful — `origin/<main>` rather than the working tree, non-empty rather than
present. What is missing is what happens after it fires, and on the auto path
that is currently nothing at all.
