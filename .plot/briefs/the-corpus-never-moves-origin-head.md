## Implementation brief — the-tests-and-sweeps-leave-no-trace (slice 1: The corpus never moves origin/HEAD)

- **Plan (canonical):** `docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/the-corpus-never-moves-origin-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

First slice of four. The other three wait on it by heading order (`rules/eligible.ts:131-134`), not by code: none touches a file this branch owns.

### What to build

`packages/domain/corpus/refs.corpus.test.ts` stops writing a ref in the shared repository's `.git`, and `default_branch` refuses the pin name even when it resolves.

The failure, measured: on 2026-09-04 `refs/remotes/origin/HEAD` pointed at `origin/plot-corpus-pin` twice, hours apart, and `plot-dispatch.sh` refused every dispatch. On 2026-10-03 an interrupted corpus run left it there again and three lifecycle pushes went to `plot-corpus-pin` (#1259). Two parallel corpus runs also collide on the one ref (#1319). The cause is `refs.corpus.test.ts` `beforeAll` (`update-ref` then `symbolic-ref refs/remotes/origin/HEAD`, around `:340`), which mutates the shared repo and relies on `afterAll` to undo it. An interrupted run never reaches `afterAll`.

Two halves, both required:

1. **The test writes no shared ref.** `git symbolic-ref refs/remotes/origin/HEAD` of the shared repository is byte-identical before and after a corpus run, including a run killed in `beforeAll`.
2. **`default_branch` treats a symref naming `plot-corpus-pin` as corrupt, resolving or not.** `repair_origin_head` (`plot-default-branch.sh:72`) repairs it with `git remote set-head origin --auto`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Restoring harder is not the fix.** `afterAll` already restores. The 2026-09-04 and 2026-10-03 corruptions are the state after a run that never reached it (SIGINT, a CI cancel, a crashed worker). Any design whose safety rests on a cleanup hook leaves the same window open. The only design with no window writes no shared ref.

**`default_branch`'s "leave a resolvable symref alone" rule stays for every name except the pin.** `plot-default-branch.sh:27-30` protects a clone whose `origin/HEAD` deliberately names a non-default branch, and `default-branch-repair.test.mjs:95` pins that. Do not weaken it. The pin name is the one exception, because nothing upstream is named `plot-corpus-pin` and no operator chooses it.

**The tension to settle before writing code: a clone cannot carry the pin as its `origin/HEAD`.** `plot-fleet-scan.sh:335-336` takes `cfg "Main branch"` first and falls to `default_branch` otherwise, and `default_branch` now repairs a pin symref. A clone whose `origin/HEAD` names `plot-corpus-pin` is therefore healed to the real default branch in the middle of the scan, and the two readings are asked about two worlds again — the failure the pin exists to prevent (`refs.corpus.test.ts:200-218`: measured 2026-08-31 and 2026-09-01, `read_ref` `cf937747` against `f55402a3`). Pick one of these and say which in the commit message:

- **Clone, pin by the config key.** Clone into a temp directory and give the clone a `Main branch` line, so `cfg` answers and `default_branch` is never asked. `cfg` reads the root `CLAUDE.md`, so write it in the clone's copy only, never the tracked file in the shared checkout (`:208-215` rejected exactly that).
- **Clone, pin by a plain ref.** Create `refs/remotes/origin/plot-corpus-pin` in the clone as a ref at a frozen SHA and leave the clone's `origin/HEAD` on the real default. Then the scans read the real default branch, and the freeze has to come from somewhere else — verify it does before choosing this.
- **Injected pin.** Pass the pin through an argument to `readFleetScan(estate, slug?)` (`corpus/production.ts:84`) and `shellContext(ROOT)` (`adapters/scripts.ts:20`). This touches the adapter and production surface, so it needs the widest check.

The first is the smallest change that keeps the freeze. The brief does not decide for you, but a choice that only works because the clone's `default_branch` is never asked must be proved by a test that fails if `cfg` stops answering.

**Rules carried over unchanged.**

- **No `origin/HEAD` is the runner's normal state, not an odd one.** `actions/checkout` never creates it (`refs.corpus.test.ts:228-247`; measured on CI 2026-09-01, PR #610: six disagreements when the pin went inert). Keep the `main`/`master` fallback so the pin still works on a runner. A clone of a runner checkout has the same property.
- **Both scans still fetch.** `--no-fetch` was tried and reverted (2026-08-31): it gives the readings different worlds. A clone fetches from the shared repo's remote or from the shared repo itself — choose the source on purpose and say why.
- **`branchTips()` and the `moved` set stay.** They freeze the right-hand endpoint (`:304-333`). A clone changes which refs they read; confirm they read the clone's.
- **Absent is not false.** If a clone cannot be made (no disk, no remote), the suite fails with the reason; it does not skip into a pass.
- **A test that spawns waits on exit, and cleans up by the exact name `mkdtempSync` returned.** `scripts/owned-run.sh` fails a run that leaks a temp entry. Never remove by a glob over the shared temp directory.

### Done when

The plan's two slice-1 assertions are the specification:

- A corpus run leaves `git symbolic-ref refs/remotes/origin/HEAD` of the shared repository unchanged.
- `default_branch` with a symref to an existing `origin/plot-corpus-pin` answers the real default branch.

Assertions that exist because a naive implementation passes without them:

- **Kill the run in `beforeAll` and compare the symref.** Comparing only after a clean run passes today's code, which restores in `afterAll`. The test must fail on `origin/main` (`a778bda0d`): record the symref, interrupt after the pin is set, compare.
- **The `default_branch` test uses a pin ref that RESOLVES.** `default-branch-repair.test.mjs:70` already tests an unresolvable pin, which passes today. A resolving fixture is the only one that fails on `main`. Make the arms disagree: also assert a resolving symref to another non-default branch is left alone, so a fix that repairs every resolving symref fails.
- **The refusal is by name.** Assert the stderr line names both refs, as the existing repair tests do.
- **Two corpus runs in parallel do not collide (#1319).** Two clones, two pins: assert neither run's ref list contains the other's.
- **Mutation-test both halves** before trusting them: revert each half of the fix in place and confirm its test goes red.

Plus: a changeset (`plot` patch, description first, `bumps:` block last). No board artifact changes, so no rebuild. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-default-branch.sh`, so growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Prefer a small edit to the existing `origin_head_resolves` / `default_branch` pair over a new function, and trim the header comment that narrates the pin, since the pin no longer touches `origin/HEAD`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Update the comment at `plot-default-branch.sh:21-25` and `:7-12` where it says the corpus repoints `origin/HEAD`: state current behaviour only.

### Scope guard

This branch owns `packages/domain/corpus/refs.corpus.test.ts`, `skills/plot/scripts/plot-default-branch.sh`, `test/reconcile/default-branch-repair.test.mjs`, and the changeset. It may touch `corpus/production.ts` and `adapters/scripts.ts` only if the injected-pin option is chosen.

The other slices in this plan hold: `local-checks.ts` (slice 2), section 14 of `plot-reconcile-scan.sh` (slice 3), and `packages/board/build.mjs` plus `.gitignore` (slice 4). The sibling plans `delivery-reads-one-source`, `the-fleet-loop-reads-its-runs-right` and `a-controller-owns-what-it-starts` run in parallel; check `git fetch` for a branch touching `plot-default-branch.sh` before editing it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
