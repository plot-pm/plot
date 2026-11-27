## Implementation brief — a-foreign-slice-is-never-claimed-here (wave 1: Claim Guard)

- **Plan (canonical):** docs/plans/2026-11-27-a-foreign-slice-is-never-claimed-here.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-foreign-slice-is-never-claimed-here` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on main)

This is wave 1 of 2. Wave 2 (`bug/a-free-wait-writes-its-own-ending`) does not wait on this branch and shares no file with it except `entities/` — do not touch `EndingReasonSchema`, `agentLoop` or `ending-action.ts`.

### What to build

The fleet claimed a slice that belongs to another repository. The Approved plan `the-bitbucket-client-sends-an-access-token` names its first slice as `` - `feature/bb-sends-an-access-token` — quatico-solutions/agent-skills: … `` with no arrow. The fleet pushed the claim `e1cf66e9b` to plot-pm/plot on 2026-11-24 20:53 UTC. GitHub's events API then holds 106 `CreateEvent` and 102 `DeleteEvent` entries for that ref between 2026-11-24 21:30 and 2026-11-26 17:53 UTC, 200 of them on 2026-11-25. No work was done. A person released the claim and added `deferred:` by hand. Your fix is the fix when that slice line reads `foreign` with no `deferred:` and nothing claims it.

Build, in this order:

1. `sliceForeignRepo(line, thisRepo)` in `packages/domain/src/rules/`. It answers the `owner/repo` that a slice line names, or `null`. Two forms count: the description starts `<owner>/<repo>:`, or the line carries `→ owner/repo#N`. A repository equal to `thisRepo` answers `null`. Reuse the reference grammar of `rules/cross-repo-reference.ts` (`REFERENCE`, `LIST_CLAIM`) — export what you need from it rather than copying a second regex.
2. `foreign` in `BranchStateSchema` (`packages/domain/src/entities/fleet.ts:56`), and a new reading `foreignRepo` on `BranchReadings` (`rules/branch-state.ts`, beside `deferredByPlan` at :125). `branchState` returns `foreign` on the line after the `deferred` return (:389) and before `ownState`, so no claim count, ref or PR answer overturns it.
3. `workflows/plan-walk-branches.ts` passes the rule's answer as `foreignRepo`, next to `deferredByPlan: line.deferred` (:528). The plan cites this as `rules/plan-walk-branches.ts:528`; the file is in `workflows/`.
4. Placement: `rules/verdict.ts` (:57, :108) and `rules/eligible.ts` treat `merged` and `deferred` as settled. A foreign branch counts as settled for wave eligibility only where its foreign PR reads merged, and is listed `foreign` otherwise. Every `switch` or exhaustive list over `BranchState` must name the new member — the typechecker finds them; do not silence it with a default.
5. Dispatch: `branchHold` in `rules/auto-dispatch.ts:688` gains a `foreign` case, and `NamedBranchRefusal` (:670) gains `branch-foreign`, whose detail names the repository. `plot-dispatch-command.mjs --branch` refuses it through `packages/fleet/src/server/entry/dispatch-command.ts`. Auto-dispatch never offers a foreign branch.
6. Waiter: a branch whose `waits:` names a foreign branch reads that branch's `→ owner/repo#N` through `Host.prMerged(branch, { repo })` (`ports/host.ts:385`, `repo` option already exists). A foreign branch with no arrow keeps its waiter `waiting`, and the reason names the repository. The wait reading is built at `plan-walk-branches.ts:~513` (`waitPrFor`).

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`foreign` is a branch state, not a flag on `deferred`.** Reusing `deferredByPlan` would make the plan author write `deferred:` by hand, which is exactly the manual repair that ended the 2026-11-25 churn. `deferred` is a decision somebody makes; `foreign` is a placement the line already states.

**`foreign` outranks every git reading.** The churn happened because the claim commit, then a ref, then a PR answer each overturned the previous state. A foreign slice has no ref here to read, so any git answer about it is about the wrong repository. Test it over a claim commit and over an open ref: both still read `foreign`.

**Ancestry is not the question and is not asked.** "Did this land" for a foreign branch is the foreign PR's `mergedAt` through the host, per *One Answer To "Did This Land"*. Add no `merge-base` call, and no `# plot-ancestry:` declaration is needed.

**The prefix form is read at the start of the description only.** Open question `[question-prefix-or-anywhere]` recommends start-only, as the template prescribes: a repository named later in prose is not a placement. Take the recommendation.

**Where `thisRepo` is unread, every `owner/repo:` prefix reads foreign.** Open question `[question-this-repo-unread]`: a missed claim costs a person one dispatch; a false claim cost 200 ref events in one day. Take the recommendation, and say so in the TSDoc as a behaviour, not a history.

**Absent is not false.** A foreign branch with no arrow is "not known to be merged", never "not merged" and never "merged": the waiter stays `waiting` and the reason names the repository. The index never says `pr: 'none'` either.

### Done when

The plan's `## Slices` entry for this branch lists the tests; they are the specification:

- a slice line `quatico-solutions/agent-skills: …` in plot-pm/plot reads `foreign` over a claim commit and over an open ref — this catches an implementation that adds the check after `ownState`;
- a line whose arrow names a PR in `other/repo` reads `foreign`;
- a line naming this repository reads its own state — this catches a `foreign` that fires on every `owner/repo` string, including this repo's own;
- `dispatch --branch` refuses `branch-foreign` and names the repository;
- auto-dispatch offers no foreign branch.

Add two the plan does not list, because a naive implementation passes without them: a foreign branch whose foreign PR reads merged lets the next wave open (catches `foreign` blocking forever), and a waiter on a foreign branch with no arrow stays `waiting` with the repository in its reason.

Plus: a changeset (`plot` patch) with the description first and the `bumps:` block last, naming the skills you change (`plot-dispatch` if its SKILL.md changes), and the plan on a `plan:` line. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the suites in the `CI suites` key, and a failure there returns as a correction. Run no full suite and no `test:e2e`. Commit no generated board bundle (`check-no-bundle-diff.sh`).

If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override. This slice should need no shell: the rule is in the domain and `plot-dispatch-command.mjs` is a launcher.

New functions are arrows. TSDoc states what the export does, its parameters, its return and its failure, and carries no history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Claim Guard` in the plan. Push the first real commit as soon as it exists. Issue #3735 is the plan's issue.

### Scope guard

This branch owns: `packages/domain/src/rules/` (new rule, `branch-state.ts`, `cross-repo-reference.ts`, `verdict.ts`, `eligible.ts`, `auto-dispatch.ts`), `entities/fleet.ts`, `workflows/plan-walk-branches.ts`, `packages/fleet/src/server/entry/dispatch-command.ts`, their tests, and any board component the new state forces to compile.

Other branches in flight: `bug/a-free-wait-writes-its-own-ending` (wave 2) owns `entities/ending.ts`, `workflows/agent-loop.ts` and `rules/ending-action.ts`. Verify with `git diff --stat origin/main...origin/<branch>` before you edit a shared file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
