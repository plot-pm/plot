# A refused bb call writes no budget row

> The `bb()` wrapper in `plot-host.sh` writes no `budget.tsv` row for a call that `bb` refused before it sent a request, and reads the refusal from `bb`'s fixed stderr phrases, as `bbThrottleCause` already does in the domain.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Issue:** #3690
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Started:** 2026-11-24, Jan Wloka, `bug/a-refused-bb-call-writes-no-budget-row`

## Changelog

- A `bb` call that `bb` refuses at its hourly ceiling or during a pause no longer counts as a Bitbucket request in Plot's budget, so a pause cannot push the board into a one-hour wait that no request caused.

<!-- Board impact: no plan format, template or docs/plans layout change. One helper script changes: `plot-host.sh` (the `bb()` wrapper reads `bb`'s stderr and skips the budget row of a refused call). The board reads `LimitReading` unchanged in shape. No board bundle is committed (`scripts/check-no-bundle-diff.sh`). -->

## Motivation

Issue #3690 reports that the `bb()` wrapper records one `budget.tsv` row for every `bb` call, whatever its exit code. On `origin/main` at `e15c9d319`, `bb()` (`skills/plot/scripts/plot-host.sh:3754-3760`) calls `host_cli_call`, which runs the command and then calls `budget_record_call` with no condition (`:3741-3748`). `budget_record_call` records nothing only for a spend of 0 or empty (`:3501-3505`).

`bb` exits 75 for three causes (agent-skills `main` at `9e3017986`): a 429 from Bitbucket after the request was sent (`bb_check_status`, `cli/bb:189-201`; `bb_paginate`, `:768`), and two refusals that send nothing, the pause after an earlier 429 and the hourly ceiling (`bb_request_guard`, `cli/bb:652-695`). The two refusals print fixed phrases: `bb paused until <time> after Bitbucket refused a request` and `<n> requests in the last hour from this machine; next request at <time>`.

**#3688 does not fix this and does not narrow it.** Since #3688 the wrapper writes `bb`'s exit code to `BB_RC` (`plot-host.sh:3758`), and `failed_code` maps 75 to exit 5 (`:690`). The row is still written before that, inside `host_cli_call`, and both causes still exit 75, so the code alone cannot tell them apart.

**The domain already tells them apart.** `bbThrottleCause` (`packages/domain/src/rules/bb-ledger.ts:489-493`) answers `ceiling` or `paused` from the same two phrases, for the in-process client's words and for `bb`'s stderr, and `pr-status.ts:221` reads it. The in-process client already appends no `BudgetEntry` for a refusal it makes (`bitbucket-api.ts`, `guarded`). Only the shell over-counts.

**The cost.** `limitWaitMs` (`packages/domain/src/rules/cadence.ts:261`) waits `MAX_LIMIT_WAIT_MS` (`:224`), one hour, where `resetAt` is null and Plot's own `perHour` reaches a `predicted` limit. At the 800 limit, refused calls recorded during a pause reach that limit sooner. For the sprint goal, an unattended run on Bitbucket must not stop for an hour on requests it never sent.

## Design

### Approach

- **The wrapper keeps a copy of `bb`'s stderr.** `bb()` sends `bb`'s stderr to its caller as today and also writes it to a per-run temp file made by `plot_tmpfile`, beside `BB_RC` (`plot-host.sh:641`). The construct must pass `scripts/check-bash32-syntax.sh`.
- **A refused call spends 0.** Where `bb` exits 75 and its stderr holds the ceiling or the pause phrase, the wrapper passes a spend of 0 to `budget_record_call`, which then records nothing. Every other exit, 75 after a 429 included, records one row as today. `host_cli_call` gains the spend as an argument, so `gh` and `jen` keep their behaviour.
- **A declared duplicate.** The shell match duplicates `bbThrottleCause`, because `bb()` runs once per host call and a bundle costs 39 ms per call (`docs/shell-and-domain.md`). A corpus test in `packages/domain/corpus/` feeds the same stderr texts to both and fails on a disagreement.
- **The shell-lines ratchet.** `scripts/check-shell-lines.sh pr` must not read higher than at the merge base, so the slice removes as many shell lines as it adds.
- **No change in agent-skills.** `cli/bb` already treats these phrases as its contract with Plot: its comment at `bb_check_status` says the words avoid the number 429 because Plot reads them (`cli/bb:180-188`).

### Open Questions

- [ ] `[question-a-partly-sent-listing]` A paginated `bb` call can send pages and then meet the ceiling or a pause on a later page (`bb_paginate`, `cli/bb:755`); its stderr holds the refusal phrase although requests went out. Recommended: record no row. The wrapper already records one row per call however many pages it sends, and `bb`'s own ledger still counts every page it sent.
- [ ] `[question-a-machine-marker]` Should `bb` mark an unsent refusal by a distinct exit code or a fixed token instead of prose? Recommended: no, not for this plan. The phrases are already read by `bbThrottleCause`, and a new exit code breaks the 75-to-5 mapping that #3688 shipped. File it in agent-skills if the phrases change.

## Slices

### Wrapper

- `bug/a-refused-bb-call-writes-no-budget-row` — the `bb()` wrapper copies `bb`'s stderr to a per-run file and records no `budget.tsv` row for an exit 75 whose stderr names the ceiling or the pause; a corpus test holds the shell match to `bbThrottleCause` <!-- builds: the spend argument of host_cli_call and the refused-call match in bb() --> <!-- tests: a stub bb that exits 75 with the pause phrase and with the ceiling phrase writes no row; exit 75 after a 429 and exit 0 write one row each; the caller still reads bb's stderr; a corpus test agrees with bbThrottleCause on every phrase --> → #3713

## Notes

Created on 2026-11-23 from issue #3690, for the sprint plot-describes-itself.

The plan has one Plot slice and no slice in agent-skills, so it fits a sprint that ends on 2026-12-04.

`plot-deliverable-search.sh` finds `bbThrottleCause` (`rules/bb-ledger.ts`, `rules/pr-status.ts`, `workflows/plan-walk-assembly.ts`) and the existing spend argument of `budget_record_call` (`plot-host.sh:3501`); it finds no shell reader of the refusal phrases.
