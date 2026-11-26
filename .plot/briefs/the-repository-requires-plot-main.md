## Implementation brief — github-refuses-a-merge-into-a-red-main (wave: Rollout)

- **Plan (canonical):** docs/plans/2026-11-23-github-refuses-a-merge-into-a-red-main.md on main
- **Approved:** 2026-11-23, jwloka, plan-PR #3691 merged
- **Branch:** `docs/the-repository-requires-plot-main` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/the-main-reading-becomes-a-pr-status`, and that slice merged as #3695 on 2026-11-26. The wave is eligible. This slice is documentation only.

### What to build

Add a `plot/main` section to `docs/review-status-rollout.md`. The page today covers `plot/review`, the Writer App and the Merger App, and it says nothing about `plot/main`. On 2026-11-23 the operator merged #3682 on GitHub while main read settled red on `17a7fc438`; the ruleset required no check that carried that reading. #3695 now writes the reading as a `plot/main` commit status. The status holds nothing until the ruleset requires it, and that setting is the part only a person with admin rights makes. This section tells that person what to set, what it does, and how to undo it.

The section states these facts. Each one is read from code or from the live ruleset, so verify it against the source named here before you write it, and do not copy it from this brief.

1. **What writes the status.** fleetd's `plot/main` pass (`packages/fleet/src/shared/auto-main-status.ts`, wired in `auto-writes.ts`) writes one commit status per open PR into the default branch, through `Host.commitStatus`, as the `Review app` identity. The domain rule `mainHoldStatus` (`packages/domain/src/rules/main-hold-status.ts`) decides it. Quote the descriptions exactly as the rule writes them: `failure` with `main is red on <9 hex>; merge the repair PR first`, and `success` with `repair PR for <9 hex>` for the admitted repair PR, or `<branch> is not red` otherwise. A PR into another base, such as `sprint/*`, gets no `plot/main`.
2. **When it writes.** The pass writes on change: a new head, a changed wanted state, or a new repair PR. It keeps its last write per PR in `.plot/state/main-status.json`. A failed write is retried an hour later (`MAIN_STATUS_RETRY_MS`), or on the next pass where the head or the wanted status changed.
3. **The setting.** Add `plot/main` to the required status checks of ruleset `main` (id `24412719`), beside `validate` and `plot/review`. Pin it to the `Review app`'s integration id, `5317669`, as `plot/review` is pinned. Read the live ruleset (`gh api repos/plot-pm/plot/rulesets/24412719`) before you write the ids: on 2026-11-26 it required `validate` (integration `15368`) and `plot/review` (integration `5317669`), with `strict_required_status_checks_policy: false`. This answers the plan's open question about pinning for the rollout page: the live ruleset pins `plot/review` by integration id, so `plot/main` takes the same pin. For another repository, say how to find its Review app's integration id; do not hardcode this repository's id as the general case.
4. **Order of rollout.** State the order as a numbered list, as the existing page does for `plot/review`: (a) fleetd runs the `plot/main` pass, and a scratch PR into main shows a `plot/main` status authored by `<app-slug>[bot]` on its head; (b) every open PR into main already carries one; (c) only then add the required check. A required check with no writer blocks every merge of that PR kind until a person removes the rule, which the existing step 5 of the page already says for `plot/review`. Name the same consequence here.
5. **What the bypass list means.** The ruleset's bypass list holds the admin role (`actor_id` 5, `RepositoryRole`), integration `5173644` and the `Writer app` (`5656981`), each `always`. An administrator's merge on GitHub still lands while main is red, and GitHub asks the administrator to confirm the bypass. The `Merger app` is not on the list and is bound. The hold binds every actor outside the list and makes the hold visible on the merge button for the rest. Removing the admin bypass is a repository decision that this plan does not make; say so in one sentence and do not recommend it.
6. **What a failing `plot/main` asks of the reader.** The description names the red commit. The reader merges the repair PR the repair record names, or waits for main to settle green. Name `.plot/state/repair-record.json` and the `bug/main-repair-<12 hex of lastGreenSha>` branch shape as where the repair PR comes from. When main settles green, fleetd writes `success` on every open PR in one pass.
7. **What a stopped fleetd does.** A commit status does not expire. If fleetd stops while main is red, every open PR keeps its failing `plot/main` and GitHub refuses every merge until fleetd runs again or a person with bypass merges. Say this as the known cost of the hold and give both ways out: `pnpm run fleetctl --restart` is not a command this brief verified, so read `skills/plot-fleet/SKILL.md` and name the real restart command there. This is the plan's open question `[question-fleetd-stops-while-red]`, whose recommendation is (a) accept it, with (c) a person reads the description. Do not document option (b): `plot-fleet --stop` writes nothing, and the plan rejects it because a hold that lifts when its writer stops is not a hold.
8. **How to remove it.** Delete `plot/main` from the ruleset's required checks. The status stays on the heads and gates nothing. To stop the writes, stop fleetd's pass; the code has no config key for that today, so do not invent one. If the code has no switch, say that removing the required check is the whole undo.
9. **Bitbucket.** Read `packages/fleet/src/shared/auto-main-status.ts` and `plot-bitbucket-commit-status.mjs` and state what holds. The plan's recommendation is that the same pass writes on both hosts and only the setting differs: a Bitbucket merge check ("minimum successful builds") would need to require the build status. If the pass writes there, name the Bitbucket setting in two sentences as a pointer and mark it untested; this repository is on GitHub and nobody here has proved the Bitbucket setting. If the pass does not write there, say so.

### Decisions the plan settles — do not re-derive them

**The document describes; it changes no setting.** A person sets the ruleset. No slice changes repository settings, and this slice must not call `gh api -X PUT` or `-X PATCH` on the ruleset, not even to test the wording. Reading the ruleset with `gh api` is fine.

**The reading is an answer and the status is a mirror.** Plot's own merge paths (`plot-ask.mjs merge`, fleetd's merge arm) read `.plot/state/default-branch.json` and never read `plot/main`. Say this once on the page, because a reader who sees a required check will assume the controllers also read it. `A Decision Reads The Index` in `CLAUDE.md` is the authority; do not edit `CLAUDE.md` for it.

**`plot/main` counts toward no PR's checks.** Commit `f89946ce0` leaves it out of a PR's `checks` and `failing_checks`, so a red main makes no open PR read `failing`, and the admitted repair PR still merges. Mention it in one sentence under the reader's section: a failing `plot/main` is not a CI failure on the PR, and a fix agent has nothing to fix there.

**The status is required, so a missing one blocks.** The plan's `[question-new-pr-head]` asks whether GitHub blocks a merge on a required check that is absent. It does for `plot/review` today under the same ruleset, and `plot/main` takes the same shape: a PR opened or pushed while main is red shows no `plot/main` until the next PR pass, and the merge button stays refused until it appears. Write that as the expected behaviour, and say it is observed for `plot/review` and not yet for `plot/main`, unless you observe it. Do not claim an observation you did not make.

**The `Review app` budget.** The plan's `[question-rate]` asks about the installation's budget. The pass writes one request per open PR per change, and PRs that share a head and a wanted status cost one write. State that number. Do not state a measured rate you did not measure.

**Rules this repo keeps re-learning.** Absent is not red: a missing, unparseable or other-version `default-branch.json` reads `success`, so a stopped or unread fleetd lifts nothing on its own and writes no `failure`. A reading older than `Checks wait` also reads `success`, and the writer re-asks the head at least once per half `Checks wait`. Say both, because a reader who sees `success` on a red main needs to know it can mean "no fresh reading".

### Done when

The plan's slice line is the specification: the rollout document names how to add `plot/main` to the required checks of ruleset `main` (`24412719`) and remove it again, what its bypass list means for the hold, and what a failing `plot/main` asks of the reader.

Lift these, because a naive section passes without them:
- Every quoted description, context name, state file path, branch shape and ruleset id matches the code or the live ruleset character for character. Grep for each in `packages/` before you commit. A description that drifts from `main-hold-status.ts` makes a reader search for a status that no PR carries.
- The section names the rollout order and the consequence of skipping it (step 4). A section that only says "add the check" is the shape that blocks every merge.
- The section says the admin bypass still merges. A section that implies the hold binds everyone would be wrong on GitHub and was the reason the plan has a bypass paragraph.
- The page's title and its first paragraph still make sense. The page began as the `plot/review` rollout; extend the lead paragraph by one sentence so a reader who opens the page for `plot/main` finds it, and leave the `plot/review` sections as they are. Prove the untouched part with `git diff` showing only additions plus the lead edit.

Plus the repo's gates: `node skills/plot/scripts/board/plot-local-checks.mjs` before each push — run what it prints. The suites in the `CI suites` key run in CI only. A docs-only change needs a changeset only if the checks print one as required; run `./scripts/check-changeset-packages.sh` if you add one (package `plot`, description first, `bumps:` block last). If `CLAUDE.md` changes, run `./scripts/check-agents-md.sh --write`; this slice has no reason to touch it. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

Writing: follow the ASD-STE100 rules from the global instructions — active voice, one instruction per sentence, headings of one to four words, and no hard-wrapped prose in markdown (one paragraph or list item is one line). The existing page wraps its prose by hand; that is old text, and you leave it alone. Your new lines are one line each.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

When the PR is created, append `→ #<number>` to this branch's line under `### Rollout` in the plan's `## Slices` section.

### Scope guard

This branch owns the `plot/main` section of `docs/review-status-rollout.md`, the one-sentence lead edit, and a changeset if the checks ask for one. It changes no code, no script, no config key and no repository setting. Slice 1 owns the rule and the pass; if you find the code disagrees with a fact in this brief, the code is right: write what the code does, and report the difference.

Open PRs on neighbouring ground were not verified at dispatch. Run `gh pr list --search 'review-status-rollout in:files'` before you start, and report a collision instead of resolving it by editing the other PR's lines.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
