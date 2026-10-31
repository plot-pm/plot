## Implementation brief — the-plan-walk-moves-into-the (wave: Branch readings)

- **Plan (canonical):** `docs/plans/2026-10-31-the-plan-walk-moves-into-the.md` on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-walk-reads-the-branches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR required; no special review channel named)

This branch is the second of eight waves. It waits on `feature/the-walk-reads-the-estate`,
which is **merged** (PR #2987, `c00de536c`) — its `rules/plan-walk-estate.ts` and
`workflows/plan-walk-estate.ts` are on `main` now and this wave is eligible to start.
Three waves wait on this one in turn (desks → assembly → in-process → cache → CLI modes →
pulse log → removal), so this slice's shape — which readings it exposes, and how — is what
every later wave composes against.

### What to build

The estate stage (`workflows/plan-walk-estate.ts`) answers *which plans exist*. This stage
answers *what state is each branch in* — the second half of what `plot-fleet-scan.sh`
computes per beat today at a cost of 27.7–30 s CPU (measured 2026-10-31, load 8–10), most
of it per-branch git calls and per-plan process starts that a single in-process pass with
batched reads removes.

Write a `readBranchReadings` (or similarly named) async function in
`packages/domain/src/workflows/plan-walk-branches.ts`, following `readEstate`'s exact shape:
take the estate's output plus the ports (`Refs`, `Host`) as input, batch every read it can,
and return a `PortResult` that fails the whole beat on an unreadable snapshot rather than
answering an empty or partial one — `readEstate`'s own comment states why: "an empty answer
is indistinguishable from a repository with no plans." The same logic applies here: an
unreadable branch must not read as `open`.

Per branch, gather the readings `rules/branch-state.ts`'s `BranchReadings` interface already
names: `refTip`, `mainTip`, `mergeSubjectFound`, `hostReach`, `pr`, `prListComplete`,
`commitsAhead`, `realCommitsAhead`, `waits`. This stage's job is **gathering, not deciding**
— `branchState()`, `waitVerdict()`, `withPlanLandings()` and `mergedBySubject()` in
`rules/branch-state.ts` and `rules/merge-subject.ts` already exist as pure functions over
these readings and must not be re-derived or duplicated here. Also gather what the plan's
Inputs table additionally calls for: landed commits (`commits_landed` in
`plot-fleet-scan.sh:3908`, the shell's "is this comma-list of commits all on `origin/main`"
check), conflicts (`conflicts_of`/`conflicts_known_of`, `plot-fleet-scan.sh:2311-2342`), and
changed paths (`changed_paths_of`, `plot-fleet-scan.sh:2377`).

### The decisions the plan settles — do not re-derive them

**A new port operation is required, and it does not exist yet.** The plan's Decisions
section names it explicitly: a batched `containsMany` on `Refs` (`packages/domain/src/ports/refs.ts`).
Today's port has `contains(ancestor, descendant)` — one pair per call — and `isMergedByAncestry`
and `mergeBase`, also one branch at a time. None of the three batches. The plan requires
batched ancestry the same way `readBlobs`/`branchTips`/`entriesAt` already batch: one call
for every branch this stage reads, not one git spawn per branch. Measured elsewhere in this
codebase (`readBlobs`'s TSDoc): ~55 ms process-spawn cost per git call regardless of how
little work it does, 136x apart for a 1-blob-per-call loop versus one batch on this
repository's scale. Define `containsMany` on the `Refs` interface, implement it on the git
adapter (`packages/domain/src/adapters/refs/refs-git.ts`), and add a test double for it in
the fixture adapter the estate slice already extended.

**Merge subjects must work on both hosts, and the GitHub/Bitbucket split is adapter data,
not a domain rule.** `rules/merge-subject.ts`'s `mergedBySubject` takes `forms` as an opaque
list of templates and asks no host; `adapters/host/merge-subjects.ts`'s `MERGE_SUBJECT_FORMS`
is where the two vendor strings (`'Merge pull request #<number> from <owner>/<branch>'` for
GitHub, `'Merged in <branch> (pull request #<number>)'` for Bitbucket) already live, read
through `mergeSubjectForms(backend)`. Call that function with the repository's host backend;
do not write a GitHub-only path and leave Bitbucket for later — the plan's own Decisions
section requires proving the Bitbucket form on a sandbox fixture in this slice.

**This stage reads merge subjects as evidence, never as a verdict**, per the repo-wide rule
in `docs/domain/merge-subject.md` (and restated in this repo's CLAUDE.md under "One Answer
To 'Did This Land'"): a subject only ever moves a no-ref branch from `open` toward `merged`
(`ownState` in `rules/branch-state.ts:282`), and only where the ref is already absent — the
ref check must stay in front of the merge-subject lookup, never hoisted above it, because a
recreated branch of the same name has a ref and must never fall into stale evidence from an
earlier merge of that name. This is already encoded correctly in `ownState`; the gathering
code must feed it `mergeSubjectFound` computed the same way, not compute its own precedence.

**`containsMany`'s answer set is three-valued, like every other ancestry read on this port**
— `'yes' | 'no' | 'unknown'`, batched. A repository that is shallow, or that carries a
non-empty `refs/replace`, refuses ancestry entirely per the plan's cache-rule input table
("Ancestry entries are refused on a shallow repository or when `refs/replace` is not
empty") — though that specific refusal is this slice's reading-gathering concern only
insofar as a refused batch must answer `unknown` for every entry, never `no`. The actual
*caching* of ancestry by object id is the Cache wave's job, not this one; this slice reads
fresh every time, with no cache of its own.

**Byte-equal, not approximately equal, against the shell's existing bundles.** The Done-when
criterion for this slice is that the stage's readings equal, byte for byte, what
`plot-merge-subject.mjs` and `plot-branch-state.mjs` already receive on stdin — those two
bundles are the oracle, not a re-reading of the shell script's source. Build the corpus test
(`packages/domain/corpus/plan-walk-readings.corpus.test.ts`, named in the plan's Done-when
and absent from the repo today — this slice creates it) by piping the same readings this
stage gathers into those two bundles and diffing. Follow `plan-walk-estate.corpus.test.ts`'s
shape: production side reads through the existing shell/bundle path, stage side reads
through the new workflow function, `compareField`/`describeDisagreement` from `./compare.js`
report any mismatch, and a disagreement stops the branch rather than being patched away on
either side (`corpus/README.md`: "Neither side is authoritative in either pair. The test
says they agree.").

### Done when

The plan's `## Done when` "Branch readings" bullet is the specification:
`pnpm --filter @plot-pm/domain exec vitest run corpus/plan-walk-readings.corpus.test.ts`
passes, on the pinned clone and on a Bitbucket-form sandbox fixture. Specifically this means:

- `containsMany` exists on `Refs`, is implemented on the git adapter, and is covered by its
  own unit test (not only by the corpus comparison).
- The stage's gathered readings — ancestry, merge subjects (both host forms), landed
  commits, conflicts, changed paths — byte-equal what `plot-merge-subject.mjs` and
  `plot-branch-state.mjs` receive on stdin today, run with no host token (per
  `corpus/README.md`'s `no-host-token.ts` setup — this slice's corpus file must get that
  setup too, the same way `plan-walk-estate.corpus.test.ts` does implicitly through the
  shared harness).
- An unreadable branch snapshot fails the stage's result rather than answering a partial or
  empty one — add a test proving this, the same shape `plan-walk-estate.test.ts` already
  uses for the estate stage's unreadable-snapshot arm.

Plus the repo's gates: a changeset (package `plot`, correct `bumps:` ordering per this
repo's CLAUDE.md — description first, `bumps:` block last), and
`node skills/plot/scripts/board/plot-local-checks.mjs` run before each push, with whatever
it prints. Do not run the full `test:e2e` or `test:contracts` suites locally — they are
CI's job (CLAUDE.md, Testing section) — run only what `plot-local-checks.mjs` names for the
files actually touched.

**`scripts/check-shell-lines.sh`** refuses a PR whose shell under `skills/` grows past its
merge base. This slice adds no new shell — it reads TypeScript ports and writes TypeScript
rules — so it should cost nothing against the budget; if a shell call turns out to be
unavoidable anywhere, pay for it by removing an equal number of lines elsewhere in the same
change. Measured at plan-brief time, `plot-fleet-scan.sh` alone is 2207 lines by
`--per-file`, and this slice does not need to touch it at all — `commits_landed`,
`conflicts_of` and `changed_paths_of` are **read as reference for what readings to gather,
not ported or deleted**: the Removal wave (last in the chain) is what eventually shrinks
`plot-fleet-scan.sh`, not this one. Leave the shell script alone.

### Bookkeeping

Open the PR through the controller once the first real commit exists:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while work is moving). Do not run
`gh pr create` directly. When the PR exists, append `→ #<number>` to this branch's line in
the plan's `## Slices` section (`### Branch readings` heading), the same way the estate
slice's line now reads `→ #2987`.

### Scope guard

This branch owns: `packages/domain/src/ports/refs.ts` (the new `containsMany` signature),
`packages/domain/src/adapters/refs/refs-git.ts` and the fixture adapter (implementations),
a new `packages/domain/src/workflows/plan-walk-branches.ts`, and the new corpus file
`packages/domain/corpus/plan-walk-readings.corpus.test.ts`. It must not touch
`rules/branch-state.ts` or `rules/merge-subject.ts` beyond calling their existing exports —
those rules are already correct and already tested; re-deriving their precedence here would
duplicate logic the estate slice's sibling rules already settled. It must not touch
`plot-fleet-scan.sh`, `plot-branch-state.mjs` or `plot-merge-subject.mjs` — those bundles
are this slice's oracle, read from, never written to.

No other branch of this plan is in flight concurrently as of this brief (the three waves
after this one — Desks, Assembly, In-process — each wait on this one or a later one, so none
has started). A later wave reading this stage's output will need its exported type names
stable; prefer naming the stage's answer type something like `BranchStageReadings` (parallel
to the estate stage's `Estate`) so the Desks and Assembly waves have an unambiguous import.

If you find something the plan did not anticipate — e.g. a reading `rules/branch-state.ts`
needs that neither this brief nor the plan's Inputs table lists — report it rather than
improvising scope beyond what this brief and the plan describe.
