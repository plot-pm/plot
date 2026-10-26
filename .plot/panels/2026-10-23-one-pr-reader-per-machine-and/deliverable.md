# Juror verdict: deliverable lens

Lens: the operator who measured 44 spenders on one account. What changes for that operator after each slice merges, is each slice shippable and testable alone, and does the Changelog promise only what ships.

Position: amend

## Summary

The design keeps one index writer, and every code reference I checked is accurate. Measured against the Motivation, the plan delivers almost nothing to the operator who filed #2386. The measured machine had two boards on two different repositories. The lock key includes the repository, so that machine gets two readers in place of two board reads, which is the same number of PR list requests. The plan does not change the ~38 Claude sessions at all. The reader-process slice also loses two things the operator sees today, the issue inbox and the PR error and backoff banner, and neither the Changelog nor the slice line mentions this. The plan needs amendments before slice 2 is built.

## 1. One writer (deliverable view only)

- I read `maybeRefreshPrs` (`packages/board/src/server/fleet.ts:2328-2357`). In the no-fleet arm the board folds into `overlayFor(...)` (`:2340`) and never into the real store. The design leaves that arm unchanged. It adds one more condition under which the board takes the read-only arm. As written, I find no interleaving that makes the board a writer.
- I read the #2436 port (`git show origin/feature/one-pr-reader-per-machine-and:packages/domain/src/ports/reader-lock.ts`). `elect` renews the claim on every call. The plan says the reader elects "before every pass". `fleetPrs` (`packages/fleet/src/shared/fleet-clock.ts:166-177`) returns early while `prGateOpen` is false, so "pass" can mean either the 60 s beat or a host read. During the 14-minute backoff the issue measured (`prNextIn=863`), a reader that renews only on a host read goes stale after `READER_STALE_MS` = 10 min (`reader-election.ts:33` on the branch). A board then judges the holder stale, starts a second reader with no memory of the backoff, and serves that tick from its overlay. Both of those processes then ask the host while it is still refusing. This gives no second writer, but it fires requests at exactly the moment the plan exists to protect. **Amend:** the plan must say that the reader elects on every PR beat, before the cadence gate.

## 2. Claims against the code

I read every cited line on `cf0232d1b`. All of them hold: `fleetOwnsPrs` :2254, `readPrsFromStore` :2264, `prError` from the bridge :2280, overlay :2340, `maybeRefreshPrs` :2328; `resolveBackend` pr-refresh.ts:1021, `writePrStore` :1324, `foldPrIndex` call :1333, `refreshPrs` :1360; `fleetPrs` fleet-clock.ts:166; real store at registryd-main.ts:2204; `fleetAutoWrites` at :2312; `fleetOwnsScan` scan-owner.ts:37; `bridgeIsFresh` :52; `issueGateOf` issue-refresh.ts:676; the test lines one-pr-index-writer.test.ts:78/:87 and one-issue-index-writer.test.ts:119. The `Detached` port (`packages/domain/src/ports/detached.ts`) has `node(script, args, cwd, logFile)`, which matches the planned use. `build.mjs` has seven entries and no reader entry yet, which is consistent with the plan.

I read the branch and found the two defects the plan names. The stale-check tests pass `startedAt: null` throughout (`reader-lock-file.test.ts:65` onward), and the takeover runs `unlink` and then publishes (`reader-lock-file.ts:219-241`). Both fixes the plan describes are needed.

One claim in the Motivation is wrong in kind. **"about 44 spenders ... two boards and about 38 Claude processes"** reads as a headcount. I read `localSpenders` (`packages/domain/src/rules/refusal.ts:79-109`). The number is the account's observed spend rate divided by one board's share, "FROM THE RECORD, NEVER A HEADCOUNT", rounded. So 44 means "the account spent about 44 board-shares per hour". It does not mean 44 processes, and the split into 2 boards plus 38 sessions is an inference that does not come from the measurement.

## 3. Each slice against its Changelog line

**Reader lock** (`feature/pr-reader-lock-elects-one-writer`). The slice is testable alone with the #2436 domain tests plus new tests for the two fixes. It ships nothing an operator can see ("no caller yet"), and the Changelog correctly claims nothing for it. This is acceptable as a preparatory slice. The estate has measured the cost of a rule with zero callers before (`setSprintState`, in CLAUDE.md). The risk is low here only because slice 2 follows directly.

**Reader process** (`feature/pr-reader-process-writes-the-index`). Every operator-visible effect lands in this one slice. It also bundles four changes: the new entry and its bundle, fleetd taking the lock, the board following the lock, and the board starting the reader. Three of its effects are missing from the Changelog:

- **The inbox goes blank or stale.** I read `maybeRefreshPrs`. When `fleetOwnsPrs` is true it calls `readIssuesFromStore` (`fleet.ts:2334`) and skips `refreshIssues`. `readIssuesFromStore` (`:2182-2206`) reads `issues.json`, and only fleetd writes that file. The plan says the reader runs "no issue read". With a reader holding the lock and no fleet running, the board therefore shows "Open issues are not listed: the fleet has left no issue index to read." If an old `issues.json` exists from an earlier fleet, the board serves those old rows as current. Today, without a fleet, the board reads issues live. This is a regression for every board without a fleet, and that is the exact population the slice targets. **Amend:** the slice must keep `refreshIssues` on the reader-follows arm, or narrow the change so that only the PR read follows the lock, and it must state which of the two it does.
- **The 429 banner disappears.** `readPrsFromStore` takes `prError` from the fleet bridge (`:2280`) and sets `prNextIsBackoff = false` (`:2284`). With only a reader running there is no bridge, so `prError` is `null` and no backoff shows. The operator measured #2386 by reading this banner (`prNextIn=863`). After slice 2, a reader in backoff reads as healthy. The plan lists this as an open question (line 75). From this lens it is a blocker for slice 2, not an open question.
- **The board still spends.** `readPrsFromStore` still calls `refreshRuns` (`:2281`), so each board keeps reading CI runs from the host. The Changelog line "Every board for that repository reads the index instead of the host" is true for the PR list only, and the line should say so.

**Changelog against the 44-spender measurement.** The Changelog says the PR list count "no longer grows with the number of open boards". That holds only for several boards on one repository, for example boards in worktrees that share a common git dir. The measured machine had ewz-kus-portal and websmith, which are two repositories. With the key `(backend, account, repo)`, that machine gets two readers, so its PR list requests stay the same. So after both slices merge, the operator who filed #2386 sees no fewer 429s from this change in the setup they measured. The open question about Claude sessions (line 76) covers the part of the spend most likely to matter. That makes it the precondition for knowing whether this plan helps at all, not a follow-up.

**Title.** The plan and issue title promise "a shared, jittered budget". The plan schedules neither, because proposal 2 stays unscheduled (line 37). **Amend:** rename the plan to what it builds, or schedule the jitter.

## 4. Open questions

- ETags (line 74): this concerns proposal 4, which is out of scope. It can stay open.
- Where the reader publishes `prError` (line 75): the code answers that something must publish it, because the banner depends on it (`fleet.ts:2280`, `:2284`). The claim file is the plan's own candidate. This is a design decision to settle before slice 2, not an operator decision.
- Claude sessions (line 76): no measurement exists in the plan, and the spender figure cannot provide one because it is a rate quotient. This needs a measurement before anyone claims the plan answers #2386. A cheap first measurement is to group the budget record's lines by caller over one hour (`a-spend-line-names-its-caller` shipped a caller field, which I have not verified here). The operator then decides whether the session path belongs in this plan.
- Reader outliving its board (line 77): this is an operator decision. Under the current design each board restart costs one overlay tick of host reads, which is small.

## 5. New defects (deliverable view)

- No slice says how the operator can see that a reader runs: no board field, no `plot-fleet --status` line, and no log path is named. The `Detached` port needs a `logFile`, and the plan does not name one. An operator who wants to check whether the PR list stopped growing has nothing to read except the budget record.
- No acceptance measurement. The plan should state the observation that proves slice 2 works, for example: "two boards for one repository → one `pr-list` caller in the budget record per beat". It should also state the one that does not apply: two repositories still give two callers.
- The other jurors' lenses cover state declarations (#2436 touched `scripts/state-inventory.json`), the spawn ratchet (the board now starts a process, but through the `Detached` adapter) and `check-shell-lines.sh`. I did not check those.

## Named amendments

1. Keep the board's live issue read on the reader-follows arm, or follow the lock for PRs only, and state which.
2. Settle `prError` and backoff publication for reader-only mode before slice 2, and make the banner a test in that slice.
3. State that the reader renews its claim on every PR beat, before the cadence gate, so that a backoff longer than `READER_STALE_MS` does not start a second reader.
4. Change the Changelog to "for each repository, boards on one machine share one PR list reader; boards still read CI runs", and add the inbox and banner behaviour.
5. In Motivation, state that the measured two-board machine does not benefit (two repositories means two readers), and correct "44 spenders" from a headcount to a rate quotient.
6. Rename the plan, or schedule the jitter it names.
7. Name an acceptance observation and where the reader's log and liveness show.

## Evidence basis

I read: the plan, `fleet.ts:2182-2357`, `fleet-clock.ts:150-177`, `registryd-main.ts:2190-2320`, `scan-owner.ts:30-60`, `detached.ts`, `build.mjs`, `refusal.ts:79-109`, the #2436 branch diff and its port and tests, and issue #2386 (`gh issue view`, read-only). I ran only `sed`/`grep`/`git show`/`git diff --stat`. I ran no tests and no bundles.
