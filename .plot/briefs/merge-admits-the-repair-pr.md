## Implementation brief — a-red-default-branch-is-repaired (wave: Merge exception)

- **Plan (canonical):** docs/plans/active/a-red-default-branch-is-repaired.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2910 merged
- **Branch:** `feature/merge-admits-the-repair-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `plot/review` on the PR, as every slice PR

This branch's `waits:` dependency, `feature/fleetd-merges-one-at-a-time` (PR
#2961), is merged — nothing blocks starting. The record slice this branch
reads (`feature/the-repair-record`, #2936) is in flight but not required to
compile against: this slice reads `RepairRecord`/`RepairRecordStore`, which
already exist on main (added ahead of schedule — see below).

### What to build

**The exception already exists in `merge()`. It does not exist in
`slicePrNext`'s merge arm, and that is the gap this slice closes.**

`packages/domain/src/workflows/merge.ts` (`merge()`, lines 211-243) already
admits the repair record's named PR on a settled-red default branch: it reads
the repair record, walks `repairEpisode`, re-asks the red commit's runs, and
calls `repairMergeVerdict` (`packages/domain/src/rules/repair-pr.ts`) to admit
or refuse. `mergeAt` (same file, lines 348-404) already threads `ports.repair`
and `ports.build` through to `readRepair`, and `packages/fleet/src/shared/auto-merge.ts`'s
`runAutoMergePass` (lines 132-142) already wires `repair: repairRecordFile(...)`
and `build: await buildShell(...)` into `MergePorts`. All of that landed in
`d82eb565a` and `1c8c0956d`, ahead of this plan's slices — read those commits
before writing anything, because they are most of this slice's design already
decided for you, one layer down.

**The problem: `mergeTick` never offers the admitted PR to `mergeAt` in the
first place.** `mergeTick` (`auto-merge.ts`, lines 59-83) calls `slicePrNext`
for every open row and asks `nextMerge` to pick the lowest-numbered row whose
step is `{ step: 'merge' }`. `slicePrNext`'s merge arm, `mergeArm`
(`packages/domain/src/rules/slice-pr-next.ts`, lines 230-247), unconditionally
returns `hold('default-branch-red')` the moment `settled.state === 'red'`
(line 243) — before any repair record is consulted. So on a red main, every
row's step is `hold`, `nextMerge` picks nothing, and `mergeAt` — which would
correctly admit the repair PR — is never called for it. The fix the exception
needs is entirely upstream of where it already works.

`mergeArm`'s own doc comment (lines 218-228) already names this as "Arm 8
(#2902, with #2904's repair exception)" and lists `default-branch-red` among
the holds — but the exception was never implemented, only the field for it
was stubbed: `SlicePrNextReadings.repair` (line 59) is typed as
`SiblingReading` (`{read:'unread'} | {read:'record'}`), a thin marker that
only supports the `unread` hold at line 236 (`if (readings.repair?.read ===
'unread') return hold('unread')`). It carries none of what `repairMergeVerdict`
needs — no record, no episode, no re-asked runs. **Do not reuse
`SiblingReading` for this.** It is the `#2903`/other-sibling shape; the repair
exception needs the same richer reading `merge.ts` already defined and
named, `RepairMergeReading` (`repair-pr.ts`), not a second ad hoc shape.

### The decisions already settled upstream — do not re-derive them

- **The verdict logic is `repairMergeVerdict`, not a new rule.** `merge.ts`
  already proved out reading the record, walking the episode, and re-asking
  the red commit's runs immediately before admitting a PR. `mergeArm` needs to
  call the same function, not reimplement the walk. Mutating `mergeArm`'s hold
  order to call `repairMergeVerdict` inline (passing it the same
  `RepairMergeReading` shape) is the shape to extend, not a parallel path.
- **The episode pin, not the SHA.** `repairEpisode` (`repair-pr.ts`) answers
  `open` only while no green has settled since the record was written and the
  settled SHA's first-parent line still contains the record's `firstRedSha` —
  never pinned to one moving SHA. Re-deriving a SHA-pinned check here would
  silently diverge from `merge()`'s own exception and break the "both
  mechanisms must agree" invariant the plan states in D-whatever: "the
  queue's `default-branch-red` hold and the merge exception must read the
  same reading."
- **A missing record is still `default-branch-red`, never a new hold.** Where
  `readings.repair` is absent or the record read failed/is null, `mergeArm`
  holds `default-branch-red` exactly as before — the exception is additive,
  narrow, and only ever lifts the hold for the one PR the record names.
- **Where the richer reading comes from.** `mergeTick`/`runAutoMergePass`
  already has everything `readRepair` (`merge.ts`, private today) needs — the
  default branch reading, the repair store, the refs port, the build port.
  Either export `readRepair` from `merge.ts` and call it once per tick (not
  once per row — the re-ask is a network/host call and must not multiply by
  open-row count), or thread an equivalent read through
  `Omit<SlicePrNextReadings, …>` the same way `defaultBranch` already is.
  Read it once in `runAutoMergePass`/`mergeTick`, before the `rows.map(...)`
  loop, and hand the same `RepairMergeReading` to every row's `slicePrNext`
  call — exactly as `defaultBranch` and `newestMerged` are already read once
  per tick and threaded to every row today.
- **`nextMerge`'s existing contract is unchanged.** It already picks the
  lowest PR number among `{ step: 'merge' }` candidates; this slice does not
  touch it. The repair PR, once admitted, is simply one more `{ step: 'merge'
  }` candidate in the same pool — no priority bump, no separate path. If two
  slice PRs are open and the repair PR is also open and admitted, the lowest
  number still wins; the repair exception does not special-case ordering
  because the dispatch queue (separate code, out of scope — see Scope guard)
  already prevents other slice work from landing while main is red.
- **This slice does not touch `queue.ts`'s dispatch hold.** The plan's
  Motivation section measures `queue.ts:583`'s `whyNotReady` as a *second*
  place a red main holds work (new slice dispatch), but the plan's Design
  §5 and this branch's slice line name only `merge()` and `slicePrNext` — not
  the dispatch queue. Leave `whyNotReady`'s `if (defaultBranchRed) return
  'default-branch-red'` exactly as it is.

### Done when

The plan's `## Done when` is implicit in its `## Slices` line: *"the narrow
exception in `merge()` and `slicePrNext` for the PR the repair record
names."* Concretely:

- `mergeArm` admits the repair record's named PR (`repairPr` or `revertPr`)
  on a settled-red reading, while the episode is open and the re-asked red
  commit's runs still read red — and refuses every other PR exactly as
  today.
- The three existing `default-branch-red` tests the plan's Notes name stay
  unchanged and still pass with no record present:
  `packages/domain/test/workflows-merge.test.ts:128` and `:165`, and
  `packages/board/test/unit/merge-entry.test.ts:135`. (These guard
  `merge()`, already correct — but a regression in the shared
  `RepairMergeReading` plumbing would show here first.)
- New table tests on `mergeArm`/`slicePrNext` paralleling the plan's Notes
  for `feature/merge-admits-the-repair-pr`: `merge()` admits the repair PR
  after a bundle commit settled red on top of the red SHA; refuses a record
  naming a non-deterministic branch; refuses when the re-asked red SHA reads
  green. Write the equivalent cases at the `mergeArm`/`mergeTick` level: the
  admitted PR surfaces as `{ step: 'merge' }` from `slicePrNext`, not just
  from `mergeAt` directly — that is the actual bug this slice fixes, so the
  test must exercise `slicePrNext`/`mergeTick`, not only `merge()`.
- A mutation check: remove the episode pin or the branch-name check from
  wherever `mergeArm` now calls into `repairMergeVerdict`, and confirm a test
  fails. (The plan's Notes already specify this mutation check for
  `merge()`; this slice's job is to make sure the same mutation, applied at
  the `mergeArm` call site, is caught too — otherwise the wiring could regress
  silently even while `merge()`'s own tests stay green.)
- `fleet unit test`: a tick with the record naming a PR and the episode open
  surfaces that PR as the `nextMerge` pick even while other open rows hold
  `default-branch-red` — proving the fix at the level fleetd actually runs
  at, not just the domain rule in isolation.

Plus the repo's gates: no build-artifact diff (`packages/board` is untouched
by this slice, so `check-no-bundle-diff.sh` should pass trivially — verify it
does, since any accidental board touch regenerates the bundle and the gate
refuses it), a changeset (`bumps: domain: patch` or `fleet: patch` per which
package's public surface moved), and the usual platform constraints
(`check-state-declarations.sh`, `check-ancestry-decisions.sh`, etc. — none of
these are expected to fire on this change, since no `State:` line, ancestry
call or lifecycle file is touched).

For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints. The suites in the `CI suites` config key run in
CI; a failure there comes back as a correction. List no full suite.

**The shell gate applies if you touch any `.sh` file:**
`scripts/check-shell-lines.sh` refuses a pull request whose shell under
`skills/` is longer than at its merge base. This slice is pure TypeScript
(domain + fleet packages); if you find yourself touching a `.sh` file at all,
that is itself a signal you have drifted from this slice's scope — the plan's
Design §5 names this as domain-rule work, and the shell layer is untouched by
any of the three merge-slices. If you must touch shell, remove an equal
number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads the plan and opens the PR with the wave heading as title, the plan
and this brief in the body. **Do not run `gh pr create`.**

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section, under "Merge exception":

```
- `feature/merge-admits-the-repair-pr` — the narrow exception in `merge()` and `slicePrNext` for the PR the repair record names <!-- waits: feature/fleetd-merges-one-at-a-time --> → #<number>
```

Push the first real commit as soon as it exists — a branch holding only the
dispatch claim with no commits is indistinguishable from an abandoned one.

### Scope guard

**This branch owns:** `packages/domain/src/rules/slice-pr-next.ts` (the
`mergeArm` function and its `SlicePrNextReadings` shape), and whatever
threading change `packages/fleet/src/shared/auto-merge.ts` needs to read the
repair record once per tick and hand it through. It also owns the new or
extended tests in `packages/domain/test/slice-pr-next.test.ts` and
`packages/fleet/test/unit/auto-merge.test.ts` (or equivalent, if named
differently — check current file names before writing new ones, since both
packages have renamed test files across this plan's sibling slices).

**This branch does not own**, and must not touch:

- `packages/domain/src/workflows/merge.ts` and `packages/domain/src/rules/repair-pr.ts`
  — already correct (`merge()`'s exception), merged ahead of this plan. If a
  bug surfaces there, report it; do not fix it inline in this branch's diff.
- `packages/domain/src/rules/queue.ts` (`whyNotReady`'s dispatch-side
  `default-branch-red` hold) — explicitly out of scope per the plan's Design
  §5, which names only `merge()` and `slicePrNext`.
- `feature/the-repair-record` (#2936, sibling slice) — owns the repair
  record's writer, its lifecycle transitions and the breaking-commit picker.
  This branch only *reads* `RepairRecord`/`RepairRecordStore`, both of which
  already exist on main.
- `feature/fleetd-starts-main-repair` and `feature/a-red-main-is-reverted` —
  the other two sibling slices under this plan, not yet started. Nothing
  here depends on them; they depend on the record slice, not on this one.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
