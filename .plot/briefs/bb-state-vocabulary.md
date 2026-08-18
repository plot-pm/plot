# Brief: bug/bb-state-vocabulary — see PR #210 through CI

The implementation is **already written, committed, and pushed**. Plan:
`docs/plans/2026-08-18-bb-state-vocabulary.md` (Approved, `Impl: same branch`).

**Do not rewrite it. Do not widen the scope.** Your job is to get PR #210
merged, and to fix it only if CI says it is broken.

## What already exists on this branch

- `bb_states_for()` in `skills/plot/scripts/plot-host.sh`, wired into three
  call sites
- 135 lines of new coverage in `test/reconcile/host.test.mjs` — 42/42 pass
  locally, re-run after a rebase onto current main
- `.changeset/20260818-bb-state-vocabulary.md` with its `bumps:` block
- The plan's Branches line annotated `PR #210`
- The GitHub path regression-checked live: `--state open` and `--state all`
  both still return PRs

## Your task

1. **Watch PR #210's checks.**

   ```bash
   bash skills/plot/scripts/plot-host.sh pr-list --state open --rich --limit 20
   ```

   Look for `number: 210`. `checks` is `green`, `failing`, `pending`, or `none`.

2. **If green:** merge it.

   ```bash
   bash skills/plot/scripts/plot-host.sh pr-merge 210 --squash --delete-branch
   ```

   Then verify with `pr-state 210` that it really says `MERGED`. GitHub's API
   has returned 503 intermittently today — if a push or merge appears to fail,
   check the actual result via `gh api` rather than trusting the error.

3. **If failing:** get the real failure, do not guess.

   ```bash
   gh run list --branch bug/bb-state-vocabulary --limit 3 \
     --json databaseId,conclusion,headSha
   gh run view <id> --log-failed | grep -E "not ok|# fail|AssertionError|error:"
   ```

   Fix, push, and let CI re-run. Repeat until green, then merge.

## The Linux traps that cost two CI rounds today

CI runs Linux; you are almost certainly on macOS. Both of these passed locally
and failed on CI:

- **`stat -f '%m' FILE` does not fail cleanly on GNU/busybox.** They read `-f`
  as `--file-system`, fail on `%m` as a missing path, and *still* print a
  multi-line filesystem report to **stdout** before exiting 1. A `bsd || gnu`
  chain runs both halves and concatenates. `2>/dev/null` hides the message, not
  the partial output.
- **`/usr/bin:/bin` is not an isolated PATH.** This repo's Linux CI ships a real
  `gh` at `/usr/bin/gh`. Shadowing with a non-executable file does not help
  either: `command -v` reports it found regardless of the executable bit.

If the failure is in this branch's shell code, suspect a platform difference
before suspecting the logic.

## Do not touch

- **`plot-fleet-scan.sh`** — three sibling branches are in flight on it right
  now (`pulse-names-the-ref-it-read`, and two queued).
- **`packages/board/`** — this plan changes only the adapter script. Its own
  Board impact note says no rebuild is required.
- **The `bb` CLI itself.** A separate `bb` defect was found and deliberately not
  fixed here: repeated `--state` flags silently keep the last value. `bb` lives
  in a different repo with its own plan flow and was reported there. This fix
  does not depend on it — one call per state works either way.

## Definition of Done

- PR #210 merged, verified via `pr-state 210` returning `MERGED`
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass on whatever
  you push
- A report: the merge commit, anything you had to fix, and any judgement call
  you made

If CI stays red for a reason the plan did not anticipate, **stop and report**
rather than reshaping the fix.
