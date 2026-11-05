## Implementation brief — a-desk-s-design-question-waits (wave 3: An escalation reaches the issue)

- **Plan (canonical):** docs/plans/2026-11-03-a-desk-s-design-question-waits.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3067 merged
- **Branch:** `feature/an-escalated-question-reaches-the-issue` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

This branch is wave 3, the last of the plan. Wave 1 (`feature/fleetd-starts-the-unblocker`, #3084) and wave 2 (`bug/an-answer-records-its-true-author`, #3109) are merged. Nothing waits on this branch.

### What to build

An unblocker run that ends `ESCALATE: <reason>` already records one row in `.plot/state/answers.tsv` with outcome `escalated <reason>` (`applyUnblockDecisions`, `packages/fleet/src/server/entry/registryd.ts:1629`; the `answer-cap` path writes `escalated answer-cap` the same way). Nothing reads that row except the age ladder (`questionEscalation` → `listed`, `notified-N`). A person who watches the issue, and not the board, never sees the question. On 2026-11-03 the desk on `feature/the-scan-script-is-a-launcher` (PR #3048) asked a scope-and-test question, nobody answered, and a person found it only after `plot-reap` copied the marker to `refusals.tsv`.

Two changes:

1. **Post the escalation on the plan's issue.** After the applier appends an `escalated <reason>` row, fleetd resolves the plan that names the desk's branch (`findPlanForBranch`, `packages/board/src/server/entry/plan-lookup.ts`, used by `brief-book.ts:89`), reads its `Issue:` line, and calls `Tracker.issueComment(id, body, marker)` (`packages/domain/src/ports/tracker.ts:481`). The body holds the question, the reason and the branch. The marker is keyed on the desk and `askedAt`, so a second pass edits the comment instead of adding one. `PLOT-BLOCKED` stays on the desk; this change never deletes or edits it.
2. **Show the reason on the *Waiting on you* row.** A desk whose question key holds an `escalated <reason>` row shows the reason in its row note. `questionNote` (`packages/board/src/server/fleet.ts:3733`) builds the note today as `waiting on you: <first line> · asked <age> ago`. The reason is a domain property: the rule that reads the rows and returns the reason lives in `packages/domain`, and `fleet.ts` only asks it. Do not compute the reason in `.tsx`.

The plan stays canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**No new store, no new recipient field.** The `outcome` column is already a free string (`answer-record.ts:15`), so `escalated <reason>` needs no column. The ladder reads `escalated` like `refused`: it falls through to the age rungs. Do not add a second TSV to remember that a comment was posted — the marker makes the post idempotent, and that is the whole dedup.

**The comment is an edit-in-place, never an append.** `issueComment` is documented as NOT idempotent without a `marker` (`tracker.ts:466`): the same call twice adds two comments. Always pass the marker. `finding-tickets.ts:137` (`TICKET_TRIAGE_MARKER`) is the existing caller that does this; follow its shape. A test that calls the post twice with the same key and counts the calls one marker apiece catches a caller that drops the marker.

**A missing issue or an unaskable tracker posts nothing and logs one line.** A plan with no `Issue:` line, a tracker answering `unaskable` (`tracker-none.ts:40` answers it on every operation; `tracker-jira.ts:295` answers it for comments) and a tracker answering `failed` each make no further call and log one line naming why. The ladder still notifies through `Notify command`. A silent success here would claim the question reached a tracker somebody configured while nothing left the machine — the reason `trackerNone` answers `unaskable` on the write.

**The post must not block or undo the record.** The `escalated` row is written first and is the source of truth. A failed or slow post leaves the row in place; the next tick must not re-run the unblocker (`unblockerDue` refuses `already-recorded` for any row on the key). Whether a failed post retries on a later tick is your call: decide it, name it in the PR description, and keep it bounded. Do not retry on every tick — that is the defect this plan fixed for failed runs.

**Layering.** The controller calls the domain; fleetd reaches the tracker through the `Tracker` port, built the way `revert-start-world.ts:186` and `auto-ticket.ts:38` build it. No new `spawn` or `execFile` outside `adapters/`: the CI ratchet (`allowed=28`) fails when the count grows.

**Rules carried over unchanged:** absent is not false (a missing `answers.tsv` reads as zero rows, never as "already started"); read the exit code, not the emptiness; an arrow function for every function you write, including in test files; factual TSDoc, with the reasoning in the commit message.

### Done when

The plan's `## Done when` for this slice is the Slice 3 list under Tests:

- An `escalated` row on a desk whose plan names `Issue: #N` makes one `issueComment('N', …, marker)` call; a second pass with the same key uses the same marker. — catches a post that drops the marker and adds a comment per tick.
- A plan with no `Issue:` line, and a tracker answering `unaskable`, each make no call and log one line. On `origin/main` no call exists. — catches a post that throws, or that reports success, where no tracker was reachable.
- The *Waiting on you* row's escalation reason is a domain property, asserted in a unit test for a desk with an `escalated test` row, plus one browser assertion that the row shows it. — catches a reason computed in the component, which only a rendered test could see.

Add three cases the list does not name, each because a naive implementation passes without them: a desk whose last row is `started` shows no reason (the reason belongs to a finished `escalated` outcome, not an open run); a desk with an `escalated` row on an earlier `askedAt` and a new marker shows no reason (the key moved); an `escalated answer-cap` row posts and shows `answer-cap`.

Plus: a changeset (package `plot`, patch or minor as the behaviour warrants; description first, `bumps:` block last, `plan:` line inside the block). Never hand-edit a bundle under `skills/plot/scripts/board/`, and never commit a rebuild: the PR diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is TypeScript and should add no `.sh`; if it touches one, pay for the growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller:

```bash
../plot/scripts/plot-open-pr.sh          # on this branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It takes the wave heading ("An escalation reaches the issue") as the PR title. Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns:

- the domain rule that reads an `escalated <reason>` row for a question key, and its tests, under `packages/domain/`
- the fleetd step that posts the comment after `applyUnblockDecisions` — `packages/fleet/src/server/entry/registryd.ts` and `registryd-main.ts` (wiring only; the applier's outcome table does not change)
- `packages/board/src/server/fleet.ts` — the row note only; the *Waiting on you* component in `packages/board/src/app/components/AgentList.tsx` renders what the domain returns and decides nothing
- one browser assertion for the row, and unit tests beside each change
- the changeset

It does not own `continuation.ts`, `unblock-outcome.ts`, `unblocker-due.ts`, `.claude/agents/unblocker.md` or `answer-record.ts`; waves 1 and 2 settled them.

Open PRs at dispatch time (2026-11-05, `gh pr list`): #3148, #3147, #3112, #3111, #3110, #3105, #3080 and #3076. None is named for `registryd.ts`; #3110 (`board-files-rows-in-the-wrong`, row placement) is the one near `fleet.ts`. Verify before you edit `fleet.ts` and expect a rebase rather than a design conflict.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
