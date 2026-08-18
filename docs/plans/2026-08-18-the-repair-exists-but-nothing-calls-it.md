# The repair exists, but nothing calls it

> `plot-resolve-artifact.sh` was built to fix exactly one thing automatically — a board-artifact merge conflict. Three PRs hit that conflict in one afternoon and a human resolved all three by hand, because nothing watches for the condition the script was written to answer.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `feature/the-scan-sees-a-repairable-conflict`
- **Delivered:**
- **Released:**

## Changelog

- Plot detects an artifact-only merge conflict on a plan's branches and reports it as repairable, so the one conflict class that needs no judgement stops consuming an operator's attention.

## Correction 2026-08-18: the premise was wrong

**A dispatched worker verified that most of this plan was already built**, on
2026-08-17 — the day *before* the plan asking for it was written. The plan's
central claim, *"Nothing ever calls it"*, is false:

| The plan asks for | Where it already is |
|---|---|
| conflict detection | `plot-fleet-scan.sh:822` `conflicts_of()` |
| the exactly-the-artifact fence | `stuck.ts:115` `isArtifactOnly()` |
| the trigger | `fleet.ts:806` `startRepair()` |

All three verified by reading the source. The scan reports the conflict SET and
`stuck.ts` classifies it one layer up — which is Principle 3 (scripts collect,
skills interpret) applied more carefully than this plan proposed, since the
plan wanted the classification in the shell.

The error was mine and it was cheap to avoid: I grepped `plot-fleet-scan.sh`
for a caller and concluded there was none, without looking in the board. A
claim about what *nothing* does needs a wider search than a claim about what
one file does.

**The worker wrote no code**, correctly: implementing the brief would have
duplicated working, tested code. `conflicts.test.mjs` already asserts the
artifact-only set, the mixed set naming both files, the clean set, and that the
scan writes nothing.

**What survives.** One real gap, found by the same worker: `PLOT_BOARD_REPAIR`
does not exist. The repair is gated on state alone and cannot be disabled
without stopping the board — which the design in this plan calls non-optional.
That is wave 2's remaining work, and it is now the only work here.

**Wave 3 is built too** — `repairFor()` at `resolver.ts:175` returns what a row should say about its repair, rendered at `fleet.ts:1990`. Verified against the source. So two of the three waves are deferred as already-done, and the worker's full report is kept beside this plan as `2026-08-18-the-repair-exists-report.md`.

Also reported and not acted on: `test:board` is order-dependent on main. One
run failed *"does not overwrite the file when a scan FAILS"* while the branch
changed no source, so the flake is main's, not the branch's.

## Motivation

Measured 2026-08-18, merging five bug branches after a release:

```
#220 bug/a-refresh-that-never-fires...  CONFLICTING → board-server.mjs
#221 bug/the-board-says-when...         CONFLICTING → board-server.mjs
#224 bug/a-rows-actions-live-in-its-menu CONFLICTING → board-server.mjs
```

All three were the same conflict, in the same generated file, with the same
resolution: take either side, `pnpm build:board`, commit. All three were
resolved by hand, one at a time, while `skills/plot/scripts/plot-resolve-artifact.sh`
sat in the repo doing precisely that.

The operator's question was the finding: **"don't we have a monitor in place
that triggers the fixes?"** There is no such monitor, and no plan for one. The
script is documented in CLAUDE.md as *"the ONE automatic write"* — but nothing
ever calls it.

### Why this conflict recurs by design

`board-server.mjs` is a build artifact committed to the repo, because the board
must run from a checkout without a build step. Every branch that touches
`packages/board/**` regenerates it, so **any two such branches collide there**,
always, regardless of whether their real changes overlap at all.

Three of this session's five bug branches touched the board. The conflict is
not an accident of timing — it is the arithmetic of a committed artifact and a
parallel fleet.

### Why it is safe to automate, and why that is unusual

CLAUDE.md states the licence precisely:

> Licensed by three verified properties (`-merge` keeps the file valid, the
> rebuild is deterministic, CI's no-diff gate proves it) and by nothing else —
> a script rather than an agent, because judgement's absence *is* the
> permission.

That is a high bar and this conflict clears it: `.gitattributes` marks the file
`-merge` so git keeps one side whole rather than splicing markers into it; the
rebuild overwrites whichever side was kept; and CI fails if the committed
artifact differs from a fresh build. **Nothing about the choice can matter.**

Almost no other conflict has that property, which is exactly why the automation
must stay this narrow.

### What the script already refuses, correctly

Measured while prototyping a watcher, all three refusals fired and all three
were right:

| Situation | Refusal |
|---|---|
| worktree holds unrelated edits | `worktree-busy` |
| conflict resolved meanwhile | `no-conflict` |
| a repair already running | `already-in-flight` |

And a conflict set that is *not* exactly the artifact is refused outright — PR
#57 was correctly identified as needing a human, naming `.gitignore`,
`MANIFESTO.md` and two SKILL files.

**So the script is not the gap. The trigger is.**

## Design

### Approach

**The fleet scan reports the condition; the fleet skill offers the repair.**

`plot-fleet-scan.sh` already answers *what is the state of this plan's
branches*. An artifact-only conflict is one more fact of that kind, and it is
derivable from data the scan can reach: `git merge-tree` against `origin/main`
gives the conflict set without touching a worktree.

A branch whose conflict set is **exactly** the artifact is reported as
`conflict:artifact` — repairable. Any other conflict set is `conflict:manual`,
naming the files, exactly as today's silence does not.

**The scan still writes nothing** (Manifesto Principle 1). It reports a fact;
`/plot-fleet` presents it with the command that fixes it, and a human or a
dispatch decides. The one automatic write stays where it is — inside
`plot-resolve-artifact.sh`, invoked deliberately.

### The pulse repairs it, and that is a deliberate escalation

The board's pulse already runs — every 5 s for git, 60 s for the host — and it
already sees `mergeable`. It also already writes: `/api/approve` and
`/api/dispatch` are POST endpoints that change the repository. So a repairing
pulse is not a new capability class; it is the same capability without a click.

**That difference is the whole risk, and it is named rather than smoothed
over.** Today's writes happen because a person pressed something and is
therefore watching. A repairing pulse writes to branches at 5 s intervals with
nobody in the room, while agents are working in those worktrees.

Chosen anyway, because the specific repair carries no judgement (the three
verified properties above) and because the alternative — a human resolving the
same conflict by hand three times in one afternoon — was measured, not
imagined.

Two constraints make it survivable, and neither is optional:

**The script's refusals are the safety, so they must stay load-bearing.** All
three fired correctly during a prototype run on 2026-08-18: `worktree-busy`
when unrelated edits sat in the worktree, `no-conflict` when the collision had
already cleared, `already-in-flight` when a repair was running. The pulse adds
no checks of its own and overrides none of these — if the script refuses, the
pulse reports the refusal and does nothing.

**Every repair is announced in the row it touched.** A silent automatic push is
indistinguishable from a branch that never conflicted, and three artifact
conflicts in one afternoon is a signal about committing a build artifact into a
repo with a parallel fleet. The row says *repaired the artifact, N minutes ago*,
so the arithmetic stays visible even as the tedium disappears.

**It repairs nothing else.** A conflict set that is not exactly the artifact is
reported for a human and never touched — verified in the prototype against PR
#57, which was correctly identified as needing one, naming `.gitignore`,
`MANIFESTO.md` and two SKILL files.

### The off switch

A pulse that writes must be refusable without stopping the board. `PLOT_BOARD_REPAIR=0`
disables the repair while leaving the detection and the report intact, so an
operator who wants to see the conflicts without the board acting on them can
have exactly that.

The default is on. A repair nobody enables is the state this plan exists to
leave.

### Open Points

- [ ] Should `/plot-merge-queue` order branches to *avoid* the collision —
      merging board-touching branches consecutively so only the first conflicts?
      It already predicts collisions; this would act on the prediction.
- [ ] Is the artifact path configurable, or is `board-server.mjs` special-cased?
      Plot is project-agnostic (Principle 5), and another repo's committed
      artifact deserves the same treatment. A `## Plot Config` key —
      `Generated artifacts` — would generalise it, at the cost of a rule an
      adopting repo must state correctly or get wrong dangerously.
- [ ] Does a `conflict:artifact` branch block its wave? It is merge-ready in
      every sense except the mechanical one, and reporting it as blocked
      overstates the problem.

## Branches

- `feature/the-pulse-repairs-the-artifact` <!-- deferred: verified already implemented 2026-08-17 — conflicts_of() at plot-fleet-scan.sh:822, isArtifactOnly() at stuck.ts:115, startRepair() at fleet.ts:806, all covered by conflicts.test.mjs. --> — detection and repair, already on main before this plan was written.

- `feature/the-repair-can-be-turned-off` — `PLOT_BOARD_REPAIR` gates the pulse-side repair, defaulting to on. Today the repair is gated on state alone, so an operator who wants to see artifact conflicts without the board acting on them has no way to say so — and the design calls that switch non-optional. Tests: `PLOT_BOARD_REPAIR=0` detects and reports but never writes; unset behaves exactly as today; the variable never converts a refusal into a repair.

- `feature/a-repaired-row-says-so` <!-- deferred: verified already implemented 2026-08-17 — repairFor() at resolver.ts:175 returns what the row should say about a branch's repair, rendered at fleet.ts:1990. --> — a row whose artifact the board repaired says so, with when.

## Notes

The watcher prototype lived for one afternoon and resolved nothing that a human
had not already started. Its value was diagnostic: it proved the refusals work
and that the detection is one `git merge-tree` away.

Related: `docs/plans/2026-08-18-a-stale-ref-outranks-the-host.md` and
`docs/plans/2026-08-18-not-yet-asked-is-not-nothing.md` came out of the same
fleet run. All three are cases of Plot holding the answer and not being asked.
