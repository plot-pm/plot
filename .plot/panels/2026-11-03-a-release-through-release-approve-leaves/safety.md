# Safety juror — a-release-through-release-approve-leaves

Position: amend

The defect is real and the main fix (call the `runRelease` tracker step from `finishRelease` after a pushed booking) is safe. The `already-released` repair is not safe as written: on a re-run the plan names no source for "the plans of the release", and the obvious source (the active sprint scope) points at the wrong plans. Close writes also re-close issues a person reopened. Each needs a decision in the plan before an unattended agent builds it.

## Findings

### 1. The repair path has no plan list, and the obvious one is the next sprint (blocking)

- `finishRelease` derives the scope from the only sprint in `docs/sprints/active/` (`release-finish.ts:176-221`). The first run closes that sprint and unlinks its active entry in the same commit (`release-finish.ts:248-258`; `7c1317c9e` removes `docs/sprints/active/delivery-loop.md`).
- Measured on origin/main now: `docs/sprints/active/` is empty. A re-run therefore reads `sprints=[]`, `scope=[]`, and `releaseFinish` returns `already-released` (`release-finish.ts` domain, lines 160-161) with `booked=[]`. The plan says the re-run "runs the same step" but the step has zero plans to run for. An agent that reuses `scope` or `booked` repairs nothing and the test still passes.
- Once the next sprint (`follow-ups-2-30-1`, created in `321966041`) is active, a re-run of `release-approve 2934 <sha>` does not reach `already-released`. `releaseApproveAt` answers `approved: true, alreadyMerged: true` for a merged PR (`workflows/release-approve.ts:142`), `finishRelease` reads the version from `origin/main:package.json` (still 2.30.0), the tag exists, and `releaseFinish` closes the NEW sprint and books its delivered plans as `Released: <date>, v2.30.0`. This hazard exists today. The plan turns it into an issue close: the new tracker step would close the issues of plans that v2.30.0 did not ship. The plan also invites this re-run as the repair tool (Changelog line 16).
- The plan's count is wrong, which hides the size of the write: Notes line 55 says "4 issues named by v2.30.0 plans". `git grep` over origin/main finds 25 plans with `Released: 2026-11-03, v2.30.0` (24 from `7c1317c9e`, plus `2026-10-31-the-fleet-scan-re-reads-what.md`, released per plan through `runRelease` in `c24a65b74`), naming 25 issues. `gh issue view` now: 12 OPEN with `plan:delivered` (#2899 #2901 #2905 #2907 #2970 #2974 #2980 #3006 #3010 #3017 #3024 #3028), 12 CLOSED with `plan:released`, 1 CLOSED with `plan:delivered` (#3033). The Motivation's "#2898 and #3049 are OPEN" is no longer true: jwloka labelled and closed #2898 at 2026-11-03T16:58Z, so a partial hand repair already ran.

### 2. A close re-runs on every call, so a repair re-closes a reopened issue

- `githubPlanStateWrite` skips the label and comment when the body hash matches, but runs `issue-close` on every `released` call (`adapters/tracker/tracker-plan-state.ts`, the "`released` close still runs on every call" block). An issue a person reopened after the release (for example on a regression) gets closed again, with no new comment, by a repair run over the whole release. For v2.30.0 that is a sweep over 25 issues.
- Open Question 1 proposes to read the tracker's label before the write. `ports/tracker.ts:261-267` states "NO RULE READS A `plan:*` LABEL OR THE PLAN COMMENT BACK, save the one read planStateWrite documents". Reading the label to decide the repair breaks that port contract. This is a person's decision, not an agent's.

### 3. The main path is safe if it keeps `runRelease`'s order

- `runRelease` reads siblings from the pushed booking tree `tmpwt` before `cleanup()`, skips every issue a non-released sibling names, and treats an unreadable sibling read as "skip all" (`deliver.ts:921-966`). For `finishRelease` the same read is correct: all booked plans are `Released` in that tree, so they do not block each other, and an out-of-scope Delivered plan that names the same issue keeps it open. The plan's line "reads the sibling plans from the booked tree" matches. The plan must also say: before `cleanup()` at `release-finish.ts:297`, and from `tmpwt` after `commitAndPush` (which may have re-cut onto a newer `origin/main`), never from `ctx.repoRoot`.
- `runRelease` keeps the booked plan at one fixed path, `os.tmpdir()/plot-release-plan-${process.pid}.md` (`deliver.ts:925`). A shared step called once per booked plan in one process reuses that path. Sequential calls are safe. A `Promise.all` over 24 plans would let one plan's issues be read from another plan's file. The shared function must take a per-plan path, or the plan must forbid concurrency.
- Push rejected: `runRelease` already skips the tracker (`deliver.ts:913-919`, `tracker=skipped`). Open Question 2 is therefore not open; the plan must state it as a requirement and test it.
- Line numbers: `runRelease` starts at `deliver.ts:778`; the tracker step is `deliver.ts:921-1013`, close to the plan's `925-1012`. `release-finish.ts:104` and `:267` are correct.

### 4. A failed tracker write and the release itself

- In `runRelease` a failed write still returns 0 and reports `tracker=failed` and `issues ... (failed=N)` on the summary lines (`deliver.ts:1005-1016`). The plan does not say what `finishRelease` returns or prints when a write fails. The booking is already on the default branch, so the write must not undo it. But `release-approve` writes one JSON line and `finished: ...`; an operator or skill that reads only the exit code sees success. The plan must name the output: one line per failed issue and one `summary: issues closed=<N> left-open=<M> (...)` line, the same shape step 5b of `skills/plot-release/SKILL.md` reads (lines 466-473, 590-591).
- A thrown `Refused` inside the shared step (for example "could not keep a copy of the released plan", `deliver.ts:927`) reaches `finishRelease`'s catch at `release-finish.ts:299-305`, which prints the message and returns 1 after the push landed. The remaining plans then get no write, and the printed text must not say "nothing was pushed". The plan must say: one plan's failure records that plan as failed and the step continues with the next plan.
- Bitbucket and Jira: the git-host tracker answers `unaskable` on a non-GitHub host and Jira answers `no-target` for `planStateWrite` (`tracker-resolve.ts:116-133`, `tracker-jira.ts:308`); `statusWrite` on Jira answers `already` on a repeat. These are safe; the summary must count them as not closed.

### 5. Test plan gaps

"One `released` plan-state write per booked plan" passes with the defects above. Missing tests, each failing before the change:
- an issue a booked plan shares with an out-of-scope Delivered plan stays open (`skipped another-plan-unfinished`);
- a rejected push makes zero tracker calls;
- an `already-released` re-run with an empty active index writes to the plans whose `Released:` record names the tag, and to no other;
- a re-run with a different sprint active refuses before any tracker call (or, if the person decides otherwise, writes nothing to that sprint's plans);
- one plan's failed write does not stop the other plans' writes and appears in the summary.

## Amendments required

1. Name the repair's plan source explicitly: the plans on the fetched default branch whose `Released:` record names `<tag>`. Never the active sprint scope, never `booked`.
2. Refuse the finish (a named refusal, for example `sprint-after-release`) when the active sprint is not the sprint this tag released: at least when its `Start:` is later than the tag date, or when its scope has no plan the release PR's changesets name. Without this, the repair invitation books and closes the next sprint's plans under the old tag. Alternatively, move the repair out of `release-approve` into a separate entry that books nothing (see Decision 1).
3. Decide Open Question 1 in the plan (see Decision 2) and remove the "read the label" option, or amend the port contract in `ports/tracker.ts` in the same slice.
4. Close Open Question 2 as a requirement: a rejected push makes no tracker call, as `runRelease` does.
5. The shared step takes a per-plan booked-plan path and runs plans one after another.
6. The shared step reads siblings from `tmpwt` before `cleanup()`, once per finish, and an unreadable read skips every issue.
7. Specify `finishRelease`'s output and exit code for tracker failures, and that one plan's failure does not stop the next plan.
8. Correct the Motivation and Notes: 25 issues, current states as measured, and the hand repair of #2898.
9. Add the tests listed in finding 5.

## Decisions for a person

1. Does the repair belong in `release-approve` at all? A re-run of `release-approve` today can already book the next sprint under the old tag. `plot-deliver.mjs --release <slug>` already accepts a Released plan (`deliver.ts` release arm, `case 'released'`) and re-runs the tracker step with nothing to commit, so a per-plan repair exists today. A separate `release-tracker <tag>` entry that books nothing is the narrower option.
2. May a repair close an issue that a person reopened after the release? Either accept it, or allow a read of the issue's state/label before the close and amend the "no rule reads a plan:* label back" contract in `ports/tracker.ts`.
3. The 12 v2.30.0 issues still OPEN today: repaired by this plan's code after it ships, or by hand now through `plot-deliver.mjs --release` per plan.

## Ran versus read

Ran (read-only): `git show`/`git grep`/`git ls-tree`/`git log` on origin/main; `gh issue view` for #3066 and the 25 issues; `gh api .../issues/{2898,3033}/timeline`. Read: the plan; `release-finish.ts` (board entry and domain workflow); `deliver.ts` 726-1016; `plan-state.ts`; `tracker-plan-state.ts`; `tracker-resolve.ts`; parts of `tracker-jira.ts`, `ports/tracker.ts`, `rules/issue-status.ts`, `workflows/release-approve.ts`, `main.ts`, `ladder.ts`, `skills/plot-release/SKILL.md`. Ran no test, no host write, no fleet or board command.
