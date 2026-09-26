# Panel — a branch behind main holds nothing

**Two lenses, both amend.** evidence (**executed** — built the fix and ran the suites), estate (read).

## The producer named cannot produce the shape

The plan says `plot-dispatch.sh --start` creates a ref behind main carrying nothing. It cannot. `plot-dispatch.sh:2057` is `git worktree add -q --detach`, and `:2080` states *"THE EMPTY BRANCH IS THE WHOLE POINT … `write_agent_manifest` writes `"branch": ""`"*. A detached checkout creates no `refs/heads/*` and pushes nothing.

Verified by the moderator against both lines. **Whatever a plan names as the producer decides where its fix belongs**, and this named one that makes no refs at all.

**The real source**: a claim always carries `commit --allow-empty` (`plot-worker-loop.sh:2307`), so a *successful* claim reads `claimed`. The behind-main-empty shape comes from a ref whose claim commit was lost or squashed away — which is `a-claim-is-released-not-deleted`'s territory, not `--start`'s.

## Two shipped tests assert the behaviour the plan calls a defect

`packages/domain/test/branch-state.test.ts:279` and `:283`:

```
it('answers merged when its tip is behind main')
it('answers merged where main cannot be read and the tip differs')
```

The second carries a comment defending it: *"The tips are compared, not resolved: an unreadable main is not equality."*

**The plan mentions neither.** A test asserting the opposite of a plan means either the plan is wrong or the test encodes a decision the plan must argue against. This plan does neither.

## The evidence juror built the fix, and bounded it

It applied the change and measured: **4 failed / 38 passed** in `test/branch-state.test.ts`, all four in the file the slice already edits, all asserting `merged` for a zero-ahead behind-main branch. No collateral breakage — the other failures baselined green on unmutated main (5 s timeouts on shell-spawning tests under load).

So the blast radius is bounded and known, which the estate lens could only infer.

## The corpus test passes with the mutant, and that pass is worthless

`packages/domain/corpus/branch-state.corpus.test.ts` went green **with the fix applied**. The juror names why: the corpus compares `branchState` against `plot-fleet-scan.sh --json`, and the scan asks `board/plot-branch-state.mjs` (`plot-fleet-scan.sh:3620`) — a bundle built from the same rule. Both sides moved together.

Verified by the moderator: the corpus imports `branchState` and `readFleetScan`, and the scan's only branch-state answer comes from that artifact.

**This outlives the plan.** CLAUDE.md presents the corpus tier as what catches drift between a rule and its shell duplicate. Where the shell side is a bundle OF the rule, the comparison is the rule against itself, and a reader seeing green has confirmed nothing. Filed separately.

## What survives

The measurement stands: a ref behind main with no commits and no PR reads `merged`, and three approved slices were withheld from dispatch by it. The symptom is real; the cause and the fix location are not established.

## Recommendation

**Amend, substantially.** Establish the real producer before proposing where to fix it, and argue against the two tests by name or accept that the behaviour is intended and the defect is elsewhere.
