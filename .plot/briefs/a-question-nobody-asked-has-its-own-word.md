## Implementation brief — a-question-nobody-asked-has-its-own-word

- **Plan (canonical):** `docs/plans/2026-09-29-a-question-nobody-asked-has-its-own-word.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `bug/a-question-nobody-asked-has-its-own-word` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review; CI is the authority)
- **Issue:** #1073

The plan has one slice. Nothing waits on it, and it waits on nothing.

### What to build

A free agent holds no slice, so its desk branch is `''`. The supervisor still asks the host whether a PR for `''` merged. `registryd-main.ts:398` (`worldForRepo`'s `prMerged`) spends `tally.calls += 1`, calls `merges.ask('')`, and gets a local refusal back. It then returns `unreachable`, which is a false statement: no question was asked. That happens once per free agent per tick. The other existing word is false too: with `not-merged`, `prGate` (`packages/domain/src/rules/gates.ts:104-110`) falls through to ``No merged PR for `` `` and tells the operator to push a branch that does not exist.

The fix adds a fourth word only on the desk side:

1. `gates.ts`: `export type DeskMergeReading = MergeReading | 'not-asked';`. Type `DeskReadings.merge` (`:20`) with it. Add a `prGate` arm **above** the fallthrough. The arm says that no branch was asked about, and that this is not a report that no PR merged. It must contain neither `No merged PR for` nor `could not be asked`.
2. `packages/board/src/server/supervisor.ts:18` and `packages/board/src/server/entry/registryd-main.ts:22`: switch the `MergeReading` import from `@plot-pm/domain/rules/reapable` to `DeskMergeReading` from `@plot-pm/domain/rules/gates`. This widens `supervisor.ts:56` (`merge`), `:278` (`prMerged`) and `registryd-main.ts:398`.
3. `registryd-main.ts:398`: return `'not-asked'` for `branch === ''` **before** `tally.calls += 1` and before `merges.ask`.

Check that `@plot-pm/domain/rules/gates` resolves as a subpath export the way `rules/reapable` does. If it does not, add the export entry in `packages/domain/package.json`, and add nothing else there.

The plan is canonical. This brief gives orientation only.

### Settled decisions — do not re-derive them

**Keep `MergeReading` at three words.** Do not widen `reapable.ts:13`. Round 3 built that version and it fails the review criterion that `reapable.ts` stays unchanged (`git diff --quiet main -- packages/domain/src/rules/reapable.ts`). The separate `DeskMergeReading` type has a second purpose: `tsc` refuses `not-asked` into `reapProblems`, `refDeletionProblems` and `finishedWith` with `TS2322: Type '"not-asked"' is not assignable to type 'MergeReading'`. A later producer that feeds the word to the reap rules then fails to build. Without the separate type, those rules would answer silently.

**A green `tsc` is not evidence.** Round 1 widened the union and both packages typechecked at exit 0. The union is read only through `===`/`!==` chains, with no `switch` and no `assertNever`, so `prGate` builds with its new arm missing. The tests find the sites. The compiler guards only the `DeskMergeReading` → `MergeReading` boundary.

**Guard before the call, not after.** An empty branch has a known answer, so testing it after `merges.ask` spends a subprocess on it. The error branch would then have to test the branch a second time to tell the refusal from an outage. The same package already guards first: `queue-reading.ts:226` (`entry.branch === '' ? false : await …`) and `supervision-report-reading.ts:109`.

**The reap half is out of scope, and it is dangerous to touch.** On a clean, dead desk with no branch, `no-merged-pr` is the only refusal `reapProblems` returns. Remove it for `not-asked` and the rule returns `[]`, so the desk is reapable. No producer on the estate delivers `not-asked` to `reapable.ts`: `entities/worktree.ts:136` is two-valued, `plot-reap.sh` mints its own word, and `plot-release-refs.sh:202` skips `""`.

**`plot-reap.sh` keeps answering `merged` for a detached desk at `origin/<main>`.** Commit `6455c0e5` made that choice deliberately. It rests on a measurement: the desk holds no commit that main lacks. If the reaper passed `not-asked` instead, every free desk would be kept forever.

**`plot-pr-merged.sh` belongs to #1082.** Its `pr_merged ""` exits 0 because `gh pr list --head ""` applies no filter. The defect is real and latent, and it is not this branch's.

**The three sibling messages stay as they are.** The changeset, plan and declaration gates also name an empty branch. They have the same shape and need their own finding.

Rules carried over:

- A reading that was never taken says so. `unreachable` means *the question failed*, and `not-asked` means *there was no question*. They are not synonyms.
- No state joins the eight worker/agent states. This word belongs to a reading, not to an agent.
- Domain code is arrow functions with factual TSDoc. Put the reasoning in the commit message.

### Done when

The plan's `## Done when` list is the specification. Each bullet is a test unless the plan marks it otherwise. The assertions below exist because a naive implementation would pass without them:

- **The producer spends nothing** (`packages/board/test/unit/registryd-main.test.ts`, beside *"adds one per host call, answered or not"* at `:1035`). Call `world.merge('')`, not `prMerged` directly. Assert three things: the answer is `not-asked`, the stubbed `plot-host.sh` received no call, and `tally.calls` did not move. A guard placed after the call returns the right word and still fails the last two assertions.
- **The other three answers are unchanged.** A stub answering `merged`, `not-merged` and a failure yields `merged`, `not-merged` and `unreachable`, and each adds one to `tally.calls`. This catches a guard that short-circuits too widely.
- **`prGate` text** (`packages/domain/test/gates.test.ts`). The message says no branch was asked about and says this is not a no-PR report. It contains neither of the two old phrases. Also assert `prGate` per existing word, so each of the three stays unchanged.
- **`supervise` for a DEAD free agent** (`packages/domain/test/supervision.test.ts`), with `merge: 'not-asked'` and clear headroom:
  - `madeProgress: false` gives a `defer` verdict with reason `no-progress`, and the failures contain the new message. This is the common case, because a desk cut at `origin/<main>` has no commits.
  - `madeProgress: true` gives a `correct` verdict, and the correction prompt contains the new message.
  - A **live** free agent gives `leave/worker-alive` (`supervision.ts:274`) before any gate runs.
- **Review criteria, not committed:** a scratch probe that assigns a `DeskMergeReading` to a `MergeReading` fails with `TS2322`, and `git diff --quiet main -- packages/domain/src/rules/reapable.ts` exits 0.

Round 4 built exactly this slice at `824f778c`. The 9 tests passed and each failed without its change. The domain suite passed 2772/2772 and the affected board unit files 162/162. Expect the same.

Repo gates. Run `nvm use` first: Node 24, because pnpm crashes on Node 26.

- `pnpm test`
- `pnpm run typecheck`, plus the domain package's typecheck
- the domain test suite
- `pnpm run test:board`, which rebuilds the artifact. Commit `skills/plot/scripts/board/*.mjs` if the build changes it.
- A changeset: `'@plot-pm/board': patch`, description first. The changelog line is the plan's: *A free agent's merge reading says *not asked* instead of borrowing a word that blames a branch or a connector.*
- Do **not** run `pnpm run test:e2e`, which is CI's gate.

### Bookkeeping

- Push the first real commit as soon as it exists. The branch is already claimed and pushed.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves). Do not use `gh pr create`.
- When the PR exists, append `→ #<number>` inside this slice's heading in the plan's `## Slices` section on `main`: `(Branch: bug/a-question-nobody-asked-has-its-own-word, PR: #N)`. Use a detached scratch worktree on `origin/main`.
- No project board is configured, so no status update is owed.

### Scope guard

This branch owns:

- `packages/domain/src/rules/gates.ts`
- `packages/board/src/server/supervisor.ts` (the import only)
- `packages/board/src/server/entry/registryd-main.ts` (the import and the guard)
- the three test files named above
- `packages/domain/package.json`, only if the `rules/gates` subpath export is missing
- one `.changeset/*.md`
- the rebuilt board artifacts

It does not touch `packages/domain/src/rules/reapable.ts`, `skills/plot/scripts/plot-reap.sh`, `skills/plot/scripts/plot-pr-merged.sh`, any schema, or the payload.

Checked at dispatch on 2026-09-30: no other remote branch changes `gates.ts`, `supervision.ts`, `supervisor.ts` or `registryd-main.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
