## Implementation brief — plan-state-write-fails-when-a

- **Plan (canonical):** `docs/plans/2026-10-24-plan-state-write-fails-when-a.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2502 merged
- **Branch:** `bug/plan-state-write-fails-when-a` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

One slice, one wave (`Label write`). Nothing waits on it and it waits on nothing.

### What to build

On 2026-10-18 the approve of #2054 and #2055 reported `plan-state=failed`: `plot-host: failed to update https://github.com/plot-pm/plot/issues/2054: 'plan:released' not found`. The repository had `plan:draft`, `plan:approved` and `plan:delivered` and lacked `plan:design` and `plan:released`. `plot-host.sh` `issue-label` (`skills/plot/scripts/plot-host.sh:5356`) runs one `gh issue edit --add-label X --remove-label a,b,c,d`, and `gh` fails the whole call when any listed label does not exist in the repository. On #2054 the add still landed, so the issue carried `plan:draft` and `plan:approved` together, and the comment and close steps never ran.

Change `issue-label` so that:

1. it reads the issue's current labels (`gh issue view <n> --json labels`) and removes only the listed labels the issue carries;
2. it creates the label to add (`gh label create`) when the repository lacks it, then adds it;
3. add and remove land in one `gh issue edit`, so a failure leaves the issue unchanged rather than half-written;
4. an issue that already carries two phase labels loses the others on its next write.

The change stays in `plot-host.sh`. `planStateLabelsToRemove` and `githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:24`, `:62`) keep their contract. The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **Fix in `plot-host.sh`, not in the adapter.** `plot-host.sh` is the one place that talks to the host CLI, and `scripts/check-host-cli-callers.sh` enforces it. A `gh label list` call from TypeScript is a second caller and fails that gate.
- **Read the issue, not the repository's label list.** The failure is "the issue does not carry label X" combined with "the repository does not have label X". Reading the issue's own labels answers the remove side for any repository state. Only the add side needs the repository's label set, and `gh label create` failing with "already exists" is the signal to continue.
- **Do not read the issue-index file for labels.** The plan leaves this as an open question. Treat it as closed against the index: `issues.json` is a bought-answer index written by `refreshIssueIndex`, and *A Decision Reads The Index* says a stale reading must not decide a write. A write must see the labels now. Confirm with `grep -n labels packages/fleet/src/shared/issue-refresh.ts` before relying on this, and record the finding in the PR body.
- **Created-label colour and description are an open question the plan leaves to this slice.** Pick one fixed neutral colour and a description of the form `Plot plan phase: <phase>`, and name both in the PR body. Do not make them config keys.
- **`PHASES` in `tracker-plan-state.ts` lists four phases, with no `design`.** The `Workflow phases` key and the plan's Motivation name five. Remove-only-carried-labels makes this safe either way: a `plan:design` label on an issue is not in the removal list today, so the fix does not widen it. Do not add `design` to `PHASES` in this slice. If you find that an issue can carry `plan:design`, report it as a separate finding.
- **Rules carried over unchanged:** absent is not false. Read the exit code of `gh`, not the emptiness of its output. An empty label list from `gh issue view` means "carries none", and a failed `gh issue view` means the write fails (exit 3 through `gh_fail`), never "carries none".

### Done when

The plan's slice line is the specification: `issue-label` removes only carried labels, creates a missing label before the add, and applies both in one edit; tests cover a repository missing `plan:design` and `plan:released`.

Assertions that exist because a naive implementation would pass without them:

- **The stub `gh` must reject a nonexistent label on `--remove-label` as real `gh` does.** A stub that accepts any label passes today's broken code. This catches a test that cannot fail.
- **Assert the issue's label set after the write, not only the call log.** A `gh issue edit` that exits 0 and leaves two phase labels is the #2054 shape. This catches a fix that swallows the error but leaves the issue half-written.
- **A write against an issue that already carries `plan:draft` and `plan:approved` ends with exactly one `plan:*` label.** This catches the repair case (item 4).
- **A `gh label create` that fails with a reason other than "already exists" fails the write.** This catches a blanket `|| true`.
- **Run each new test against the unfixed `plot-host.sh` and watch it fail** before you believe it (commit first, then mutate).

Tests to extend: `packages/domain/test/tracker-plan-state.test.ts` and `test/reconcile/release-tells-the-tracker.test.mjs`. In the `.mjs` test, `run()` already deletes `PLOT_UNATTENDED`; keep that. A new helper you write is an arrow function (`export const f = () =>` style in the domain package; arrows anywhere you write the body).

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and not `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so the added lines are paid for in the same change: remove shell elsewhere, or write the label rule in the domain and ask it through a bundle. The gate stores no number and has no override. Measure the growth with the gate before the first push.

Add a changeset (description first, `bumps:` block last) naming package `plot`, skill `plot-host`'s owner skill as found under `skills/`, with a `plan:` line inside the `bumps:` comment block. Run `./scripts/check-changeset-packages.sh`. Do not edit versions by hand and do not commit a rebuilt board bundle.

### Bookkeeping

- Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- Mark the open questions in the plan's `### Open Questions` as answered in the same PR, with the answer you took.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh` (the `issue-label` arm only), `packages/domain/test/tracker-plan-state.test.ts`, `test/reconcile/release-tells-the-tracker.test.mjs`, the changeset, and the plan's Open Questions and Slices line. Other branches in flight in sprint `follow-ups-2-28-3` may touch `plot-host.sh` elsewhere. Run `git fetch` and `git diff origin/main --stat -- skills/plot/scripts/plot-host.sh` before the first push to see a collision early.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
