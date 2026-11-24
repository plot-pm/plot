## Implementation brief — a-refused-bb-call-writes-no-budget-row

- **Plan (canonical):** `docs/plans/2026-11-23-a-refused-bb-call-writes-no-budget-row.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/a-refused-bb-call-writes-no-budget-row` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one branch. No other wave waits on it. No change in agent-skills.

### What to build

The `bb()` wrapper in `skills/plot/scripts/plot-host.sh` (about `:3754`) writes one `budget.tsv` row for every `bb` call, whatever its exit code. `host_cli_call` (about `:3741`) runs the command and then calls `budget_record_call` with no condition. `bb` exits 75 after two refusals that send no request — the hourly ceiling and the pause after an earlier 429 — and these count as Bitbucket requests in Plot's budget. During a pause, the refused calls push `perHour` toward the 800 limit, and `limitWaitMs` (`rules/cadence.ts:261`) then waits `MAX_LIMIT_WAIT_MS`, one hour, for requests nobody sent (issue #3690).

Make `bb()` copy `bb`'s stderr to a per-run temp file (`plot_tmpfile`, beside `BB_RC`, about `:641`) while the caller still reads it. Where `bb` exits 75 and that stderr holds the ceiling phrase (`requests in the last hour from this machine; next request at`) or the pause phrase (`bb paused until <time> after <host> refused a request`), pass a spend of 0 to `budget_record_call`, which records nothing for 0. Give `host_cli_call` the spend as an argument so `gh` and `jen` keep their behaviour. Every other exit records one row as today, 75 after a real 429 included. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The exit code alone cannot do it.** #3688 wrote `bb`'s code to `BB_RC` and `failed_code` maps 75 to 5 (`:690`), but a 429 after a sent request and both refusals all exit 75. The phrases are the only discriminator. Do not add a new exit code to `bb`: it breaks the 75-to-5 mapping #3688 shipped, and the phrases are already `bb`'s contract with Plot (comment at `bb_check_status`, `cli/bb:180-188`).

**Declared duplicate of `bbThrottleCause`.** `rules/bb-ledger.ts:489-493` answers `ceiling` / `paused` / `host` from the same two phrases. The shell matches them again because `bb()` runs once per host call and a bundle costs 39 ms per call (`docs/shell-and-domain.md`). Do not call a bundle from `bb()`. Pair the two in `packages/domain/corpus/` (precedent: `bb-ledger.corpus.test.ts`, `sprint-score.corpus.test.ts`) with `compareField` / `describingAs` so a disagreement names both answers. On a disagreement the branch stops; do not adjust either side to pass.

**A partly sent listing records no row.** A paginated `bb` call can send pages and then meet the ceiling on a later page; its stderr holds the refusal phrase. Record no row. The wrapper records one row per call however many pages go out, and `bb`'s own ledger counts every page it sent. This is the plan's recommended answer to its first open question.

**Keep the caller's stderr.** The copy is in addition to the stream the caller reads today (`pr-list` reads it for the refusal text; `failed_code` for the exit). A construct that swallows stderr breaks both. It must also pass `scripts/check-bash32-syntax.sh`: no `&>`, no `|&`, no `${var,,}`, no process substitution assumptions beyond what the file already uses.

**Rules carried over unchanged:** read the exit code, not the emptiness of stdout; an unreadable stderr copy means record one row as today (absent is not "refused"); `budget_record_call` already records nothing for a spend of 0 or empty, so do not add a second skip path.

### Done when

The plan has no `## Done when` section; the specification is the slice's line and the Changelog line. Tests the plan names, each catching a naive pass:

- A stub `bb` that exits 75 with the pause phrase writes no row; the same with the ceiling phrase writes no row (catches a match on the exit code alone).
- A stub `bb` that exits 75 with a plain 429 message writes one row (catches a match on 75 alone).
- A stub `bb` that exits 0 and one that exits 1 write one row each.
- The caller still reads `bb`'s stderr, refusal text included (catches a redirect that swallows it).
- A corpus test feeds the same stderr texts to the shell match and to `bbThrottleCause` and fails on a disagreement (catches drift between the two).

Look at `test/reconcile/budget.test.mjs`, `host.test.mjs` and `bb-listing-requests.test.mjs` for how a `bb` stub and a private budget home are set up. Add a changeset (description first, `bumps:` block last; package `plot`, skill `plot` patch is the likely level).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so pay for growth in the same change: remove as many shell commands elsewhere as the match adds, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. Report before and after from `check-shell-lines.sh --per-file`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Wrapper` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-host.sh` (`bb()`, `host_cli_call`, the `BB_RC` setup), a new corpus test under `packages/domain/corpus/`, the shell tests above, and the changeset. `rules/bb-ledger.ts` is read-only here: if the phrases need a change, report it.

Not yours: `cli/bb` in agent-skills, `failed_code`'s mapping, the in-process client's `guarded` path (`bitbucket-api.ts`), and `limitWaitMs`. Other branches in flight on the Bitbucket or budget code: none at dispatch (checked `origin` heads on 2026-11-24).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
