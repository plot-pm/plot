## Implementation brief — a-high-finding-is-fixed-before (wave 3: HIGH ticket)

- **Plan (canonical):** docs/plans/2026-10-29-a-high-finding-is-fixed-before.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2912 merged
- **Branch:** `feature/an-unfixed-high-is-ticketed` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per the plan's `Review: pr`

This is the last of three waves. Wave 1, `feature/the-fixer-attempts-record`
(PR #2930), and wave 2, `feature/fleetd-starts-the-fixer` (PR #2965), are both
merged, so nothing blocks this wave from starting. Nothing waits on you.

### What to build

Two stubs in `packages/domain/src/rules/slice-pr-next.ts` are yours — wave 2
left them for you on purpose:

```ts
export const highArm = (readings: SlicePrNextReadings): SlicePrStep =>
  readings.ticket?.read === 'unread' ? hold('unread') : none('high-not-built');
```

Replace it with the plan's items 4–6 (`## Design › Approach`, "The arms"):

4. HIGH on this head, attempts spent, no ticket recorded → `{ step: 'ticket', head: row.headSha }`.
5. HIGH on this head, attempts spent, ticket recorded, no accepted `success` on this head → `{ step: 'write-status', head: row.headSha, state: 'success', description, why: 'ticket-accepted' }`.
6. Accepted `success` on this head → `none` — #2902's merge arm already takes it from there via `mergeArm`, which reads `row.plotReview === 'success'` with no knowledge of why.

"HIGH on this head" and "attempts spent" read exactly as wave 2's `highArm`
read them (now gone from the stub, but still true): `row.plotReview ===
'failure'` with `row.plotReviewSha === row.headSha`, and
`fixerAttemptsExhausted` (`rules/fixer-attempts.ts`) on the `FixerReading`
wave 1 built. `ciRedArm` is not yours — it is wave 2's, already real, and
answers plan item 7 (`ci-red-attempts-spent`) on its own.

Then build the fleet-side tick action that turns a `ticket` step and a
`write-status`/`ticket-accepted` step into real writes, following
`packages/fleet/src/shared/auto-review.ts`'s `reviewTick` shape the way wave
2's fixer-start tick did (one function, one pass over open rows, acts on the
one step it owns).

### Settled decisions — do not re-derive them

- **The plan's Motivation section names two functions that no longer
  exist under those names — read the current code, not the plan's citations.**
  `openFollowUp` and the inline `reviewTracker` resolution it names
  (`review.ts:42,76`) described the code as it stood when the plan was
  written. Since then #2900's `feature/a-review-opens-no-issue` landed: the
  review-time follow-up issue is gone, and `reviewIssue` (`rules/review-issue.ts`)
  now answers `'none'` unconditionally, for every severity including HIGH —
  its own doc comment says so. What that slice left behind is exactly what
  you need: `REVIEW_ISSUE_LABEL` (`'ai-generated'`), `reviewIssueTitle(pr)`,
  and `findOpenReviewIssue(issues, pr)`. Reuse them rather than inventing a
  second title or label scheme — a second scheme is what would make
  `findOpenReviewIssue` blind to tickets this plan opens.

- **The tracker resolution the plan asks you to "move to an adapter export"
  (`review.ts:76`) is also already done.** `trackerForIssues` lives at
  `packages/domain/src/adapters/tracker/tracker-resolve.ts` and is already an
  adapter export — `plan-state.ts` and `verify.ts` both call it today. Call
  it the same way; there is no inline resolution left in `review.ts` to move.

- **The ticket record follows wave 1's file-adapter shape exactly, not a new
  one.** `packages/domain/src/adapters/fixer-attempts/fixer-attempts-file.ts`
  is the precedent: a Zod entity with a literal `v`, a `decode` that returns
  `'none' | 'unreadable' | <record>` (never throws, never nulls), a port as
  an `interface` with `read`/write methods returning `PortResult`, and an
  adapter that writes through a `<pid>.tmp` file and `rename`s it into place.
  Build `packages/domain/src/entities/ticket-record.ts`,
  `ports/ticket-record.ts`, and
  `adapters/ticket-record/ticket-record-file.ts` at
  `.plot/state/tickets/<pr>.json`, keyed by PR number — the same directory
  level as `fixer-attempts/`, a sibling, not a subdirectory of it.

- **`pending`-then-id, not written-then-check.** The plan's own precedent is
  `openFollowUp`'s old shape (`review.ts:251-281` as it stood before #2900,
  still the right shape even though that caller is gone): write a `pending`
  record before asking the tracker to open the issue, then overwrite it with
  the id once the tracker answers. A `pending` record on read holds and names
  the file to check — it is not "no ticket yet", because the open call might
  already be in flight from a previous tick that crashed between the ask and
  the write-back. Reading `pending` as "none" would open a second ticket for
  the same PR; reading it as the final id would gate `write-status` on a
  ticket that may not exist yet. Hold on `pending`, the same way `FixerReading`
  holds on an unreadable in-flight mark (wave 1's brief, same reasoning: absent
  is not false).

- **One ticket per PR, across every head.** A later head's HIGH findings are
  a *comment* on the already-open ticket, never a second `issueOpen` call.
  Key the record by PR number, matching `fixer-attempts`'s own key, not by
  head SHA — a per-head key would open a new ticket on every push past the
  budget, the same loophole wave 1's per-PR key closed for attempts.

- **`reviewStatus(counts, ticket)` is new — it does not exist yet.** It is a
  pure domain function next to `reviewVerdict`
  (`packages/domain/src/rules/review-verdict.ts`) or its own file. It answers
  `success` for a HIGH only when the ticket record holds a confirmed id *and*
  the attempts record (wave 1) shows the budget spent for this PR — both
  conditions, not either. `review.ts`'s `finishReview` (`review.ts:509-510`)
  computes `state`/`description` inline today
  (`counts.high === 0 ? 'success' : 'failure'`); this plan does not touch
  that computation — your `reviewStatus` is a *second* caller for the ticket-
  accepted case, invoked by the fleet tick, not a replacement for
  `finishReview`'s own inline logic. Leave `review.ts` alone, per your scope
  guard below.

- **The accepted `success` write follows `writeApprovalStatus`'s precedent
  exactly** (`packages/board/src/server/entry/approve.ts:87-96`): a bare
  `host.commitStatus` call with `context: REVIEW_CONTEXT` (imported from
  `review.ts`), no new run, no agent. The description names the ticket and
  the run marker within the host's 140-character cap
  (`packages/board/test/unit/review.test.ts:171-177` — read that test before
  choosing a format, it is the existing cap check). Where `commitStatus`
  answers `unaskable` (a host with no commit statuses, `ports/host.ts:359-373`),
  the PR holds and the tick notifies rather than retrying silently — do not
  swallow that refusal.

- **The ticket opens unassigned.** `IssueOpen` (`ports/tracker.ts:145-152`)
  takes `title`, `body`, `labels` only, and its own doc comment calls
  widening it to an assignee "the mirror this port exists to refuse." Do not
  add a field; do not route around the port with a second tracker call.

- **A HIGH on #2904's repair PR is not yours.** `slicePrNext`'s guard arm
  (`guardArm`, same file) already lets a repair/revert PR past the scope
  check via `repairNamesPr`; #2904 sends that PR's HIGH to the revert
  instead of your fixer/ticket path. You do not need to special-case it —
  just do not assume every PR reaching `highArm` is a normal slice PR if you
  add new guard logic; there should be no reason to.

- **Layering, vocabulary, arrows.** Same as wave 1 and wave 2: controller →
  domain → port → adapter; the domain owns the port with no runtime import of
  the adapter; arrow functions for everything in `packages/domain/**`; TSDoc
  states what, not why; Agent is the actor, Slice never Wave in new code.

- **Answers, never verdicts.** The ticket record holds what happened (the
  tracker's id, or `pending`), not a derived "should merge" flag — that stays
  `reviewStatus`'s job, re-derived fresh each tick from the record plus the
  attempts count.

### Done when

The plan's slice line for this wave is the specification. Lift these
assertions, each of which a naive implementation passes without:

- A `pending` record on a PR holds `ticket` and `write-status` alike — it
  never reads as "no ticket" and opens a second one, and never reads as a
  confirmed id and writes an unearned `success` (catches collapsing the
  three-state record to two).
- Two heads of the same PR, both HIGH, both past the attempts budget, open
  exactly one ticket between them — the second head's findings land as a
  comment on the first's ticket (catches a per-head key or a second
  `issueOpen` call).
- `reviewStatus` answers `success` only when BOTH the ticket is confirmed AND
  the attempts budget reads spent — neither alone (catches gating on only one
  of the two, which would accept a HIGH whose fixer never actually ran out of
  attempts, or ticket a HIGH whose ticket write is still `pending`).
- A tracker that answers `unaskable` for `issueOpen`, and a host that answers
  `unaskable` for `commitStatus`, each leave the PR holding rather than
  merging unticketed (catches an HIGH that merges anyway because a refusal
  was read as success).
- The findings comment on a confirmed ticket carries the HIGH count and the
  PR, in the same shape `findingsBody` uses for the dropped review-time
  comment, so a reader of the ticket sees what was found without opening the
  PR (catches a comment that is only "see PR" with no content).

Plus: add a changeset (description first, `bumps:` block last;
`./scripts/check-changeset-packages.sh`). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints. The suites in the `CI suites` config key run in CI, and a
failure there comes back as a correction. Do not run `test:e2e` locally. This
slice is unlikely to touch a `.sh` file; if it does,
`scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere or
write the rule in the domain. Do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`),
then append `→ #<number>` to this branch's line in the plan's `## Slices`.
Push the first real commit as soon as it exists.

### Scope guard

This branch owns the ticket-record port, its decode and its file adapter
under `packages/domain/`; `reviewStatus`; the `highArm` replacement in
`rules/slice-pr-next.ts`; and the fleet-side tick action that calls
`issueOpen`/`issueComment` and the accepted-`success` write. It does not own
`ciRedArm` (wave 2, already real) or anything in `review.ts` — the review-run
path that writes `failure` on a HIGH is unchanged and not yours to touch. Two
other plans are in flight against files you are near: #2905 reads the ticket
record you are building to render it into the plan comment (reads only, after
you merge); #2904 reuses your ticket writer for its revert tickets once you
land it (also reads only). Neither should collide with you if you keep the
ticket-record module's shape stable once you land it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
