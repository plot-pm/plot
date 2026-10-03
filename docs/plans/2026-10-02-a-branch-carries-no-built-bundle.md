# A branch carries no built bundle

> A pull request no longer commits the generated board bundles. After each merge, a GitHub App builds them and pushes them to `main`. Today every PR carries its own build of 34 bundles, so each merge makes every other open PR conflict, and on 2026-10-02 seven green PRs needed a merge train to land.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1187, #1112
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, jwloka, `bug/main-builds-its-bundles`
- **Started:** 2026-10-03, jwloka, `bug/a-pr-carries-no-bundle`

## Changelog

- A pull request no longer carries the generated board bundles under `skills/plot/scripts/board/`. CI builds them before its first test, and a PR whose diff changes one is refused with the command that restores them.
- After each merge to `main`, a workflow builds the bundles and pushes the result to `main` as a GitHub App. An open PR therefore no longer conflicts with `main` because another PR merged.
- A desk that rebuilt the bundles to test locally reads clean to the reaper, the supervisor and `/plot-dispatch`, and the loop resets it to `main` without a new desk.
- The board no longer repairs bundle conflicts. `plot-resolve-artifact.sh` and the board's automatic call to it are removed. An artifact-only conflict now names the restore command.

<!-- Board impact: the board's artifact is one of the 34 bundles. The operator's board runs main's committed build, which trails a merge by one build (about 3-5 min). The board's automatic repair and its Repair display are removed in slice 3, and the `artifact-conflict` state is reworded there. -->

## Motivation

**Every merge makes every open PR conflict.** `skills/plot/scripts/board/` holds 36 files. 34 of them are generated bundles, listed in `BOARD_ARTIFACT_PATHS` (`packages/board/src/contract/bundles.generated.ts`) and marked `-merge` in `.gitattributes`. The other two, `README.md` and `plot-monitor.mjs`, are written by hand. Local git keeps one side of a `-merge` file whole, but GitHub ignores the attribute when it computes mergeability. Measured 2026-10-02:

- After the merge of #1185, all 10 open PRs read DIRTY. The only conflicts in 9 of them were in bundles. The 10th, #1182, also conflicted in `test/reconcile/host.test.mjs`.
- A hand repair (merge `main`, take a side, `pnpm build:board`, push) cleared them. The watcher then merged #1185 and #1177, and the next five merges failed on new bundle conflicts.
- Repairing, re-running CI and merging one PR at a time costs about 20 minutes per PR, because one `validate` run takes 16–18 minutes. A merge train (#1188) landed seven green PRs in one merge, after one combined rebuild.
- Of the last 7 push runs on `main`, 3 failed in `Board build + artifact freshness`.

**The automatic repair fails and does damage.** `plot-resolve-artifact.sh` runs `pnpm run test:board` before it pushes. That run fails on every local machine because `streaming-scan.test.ts` reads the machine's real PR index (#1112). After the failure, the rollback runs `git reset --hard HEAD~1` (`plot-resolve-artifact.sh:411`). That removed an operator's pushed commits twice on 2026-10-02 (#1187).

**The cost falls on the fleet.** An agent whose PR is DIRTY reads as waiting on a person (#1164). It cannot finish, and its slot stays taken.

## Design

### Approach

**A built bundle is `main`'s output, never a branch's input.** The term "generated path" in this plan means exactly an entry of `BOARD_ARTIFACT_PATHS`, never the directory.

**1. `main` builds its own bundles (slice 1).**

- A workflow runs on every push to `main`, in a `concurrency` group with `cancel-in-progress: true`. A run for an older push therefore cannot push an older build over a newer one.
- It runs `pnpm build:board`. When the generated paths differ from `HEAD`, it commits them as `plot: build the board artifact` and pushes to `main` with a token of a GitHub App. A repository ruleset names the App as a bypass actor for the PR and `validate` requirements. If the push is refused because `main` moved, the next push's run builds again, and nothing is lost.
- **Loop guard:** the App's own push starts the workflow again. That run finds the tree fresh and pushes nothing. A test proves it.
- **`main` stays green between a merge and its build.** On `push` to `main`, the step `Board build + artifact freshness` reports a stale build as a warning and exits 0. The workflow owns freshness. A separate step fails when the bundles on `main` are still stale more than one workflow run after the merge that changed the source, so a broken workflow becomes visible.
- **The release job checks freshness before it tags.** `release.yml` runs `pnpm build:board` and refuses to tag when the generated paths differ. The `version` script (`package.json:22`) no longer runs `build:board`, so the release PR carries no bundle and takes `main`'s.
- **Prerequisite, owned by a person:** create the App on `plot-pm/plot` with `contents: write`, add it to the ruleset bypass list, and store its id and private key as repository secrets. A fleet agent cannot do this. Slice 1 is dispatched only after the secrets exist.

**2. A PR's diff carries no bundle (slice 2).**

- **The gate is a script with a fixture test:** `scripts/check-no-bundle-diff.sh`, following the `check-bundle-attributes.sh` and `test/reconcile/bundle-attribute-gate.test.mjs` precedent. On a `pull_request` run it refuses a diff against the merge base that changes a generated path. It reads the generated set from the same derivation as `check-bundle-attributes.sh`, never from a list. It does not refuse `bundles.generated.ts` or `.gitattributes`: two PRs that add bundles still conflict there, and reading that conflict is the correct repair.
- **The refusal prints the repair with exact paths:** `git checkout "$(git merge-base HEAD origin/main)" -- <each generated path the diff changes>`, plus `git rm` for a generated path the merge base lacks. It never prints the directory, because `README.md` and `plot-monitor.mjs` are not generated.
- **CI builds before its first test.** `pnpm run build:board` moves ahead of `Helper contract tests`, `E2E choreography tests` and the systemd steps in `validate`, and the `corpus` job gains it. Three corpus tests and 14 files under `test/` load bundles, and after this slice the checkout holds `main`'s build, not the PR's.
- **A commit-time gate refuses a staged generated path** on any branch, as `plot-brief-name-gate.sh` refuses a misnamed brief. The refusal then arrives at commit, not after a 16-minute CI run. It is registered in `hooks/hooks.json`, so `plot-install-hooks.sh` installs it.
- **One filter excuses the generated paths at a desk.** Uncommitted desk changes are read in four places today:
  - `plot_worker_dirty_filter` (`plot-worker-state.sh:389`) decides `stalled`, `desk_is_resettable`, and the `--restart` and `--release` refusals. `trees-git.ts` sources it for `Trees.dirtyPaths`, which `rules/gates.ts` and `rules/movable.ts` read.
  - `desk_dirt` (`plot-desk-dirt.sh`) serves the reaper and reconcile §21.
  - `bashCleanliness` (`packages/board/src/server/registry.ts:1153-1190`) serves the board's drop rule.
  - `plot-dispatch.sh:1925`, `:3541` and `plot-fleetctl.sh:1155` read raw porcelain.

  All of them read one sourced filter that excuses exactly the generated paths, path by path, as `plot-desk-dirt.sh:20-21` requires. One test proves that a desk holding only rebuilt bundles reads clean in each reader, and a desk with a source change beside them reads dirty. The rules in `rules/gates.ts` and `rules/reapable.ts` stay unchanged; only the reading changes.
- **`reset_desk` restores the generated paths** before `git checkout --detach origin/<main>` (`plot-worker-loop.sh:871-905`). The checkout is otherwise refused once `main`'s bundles moved, and the loop leaks one desk per slice.
- **The text that says "commit the artifact" changes:** `.plot/worker-prompt.sh:186`, the `ci.yml:1080` error message, `CLAUDE.md` (the Testing paragraph "On a conflict in `board-server.mjs`" and the helper-table row), `docs/definition-of-done.md:27-60`, and the `.gitattributes` header. `plot-install-prompt.sh` never overwrites an adopting project's prompt, and the changeset says so.

**3. The repair goes (slice 3).** The removal list, read from `origin/main`:
- `plot-resolve-artifact.sh`;
- `packages/board/src/server/resolver.ts` (`mayResolve`, `REPAIR_SCRIPT`, `spawnRepair`) and `test/unit/resolver.test.ts`;
- `packages/board/build.mjs:1158,1191,1198`, `packages/board/package.json:42` and `packages/board/.gitignore:21`;
- `scripts/check-script-names.sh:110`, `packages/domain/test/scripts-shell.test.ts:350` and `release-smoke.sh`;
- the `Repair` schema and its client rendering (`contract/schema.ts:2062-2290`), the comments at `stuck.ts:138` and `plot-reap.sh:48`, and the CLAUDE.md helper row.

  Two parts of the slice are not deletions:
- **The freshness and set-equality assertions survive.** `test/reconcile/resolveartifact.test.mjs` (about lines 560-600) holds the only test that `bundles.generated.ts` is fresh and equals the shell derivation. Those assertions move to the new gate's test before the file goes.
- **`artifact-conflict` keeps its classification and changes its meaning.** After slice 2, an artifact-only conflict means "this branch committed a bundle". `stuck.ts` renders the restore command and no pending repair. That wording is a domain property with a unit test (`stuck-display.test.ts`, `stuck-rows.browser.test.ts`).

**Order.**
- Slice 1 is safe alone: while PRs still carry bundles, `main` is fresh after each merge and the workflow pushes nothing.
- Slice 2 starts refusing bundle diffs only after slice 1 keeps `main` fresh.
- Slice 3 removes the repair once nothing needs it.
- **The board's automatic repair switches off in slice 2.** Otherwise it commits a rebuild into a PR that slice 2 refuses. The trigger is `resolver.ts:236-237`.

**What stays.** The bundles stay tracked on `main`, because the plugin installs from the repository (`.claude-plugin/marketplace.json` names `source: ./`) and runs `skills/plot/scripts/board/*.mjs` directly.

**What trails, measured against the route chosen.** Between a merge and the App's push, `main` holds the previous build for one workflow run: install, build and push, about 3–5 minutes. In that window:
- a bundle that cannot answer stops `plot-fleet-scan.sh` (exit 2 at `:3809`, `:4217`), `plot-approve.sh`, `plot-deliver.sh`, `plot-dispatch.sh` and every script sourcing `plot-desk-root.sh`;
- an older bundle given a newer argument may answer under the old rule, which is a wrong answer, not a missing one;
- the operator's board under `node --watch` runs the previous build.

  The window is short enough to accept, and the fleet scan's exit 2 retries on the next pulse. A bot PR would have stretched it to a 16–18 minute `validate` run, restarted by every push during a merge burst.

### Open Questions

- [ ] **The App** (decided 2026-10-02: an App, pushing to `main` through a ruleset bypass). Who creates it, and is it also used for `release.yml:49`? Release PR #1160, opened with `GITHUB_TOKEN`, has never run a check and is merged with `--admin`. The comment at `ci.yml:6-22` describes push runs that never happened.
- [ ] **The bypass and the required check.** Confirm that a ruleset bypass lets the App push to `main` past both the PR requirement and the required `validate` check, and that its push starts the push-triggered workflows. A push made with an App token does start workflows, unlike `GITHUB_TOKEN`.
- [ ] **PRs open at the switch.** On 2026-10-02 five PRs are open. Plan: the gate's repair line plus one manual pass, no sweep script.

## Slices

### Main builds its bundles

- `bug/main-builds-its-bundles` — a workflow on push to `main` builds the bundles and pushes them to `main` as the App, in a concurrency group with a loop guard; `main`'s freshness step warns and a lag check fails; the release job checks freshness before it tags, and the `version` script stops building → #1249 <!-- builds: board-artifact workflow -->

### A PR carries no bundle

- `bug/a-pr-carries-no-bundle` — `scripts/check-no-bundle-diff.sh` refuses a generated path in a PR diff and prints the merge-base restore; CI builds before its first test; a commit-time gate refuses a staged generated path; one filter excuses the generated paths in every desk reader; `reset_desk` restores them; the board's automatic repair is switched off <!-- waits: bug/main-builds-its-bundles --> <!-- builds: check-no-bundle-diff.sh, the generated-path desk filter -->

### The repair is retired

- `bug/the-artifact-repair-is-retired` — removes `plot-resolve-artifact.sh`, the resolver, the `Repair` display and every listed reference; moves the freshness and set-equality assertions; `artifact-conflict` names the restore command <!-- waits: bug/a-pr-carries-no-bundle -->

## Notes

- 2026-10-02: drafted after the merge train #1188. GitHub settings read the same day: `main` requires the `validate` check (`strict: false`), a PR, and 0 approvals; `enforce_admins` is off; `allow_auto_merge` is on; the repository holds no Actions secrets.
- 2026-10-02, round 1 (panel: skeptic, operator, domain; all `amend`, `.plot/panels/2026-10-02-a-branch-carries-no-built-bundle/round1.md`): the bundle-diff gate would have refused the bot's own PR, and a stale `main` would have been red by design. CI ran its suites before the build. Excusing the bundles in `plot-desk-dirt.sh` alone left three other readers calling a desk `stalled`. The repair line restored from the wrong commit. The operator chose the App-pushes-to-`main` route, which removes the bot PR, its exemption and its starvation during merge bursts.
