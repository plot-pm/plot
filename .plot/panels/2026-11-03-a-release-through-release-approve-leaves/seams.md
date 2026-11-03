# Seams juror: a-release-through-release-approve-leaves

Position: amend

The defect is real and the approach for the first run (a shared tracker step after the push) is right. The repair half does not work as written, the measurement is wrong, and three seams (the bundle entry guard, the sprint-scope-only booking, the reconcile sweep) are unnamed. Each one has a concrete amendment below.

## Findings

### 1. The `already-released` re-run has no plan list to repair (HIGH)

- `finishRelease` reads its scope from the active sprint index only (`release-finish.ts:176-201`). The first run closes the sprint and removes its active entry in the same commit (`release-finish.ts:248-258`).
- On `origin/main` now, `docs/sprints/active/` is empty (`git ls-tree origin/main docs/sprints/active/` prints nothing). A re-run therefore reads `sprints = []` and `scope = []`, and `releaseFinish` answers `already-released` with an empty scope (`workflows/release-finish.ts`, `pending.length === 0 && closeSprint === null`). The tracker step has no plan to run for.
- Once `follow-ups-2-30-1` (State: Planning) enters the active index, a re-run reads that sprint's scope, whose plans are Draft or Approved, and refuses `plan-unbookable` with exit 1. It never reaches `already-released`.
- So "Running `release-approve` again on an already-released version repairs a tracker write that an earlier run missed" (plan Changelog) is false in both cases. The repair needs its own scope: the plans whose `Released:` record names the tag (for example `- **Released:** <date>, v2.30.0`) in the plan directory at `origin/<default>`. The version comes from `origin/<default>:package.json` (`release-finish.ts:123-135`), so the tag is known.

### 2. The bundled entry guard makes "extract from runRelease" a trap (HIGH)

- `deliver.ts:1021` runs `run(process.argv…)` when `import.meta.url` equals `process.argv[1]`. `release-finish.ts` is bundled into `plot-ask.mjs` through `entry/main.ts` (`packages/board/build.mjs:176-180`). If the shared step stays in `deliver.ts` and `release-finish.ts` imports it, the guard compares the bundle's own URL with `plot-ask.mjs` and runs the deliver entry inside `release-approve`.
- `release-finish.ts:35-36` already records this trap for `sprint-transition.ts`. The plan says "one function that both callers use" but names no module. The slice must name a module with no entry guard (for example a new `entry/release-tracker.ts`, or `ladder.ts`, which both files import already).

### 3. The measurement in the plan is wrong, and the estate has moved since (MEDIUM)

- Notes: "4 issues named by v2.30.0 plans, 0 carry `plan:released`". Commit `7c1317c9e` books 24 plan files; 23 name an issue, 24 issues in total (`#2993, #3040` share one plan; `2026-10-30-ci-runs-what-the-change-touches.md` names none).
- Read on 2026-11-03 after 16:57Z: 10 of the 24 carry `plan:released` and are closed (#2898, #2902, #2903, #2904, #2906, #2993, #2997, #2999, #3040, #3049). The #2997 timeline shows `jwloka` relabelled it at 2026-11-03T16:57:38Z, so a hand repair ran after the issue was filed. 13 are OPEN with `plan:delivered` (#2899, #2900, #2901, #2905, #2907, #2970, #2974, #2980, #3006, #3010, #3017, #3024, #3028). #3033 is CLOSED with `plan:delivered`.
- The Motivation's "#2898 and #3049 are OPEN with `plan:delivered`, #2997 … with `plan:delivered`" no longer holds. The plan must restate the count with its time, and must say that the hand repair is itself an intervention the sprint records.

### 4. Plans outside the sprint scope get no booking and no tracker write (MEDIUM, finding 2 of #2927)

- `finishRelease` books only unstruck Must/Should/Could items of the one active sprint (`release-finish.ts:38-50`, `:206`). At `7c1317c9e`, four Delivered plans outside the sprint existed: #1850, #2121, #2260 (`plan:delivered`, closed) and #2978 (`2026-10-31-the-fleet-scan-re-reads-what.md`, `Sprint:` empty).
- #2978's plan was booked afterwards through the per-plan path, `c24a65b74 plot: release the-fleet-scan-re-reads-what (v2.30.0)`, at 17:52 +0100. That is a second hand step for the same release.
- The plan's tracker step follows "each plan it books", so it inherits this gap. The plan must state that it does, name #2927 finding 2 as out of scope, and make the finish print the Delivered plans outside the scope it leaves unbooked and untold, or pull that fix in. A silent omission repeats the defect this plan fixes.

### 5. The reconcile sweep does not see the gap before or after the change (MEDIUM)

- `/plot-reconcile` calls `plot-released-labels.mjs --section` (`plot-reconcile-scan.sh:3543`). That rule reads closed issues only and skips an `open` issue first (`rules/released-labels.ts:71`). The 13 OPEN issues of Released plans above are invisible to it. #3033 is the one 2.30.0 issue it reports.
- So the plan's "`/plot-reconcile` reports and closes nothing" is half true: it reports closed-issue label drift, and it does not report an open issue whose plans are all Released. A reader cannot use the sweep to verify this fix, and the next miss stays silent.
- Amendment: either add the open case to the reconcile section (count of open issues that only Released plans name, with the repair command), or state in the plan that no surface reports it and file a follow-up.

### 6. Tracker seams: the vocabulary is GitHub's, the behaviour holds on all three (LOW)

- Jira: `tracker-jira.ts:308` answers `no-target` for every `planStateWrite`; the Jira write is `plot-issue-status.sh`'s status transition, and `plot-host.sh:5689-5717` makes that idempotent (a status already held answers `no-match`). A re-run on Jira is safe.
- Bitbucket with no `Tracker`: `trackerGitHost` uses `githubPlanStateWrite` (`tracker-resolve.ts:130`), and `plot-host.sh issue-label` answers exit 4 off GitHub, so each issue reports `unaskable`. That is a named outcome, not a silent one.
- GitHub: `githubPlanStateWrite` skips label and comment on a matching hash and runs `issue-close` on every `released` call (`tracker-plan-state.ts`). A re-run is safe.
- The Changelog line "records `plan:released` … and closes them" is true on GitHub only. It should say "tells the tracker, as the per-plan release command does", so the Jira and Bitbucket readers are not promised a label.

### 7. Claims checked against the source

- `release-finish.ts:104` (`finishRelease`) and `:267` (`already-released`): true.
- `deliver.ts:925-1012`: the tracker step runs from `:921` (keep a copy of the booked plan) to `:1016` (`spendActionReceipt`). Close enough; the slice must take `:921-928` (the copy) and `:944-960` (sibling read before `cleanup()`), not only `:968-1011`.
- "Releases 2.29.0 and 2.29.1 were booked per plan through `runRelease`": consistent with the 2.29.x plan commits; not contradicted.
- Plan #2997's claim: its "What already works" line says "delivery and release write `plan:delivered` and `plan:released` (`deliver.ts:546`, `:969`)" and its goal 2 says every closed issue of a Released plan carries `plan:released`. Both hold only for `runRelease`. The plan asks for #2997 to be corrected but names no edit; #2997 is Released, so the correction belongs in this plan's own text or in #2997's Notes, and the slice must say which.
- Step 5b of `skills/plot-release/SKILL.md` describes only `plot-deliver.sh --release` per plan and never names `release-approve`. The slice line does not list this SKILL.md edit, the Model Guidance row 5b, or the changeset bump for `plot-release`.

### 8. Sibling read inside one batch (holds)

- All booked plans read as Released in the booked tree, so an issue two booked plans share is not skipped. An issue a booked plan shares with a Delivered plan outside the scope (finding 4) is skipped and stays open until that plan releases by the per-plan path. That is correct behaviour, and the summary line must name it `left-open … (another-plan-unfinished=…)` as `runRelease` does.
- `FinishContext` has no `scriptDir`, which `runRelease` uses to build `planStoreShell`/`scriptsShell` over the booking worktree (`deliver.ts:944-945`). The slice must add it, set it in `main.ts:227`, and read siblings before `cleanup()` (`release-finish.ts:297`).

## Rubric

1. Fixes the defect for a first run, yes. Verification: after a `release-approve`, every issue that a booked plan names and no unfinished plan names reads `plan:released` and CLOSED on GitHub (`gh issue view <n> --json state,labels`), and the finish prints `summary: issues closed=<N> left-open=<M>`. The repair half does not work (finding 1). The sprint goal measures approval to the release PR; this step runs after the merge, so it removes a post-release hand repair (the 16:57Z relabel and the 17:52 per-plan booking) rather than an in-span intervention.
2. Line numbers hold; the measurement and the reconcile claim do not (findings 3, 5).
3. Half-done: SKILL.md 5b, Model Guidance, changeset, CLAUDE.md's `release-approve` paragraph (it lists the action's refusals and should list the tracker step), the out-of-scope plans, reconcile. No shell lines change, so the shell-lines ratchet and bash 3.2 are untouched. The Bitbucket arm reports `unaskable` per issue.
4. Failure modes: push rejected must skip the step (the plan recommends this; make it a decision, not an open question). A tracker `failed` must print the issue and leave exit 0 as `runRelease` does, or exit 1; the plan must choose. The re-run must not refuse `plan-unbookable` on the next sprint's scope (finding 1).
5. A Sonnet agent cannot build the repair from the plan alone: the repair scope and the module location are missing decisions (findings 1, 2). Open question 1 (read labels before writing) adds a read no writer makes today; the writes are idempotent, so the agent should write every issue of the tag's plans and read nothing first. Decide it in the plan.
6. The named test ("one `released` plan-state write per booked plan") fails before and passes after. Missing: a re-run test with the sprint already closed (empty active index) that still writes for the tag's plans; a re-run test with a different active sprint; a test that a shared issue with an unbooked Delivered plan is skipped; a test that a rejected push makes no tracker call; and a test that `release-finish.ts` imports nothing that carries an entry guard (or a build check that the bundled `plot-ask.mjs release-approve` does not run deliver's `run`).

## Required amendments

1. Define the repair scope: on a re-run, the plans whose `Released:` record names the tag read from `origin/<default>`, independent of the active sprint index, reached before the sprint-scope refusals (`sprint-ambiguous`, `plan-unbookable`). Add a test for an empty active index and one for a different active sprint.
2. Name the module that holds the shared step and require that it carry no entry guard; add the test or build check from rubric item 6.
3. Correct the Notes and Motivation counts: 24 issues across 23 plans; state the reading time and the 10 already relabelled by hand.
4. State the sprint-scope-only booking (#2927 finding 2) as a known limit, and make the finish print the Delivered plans outside the scope that it leaves unbooked and untold.
5. Either extend the reconcile section to count open issues that only Released plans name, or record that no surface reports them and file a follow-up.
6. Add to the slice: SKILL.md step 5b and its Model Guidance row, the CLAUDE.md `release-approve` sentence, and a changeset (`plot` with a `plot-release` bump). Say where #2997's claim is corrected.
7. Close open questions 1 and 2 in the plan: write every issue with no pre-read; skip the step on a rejected push.

## Decisions for a person

- Whether out-of-scope Delivered plans (#2927 finding 2) are fixed here or stay a named limit.
- Who repairs the 14 issues of 2.30.0 that are still not `plan:released` (13 open, #3033 closed) before this ships: a re-run after the slice merges, or a hand run of `plot-plan-state.sh --phase released` per plan now.

## What I ran and what I only read

Ran (read-only): `git show origin/main:` on `release-finish.ts`, `deliver.ts`, `plan-state.ts`, `main.ts`, `workflows/release-finish.ts`, `workflows/release-approve.ts`, `tracker-jira.ts`, `tracker-resolve.ts`, `tracker-plan-state.ts`, `plot-plan-state.sh`, `plot-issue-status.sh`, `plot-host.sh`, `plot-reconcile-scan.sh`, `rules/released-labels.ts`, `skills/plot-release/SKILL.md`, plan `2026-11-01-an-issue-shows-its-plan-s.md`, sprint `2026-W45-follow-ups-2-30-1.md`; `git show --stat 7c1317c9e` and each booked plan's `Issue:` line; `git ls-tree origin/main docs/sprints/active/`; the Delivered plans at `7c1317c9e`; `gh issue view` on #3066, #2927, #2997 and all 28 issues named above; the #2997 timeline through `gh api`; `gh pr view 3071`.

Only read, not executed: the re-run behaviour of `finishRelease` (findings 1 and 2 are derived from the code, not from a run); the entry-guard behaviour inside the bundle (derived from `deliver.ts:1021`, `build.mjs:176-180` and the warning at `release-finish.ts:35-36`). I ran no test suite, no host write, and no fleet or board command.
