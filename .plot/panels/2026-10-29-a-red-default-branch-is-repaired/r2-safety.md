# Juror verdict: safety (round 2)

Position: amend

Evidence: Read the amended plan (e4a702012), round 1's `panel.md` and `safety.md`, `loop-decisions.md`, the design's *A red main* on origin/main, and the sibling plans #2900, #2902 and #2898 (grep for repair, revert and unsettled). Read `workflows/merge.ts`, `rules/default-branch.ts`, `entities/default-branch.ts`, `fleet/src/shared/default-branch-refresh.ts`, `.github/workflows/build-bundles.yml` and `ci.yml:55-64`. Checked every file:line the plan cites with `sed -n`. Ran a node probe (`juror-r2-2904-safety/probe.mjs`, a resolve hook over the domain and fleet `.ts` sources) that drives the real `refreshDefaultBranch` through a fake world over seven ticks, plus `merge()` and `advanceSettled`. Ran `git log --first-parent origin/main --since=2026-10-20` to classify which commit follows each PR merge. Ran read-only `gh pr view` on three numbers. Ran `vitest run test/workflows-merge.test.ts` (26 of 26 pass). Ran no host write and no broad suite.

## (a) Did the amendment fold round 1's safety findings?

| Round-1 finding | Status in the amended plan | Evidence |
|---|---|---|
| Narrow merge exception, keyed on the record | Folded as step 4 and slice 2. **The pin is wrong for this repository** (finding 1 below). | plan:60, :100 |
| Revert only a PR merge the host reads MERGED, never a direct push or a `State:` write | Folded as step 3. **There is one hole**: a subject that ends in `(#N)` is not a merge commit (finding 3). | plan:59 |
| Revert opened on a main that turned green | Folded for the **revert** PR (`close-revert`, plan:62). **Dropped for the fix PR**: round 1 b3 said an open fix PR on a green main must be closed or handed to the normal loop. The plan does not say this. **The merge-time freshness is too loose** (finding 2). | plan:62; round-1 safety.md b3 |
| Pending newer head blocks the revert | Folded (`headSha === settled.sha`, plan:58). | plan:58 |
| Stale reading never reverts | Folded (strict `defaultBranchAgeMs`, plan:58, :79). | plan:58 |
| Record written before any action | Folded as a claim (plan:57, :96). A test is named (plan:115) but no slice owns it. | plan:115 |
| Two machines repair at once | **Not closed.** It is Open Question 4 (plan:87), and no slice is gated on its answer. The claim at plan:57, "a crash or a second tick starts no second repair", holds on one machine only: the record lives under `.plot/state/` on that machine (D6). | plan:57, :87 |
| Ask the host, not the index, before a PR opens | Folded for the fix PR (plan:61). **Missing for the revert PR** (step 6, plan:62), and no step says that `unaskable` holds. | plan:61-62 |
| A push to main by the role is a gate | Folded through D5 (plan:74). | plan:74 |
| Return path for a Delivered plan | Moved to Open Question 7. The plan now writes no ticket (plan:63). The binding design on origin/main still says the revert gets a ticket (`DESIGN-delivery-loop.md:120`). So a revert of a Delivered plan's work leaves no trace except the run log. | plan:63, :90 |

## (b) Cited facts

All twelve file:line citations match the worktree: `merge.ts:127-129`, `default-branch.ts:110-115/229/241/262`, `entities/default-branch.ts:73/85`, `queue.ts:583`, `registryd-main.ts:2863`, `pr.ts:64`, `trees.ts:490/506`, `auto-dispatch.ts:220`, `merge-subject.ts:88`, `workflows-merge.test.ts:128/165`, and `merge-entry.test.ts:135`. `default-branch-refresh.ts:210` is `const carried = previous?.settled` ✓.

There is one imprecision. Red can also start in the ancestor arm (`settleBehindHead`, `default-branch-refresh.ts:238`), not only at `advanceSettled` (`:232`). The probe's tick 6 (G2 green, then A1 red and B1 pending in one gap) moves `settled` from `{G2,green}` to `{A1,red}` with `head: pending`. The record write must cover both arms.

## Findings (executed)

1. **The red-SHA pin closes the exception on this repository's own main, almost every time.** Step 4 admits the repair PR "only while the settled red SHA equals the record's red SHA", and `close-revert` fires when "the settled SHA moved" (plan:60, :62). The probe drove the real refresh: G green → R red (the record point, `prev.settled={G,green}`) → a direct push X that also runs red. The result is `settled={X,red}`, so `pin settled==R after X: false`. `advanceSettled({sha:'R',state:'red'},'X','red')` returns `{sha:'X',state:'red'}`. A push to a red main is the normal case here:
   - `build-bundles.yml` pushes `plot: build the board artifact` as the `plot-build` App after each push to main that changes the bundles. In the log since 2026-10-20, 101 of 303 PR merges are followed directly by that bot commit.
   - After a PR merge, the next first-parent commit lands within a median of 28 s (p75: 79 s). 99 % of PR merges are followed by another commit within 30 min.

   So a breaking PR P is usually followed by the bundle commit B. B builds on red and settles red, the settled SHA moves from P to B, the exception closes, and `close-revert` closes the revert PR. Main stays red: the anti-goal. The mutation test the plan names (plan:115, "mutation check on the red-SHA pin") would lock this defect in. **The pin must be on the episode, not on the SHA**: the record is open (no settled green since `redSince`), settled is red, and the record's red SHA is a first-parent ancestor of or equal to the settled SHA (an `evidence` ancestry call). `close-revert` must fire on a settled green, not on any move of the SHA. #2902's `default-branch-unsettled` (its plan:50) already supplies "tip == settled" at merge time.

2. **The exception admits a revert on a reading up to 30 min old.** Step 4 requires a "red and fresh" reading, and fresh means within `Checks wait` (`merge.ts:123`). `revert` fires only after `Main repair bound`, and by then the head is past `Checks wait`. At that point the refresh re-asks only every `checksWaitMs / 2` (`reaskIntervalMs`, `default-branch-refresh.ts:40`), which is 1800 s at the default. If a re-run turns the same SHA green, the tip does not move, so #2902's `default-branch-unsettled` does not catch it. fleetd can then merge a revert of innocent work onto a main the host already reads green. Step 6 confirms with a fresh reading before it *makes* the revert, not before it *merges* it. The exception should take its own `runsForSha` of the red SHA immediately before the merge, the way `merge()` re-asks the PR.

3. **A subject `(#N)` does not prove a merge commit.** Of 134 first-parent commits since 2026-10-20 that end in `(#N)`, 3 are direct pushes by a person, e.g. `sprint: … joins the Must Haves (#2269)`. The worktree's own HEAD is `plot-idea: amend after panel round 1 (#2904)`. All three name issues today: `gh pr view` answers "Could not resolve to a PullRequest", so the MERGED check rejects them. A direct push that names a merged PR passes the subject test and the MERGED test. The picker must require the host's `mergeCommit` (`pr.ts:64`) to equal the candidate SHA. "Changes no `State:` line" should also say "adds or removes none": reverting a plan PR's merge removes a file with a `State:` line, which `plot-state-gate.sh` refuses (#1611).

4. **No record means no repair, and nothing says so.** Probe tick 7: with no previous file, a red head gives `prev.settled=undefined, now.settled={Z1,red}`. No change from green to red is seen, so no record is written. This happens when fleetd first starts on a red main, or when a missing, other-branch or other-version file decodes to null (`default-branch-refresh.ts:193`). Main then stays red with no notification. The rule needs an answer for red with no record: write a record with an unknown last green, so the picker answers `unknown` and the plan notifies.

5. **The record is a file, so "no caller can claim the exception by naming itself" (plan:60) is not yet true.** Any process on the machine can write `.plot/state/` (the role settings deny `.claude/**` and the gates, not this file). With D1, only fleetd merges unattended, but fleetd trusts whatever PR the record names. If the admitted PR must also have the deterministic head branch derived from the record's red SHA (e.g. `bug/revert-<sha12>`, `bug/repair-<sha12>`), one rule closes this and Open Question 4.

6. **D4 makes the anti-goal unreachable on this repository today.** `Merger app` is not declared in `CLAUDE.md`, and #2902 answers `merger-app-missing` and merges nothing (its plan:74). The plan has no outcome for a repair PR that fleetd may not merge. It should answer `exhausted` and notify, not wait silently.

## (c) Slices

The cut is right: record → exception → fix forward → revert. The `waits:` follow the slice map exactly. #2900's plan:93 says the main-repair and revert PRs "each start the reviewer on its own PR through the detached start this plan builds". So slices 3 and 4 *start* the reviewer themselves. Step 5 says the reviewer "runs on the fix PR because the repair record names it" (plan:61), which reads as if #2900 does it. The text should say this plan starts it. Slice 3 depends on `feature/fleetd-reviews-slice-prs` only through wave order (slice 2 → #2902 slice 2 → #2900). That holds if waves run in order. Name it as a `waits:` anyway, since the start is a direct call. Slice 4 should own the test for crash-before-record and the multi-tick anti-goal test. At present they float in Notes (plan:115).

## (d) Open questions

- Q3 (down longer than the bound): revert on the first *fresh* reading. Strict age already makes a stale reading after restart wait for one refresh. A fix that landed during the downtime moves the head, and the `headSha === settled.sha` check holds it. No repair-first is needed. Finding 4 covers the case where downtime spans the change from green to red with no file.
- Q4 (one writer across machines): a deterministic branch name under an existing prefix (`bug/revert-<red-sha12>`). A second machine's push of a different commit to that name is rejected, and `pr-list --branch` finds the first machine's PR. It also closes finding 5. It must be answered before slice 3 and slice 4. These slices open PRs, and the record cannot see a second machine's record (D6).
- Q6 (bound vs. fix in review): if the revert merges first, the fix PR stays open on a green main, rebased onto the reverted code, and nobody owns it. That is the dropped half of round-1 b3. Answer: on a settled green, close every PR the record names, not only the revert.
- Q1 (outside red): the cheapest probe is a re-run of the failed jobs on the red SHA before the revert. A red that the re-run turns green answers `unknown`. This needs no CI on the last green SHA.
- New: the rule has no outcome for the case where the revert merges and main stays red (a second break, or a picker that was wrong). Name it (`exhausted`), so the record never reverts twice in one episode.

## (e) Tests

- Slice 1: a domain table test of `redMainStep`. Add rows for a settled SHA that moved within the episode (P → B, both red), which must stay `revert`/`await-repair` and not `close-revert`, and for red with no record. Add a fleet unit test of the refresh writing the record in both arms (tick 2 and tick 6 of the probe are ready fixtures). Add a picker table test: direct push, `(#N)` with `mergeCommit ≠ sha`, two PR merges, a squash subject, and a plan file added or removed.
- Slice 2: domain tests on `merge()` for the repair PR after a bundle commit settled red on top of the red SHA (admit), and for a PR named by a record whose branch is not the deterministic one (refuse). Keep the three existing `default-branch-red` tests unchanged; they passed here, 26 of 26. Make the mutation check drop the *episode* pin.
- Slice 4: an adapter test on a temp git repo (plan:115) plus a fleet fake-clock multi-tick test that includes a bot push after the breaking merge. That fixture is what makes the anti-goal test fail on the current design.

## Amendments

1. Replace the red-SHA pin with an episode pin: the record is open, settled is red, and the record's red SHA is an ancestor of or equal to settled. Fire `close-revert` on a settled green only. Name the bundle bot's push (101 of 303 PR merges) as the case this serves.
2. Before the exception merges a repair PR, re-ask the red SHA's runs fresh. Do not accept a reading up to `Checks wait` old.
3. The picker requires the host's `mergeCommit` to equal the candidate SHA. Treat a `State:` line added or removed like one changed.
4. Write the record in both refresh arms. Red with no prior green writes a record that the picker answers `unknown` for and that notifies.
5. Key the repair and revert PRs to a deterministic branch name derived from the red SHA, under an existing prefix. Admit only that branch. This answers Q4 before slices 3 and 4.
6. On a settled green, close every PR the record names, including the fix PR.
7. For a revert PR, ask the host (`pr-list --branch`) before opening it, and treat `unaskable` as a hold.
8. Undeclared `Merger app` → `exhausted` plus a notification. A successful revert also notifies, naming the reverted PR and its plan, until Q7 has a ticket path (design:120).
9. Put the crash-before-record test and the anti-goal multi-tick test under named slices, and add a bot-push fixture to the latter.
