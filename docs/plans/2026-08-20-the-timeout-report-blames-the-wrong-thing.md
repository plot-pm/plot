# The timeout report blames the wrong thing

> Board, 2026-08-20: *"timed out after 90000ms — **37 worktrees**, 22 branches,
> **80 ms per git spawn** — the scan spawns git per branch, and every spawn reads
> this estate at startup; **pruning stale worktrees cuts both the count and the
> per-spawn cost**."*
>
> Pruned 26 of the 37. The scan still took 97 s, and the report then read
> **11 worktrees, 106 ms per git spawn** — the count fell 70 %, and the number it
> promised would fall *rose 33 %*.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — falsified by acting on it: 26 of 37 worktrees pruned, scan unchanged, the per-spawn figure rose
- **Delivered:** 2026-08-22, jwloka, PRs #291
- **Started:** 2026-08-20, Jan Wloka, `bug/the-timeout-report-drops-what-it-cannot-measure`

## Problem

The timeout report is the one message a reader acts on when the board stops
telling the truth, and it names a remedy. Measured against that remedy, the
report is wrong in a way that costs work rather than merely misinforming.

### What was measured

| | before pruning | after pruning |
|---|---|---|
| worktrees | 37 | **11** (−70 %) |
| `ms per git spawn`, as reported | 80 | **106** (+33 %) |
| scan wall-clock | timed out at 90 s | **97 s** |
| git spawns in one scan | — | **96** |
| time spent **inside** git | — | **25 s of 131 s** |

Two of those lines each falsify one half of the report's claim. The count fell
and the wall-clock did not. The per-spawn cost was promised to fall and rose.

And the third line moves the whole diagnosis: **81 % of the scan's time is not
in git at all.** Ninety-six spawns totalling 25 s cannot explain 131 s, so no
change to the number of spawns — nor to what each spawn reads — can be the fix
the report proposes.

### Why the per-spawn number cannot mean what it says

`fleet.ts:432-444` states the reasoning: *"every spawn reads the ref database and
the worktree list at startup, so both multiply the launch overhead. `perSpawnMs`
is the launch overhead itself, **timed against this repo's actual estate** rather
than assumed."*

The probe is at `fleet.ts:520`:

    await run('git', ['rev-parse', '--git-dir'], opts.repoRoot);

`git rev-parse --git-dir` prints a path. **It does not read the ref database and
it does not read the worktree list** — so it cannot be timing what the comment
says it times. What it does measure is how long this machine currently takes to
start a process, which is why the number tracked system load rather than the
estate: it rose while the estate shrank.

The same run recorded `git --version` at **2,037 ms** — a call that opens no
repository at all. A probe that can take two seconds to print a version string is
measuring the machine, not the repo.

The irony is documented in the file itself. The comment at `fleet.ts:441-443`
declines to print a spawn count *"rather than printing a fabricated
`spawns ≈ 8 × branches` dressed as a measurement"* — the author saw the trap
precisely, named it, and then built it one value over.

### Why this is worse than a bare timeout

The message it replaced was `timed out after 90000ms`, which says nothing and
misleads nobody. This one names an actor (`worktrees`), a mechanism (*every spawn
reads this estate*), and an action (*pruning stale worktrees*). A reader who
trusts it spends real effort — 26 worktrees removed here — and gets nothing, then
reads a **higher** number and has no way to tell whether the pruning backfired or
the report was never measuring that.

**A wrong explanation is more expensive than no explanation**, because it is
actionable.

## Design

### The report keeps what it measured and drops what it inferred

`worktrees` and `branches` are real counts of real things — they stay. What goes
is the causal sentence built on top of them and the number that pretended to
support it.

| Today | Becomes |
|---|---|
| `37 worktrees, 22 branches, 80 ms per git spawn` | `37 worktrees, 22 branches` |
| *"the scan spawns git per branch, and every spawn reads this estate at startup; pruning stale worktrees cuts both the count and the per-spawn cost"* | *(removed — see below)* |

**`perSpawnMs` is deleted rather than repaired.** A probe that genuinely measured
the estate's effect on spawn cost would have to spawn against a *different*
estate to have anything to compare with, and the board has only this one. There
is no honest version of this number available from inside a single repo, which is
why the fix is removal and not a better probe.

### What replaces the causal claim

The report should say what it can observe and stop. Two candidates, and the plan
picks the first:

- **Name the counts and the timeout, and offer no mechanism.** The reader learns
  the estate is large and the scan did not finish, which is true and is what a
  timeout report owes. It proposes nothing it cannot support.
- Measure where the time actually went and report *that* — the `--stream`
  derivation already emits one line per plan, so a timeout could name the plan it
  died in. Recorded as the follow-up, not this fix: it is a new measurement, and
  this branch's job is to stop asserting a false one.

### What must not change

- **The counts.** `worktrees` and `branches` are measured, cheap, and honest.
- **The `an-outage-is-not-an-answer` rule.** `measureEstate` already returns
  `null` rather than a partial object, so a number that could not be observed is
  reported as absent. That rule is why this defect is a wrong *sentence* rather
  than a fabricated *value* — and it is what the fix leans on.
- **The pruning itself was still worth doing** — 37 worktrees is an unhealthy
  estate for other reasons. What must not survive is the claim that it makes the
  scan faster.

### Open Points

- [ ] Should the timeout report name the plan the scan died in? `--stream` makes
      it possible and it would be a real measurement rather than an inferred one.
      Recorded as a follow-up because it is new work, not a correction.
- [ ] Is there a defensible measurement of git launch overhead at all, or is the
      honest answer that a single-repo board cannot attribute its own slowness to
      its estate?

## Branches

### Says
- `bug/the-timeout-report-drops-what-it-cannot-measure` — `perSpawnMs` and the causal sentence are removed; the counts and the timeout stay. Tests: the report names the worktree and branch counts; it contains no per-spawn figure; it proposes no remedy it cannot support; `measureEstate` still returns null rather than a partial object when a count cannot be read; the bare-timeout fallback is unchanged where no counts are available. PR #291. → #291

## Notes

Found by acting on the report. The pruning was done because the board asked for
it, and the measurement that followed was only taken because the wall-clock did
not move — the second reading (106 ms at 11 worktrees) is what turned a
disappointing result into a falsification.

The failure mode is one this estate keeps producing: a plausible, specific,
number-bearing explanation that points at the wrong quantity. It is the same
shape as `measured-facts-dropped-before-the-contract` and
`board-row-emptiness-is-usually-a-filter` — in each, the code stated a cause it
had not measured, and the measurement, once taken, pointed somewhere else.

Worth recording precisely because the file *already knew*: the comment that
declines to fabricate a spawn count sits four lines above the fabricated
per-spawn cost. **Knowing the rule did not prevent breaking it one value over.**
