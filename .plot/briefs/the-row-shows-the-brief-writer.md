## Implementation brief — a-slice-whose-brief-is-being (wave 2: The row shows the writer)

- **Plan (canonical):** `docs/plans/2026-10-09-a-slice-whose-brief-is-being.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-row-shows-the-brief-writer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`feature/the-brief-ask-names-its-branch`, #1424) is merged. It made a `--brief-only` run record its branch, so a running or failed writer is attributed to that branch alone. This wave turns that reading into a domain answer and an indicator. Nothing waits on this wave.

### What to build

Issue #1417: while the fleet wrote briefs for `the-fleet-runs-without-the-board` and `the-shell-sheds-its-decisions`, the board showed no indicator for the slices being briefed. Measured 2026-10-09, `/api/fleet` carried `briefAskedAt` on all four NOT STARTED slices of one plan hours after their writer ended. The only reading was an age, and an age cannot end.

Three pieces, in this order:

1. **A domain rule `briefWriterState`** in `packages/domain/src/rules/` (new file, exported from `src/index.ts` beside `quiet`). It takes readings as values — the brief's presence, the writer's run state for this branch (`running` / `failed` / none), the ask's time — and answers `writing`, `failed`, `asked` or `none`. `writing` holds only while a writer's process runs for this branch and the brief is absent. Brief present, or `needsBrief` false, answers `none`.
2. **The server passes the readings in.** `briefReading` (`packages/board/src/server/brief-ask-log.ts`) today returns `askedAt` and `failed` and drops the run state it already read in `implementRunFor`. Add a `writing` reading there (the branch's own state file holds `running <pid>` with a live pid — `readRunState` already does the `alive` check) and let `fleet.ts` (around line 7360) call the rule. Add the answer to the row schema (`packages/board/src/contract/schema.ts`, beside `briefFailed`) with `.default(...)` so an older server's payload still validates; set it to the same default at the two other row constructors in `fleet.ts` (~7845, ~8144).
3. **The row renders the answer.** `briefNote` (`row-identity.ts:296`) and `BriefLine` (`rows.tsx:1565`) read the answer; `writing` renders a working indicator in NOT STARTED. Reuse the pulse the Agents tab already has (`animate-pulse motion-reduce:animate-none`, decorative dot `aria-hidden`, see `.plot/briefs/working-rows-pulse.md`) rather than introducing a second animation.

### Decisions the plan settles — do not re-derive them

**"Running" is read from the writer's process, not from an age.** The implement route writes `running <pid>` into its state file and `readRunState` checks the pid with `alive`. `brief-ask-log.ts`'s header argues against reading a process, because its author saw a 0-byte log at 25 s and 40 s with no visible process and called the writer dead — the writer then finished and landed the brief. That argument is about reading the LOG and the absence of a process while a writer starts. The state file holds the pid before the run begins, so the pid reading does not have that blind spot. The plan reverses the #905 decision for the indicator only. Keep the age as a note beside the indicator; it never decides `writing`.

**A run that named no branch does not read as `writing`.** Wave 1 keeps the per-plan reading for a branchless run so it marks every brief-less sibling as `asked`. An indicator on every sibling is the defect in #1417, so a branchless running run answers `asked` and never `writing`. The change narrows the reading and never widens it.

**`writing` ends when the brief lands.** `needsBrief(row)` is `startability === 'needs-brief'` and is false once the brief is on the default branch. The rule must answer `none` then even if the pid is still alive for a moment. A test with `writing` readings and brief present catches an implementation that tests only the process.

**The state is a domain property, not a component decision.** CLAUDE.md, *Every rendered state is a domain property*: the `.tsx` reads the answer and decides nothing. Unit tests assert all four answers without a browser. One browser test shows the indicator on a NOT STARTED row.

**Where the wave-1 reading stays authoritative.** `failed` and `asked` keep the semantics `briefReading` documents (failure outranks ask; a recorded `0` is no ask). This wave adds `writing`; it does not move those two. If your rule needs them changed, stop and report.

**Carried-over rules.** Absent is not false: a missing state file, a missing root (`repoRoot` undefined) and an unreadable pid all answer `none`/`asked` by the existing defaults, never `failed`. Read the recorded exit, not the emptiness of the log. Null is the default and makes no claim.

### Done when

The plan has no `## Done when` section; the slice line is the specification: *a domain rule answers `writing`/`failed`/`asked`/`none` for a slice from readings, the fleet payload carries it, and a NOT STARTED row shows a working indicator while the answer is `writing`, with one browser test.* Assertions that exist because a naive implementation would pass without them:

- **Siblings stay quiet.** Two brief-less slices of one plan, a running writer recorded for one: only that row answers `writing`. Catches a plan-keyed implementation.
- **A branchless running run answers `asked`, not `writing`,** on every sibling. Catches widening the indicator back to the plan.
- **A dead pid answers `failed` and a live pid with the brief present answers `none`.** Catches reading the process without the brief, and the reverse.
- **The payload default.** A fleet payload without the new field validates and renders as today. Catches a required field breaking an older server's pulse.
- **The browser test** asserts the indicator on a NOT STARTED row and its absence on a sibling.

Plus the repo gates: a changeset (description first, `bumps:` block last; package `@plot-pm/board`; naming the plan on a `plan:` line), and `pnpm build:board` only to test locally — never commit the rebuilt artifact. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run board tests while a board is open on this machine. No `.sh` file is in scope; if you touch one, `scripts/check-shell-lines.sh` refuses growth.

New functions are arrows. TSDoc states what the export does, its parameters, its return and failures; the reasoning belongs in the commit message.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new rule and its test in `packages/domain/`, `brief-ask-log.ts`, the brief fields in `fleet.ts` and `schema.ts`, `row-identity.ts`, `BriefLine`/`BriefNoteCell` in `rows.tsx`, the unit tests `brief-ask-log.test.ts` and `brief-failed.test.ts`, one case in `agents-tab.browser.test.ts`, and the changeset.

Not yours: `askForBrief` in `auto-dispatch.ts` and its plan-keyed `.plot-brief-<plan>.log`. The plan states this slice does not change that asker; if it still marks siblings after your change, report it. Sibling waves in flight on `fleet.ts` and `rows.tsx` may exist — check `git log origin/main` for those files before you rebase, and keep the diff to the lines above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
