# Round 1 — operator lens

Position: amend

The direction is right: a bundle is main's output, and removing it from branches removes the conflict class that cost the merge train on 2026-10-02. As written, though, my day after slice 2 has a red `main` after every merge, a bot PR that starves during merge bursts and cannot run its checks without a credential nobody has created, fleet desks that read as `stalled` and cannot be reset, and a CI order that tests shell scripts against stale bundles. Each of these has a concrete fix below. The token question is a blocker for approval.

## Findings

### F1. The token is a blocker, and the release PR already proves it (rubric 4, 1)

- `gh pr view 1160 --json author,statusCheckRollup` → author `app/github-actions`, zero status checks; `gh pr list` → #1160 `MERGEABLE BLOCKED`.
- `gh run list --branch changeset-release/main` → the last 8 runs are all `pull_request` / `action_required`, newest 2026-09-27. Not one `push` run exists, although `ci.yml:6-22` adds `changeset-release/main` to `push.branches` and claims a push-triggered run reports `validate`. A push made with `GITHUB_TOKEN` starts no workflow, so that workaround never fired.
- `gh api repos/plot-pm/plot/actions/secrets` → no secrets listed. No App or PAT exists today.
- Branch protection (`gh api .../branches/main/protection`): `validate` required, `strict: false`, 0 approvals, `enforce_admins: false`; `allow_auto_merge: true`, `delete_branch_on_merge: true`.

A bundle PR opened with `GITHUB_TOKEN` sits exactly where #1160 sits: BLOCKED, no checks, auto-merge never fires. Slice 1 delivers nothing until the credential exists, and slice 2 then turns main permanently stale. The question must be answered before approval, not during slice 1.

Operator view on the choice: a fine-grained PAT makes me the author of every bundle PR, so the board's *Only my work* filter (`People` key) shows a bot PR as my work, and the PAT expires on a date I must remember. A GitHub App installed on `plot-pm/plot` with `contents: write`, `pull-requests: write` has neither cost. The same credential also repairs #1160, which every release has merged with `--admin` (`ci.yml:9-15`). The plan should name the App, name who creates it, and fix `release.yml:49` in the same slice or name the plan that does.

### F2. Main goes red after every merge (rubric 2, 3)

The plan keeps the step a freshness check on `main` and says "the bundle PR makes it pass" (Design, point 2). After slice 2 every merge that touches board source lands without bundles, so the push run on `main` fails `Board build + artifact freshness` (`ci.yml:1074-1084`) every time, until the bot PR lands. This already happens today: of the last 7 `main` runs, 3 failed in exactly that step (runs 36979093142, 36978708031, 36976195019). After slice 2 it becomes the normal state of `main`, and a red main stops meaning anything — the step that fails for a real reason (e.g. `Helper contract tests`, run 36979551094) hides among the expected ones.

### F3. The window is one validate run at best, and unbounded in a burst (rubric 2)

- `validate` on `main` takes 16–18 minutes (06:26→06:44, 06:58→07:17, 07:36→07:54 on 2026-10-02).
- Pushes to `main` arrive faster than that: 07:28, 07:32, 07:36, 07:37 — four within 10 minutes. `git log origin/main --since=2026-10-01 --merges` → 88 merges.
- Each push force-pushes `bot/board-artifact`, which gives the PR a new head and restarts its 17-minute `validate`. With `strict: false` auto-merge waits for the checks of the current head, so during a burst the bot PR never lands. The window is the burst plus one run, not "about one CI run".
- Each push also costs a second full `validate` (the bot PR) and a third (the bot merge on `main`), plus a `release.yml` run that force-pushes #1160 again.

Two runs of the workflow can also race: an older run that force-pushes after a newer one puts an older build on the branch. The plan names no `concurrency` group.

### F4. "Every bundle caller treats a missing answer as could not ask" is false (rubric 2)

Callers that fail closed, from `origin/main`:
- `plot-fleet-scan.sh:3809` and `:4217` exit 2 — `cannot read branch states` / `cannot read slice verdicts`. The scan is what my board and the supervisor read.
- `plot-approve.sh:513`, `plot-deliver.sh:177,393`, `plot-dispatch.sh:2316` stop with `run 'pnpm build:board'`.
- `plot-desk-root.sh` (CLAUDE.md: "No caller keeps a fallback default: an unaskable rule stops the script"), `plot-sprint-release.sh` and `plot-start-command.mjs` ("Any other exit is a rule that could not be asked, and nothing starts") stop too.

And a stale bundle does not always fail to answer: it answers the old rule. A PR that changes a rule and its shell caller lands the caller first; for the window the new caller reads the old rule's answer, which is a wrong answer rather than a missing one. In my day this is: the fleet scan errors or misjudges, dispatch and approve stop with a repair (`pnpm build:board`) that I must not commit, and the plugin installed from `main` in that window (`marketplace.json` `source: ./`) ships the mismatched pair.

### F5. Fleet desks with a local build are not handled by `plot-desk-dirt.sh` alone (rubric 3)

The plan excuses generated paths in `plot-desk-dirt.sh` only. Two other readers decide what a desk is:

- `plot-worker-state.sh:389` `plot_worker_dirty` — used by `plot-worker-loop.sh:800,827` (the `uncommitted-changes` reason and the `stalled` state), by `desk_is_resettable` (`:846`), and by `plot-dispatch.sh`'s `--restart` / `--release` refusals ("uncommitted work on the desk"). A desk that only rebuilt bundles would read `stalled`, take a correction from the supervisor, and refuse `--release`.
- `reset_desk` (`plot-worker-loop.sh:871-905`) runs a plain `git checkout --detach origin/<main>` and deliberately never `reset --hard`. A desk holding locally rebuilt bundles whose committed versions differ between its HEAD and the new `origin/main` (true after every bot PR) makes git refuse the checkout, and the loop falls back to a new desk. Every agent that touched board source leaks one desk per slice.

### F6. CI tests shell scripts against stale bundles (rubric 3)

In `ci.yml`, `Helper contract tests` (`pnpm run test:contracts`, line 184) and `E2E choreography tests` (line 206) run long before `Board build + artifact freshness` (line 1074). The `corpus` job (lines 60-95) runs no build at all. Today that order works because the PR carries its own bundles. After slice 2 a PR that changes a rule and the shell script that calls its bundle runs the contract tests against `main`'s bundles and goes red, or passes for the wrong reason. "It builds the bundles for the run's own tests" must mean a build before the first test in every job that reaches `board/*.mjs`.

### F7. The repair line does not clear the refusal (rubric 1, 4)

The gate compares the diff against the merge base. The printed repair is `git checkout origin/main -- skills/plot/scripts/board/ && git commit`. Once a bot PR has merged after the branch's merge base, `origin/main`'s bundles differ from the merge base's, so the repaired branch still changes them and the gate still refuses. It also leaves in place any bundle file the branch added (a new `build.mjs` output). The repair must restore from the merge base: `git checkout "$(git merge-base origin/main HEAD)" -- skills/plot/scripts/board/` plus `git rm` of generated paths the merge base lacks — or merge `origin/main` first, then restore from `origin/main`. For the transition day this is the whole answer: open fleet PRs today are 4 (#1190, #1189, #1183, #1170; #1170 already DIRTY) plus #1160, so a correct repair line plus one manual pass is cheaper than a sweep script.

### F8. Remaining PR-conflict paths (rubric 1)

- The release PR: `package.json:22` — `"version": "... && pnpm run build:board"`. Changesets runs that on each `main` push, so during a window #1160 commits a bundle build and conflicts with `bot/board-artifact` on the same files. Both are force-pushed from `main`, so it heals, but Open Question 4 has the answer "it does need a decision": either the gate exempts `changeset-release/main` (it runs no `pull_request` checks anyway, F1) or the version script drops the build and the release takes `main`'s fresh bundles.
- Bundles do not embed a version (checked: neither `0.16.2` nor `2.22.2` occurs in `board-server.mjs`), so the release build differs from `main` only during a window.
- Non-bundle conflicts stay, as #1182's `host.test.mjs` showed. That is out of scope and fine.

### F9. Slice 3 and docs (rubric 3)

Slice 3 removes `plot-resolve-artifact.sh` and the board's call. It also needs: `scripts/check-script-names.sh:110` (its exception row), `packages/board/src/server/resolver.ts`, `stuck.ts`, the `Repair` schema in `contract/schema.ts:2062-2290` and its client rendering (a board capability touches six places), the CLAUDE.md helper-table row and the Testing paragraph "On a conflict in `board-server.mjs`", `docs/definition-of-done.md:27-44`, and the `.gitattributes` comment block. Slice 2 must change `.plot/worker-prompt.sh:186`, which today says "run pnpm build:board in THIS worktree and commit the artifact", and the `ci.yml:1080` message "commit the result". `plot-install-prompt.sh` never overwrites an existing `.plot/worker-prompt.sh`, so an adopting project keeps the old instruction; the changeset should say so.

## Amendments

1. **Answer the token before approval.** Name a GitHub App (not a PAT) installed on `plot-pm/plot` with `contents: write` and `pull-requests: write`, name who creates it, and store its id and key as repository secrets. Slice 1 cannot merge without it. Record that the same credential can replace `GITHUB_TOKEN` at `release.yml:49`, and correct or remove the `ci.yml:6-22` comment, which describes push runs that never happened.
2. **Keep `main` green between a merge and its bundle PR.** On `push` to `main`, the freshness step reports staleness as a warning; the bundle workflow owns freshness. Add a separate check that fails only when `main` stays stale past one bundle PR (for example: the workflow fails when it finds an open `bot/board-artifact` PR older than N minutes whose checks failed).
3. **Bound the bundle workflow.** Add `concurrency: { group: board-artifact, cancel-in-progress: true }`. Skip the force-push when the branch already holds the identical tree. State the measured window: 16–18 minutes per `validate`, longer during a merge burst, and say that a burst delays the bundle PR rather than losing it.
4. **Correct the window claim.** Replace "Every bundle caller already treats a missing answer as could not ask" with the list in F4, and state what the operator sees: a fleet scan exiting 2, dispatch/approve/deliver stopping, and a stale rule answering. Either accept that for the window explicitly, or let the bundle workflow push directly to `main` through a ruleset bypass for the App, which removes the window entirely. Add this as an Open Question.
5. **Slice 2: excuse generated paths in every desk reader.** Apply the exclusion in `plot_worker_dirty` (`plot-worker-state.sh:389`) as well as `plot-desk-dirt.sh`, derived from the build as `check-bundle-attributes.sh` derives it. Make `reset_desk` restore the generated paths (`git checkout -- <generated>` / remove untracked generated files) before its checkout, since those files are never work. Add a contract test: a desk whose only change is a rebuilt bundle is resettable, not `stalled`, and releasable.
6. **Slice 2: build before the first test.** Move `pnpm run build:board` ahead of `Helper contract tests` and `E2E choreography tests` in `validate`, and add it to the `corpus` job if any corpus test reaches `board/*.mjs`. Keep the no-bundle diff gate where it is.
7. **Slice 2: fix the repair line.** Print a repair that restores from the merge base and removes generated files the merge base lacks, and test it against a branch whose merge base predates a bundle PR. Resolve Open Question 3 as "repair line, no sweep" — five open PRs today.
8. **Resolve Open Question 4 in the plan.** Either remove `pnpm run build:board` from the `version` script so the release PR carries no bundle, or state that the gate does not apply to `changeset-release/main` and that a release PR cut during a window carries a build that the next bot PR supersedes.
9. **Slice 3 and docs: list the touchpoints in F9**, including `check-script-names.sh:110`, the `Repair` schema and client, CLAUDE.md, `docs/definition-of-done.md`, and the `.gitattributes` comment. Slice 2 changes `.plot/worker-prompt.sh:186` and `ci.yml:1080`.
10. **Operator runbook, two lines in the plan:** what to do when the bundle PR is red (read the failing step; a red bot PR is a red `main` build, so fix forward on `main`, never by committing bundles on a branch), and where the bot PR appears on the board (exclude `bot/` from *Only my work* and from Waiting on you, or name it as expected).
