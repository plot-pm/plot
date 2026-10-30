## Implementation brief — a-dead-desk-gets-a-fixer (wave 2: Holding-work reads the merge)

- **Plan (canonical):** [docs/plans/2026-10-29-a-dead-desk-gets-a-fixer.md](../../docs/plans/2026-10-29-a-dead-desk-gets-a-fixer.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2915 merged
- **Branch:** `feature/holding-work-reads-the-merge` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review (GitHub App), per repo convention

This is the second of the plan's two slices. The first — `feature/a-dead-desk-reads-unreadable` — is already merged (PR #2960, landed in `ec3c3099d`). This wave does not depend on its code, only on the surrounding readings it left unchanged.

### What to build

A `holding-work` ending answers `leave` (no marker, no person asked) when the host says the branch's pull request has merged **and** the desk holds no uncommitted file. Today it never checks either: it asks only whether this is a take-up refusal (`refusedAssignment`) and how many fresh sessions the slice already had (`priorFreshSessions`), in `endingTableAnswer` at `packages/domain/src/rules/ending-action.ts:349-352`:

```ts
if (readings.ending === 'holding-work') {
  if (takeUpRefused(readings.refusedAssignment, readings.branch)) return 'release-claim';
  return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
}
```

The measurement motivating this (plan, `## Motivation`, "The merged pull request"): PR #2591 merged at 18:35:00Z and its `holding-work` ask followed 46 seconds later — a person was paged for a desk whose work had already landed.

Add a merged-and-clean check between the take-up check and the fresh-session count:

```ts
if (readings.ending === 'holding-work') {
  if (takeUpRefused(readings.refusedAssignment, readings.branch)) return 'release-claim';
  if (readings.prMerged === 'merged' && readings.dirtyTree === 'no') return 'leave';
  return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
}
```

`prMerged` and `dirtyTree` are already fields on `EndingActionReadings` (`ending-action.ts:67-82`) — the bound arms (`bound`/`unreadable`/`quiet`) and the five outright-asks-person reasons already read them (lines 357-366). This slice is the third reader, not a new field.

### The decisions the plan settles — do not re-derive them

**Why `prMerged`, not the PR index.** The plan's "What this slice reads instead of the index" applies here too: the index can prove `MERGED`, never prove *no* PR, and `prMerged` is already the field that encodes that asymmetry — `'unanswerable'` takes the same arm as `'not-merged'` (see the field's own doc comment, `ending-action.ts:67-74`). Do not add a second index read; reuse the existing reading path.

**Why `dirtyTree`, and why it must gate the merge.** A merged PR does not prove the desk's current tree is clean — the agent can keep editing after the merge lands. The plan is explicit: *"a desk whose held files are not empty, or whose held-files read failed, keeps today's answer, a fresh session or a person."* `dirtyTree: 'unanswerable'` must take the same arm as `'yes'` (dirty) — this is already how `dirtyTreeReading` behaves (`registryd.ts:979-980`: `heldFiles === null || heldFiles.length > 0 ? 'yes' : 'no'`), so passing that reading through unchanged is correct; do not write a second, more lenient check.

**The reader must start asking `prMerged` for `holding-work` too.** `registryd.ts:1061-1064` currently gates the host call on `endingAsksPersonOutright(ending) || isBoundEnding(ending)`, and `holding-work` is neither:

```ts
prMerged:
  (endingAsksPersonOutright(ending) || isBoundEnding(ending)) && !endingAsked
    ? await asks.prMerged(tree.branch)
    : 'unanswerable',
```

Add `ending === 'holding-work'` to that condition so the host is actually asked. Without this change, the domain-level fix is dead code: `freshAgentDecisions` (`registryd.ts:1169-1188`) passes `reading.prMerged` through unconditionally already (line 1184 — no `bound ? … : …` gating on `prMerged`, unlike `commitBeyondClaim`/`prOpen`/`dirtyTree`), so the only place currently starving the new check of a real answer is this one gate.

**`heldFiles` is already read for every candidate — reuse it, do not add a second read.** `registryd.ts:1065` calls `await heldFiles(tree.path)` unconditionally for every candidate, independent of ending. The `dirtyTree` field already resolves through `dirtyTreeReading(reading.heldFiles)` inside `freshAgentDecisions`, but only when `bound` is true (`registryd.ts:1183`: `dirtyTree: bound ? dirtyTreeReading(reading.heldFiles) : 'no'`). Extend that ternary's condition to include `holding-work` — e.g. introduce `const readsWork = bound || reading.ending === 'holding-work'` and use it for `dirtyTree` (and only `dirtyTree`; `commitBeyondClaim`/`prOpen` stay bound-only, since `holding-work`'s table arm never reads them).

**`endingAsked` still short-circuits the host call.** Both the existing `prMerged` gate and the one you're extending already AND against `!endingAsked` — preserve that; an ending already asked about must still cost no host call, per the comment at `registryd.ts:1057-1060`.

**The take-up arm is unaffected and must stay first.** `takeUpRefused` is checked before the new merged-and-clean branch and must remain first: a take-up `holding-work` (one agent refusing another's unlanded work) is a different situation from an after-prompt `holding-work`, and its `release-claim` answer must not be pre-empted by a merge check that was never about it. The existing tests at `rules-ending-action.test.ts:54-58` and `:68-74` pin this ordering — read them before touching the function.

**Vocabulary carries over unchanged.** The code says Agent for the actor and Slice for a branch; this slice adds nothing to the known `Wave` defect (CLAUDE.md, "The Domain Package").

### Done when

The plan's slice line is the specification (plan, `## Slices` → "Holding-work reads the merge"):

> the `holding-work` arm answers `leave` where `prMerged` reads `merged` and `dirtyTree` reads `no`; the reader asks `prMerged` for `holding-work`, and `freshAgentDecisions` passes the held-files reading for `holding-work`

Concretely:

- **Domain unit** (`packages/domain/test/rules-ending-action.test.ts`): rows for `holding-work` crossed over `prMerged` (`merged`, `not-merged`, `unanswerable`) × `dirtyTree` (`no`, `yes`) × `priorFreshSessions` (0, 1) — only `merged`+`no` (either `priorFreshSessions`) answers `leave`; every other combination keeps today's `start-fresh`/`needs-a-person` split. Also assert the take-up arm (`refusedAssignment` matching another branch) still answers `release-claim` regardless of `prMerged`/`dirtyTree` — this catches an accidental reordering that would let the merge check run before the take-up check.
- **The #2591 regression fixture**: the plan names this explicitly — a fixture of the plan's ten measured second-ending readings, asserting only #2591's answer changes (to `leave`) when the merged-and-clean check is added; the other nine keep their recorded answer. The plan's Notes section flags that #2591's held-files state isn't in the historical record, so the fixture assumes a clean tree for it — **the fleet unit test below, not this fixture, is what actually proves the held-files guard.**
- **Fleet unit** (`packages/fleet/test/unit/fresh-agent-tick.test.ts`): a `holding-work` desk whose host answers `merged` and whose tree is clean writes no marker and starts nothing; the same desk with a held file, or with a failed `heldFiles` read, keeps today's answer (marker or fresh session, per `priorFreshSessions`). Also assert the host is asked `prMerged` for a `holding-work` desk at all — a test that stubs `asks.prMerged` and checks it was called, which is the only thing that would have caught the registryd.ts gate being left unextended.
- Every existing `holding-work` test (the take-up/after-prompt split, the shared `priorFreshSessions` count across ending reasons, `endingAsksFreshStart`) keeps passing unmodified — this slice adds a precondition in front of the existing branch, not a rewrite of it.

Plus: no new build artifact, no changeset needed beyond the plan's existing one (`.changeset/a-dead-desk-reads-unreadable.md` already covers this plan; check whether it needs a second entry or whether one changeset spanning both slices is intended — the plan's PR for slice 1 already shipped a changeset, so slice 2 likely needs none unless release process requires one changeset per merged PR). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base — this slice touches no `.sh` file, so it should not trip this gate, but confirm before pushing if any helper script changes.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Never `gh pr create` directly. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns:

- `packages/domain/src/rules/ending-action.ts` — the `holding-work` arm of `endingTableAnswer`
- `packages/domain/test/rules-ending-action.test.ts` — new rows
- `packages/fleet/src/server/entry/registryd.ts` — the `prMerged` ask gate (~line 1062) and the `dirtyTree` pass-through in `freshAgentDecisions` (~line 1183)
- `packages/fleet/test/unit/fresh-agent-tick.test.ts` — new rows

Sibling wave `feature/a-dead-desk-reads-unreadable` already merged and touched the same four files (it added the second `killedWorkerEnding` arm and the async `killedWorkerEndings` plumbing). Rebase onto current `main` before starting — do not re-derive its diff, and re-read the current `endingTableAnswer`/`registryd.ts` state rather than trusting the plan's line numbers for slice 1's code, which has since merged and shifted surrounding lines.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
