# The bb pause rule follows bb 1.15.2

> Plot's `bbRetryAfter` counts a `Retry-After` above 86,400 s as 86,400 s, as `bb` 1.15.2 does; the bb-ledger recorder lifts every constant the lifted functions read; and the corpus, re-recorded with `bb` 1.15.2, asserts all 18 comparisons, the UTF-8 account key included.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-25, jwloka, plan-PR #3716 merged
- **Started:** 2026-11-25, Jan Wloka, `bug/the-bb-pause-rule-follows-bb-1-15-2`
- **Delivered:** 2026-11-26
- **Released:** 2026-11-27, v2.37.0

## Changelog

- fleetd writes the same pause as `bb` 1.15.2 after a Bitbucket 429: a `Retry-After` above one day (86,400 s) pauses for one day. Before, fleetd paused for up to 999,999,999 s where `bb` paused for one day.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout change; the board reads `LimitReading` unchanged. -->

## Motivation

`packages/domain/corpus/bb-ledger.corpus.test.ts` holds Plot's ledger rules in `packages/domain/src/rules/bb-ledger.ts` to `bb`'s shell functions. `packages/domain/corpus/record-bb-ledger.mjs` records those functions from the installed `bb` into `packages/domain/corpus/fixtures/bb-ledger/*.json`. The fixtures on `main` are recorded with `bb` 1.15.0 (agent-skills `2c904ab17`), and the recorder refuses any other version (`VERSION = '1.15.0'`, `record-bb-ledger.mjs:38`).

`bb` 1.15.2 is installed now (`/opt/homebrew/bin/bb`, `bb --version`), and is identical to `cli/bb` at agent-skills `83d16f25c`. An uncommitted re-record with 1.15.2 (worktree `bug-the-bb-ledger-corpus-asserts-the-utf8-key`, measured 2026-11-24) passes 17 of 18 corpus tests:

- The UTF-8 account key now agrees: `bb_account_key` pins `LC_ALL=C` (agent-skills#139, `d956b6312`), so `ÜMLAUT@example.com` and `Ärger.Öl@Straße.de` give the C-locale key in both locales.
- "writes the pause and its words after a 429 as bb_pause_after_429 does" fails with 13 mismatches, one `tail` and six `file`+`tail` pairs over the seven cases with a digit `Retry-After`. Examples: `null|900 :: file :: rule="1788001023 900\n" shell="1788000423 300\n"`; `"1787996524 300\n"|700 :: file :: rule="1788000823 700\n" shell="1788000723 600\n"`; the shell's tail lacks `Bitbucket asked to wait <n> s; `.

## Design

### Approach

- **The 13 mismatches are a recorder defect, not a rule change and not a `bb` defect.** Traced 2026-11-24: `bb_pause_after_429` 1.15.2 clamps with `[[ "${#ra}" -gt 9 || "$ra" -gt "$BB_RETRY_AFTER_MAX" ]] && ra="$BB_RETRY_AFTER_MAX"`. The recorder's `constants()` lifts only `BB_BUDGET_DEFAULT`, `BB_BUDGET_WINDOW` and `BB_PAUSE_SKEW`, so `BB_RETRY_AFTER_MAX` is unset in the lifted shell. `[[ 900 -gt "" ]]` compares against 0 and succeeds, `ra` becomes empty, and the function then takes the no-`Retry-After` path: 300 s for `null|900`, the doubled 600 s for `1787996524 300|700`, and no "asked to wait" words. The real `bb` defines the constant at `cli/bb:228` and answers 900.
- **One rule change since 1.15.0 reaches the pause.** Diffed `bb_pause_after_429` and `bb_pause_write` between `2c904ab17` (1.15.0) and `83d16f25c` (1.15.2): `bb_pause_write` is unchanged, and `bb_pause_after_429` changes only the clamp, `b6c8e4b29` (2026-11-21, `BB_RETRY_AFTER_MAX=86400`). The commits `9cd41c87b`, `158957e10`, `b9c8cc21b`, `2dcf44658` and `19b673f18` are dated 2026-11-20 and precede `2c904ab17`, so 1.15.0 holds them and `bbPauseAfter429`, `bbPauseMerge` and `BB_PAUSE_SKEW_S` already port them.
- **Lifted with the constant, 1.15.2 agrees with the rule on 14 of 15 cases.** The one difference is `null|1234567890`: `bb` writes `1788086523 86400`, and `bbRetryAfter` gives 999,999,999 s.
- **The rule port.** Add `BB_RETRY_AFTER_MAX_S = 86400` to `bb-ledger.ts`; `bbRetryAfter` answers it for more than 9 digits (leading zeros not counted) and for any value above it. Update the doc header to `cli/bb` 1.15.2 (agent-skills `83d16f25c`). `bbPauseTail` keeps printing the raw header, as `bb` does.
- **The recorder fix.** `constants()` lifts `BB_RETRY_AFTER_MAX` too, and refuses to record when a lifted function names a `BB_[A-Z_]+` constant that the prelude does not define and that is not a per-process or environment variable on a named list. This turns the next unlifted constant into a refusal instead of a silent recording.
- **The corpus.** Raise the recorder's version gate and the test's `VERSION` to 1.15.2, re-record, replace the declared UTF-8 divergence with a whole assertion in both locales, and assert that at least one recorded 429 case carries `asked to wait`, so the pause comparison cannot pass over a lifted shell that ignores `Retry-After`.
- **One slice.** The rule change cannot be compared without the re-recorded corpus, and the re-recorded corpus fails without the rule change. Two slices would leave the corpus red or the rule untested between them. Adjusting either side to make the comparison pass is forbidden ("A Shell Script Asks The Domain"); here the recorder carries the defect, and the rule follows `bb`'s recorded behaviour.

### Open Questions

- [ ] `[question-bb-defect]` If a trace shows a `bb` defect rather than a rule, what does the plan do? Recommended: stop that part, file it in quatico-solutions/agent-skills, and port only the rest. The trace of 2026-11-24 found no `bb` defect: the 300 s comes from the recorder.
- [ ] `[question-later-bb-releases]` How does Plot stay in step with later `bb` releases? Recommended: the recorder refuses an unrecorded `bb` version, as it does today, and the corpus test's header names the recorded version, so a new `bb` release needs a person to re-record and read the diff.

## Slices

### Port

- `bug/the-bb-pause-rule-follows-bb-1-15-2` — `bbRetryAfter` clamps at `BB_RETRY_AFTER_MAX_S` 86400, the recorder lifts `BB_RETRY_AFTER_MAX` and refuses an undefined lifted constant, its version gate names 1.15.2, and the corpus is re-recorded with `bb` 1.15.2 and asserts the UTF-8 key whole <!-- builds: BB_RETRY_AFTER_MAX_S and the recorder's constant check --> <!-- tests: bb-ledger.corpus.test.ts passes 18 of 18 over fixtures whose bb field starts with "bb 1.15.2 "; the null|1234567890 case reads file "1788086523 86400\n"; at least one pauseAfter429 tail carries "asked to wait"; a bb-ledger unit test gives bbRetryAfter("86401") = 86400 and bbRetryAfter("00429") = 429 --> → #3722

## Notes

Created on 2026-11-24 after the bb-ledger corpus, re-recorded with bb 1.15.2, disagreed on the 429 pause; the operator asked for this plan.
