## Implementation brief — settled-finding-tickets-close (wave: Finding tickets)

- **Plan (canonical):** [docs/plans/2026-11-01-an-issue-shows-its-plan-s.md](../../docs/plans/2026-11-01-an-issue-shows-its-plan-s.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Branch:** `bug/settled-finding-tickets-close` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention (`plot-review` GitHub App)

**This branch waits on `bug/the-plan-comment-has-one-writer`.** It is not yet merged — no PR exists for it at the time of this brief, and `plot-fleet-scan.sh --next` will not hand this branch out until it lands. Do not start coding against `main` until that branch's PR is merged; the wait exists because this slice's stay-open comment goes through the same locked read-modify-write path that slice is fixing (`withIssueLock` in `packages/domain/src/adapters/tracker/tracker-plan-state.ts`), and building on top of the unfixed path means re-doing the comment-write call once the fix lands.

### What to build

`plot-review` stopped opening follow-up issues for findings on 2026-10-29 (`reviewIssue` answers `'none'` unconditionally, `packages/domain/src/rules/review-issue.ts:20`) — a HIGH finding now holds the PR at `plot/review=failure` instead. That left two kinds of ticket with no closing rule: 196 open, 166 closed `plot-review: findings on PR #N` tickets (by title query), and `auto-ticket.ts`'s HIGH-finding tickets opened when a fixer's attempts are spent. A merge is **not** a safe trigger for closing either: a merge is exactly the moment an unfixed finding reaches `main`, so a merge-triggered close would close the tickets that most need to stay open. #2935 and #2924 are open tickets of this kind today.

Build the domain predicate `reviewTicketSettled(ticket, verdict)` and the operator entry `plot-finding-tickets.mjs` that triages the 196 open tickets (plus any `auto-ticket.ts` ticket) using it: close the ones a recorded verdict says are settled, comment once on the ones that still have open findings, and touch nothing where no verdict exists yet.

### The decisions the plan settles — do not re-derive them

**Settled is a domain predicate over a *recorded* verdict, never over merge or PR state.** `reviewTicketSettled(ticket, verdict)` answers `settled`, `open` or `unjudged`:
- The verdict is a named record at `.plot/state/ticket-verdicts/<issue>.md`: a `Default:` line naming the default-branch commit it was judged at, then one line per finding, `- <finding title>: fixed | not-reproduced | wont-fix | still-true`.
- `settled` requires the verdict's finding count to equal the ticket's own `Findings: HIGH a, MEDIUM b, LOW c` total (parsed the same way `reviewVerdict` in `review-verdict.ts` already parses that line shape), and every line to read `fixed`, `not-reproduced` or `wont-fix`.
- One `still-true` line anywhere gives `open`.
- A missing verdict file, a finding count that doesn't match the ticket's total, or an unreadable line gives `unjudged` — not `open`. The distinction matters: `unjudged` means "nobody has looked yet", `open` means "someone looked and at least one finding is still true". The entry writes nothing for `unjudged` and a comment for `open`.
- A merge, a `MERGED` PR-index row, and a closed PR are not inputs to this function at all — there is no code path by which merging a PR changes what `reviewTicketSettled` answers. This is deliberate: see the acceptance row "A merge is no input" below.

**`issueClose` is a new, sixth write on the Tracker port, closing-only.** Follow the shape of `issueLabel` (`ports/tracker.ts:496`, the fifth write) and `issueOpen`/`issueComment` immediately above it in the same file: a `PortResult<...>` return, `unaskable` where no tracker is declared or the declared one can't close issues, `failed` otherwise with the reason in `lastRefusal()`. The GitHub adapter runs it as `plot-host.sh issue-close` (new subcommand at `plot-host.sh:5771`, right after the existing `issue-label` at `:5770`) — follow `check-host-cli-callers.sh`'s rule that `plot-host.sh` is the only caller of the host CLI; do not add a second `gh issue close` site.

**The stay-open comment reuses the marked-comment mechanism, not a new one.** The comment on an `open` ticket carries its own marker, `<!-- plot:ticket-triage -->` (distinct from `PLAN_STATE_MARKER`, `<!-- plot:plan-link -->`, in `tracker-plan-state.ts` — different concern, different marker, do not conflate them), and is edited in place rather than appended. It is written **only when its text changes** — hash the rendered comment the same way the plan-state write already avoids a no-op write, and skip the call when the hash matches what's already posted. This is why the branch waits on `bug/the-plan-comment-has-one-writer`: that slice is fixing the locked read-back race in exactly this read-modify-write shape (`withIssueLock`, `tracker-plan-state.ts:139`), and this slice's comment write goes through the same path once fixed.

**The entry point is dry-run-by-default, `--yes` to write, and refuses unattended writes** — same shape as `plot-released-labels.mjs` (`packages/board/src/server/entry/released-labels.ts`), which is the closest existing analog in this plan and worth reading end-to-end before writing this one. Mirror its structure: a `Deps` interface for injected tracker/env/io, a `run(argv, deps)` function exported for testing, and an `if (process.argv[1] === ...)` guard at the bottom that wires the real tracker via `trackerForIssues` and only runs when invoked directly, never when imported. `--yes` refuses under `PLOT_UNATTENDED=1` (exit 2) before reading anything, same as `plot-released-labels.mjs`.

**Reading the open tickets costs one list call, not one lookup per ticket.** Use `issueListWithTitle('ai-generated', 'plot-review: findings on', …)` (`ports/tracker.ts:316`) — already on the port, 2 pages for the current 196 open tickets. Read each ticket's verdict file from disk (not from the tracker), classify with `reviewTicketSettled`, then: one `issueClose` call per `settled` ticket, one comment lookup plus one write per `open` ticket whose comment text changed, nothing for `unjudged`.

### Done when

The plan's `## Done when` item 3 is the specification: *"A review finding ticket closes when its findings are settled, and otherwise says once why it stays open. A merge does not close it."* Lift these assertions — each exists because a naive implementation would pass without it:

- **Settled needs every finding, not just the ones mentioned.** A verdict with 6 lines for `Findings: HIGH 0, MEDIUM 2, LOW 4`, all `fixed` or `wont-fix` → `settled`. Catches an implementation that checks "no `still-true` line" without also checking the count matches the ticket's total — a verdict missing two lines would wrongly read as settled under that weaker check.
- **One `still-true` keeps a ticket open.** Same input with one line changed to `still-true` → `open`, not `settled`. Catches a majority-vote or percentage-threshold implementation.
- **A short or missing verdict decides nothing, and is distinct from `open`.** 5 lines for a 6-finding ticket, or no verdict file at all → `unjudged` in both cases. Catches collapsing `unjudged` into `open` (which would wrongly cause a stay-open comment to be written for a ticket nobody has reviewed yet) or into `settled` (which would wrongly close it).
- **A merge is not an input, under any circumstance.** A merged PR with no verdict file → `unjudged`, and critically, no close call is made regardless of merge/PR-index/PR-closed state. Write the test so it constructs a merged-PR context and asserts `reviewTicketSettled` is never even given that context — the function's signature should make a merge state impossible to pass in, not just unused.
- **The stay-open comment write is idempotent across runs.** Two `--yes` runs with the same unchanged `open` verdict → one comment write on the first run, zero on the second. Catches an implementation that always writes when a ticket is `open`, regardless of whether the comment text changed.
- **The triage closes only what's settled, in one pass.** One ticket each of `settled`, `open`, `unjudged`, one `--yes` run → exactly one `issueClose`, one marked comment write, and nothing for the third. This is the entry-level integration assertion that the three domain answers above actually route to three different write behaviors.

Plus the repo's gates: a changeset (`plot` package, patch — new domain rule plus entry, not a breaking workflow change), and `skills/plot/scripts/README.md` gets a new row for `plot-finding-tickets.mjs` (`scripts/check-helper-table.sh` is the gate). Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites named in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice adds `plot-finding-tickets.mjs` as a thin launcher (resolve the built bundle, `exec` it — decide nothing itself), the same shape `plot-released-labels.mjs`'s launcher already uses, so it should cost little to no net shell growth. If it does grow, pay for it by removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — the claim push already happened per the fleet scan; what's owed now is visible progress, not a second ref write. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Finding tickets` heading.

### Scope guard

This branch owns: `packages/domain/src/rules/review-issue.ts` (adds `reviewTicketSettled` beside the existing `findOpenReviewIssue`/`reviewIssue`/`reviewIssueTitle`), `packages/domain/src/ports/tracker.ts` and its GitHub/fixture/Jira/none adapters (adds `issueClose`), `packages/board/src/server/entry/finding-tickets.ts` built to `skills/plot/scripts/board/plot-finding-tickets.mjs`, and that script's new row in `skills/plot/scripts/README.md`. Tests: `packages/domain/test/review-issue.test.ts`, `packages/board/test/unit/finding-tickets-entry.test.ts`.

Other branches in this plan's wave structure, verified at dispatch time against the plan's `## Slices` section rather than guessed:
- `bug/an-issue-reads-its-plan-from-main`, `bug/the-plan-comment-has-one-writer`, `infra/released-issues-carry-their-label`, `bug/an-added-issue-owes-its-phase` are already `Started`.
- `bug/the-plan-comment-has-one-writer` is this branch's direct blocker (see above) — it owns `tracker-plan-state.ts`'s `withIssueLock` and the read-back at `:192-193`, which this branch's comment write depends on but must not itself modify.
- `bug/a-slice-row-reads-its-head-s-checks` is a sibling slice with no stated dependency on this one; it touches `packages/domain/src/rules/pr-row.ts` and `packages/board/src/server/fleet.ts`, disjoint from this branch's files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
