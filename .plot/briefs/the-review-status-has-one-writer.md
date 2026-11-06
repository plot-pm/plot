## Implementation brief — pr-review-accepts-a-plot-review (wave 2: Review write gate)

- **Plan (canonical):** `docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md` on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3074 merged
- **Branch:** `feature/the-review-status-has-one-writer` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave follows wave 1, `feature/pr-review-accepts-a-plot-review` (#3187), which owns the writer check. The two waves share no file: this one touches only the command gates. Cut this branch from `main` after wave 1 merges; if it was cut earlier, rebase onto `origin/main` first.

### What to build

A `plot/review` commit-status write from the master agent or a fleet desk is not refused today. Measured on `origin/main`: `roleDenyGateOf` (`packages/board/src/server/entry/gate.ts`, near `:1070`) refuses `plot-host.sh commit-status` with any context through `callsCommitStatus` (`packages/domain/src/rules/role-gate.ts:75`), but it is in `NAME_ONLY_GATES` (`gate.ts:1139`), so only a role agent whose settings file names it runs it. The master agent and a desk run `controllerGateOf` through `--all`, and that gate returns `null` for every linked worktree at `if (linked) return null;` (`gate.ts:999`) — a desk is a linked worktree. Neither gate reads the `gh api …/statuses/<sha> -f context=plot/review` form.

Build one reading, two gates:

1. `rules/role-gate.ts` gains `writesReviewStatus(command)`. It answers true for `plot-host.sh commit-status <sha> <state> plot/review …`, and for a `gh api` call that names a `statuses/<sha>` path with a `context` field of `plot/review` through `-f`, `-F`, `--field` or `--raw-field`, quoted or not.
2. `roleDeniesCommand` (`role-gate.ts:275`) refuses `callsCommitStatus(command) || writesReviewStatus(command)`. A role agent now also loses the `gh api` form.
3. `controllerGateOf` calls `writesReviewStatus` first in `ask`, on the `stripped` command, before the `const atDesk` line, before `readings.where` and before the `linked` return. `wants` gains `writesReviewStatus(command)` so an attended command is read too. The refusal names `plot-review.mjs` as the route.

`controller-gate.ts` gains no parser, and `gate.ts` imports `writesReviewStatus` beside the role-gate names it already imports (`gate.ts:30`). The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The check precedes the git read, so a failing git read cannot let the write through.** Placed after `readings.where`, the existing catch at `gate.ts` returns `null` with a stderr warning when git cannot be read. A check below that catch would allow the write in exactly the case the gate cannot see. The test with a `where` reading that throws holds this.

**It runs before the `linked` return, because a refusal beside `unpinnedMerges` never runs at a desk.** That return sits above the unpinned-merge refusal. Do not place the check there.

**One parser, in `role-gate.ts`.** A second parser in `controller-gate.ts` is the failure decision 10 names. The domain rule is an arrow function, pure, with factual TSDoc.

**The quoted form needs care in both directions.** `runsNamed` reads `withoutQuotes(command)`, which blanks quoted text, so `'context=plot/review'` vanishes if the reading goes through it. The `gh api` arm must read the field value with its quotes. The opposite risk: `git commit -m "gh api statuses/x -f context=plot/review"` must not refuse. The controller gate hands the rule `withoutMessageSinks(withoutQuotedHeredocs(command))`, which blanks a commit message, and the role gate's own `withoutComments` handles the same for a role agent. Test both: a quoted field refuses, a commit message that quotes the command passes.

**A read does not refuse.** `gh api repos/o/r/statuses/<sha>` with no `context` field passes. So do `plot-review.mjs <pr>` and a `commit-status` with another context. `plot-review.mjs` writes the status as its own child process, which the hook never sees — that is the allowed route.

**Named limits, not defects.** The hook reads the agent's own command line. It does not see a script file the agent writes and then runs, or `gh api … --input <file>` whose `context` lies in a file. State them in the TSDoc of `writesReviewStatus`; do not try to close them here.

**No live reproduction.** A forged `plot/review` write on a real repository is the act under review. Tests use command strings and injected readings.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc; decision history goes in the commit message.
- A gate whose exit is 0 cannot prove it fired. Assert the refusal text, not only the code.
- Absent is not false: a `where` reading that fails answers neither "desk" nor "main checkout".

### Done when

The plan's *Tests* list for the gate is the specification:

- `packages/domain/test/role-gate.test.ts`: `writesReviewStatus` is true for `plot-host.sh commit-status <sha> success plot/review …`, `gh api repos/o/r/statuses/<sha> -f context=plot/review -f state=success`, the `-F`, `--field` and `--raw-field` forms and a quoted `'context=plot/review'`; false for `plot-review.mjs <pr>`, a `commit-status` with another context, and a `gh api …/statuses/<sha>` read with no `context` field.
- `packages/board/test/unit/role-deny-gate.test.ts`: the `gh api …/statuses` form refuses beside the existing `commit-status` case at `:21`.
- `packages/board/test/unit/controller-gate-readings.test.ts`: `controllerGateOf` refuses both write forms with a `where` reading of `linked: true` and of `linked: false`, with `PLOT_UNATTENDED` set and unset, and with a `where` reading that throws.
- `test/reconcile/controller-gate.test.mjs`: the hook refuses both forms from a real linked worktree (`git worktree add` in the fixture repository) and from its main checkout; `plot-review.mjs <pr>` and a `commit-status` with another context pass in both.

Lift these, which a naive implementation passes without:

- the `linked: true` case in `controller-gate-readings.test.ts` fails on `origin/main`. It catches a refusal placed after the `linked` return.
- the throwing `where` reading catches a check placed below the git read.
- the real-linked-worktree case in `controller-gate.test.mjs` catches a unit test that injects `linked` and never meets the hook's real worktree detection.
- the commit-message case catches a reading that does not use the stripped command.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. In `test/reconcile/`, run the names you touched in `controller-gate.test.mjs`, never a whole-file glob guess.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits no `.sh` file. If that changes, growth is paid for in the same change, and joining statements with `;` or `&&` is not a payment.

Add a changeset (`plot` package, description first, `bumps:` block last, then run `./scripts/check-changeset-packages.sh`). The PR diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`). `board-server.mjs` is generated; do not commit a rebuild.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while it moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Line numbers above moved since the plan was written (`linked` return `gate.ts:999`, `NAME_ONLY_GATES` `gate.ts:1139`, role-gate import `gate.ts:30`); re-find them by symbol. `docs/review-status-rollout.md` is wave 1's doc edit, not this one's.

### Scope guard

This branch owns: `packages/domain/src/rules/role-gate.ts`, `packages/board/src/server/entry/gate.ts`, and the four test files named above.

Not this branch: `plot-host.sh`, `rules/github-review.ts`, `host-shell.ts`, `pr-refresh.ts`, `merge.ts`, `release-approve.ts`, `slice-pr-next.ts` (wave 1, `feature/pr-review-accepts-a-plot-review`, #3187). Rebase on `origin/main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
