# A refused dispatch asks for a brief

> The brief gate refuses and nothing writes the brief, so a briefless branch
> stays eligible forever and no one is told why.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

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

### The silent half is the expensive one

A hand dispatch refused for a missing brief prints a refusal an operator reads.
**Auto-dispatch prints nothing** — the branch is filtered out of the candidate
list, so an eligible slice with no brief is never picked up and nothing says why.
It sits eligible while the fleet works on other plans.

### Measured 2026-09-01, and the failure this plan does NOT fix

Three briefs written by hand that day used `feature-…`/`docs-…`/`bug-…`
filenames. `brief_path()` is `${1##*/}` — the branch after its last slash, prefix
dropped — so the gate could not see any of them. **271 of the 280 briefs on main
are unprefixed**; the 9 exceptions were all invisible to the gate that exists to
find them.

**That is a naming defect, not a missing-callback defect, and it argues for this
plan rather than against it:** a `Brief command` writes through one code path
that computes the name the gate reads, so the two cannot disagree.

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

**Staleness must not gate.** A brief can be older than its plan and still
correct — the plan may have gained a Note that changes nothing an implementer
does. Refusing on that would stop the fleet for a false positive, and a gate
people learn to force past has stopped being one.

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

- `feature/a-brief-has-one-name` — one function computes the brief path from a branch, used by `plot-dispatch.sh`, `auto-dispatch.ts` and `/plot-implement`. Fixes the 9 misnamed briefs on main and adds a test that every brief in `.plot/briefs/` matches a name the gate would read. First, because the callback is pointless while a written brief can land where nothing looks.

### Asking

- `feature/a-refused-dispatch-asks-for-a-brief` — the `Brief command` key, read via `plot-config.sh`; `plot-dispatch.sh` invokes it when the brief gate fires; a `no-brief-command` refusal when unconfigured.

### Reporting

- `feature/the-fleet-says-which-briefs-are-missing` — `auto-dispatch.ts` stops silently filtering: the branches it skipped for a missing brief reach the payload, and the board shows them.

## Done when

- **A dispatch refused for a missing brief names what it did next** — called the
  command, or refused with `no-brief-command`. Asserted on both paths.
- **A brief written by the callback lands where the gate reads it**, proven by
  dispatching the same branch again and having it start.
- **Every brief in `.plot/briefs/` matches its branch under the gate's own
  rule**, asserted by a test rather than by review — the 9 exceptions are the
  reason.
- **Auto-dispatch reports a briefless eligible branch** rather than dropping it.
- Staleness is reported and **never refuses**; the report names the plan commit
  it compared against.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm build:board`, changeset.

## Notes

**The gate is not the thing being added.** It exists, on both paths, and it is
careful — `origin/<main>` rather than the working tree, non-empty rather than
present. What is missing is what happens after it fires, and on the auto path
that is currently nothing at all.
