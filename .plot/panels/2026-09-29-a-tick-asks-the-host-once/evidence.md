Position: amend
Evidence: executed

# The evidence lens on `a-tick-asks-the-host-once`

The plan's hops are real — every one I checked resolves where it says. That is
unusual for this author and worth stating first. What the plan gets wrong is the
**arithmetic**, and the arithmetic is the whole argument: it proposes a fix
bounded by the tick for a cost that is already bounded by the tick, while
leaving the one call site that genuinely scales unnamed.

## 1. The hops are real, and I executed the tick

Every citation verified:

- `queue-reading.ts:212` — `await world.queuedHasLanded(entry.branch)`, inside the plan loop. **Correct.**
- `queue-reading.ts:226` — `await world.sliceHasMerged(entry.branch)`, inside the agent loop. **Correct.**
- `registryd-main.ts:459` — `queuedHasLanded: async (branch) => { const answer = await host.prMerged(branch); … }`. **Reaches the host. Correct.**
- `registryd-main.ts:453` — `sliceHasMerged: async (branch) => { const answer = await host.prMerged(branch); … }`. **Reaches the host. Correct.**
- `host-shell.ts:309` — `prMerged: async (branch) => { const run = await runProcess('bash', [host, 'pr-merged', branch], inRepo); … }`. **Correct.**

`supervisor.ts:332` is the one citation that is **misattributed**, and that
matters — see §4. It reads `merge: (branch) => options.prMerged(branch)`, which
is a *different* reading on a *different* path. Neither of the plan's two call
sites resolves through it.

I ran a real tick with a counting wrapper around `plot-host.sh`, via
`PLOT_SCRIPTS_DIR` pointed at a shadow directory of symlinks
(`registryd-main.ts:93`). The tracked script was not modified — verified
`git status --short skills/plot/scripts/plot-host.sh` clean, 260859 bytes,
before and after.

```
$ PLOT_SCRIPTS_DIR=$SD/shadow node skills/plot/scripts/board/plot-registryd.mjs --once
exit=0

=== HOST CALLS: 4 ===
     1  pr-merged bug/a-sprint-item-names-a-plan-or-says-it-has-none
     2  pr-merged
     3  pr-list --state merged --limit 500
     4  pr-merged bug/a-sprint-item-names-a-plan-or-says-it-has-none
```

Tick counters:

```
plot-registryd tick agents=2 left=2 reap=0 correct=0 person=0 defer=0
  handed=0 held=321 idle=0 already-merged=0 merge-unknown=0 no-brief=0
  not-claimable=321 no-free-agent=0 unclaimed=5 cost=9471ms
```

**Four host calls on an estate of 321 slices and 2 agents.**

## 2. THE ONE I MOST SUSPECT — `queuedHasLanded` IS foldable, and the plan's own open question resolves against it

The plan makes this its single open question and says the slice must read two
functions. I read them. The answer is **yes, it is foldable**, and the plan's
framing of *why* it might not be is wrong.

`rules/landed.ts:61-68`:

```ts
export const landed = (readings: PrReadings): LandedAnswer => {
  switch (readings.merged) {
    case 'found':     return 'landed';
    case 'none':      return 'not-landed';
    default:          return 'unknown';
  }
};
```

`landed()` reads **`readings.merged` and nothing else**. The `open` field is
never touched — and the caller at `registryd-main.ts:472` already knows this and
passes `open: 'unaskable'` with a comment saying so:

> `// NOT READ BY 'landed', and named rather than guessed.`

So the *type* difference the plan hangs its open question on (`LandedAnswer` vs
`boolean`) is not a difference in **subject** — the doc comment at
`queue-reading.ts:44` is about *who holds the branch* and *what silence must
mean*, not about a fact one reading carries and the other does not. Both
readings ultimately ask `plot-host.sh pr-merged <branch>`.

**The real obstacle is one the plan never identifies**, and it is in the bundle,
not in `landed`. `registryd-main.ts:432-452`:

```ts
mergedBranches: async () => {
  const answer = await host.prList('merged', 500);
  if (!answer.ok) return new Set<string>();
  return new Set(answer.value.filter((pr) => pr.state === 'MERGED').map((pr) => pr.head));
},
```

**An empty set collapses `unaskable` into `none`.** `landed` needs three values;
a `ReadonlySet<string>` carries two. Fold naively and an unreachable host stops
answering `unknown` and starts answering `not-landed` — which is *promoting on
silence*, the exact thing the plan's "Holding stays" section swears it will not
do, and which `queue-reading.ts:167-172` spells out as the one case where
silence must withhold work.

This is fixable in about four lines — `prList` returns a `PortResult`, so
`answer.ok` is available and the bundle can return a discriminated
`{ ok, set }` instead of a bare set. But **the plan states the opposite
conclusion of the one the code supports**: it says the risk is that
`mergedBranches` lacks a fact `landed` needs, and instructs the slice to add a
*second bundled call* if so. The actual risk is that folding silently destroys
the three-valued answer, and the remedy is to widen the bundle's return type,
not to add a call. An implementer following the plan's decision procedure finds
"the fact is present" and folds — introducing the promote-on-silence bug the
plan was written to avoid.

**This is the amendment that matters most.**

## 3. The cost argument is unmeasured, and the measurement refutes it

The plan never counts. I did.

**`queuedHasLanded` fired ZERO times.** Not four, not 321 — zero. All 321 slices
held at `not-claimable`, and `queue-reading.ts:206-213` gates the call on
`entry.claimable && briefPresent`:

```ts
const briefPresent = entry.claimable ? await world.briefPresent(entry.branch) : false;
landed: entry.claimable && briefPresent ? await world.queuedHasLanded(entry.branch) : 'not-landed',
```

`claimable` is `verdicts[index] === 'eligible'` (`queue-reading.ts:127`), and
`sliceVerdicts` makes a slice eligible only where **every prior slice is
complete**. So at most **one slice per plan** is ever claimable, in an Approved
plan, and only then if a brief exists. The operator's reported
`merge-unknown=4` is the population: **four**, and the plan quotes that line
without noticing it is the refutation of its own cost model.

`queue-reading.ts:156-165` already documents this bound and the plan ignores it:

> **THE HOST IS ASKED UNDER THE SAME BOUND, AND HERE IT IS THE POINT RATHER THAN A SAVING.** … This estate had **454 queued slices** on the tick that found the defect, and a daemon asking the host about every one of them each minute would spend its whole budget … So the question goes only to a slice that `isHandOverReady` would otherwise pass.

**The plan's central premise — "`queuedHasLanded` fires per claimable slice"
and that this is unbounded — is already bounded, deliberately, with the
measurement in the comment.** The plan's Notes section claims the estate
"applied the lesson partially"; the code shows it applied a *different and
appropriate* bound to a reading with a different population.

`sliceHasMerged` is bounded by the agent count, which is the fleet cap — 2 here,
and `rules/fleet-size.ts` bounds it everywhere. It does not scale with slices
either.

**So: neither of the plan's two named call sites scales with the estate.** Both
are already bounded by something small. The plan's "Done when" — *"A tick's
host-call count does not grow with the number of slices or agents"* — is half
already true and half asks for something the second clause cannot deliver: the
agent readings legitimately grow with agents, and should, unless they are folded
into the bundle.

## 4. The genuine defect the plan walks past: the same branch is asked TWICE

Look at the call order again. Calls **1 and 4 are the same branch**:

```
1  pr-merged bug/a-sprint-item-names-a-plan-or-says-it-has-none
4  pr-merged bug/a-sprint-item-names-a-plan-or-says-it-has-none
```

Two separate code paths ask the host the identical question in one tick:

- `supervisor.ts:186` — `world.merge(branch)` inside `readAgent`, per agent, resolving through `supervisor.ts:332` → `registryd-main.ts:290` → `host.prMerged`.
- `queue-reading.ts:226` — `sliceHasMerged`, per agent, resolving through `registryd-main.ts:453` → `host.prMerged`.

**This is a third per-branch host call site, on a third path, and the plan does
not name it.** It cites `supervisor.ts:332` as the resolution hop for the two
readings it *does* name — it is not; it is an independent reading the plan has
mistaken for plumbing. So the plan would fold two call sites and leave the third
firing, halving a duplication instead of removing it.

A per-tick memo would fix this in isolation, and the machinery is already there
and already used for exactly this shape — `registryd-main.ts:272-282`:

```ts
// THE MEMO'S LIFETIME IS ONE TICK, and `readTick` is what ends it
let memo: Promise<ReadonlyMap<string, PlanBranchLine>> | null = null;
```

It memoizes `planLines` and **nothing host-shaped**. A `prMerged` memo cleared
by the same `beginTick` is a smaller, safer change than the fold, removes the
duplicate exactly, and preserves all three values because it caches the
`PortResult` rather than a set.

The plan's "What this does NOT do" says *"It does not add a cache or an index
read"* — it rules out the per-tick memo by name, and the memo is the one fix
that addresses what I actually measured.

Also visible in the log, call 2:

```
2  pr-merged            <- empty branch
```

The free agent (`branch: ""`) reaches `supervisor.merge('')`. `sliceHasMerged`
guards this (`queue-reading.ts:226`: `entry.branch === '' ? false : …`);
`supervisor.merge` does not. I ran `plot-host.sh pr-merged ""` directly:

```
skills/plot/scripts/plot-host.sh: line 3342: 1: pr-merged needs a branch
exit=1
```

It is refused locally, so it costs no API quota — but `registryd-main.ts:291`
maps `!answer.ok` to `'unreachable'`, so **every free agent contributes a
spurious `unreachable` merge reading to the supervisor's rule input each tick**.
That is a correctness finding, not a budget one, and it is free to fix.

## 5. The board is the larger consumer, and the plan scopes out the half that already solved this

The issue says *"the board polls the host as well"*. The plan scopes it out in
one line. Measured:

| | supervisor tick | board `refreshPrs` |
|---|---|---|
| cadence | 60 s (`DESIGN-agent.md`) | 60 s (`fleet.ts:132`, `PR_REFRESH_MS = 60_000`) |
| calls/pass, measured here | **4** | **1** bundled `pr-list --rich --state all --limit PR_LIMIT` (`fleet.ts:2861`) |
| rate-aware | **no** | yes — `spendRateFor`, `prRefreshMsFor`, `prNextDueAt`, backoff (`fleet.ts:2526-2528`, `2797`) |
| records its spend | **no** — zero hits for `spendRate`/`recordSpend`/`withHostSlot` in `registryd-main.ts` or `supervisor.ts` | yes, `withHostSlot` (`fleet.ts:2863`) |
| writes `PrIndexStore` | no | yes, `writePrStore` (`fleet.ts:3005`) |
| stretches under load | no | yes — `boardSharePerHour` / `CADENCE_DAMPING` (`rules/cadence.ts:57-74`) |

So the plan fixes the **smaller** consumer by raw count, and it is right to —
but for a reason it never gives. **The board is not the problem because the
board already did this work.** One bundled call, a spend record, and a cadence
that stretches when the account is under pressure.

The sharper statement the plan should be making: *the supervisor is the
unbudgeted consumer*. It spends alongside a board that carefully subtracts its
own contribution from an observed rate (`rules/cadence.ts:75-90`) — and the
supervisor's calls **land in that record as external load the board then
throttles itself against**, while the supervisor itself throttles never. On a
Bitbucket estate under 429, the board backs off and the supervisor keeps asking
at a fixed 60 s. That is a better account of the reported incident than "two
readings are unbundled", and the plan does not contain it.

## 6. Is declining the index the right call?

Yes, on this evidence, and the plan's stated reason is adequate. `PrIndexStore`
holds only MERGED rows as terminal (CLAUDE.md, *A Decision Reads The Index*),
and the supervisor's readings are 4 per tick — an index read to save 2 calls is
not worth a new layering argument. The per-tick memo is the proportionate fix
and the plan rules it out; that is the error, not the index decision.

Note that `mergedBranches()` does **not** consult the store today —
`registryd-main.ts:432` calls `host.prList` directly. The plan's claim that the
supervisor reads no store is accurate.

## What would make me say proceed

1. **Fix the open question's stated resolution.** The fold is possible; the
   hazard is `mergedBranches()` returning a bare `Set` that cannot express
   `unaskable` (`registryd-main.ts:435`). Say that, and require the bundle's
   return type to carry the third value before anything folds.
2. **Name the third call site.** `supervisor.ts:186` → `:332` →
   `registryd-main.ts:290`. The measured duplicate is 2 of the tick's 4 calls.
3. **Replace the cost claim with the measurement.** 4 calls, 321 slices, 2
   agents, `queuedHasLanded` fired zero times; `merge-unknown=4` on the
   reporting estate is the claimable population, not a symptom of unbounded fan-out.
4. **Un-rule-out the per-tick memo.** It is the smallest fix for what was
   measured, the mechanism already exists at `registryd-main.ts:272`, and it
   preserves three-valued answers where the fold endangers them.
5. **Say what the board comparison shows** — the supervisor is unbudgeted beside
   a board that is budgeted, and that asymmetry is the Bitbucket story.
6. **Fix or explain the empty-branch call** at `supervisor.merge('')`.

## Against my own position

**The strongest case for `proceed`:** the plan's hops are all real, its
direction is right, and it explicitly refuses to guess — it makes the
`queuedHasLanded` question the slice's to answer by reading two functions,
which is exactly the discipline this author has been faulted for lacking. An
implementer who reads `landed.ts` and `registryd-main.ts:432` as I did will
find the set-cannot-express-`unaskable` problem themselves. Arguably the plan's
machinery worked and I am marking it down for reaching the right destination by
a wrong map.

I weighed that and it does not reach `proceed`, for one reason: the plan does
not merely leave the question open, it **states a false disjunction** — *"if
`landed` needs a fact `mergedBranches` does not carry, the fix is a second
bundled call"*. `landed` needs no fact the bundle lacks; it needs a
*distinction the bundle's return type discards*. An implementer who checks the
plan's actual test — "does `mergedBranches` carry the fact?" — gets **yes**, and
folds, and ships promote-on-silence. The plan's decision procedure leads to the
wrong answer, which is worse than an open question.

**The strongest case for `reject`:** the central premise is measurably false.
Neither named call site scales; one fired zero times on a 321-slice estate; the
bound the plan says is missing is documented in the file it quotes, eighteen
lines above the lines it quotes. On this estate the plan fixes nothing.

I did not go to `reject` because the **reported incident is real** — a Bitbucket
estate hit 429 twice in two hours with `merge-unknown=4`, and 4 host calls per
minute from an unbudgeted consumer beside a budgeted board is a credible cause.
The duplicate at §4 is a genuine defect the plan is one citation away from
finding, and its issue number, sprint and framing are all sound. Rejecting would
throw away a correct bug report because its mechanism section is wrong. The
mechanism section is amendable.

**Where I could be wrong:** my estate has 2 agents and 0 claimable briefed
slices. An estate with 40 plans each holding one eligible briefed slice would
fire `queuedHasLanded` 40 times and the plan's concern would be live. I cannot
rule that out — but the reporting estate printed `merge-unknown=4`, and 4 is the
number that reached the host there too.

## Host calls made

**Three.** Two by the single `--once` tick (`pr-merged` on one branch, twice —
the duplicate itself; the empty-branch one was refused locally before any API
call, and `pr-list --state merged --limit 500` is the bundle, so 3 reaching the
host is the honest count including the list). One by my direct
`plot-host.sh pr-merged ""` probe, which was refused locally and reached nothing.
No PR was created, merged or modified. Nothing under `skills/`, `docs/` or
`packages/` was changed.
