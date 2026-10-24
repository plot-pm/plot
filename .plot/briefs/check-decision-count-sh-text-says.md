## Implementation brief — check-decision-count-sh-text-says (wave 1: Gate text)

- **Plan (canonical):** docs/plans/2026-10-24-check-decision-count-sh-text-says.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2566 merged
- **Branch:** `bug/check-decision-count-sh-text-says` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention

Single wave, single branch. Nothing waits on it.

### What to build

Two pieces of text in `scripts/check-decision-count.sh` describe a counting rule that #1416 replaced on 2026-10-09. `counted()` (line 171) counts every README script row whose Kind is not `launcher`. The text says `readings` and `paired` rows are also uncounted. Measured 2026-10-24: the desk for PR #2468 added a `readings` row with its bundle evidence, the gate refused +1 (48 rows against 47), the desk read the header, concluded the gate was wrong and stopped with a PLOT-BLOCKED marker asking for an override. The gate was right.

Edit text only. Do not touch `counted()`, `has_evidence()` or any control flow. The plan is canonical.

### Settled decisions

- **The evidence rule stays.** `readings` and `paired` still need evidence in the Replaced by cell, because the evidence proves the Kind label. It does not exempt the row from the count. Header lines 17-18 ("one of the three uncounted kinds") must say the three kinds carry an evidence rule and that only `launcher` is uncounted. Do not remove the evidence rule or the `readings`/`paired` arms in `has_evidence()`.
- **Refusal, line 198** ("or convert a row of the same count to launcher, readings or paired with its evidence"): say that only a conversion to `launcher` lowers the count and that a `readings` or `paired` row counts like any other. Do not widen the wording to suggest an override. The script reads no override and gains none.
- **Tests (the plan's open question).** Measured at dispatch: `grep -rln "readings or paired\|three uncounted" test scripts docs skills` returns only the script and the plan, so no test asserts the old wording. Re-run the grep, including the exact new refusal text, before pushing; update any assertion that turns up.
- Line 171 and the refusal at line 189 ("kind changed without evidence") are correct as they stand.

### Done when

The plan states no `## Done when` list; the specification is the Approach section.

- The header names `launcher`, `readings` and `paired` as the kinds with an evidence rule and states that only `launcher` is uncounted.
- The refusal states that only a conversion to `launcher` lowers the count.
- `grep -n "three uncounted\|launcher, readings or paired" scripts/check-decision-count.sh` returns nothing.
- Behaviour is unchanged: `git diff` shows comment and message text only.

Plus: a changeset is not needed if the change touches no skill (`scripts/` is repo-level); run `./scripts/check-changeset-packages.sh` if you add one. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this change is in `scripts/` and edits text in place, so it adds no lines.

### Bookkeeping

When the PR is created through `skills/plot/scripts/plot-open-pr.sh`, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `scripts/check-decision-count.sh` and, only if a test asserts the old wording, that test. No other branch is in flight on this file. If you find something the plan did not anticipate, report it rather than improvising outside scope.
