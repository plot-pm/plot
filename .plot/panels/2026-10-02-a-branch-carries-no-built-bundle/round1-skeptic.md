# Round 1 — Skeptic

Position: amend

The direction is right: a PR whose diff touches no bundle cannot conflict on a bundle, so the stated failure goes for ordinary fleet PRs. But the plan's mechanism looks finished in four places where the failure, or a new one, still happens: slice 2's gate refuses the bot's own bundle PR; slice 2 makes `main` red after every source merge by design; CI runs most of its suites against the stale bundles before it builds; and `plot-desk-dirt.sh` is one of at least six readers of a dirty desk. The trailing window is stated as "about one CI run" without a measurement, and the measurement says it can be much longer.

## 1. Does the design remove the failure?

**For an ordinary PR, yes.** A PR that changes no generated path has no bundle hunk, so GitHub's mergeability no longer depends on `-merge` (`.gitattributes`, 36 `-merge` lines, `git show origin/main:.gitattributes | grep -c -- -merge` → 36; the plan says 41, which is unmeasured or wrong — `git ls-tree origin/main skills/plot/scripts/board/ | wc -l` → 36 files, 35 built plus `plot-monitor.mjs`).

**Paths by which a PR still conflicts or is still stuck:**

- **The bundle PR is refused by slice 2's own gate.** Slice 2 refuses "a PR whose diff against its merge base changes a generated path". The bundle PR from `bot/board-artifact` is exactly such a PR, and once the token question is answered with a PAT/App token it runs as a `pull_request` event. Nothing in the plan exempts it. Result: from slice 2 on, the bundle PR can never pass `validate`, `main` never refreshes, and the design deadlocks.
- **The release PR carries bundles.** `package.json:22` — `"version": "... && bash .dev/scripts/sync-versions.sh && pnpm run build:board"`. `changeset-release/main` therefore commits a fresh build whenever `main` trails, and it and `bot/board-artifact` change the same 35 files. Whichever merges second is DIRTY on GitHub. Both self-heal on the next push to `main` (changesets force-pushes; the workflow force-pushes), so this is a delay rather than a deadlock, but Open Question 4's "confirm it needs no change" has its answer: it does change bundles, and the plan's claim "A release tag holds a fresh build, because the release PR is cut from main" holds for a different reason (the version script builds).
- **PRs open at the switch** (Open Question 3) still carry bundles and are refused; the board's repair can still fire on them until slice 3 and recommits a bundle into a PR that slice 2 refuses (`plot-resolve-artifact.sh:398-421` commits the rebuild and pushes).
- **An agent that stages its desk build** (`git add -A`, `git commit -a`) is refused by CI. The plan answers this with a worker-prompt sentence — a rule, not a gate (CLAUDE.md › Gates Over Rules). `plot-brief-name-gate.sh` is the in-repo precedent for a PreToolUse commit gate on path shape.
- **A desk with rebuilt bundles cannot rebase or pull** once the bundle PR has changed those files on `main`: git refuses to overwrite local changes to tracked files. Agents rebase routinely (memory: "A 'Says' wave branch rebases onto its merged siblings", "Verify a rebase before pushing it"). The plan creates this failure and does not name it.

## 2. What breaks for consumers

**CI itself tests the wrong code after slice 2.** In `validate`, `pnpm run test:contracts` (`ci.yml:186`) and `pnpm run test:e2e` (`ci.yml:206`) and the systemd-unit steps using `plot-registryd.mjs` (`ci.yml:234`, `:324`) all run BEFORE `Board build + artifact freshness` (`ci.yml:1074-1084`). The `corpus` job (`ci.yml:60-95`) never builds at all, and three corpus tests call bundles (`git grep` → `branch-state.corpus.test.ts`, `deliverable.corpus.test.ts`, `sprint-score.corpus.test.ts`); 14 files under `test/` reference `board/*.mjs`. Today they run the PR's committed build. After slice 2 the checkout is `refs/pull/N/merge`, which holds `main`'s stale bundles, so a PR changing a rule is contract-, e2e- and corpus-tested against the rule it replaces. That is green-for-the-wrong-reason in one direction and red-for-someone-else's-change in the other. "Builds the bundles for the run's own tests" must mean "before the first step that reads one, in every job".

**`main` goes red on every source merge, by design.** CI runs on `push: branches: [main, ...]` (`ci.yml:4-21`). After slice 2, every merge that changes board or domain source lands with stale bundles, and the plan keeps the freshness check on `main` ("the bundle PR makes it pass"). So the merge commit's `validate` fails deterministically, and the push-run's contract/e2e/corpus suites also run against stale bundles. A red-by-design `main` trains everyone to ignore red `main`, which is the signal the freshness check exists to give. Current measured baseline already has 4 failed push runs on `main` in the last 15 (`gh run list --workflow ci.yml --branch main --limit 15`).

**The trailing window is not "about one CI run".** Measured with the command above: a `main` push run takes 14–18 min; 15 pushes landed between 06:00 and 08:17 on 2026-10-02 (one per ~9 min), with four inside six minutes (06:22–06:28) and three inside nine (07:28–07:37). The plan force-pushes the bundle PR on every push to `main`, and each force-push restarts its 14–18 min `validate`. With pushes arriving faster than a run completes, the bundle PR does not land until the fleet goes quiet for ~18 min, so during an active day `main` can trail by many merges for hours. That window is where every consumer below is exposed.

**"Every bundle caller already treats a missing answer as could not ask" is unmeasured and false as stated.** CLAUDE.md documents callers that stop rather than degrade: `plot-sprint-release.sh` ("a bundle that cannot answer stops the script"), `plot-release-gate.sh` (exit 2), `plot-desk-root.sh` ("an unaskable rule stops the script" — sourced by nine scripts including dispatch, reap and deliver), `plot-start-command.mjs` ("Any other exit ... nothing starts"). Worse, an older bundle given a newer argument may not fail at all; it may answer under the old rule. A stale-bundle answer is a wrong answer, not a missing one.

**Consumers in the window:**

- Plugin install (`.claude-plugin/marketplace.json` `source: ./`): a user installing from `main` gets new `*.sh` with old `board/*.mjs`. Same mismatch as above, now shipped to adopting repos.
- Operator's board under `node --watch` (`package.json:14`): runs `main`'s committed `board-server.mjs`, so a merged board fix is invisible until the bundle PR lands. CLAUDE.md:Testing already warns this "reads exactly like the fix not working"; the window makes it routine.
- Desks: `plot-board-probe.sh` makes a desk resolve the MAIN checkout's artifact (`test/reconcile/boardprobe.test.mjs:266`), so a desk's own rebuild is not what its board runs. Scripts at desks call the desk's tracked `board/*.mjs`, i.e. the stale build unless the agent rebuilt.
- After slice 2, desk rebuilds read as dirt to every reader the plan does not touch (next section).

## 3. Slice order and what is missing

**Order is not safe as written.** Slice 2 deadlocks (bundle PR refused) and reddens `main`. Slice 3 runs the repair through the whole slice-2 period, recommitting bundles into PRs slice 2 refuses — the repair must be switched off no later than slice 2 (the trigger is `packages/board/src/server/resolver.ts:236-237`, `REPAIR_SCRIPT`).

**`plot-desk-dirt.sh` is one reader of six.** Its only consumers are `plot-reap.sh:276` and `plot-reconcile-scan.sh:323`. Uncommitted desk changes are also read by: `plot-worker-state.sh:392` (`plot_worker_dirty_filter` — decides `stalled`, which the supervisor acts on), `packages/board/src/server/registry.ts:1181` (`git status --porcelain`, "no exclusions"), `plot-dispatch.sh:1925` (`--restart`), `:2100` (`--release` refuses on dirt), `:3547`, and `plot-worker-monitor.sh:432`. A desk holding its own build reads `stalled`, gets a correction or a `PLOT-BLOCKED`, and cannot be released. Excusing paths in one file recreates the drift CLAUDE.md records for `plot-pr-merged.sh`.

**Missing from slices:**

- Slice 1: a `concurrency:` group on the build workflow, so a run for an older `main` cannot finish after a newer one and force-push an older build over it. A loop guard is implicit (the bundle PR's merge pushes to `main`, finds a fresh tree, opens nothing) — state it and test it.
- Slice 1: the token. The repo already solved the same problem for `changeset-release/main` by adding the branch to `on.push.branches` so a push-run reports `validate` on the head SHA (`ci.yml:6-21`). Adding `bot/board-artifact` there may remove the need for a PAT/App token for the check; whether an auto-merge enabled with `GITHUB_TOKEN` then fires, and whether its merge push triggers `release.yml` (pushes made by `GITHUB_TOKEN` start no workflow), must be measured.
- Slice 2: the build step moved ahead of `test:contracts`, `test:e2e`, the systemd steps, and added to the `corpus` job.
- Slice 2: the gate keyed on `github.event_name == 'pull_request' && github.head_ref != 'bot/board-artifact'`; on `push` to `main` the freshness check becomes a report, not a failure (the bundle PR is the freshness mechanism). `changeset-release/main` runs as `push` and keeps a passing freshness check because it builds.
- Slice 2: one shared generated-path filter consumed by all six dirt readers, with a test that a desk holding only a rebuild reads clean in each. Alternatively avoid dirt entirely: desks build to a path git does not track, or set `git update-index --skip-worktree` on the generated set at desk creation (also fixes the rebase refusal).
- Slice 2: a commit-time gate (PreToolUse, like `plot-brief-name-gate.sh`) refusing a staged generated path on a non-bot branch, so the refusal arrives at commit rather than after a CI round trip.
- Slice 2 or 3: the docs and gates that assert today's behaviour — `CLAUDE.md:223` (helper row), `CLAUDE.md:663` ("On a conflict in `board-server.mjs`"), `docs/definition-of-done.md:30` (Resolving a board artifact conflict), the `.gitattributes` header ("The CI no-diff gate is what keeps this honest"), `scripts/check-script-names.sh:110` exception, `test/reconcile/artifact.test.mjs:247`, the resolver tests, and `schema.ts:2062,2102` comments. The freshness-step error message at `ci.yml:1080` tells the reader to "commit the result", which slice 2 inverts.
- A changeset per slice; slice 3 removes a shipped script.

## 4. Open Questions

- **Q1 (token) is a blocker for slice 1** and is mis-framed: the repo's own `changeset-release/main` precedent (`ci.yml:6-21`) is a candidate answer that needs no secret for the check, and the side effect "a `GITHUB_TOKEN` merge triggers no `push` workflow" decides whether `release.yml` and the CI push-run see the bundle merge at all. Answer before approval.
- **Q2 (two merges in one run) is a blocker** and is broader than stated: the measured push rate (one per ~9 min, bursts of four in six minutes) against a 14–18 min run means force-push-and-restart can starve the bundle PR for hours. The plan needs a decided policy — do not force-push while the bundle PR's run is in progress and let the next run catch up; or let the workflow push the build to `main` directly through a bypass actor (`enforce_admins` is off, per the plan's own Notes), which shrinks the window to one build.
- **Q3 (PRs open at the switch)** is answerable now: ship the repair line plus the repair switched off in the same slice; no sweep is needed if the gate prints the command.
- **Q4 (release PR)** is answered by `package.json:22`: it builds and carries bundles. Remove the question and state the consequence (it may conflict with the bundle PR; both regenerate).
- **Missing questions:** what does a red `main` push-run mean after slice 2; what does a desk's dirt mean to the five readers outside `plot-desk-dirt.sh`; which bundle callers fail closed against an older bundle (a list, measured, replacing the unmeasured sentence).

## Exact amendments

1. Approach §2: exempt `bot/board-artifact` from the no-bundle gate; on `push` to `main` the freshness step reports and does not fail; build before the first step that reads a bundle in `validate`, and add the build to `corpus`.
2. Approach §1: add a `concurrency:` group; replace "force-pushes on each push to main" with a decided policy for runs in progress (Q2), justified against the measured 14–18 min run and ~9 min push interval.
3. Approach §3: replace "`plot-desk-dirt.sh` excuses the generated paths" with one shared filter used by `plot-worker-state.sh`, `registry.ts`, `plot-dispatch.sh` (restart, release, :3547), `plot-worker-monitor.sh`, `plot-reap.sh` and `plot-reconcile-scan.sh` — or with `skip-worktree` at desk creation — and name the rebase refusal it prevents. Add a commit-time gate for staged generated paths.
4. Move "the board's automatic call to `plot-resolve-artifact.sh`" from slice 3 into slice 2.
5. "What trails": replace "about one CI run" with the measured run time and push rate, and replace "Every bundle caller already treats a missing answer as could not ask" with the measured list of fail-closed callers and what each does against an older bundle.
6. Motivation: "`.gitattributes` marks 41 paths" → 36 (measured).
7. Open Questions: mark Q1 and Q2 as blocking slice 1; answer Q4 from `package.json:22`; add the three missing questions above.
8. Slice lists: name the docs, gates, tests and error text in §3 above under the slice that changes the behaviour each asserts.
