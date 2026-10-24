# The shell-lines gate counts a joined line as a removed line

> `scripts/check-shell-lines.sh` counts physical lines, so joining two statements onto one line passes the gate without paying for the growth.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2622
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2623 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/the-shell-lines-gate-counts-a`

## Changelog

- The shell-lines gate measures shell size in a unit that joining statements does not reduce, and its refusal names joining as not a payment.

<!-- Board impact: none. The change touches scripts/check-shell-lines.sh, its test and the text that tells a desk how to pay; it does not touch the plan format, the template, skills/plot/scripts/ or the docs/plans layout. -->

## Motivation

`scripts/check-shell-lines.sh` counts the non-comment, non-blank physical lines of every `.sh` file under `skills/`. A change that joins two statements with `;` or `&&`, or folds a `fi` or `done` onto the line before, lowers the count without lowering the shell.

Observed 2026-10-24, three fleet desks met the gate this way after their correction budget ran low:

- #2468 (`bug/recording-a-slice-pr-number-writes`): about 15 commits such as "join the two argument-capture lines" and "fold the metas accumulator onto one line" in `plot-record-pr.sh`, `plot-open-pr.sh` and `plot-desk-root.sh`.
- #2591 (`feature/tracker-issue-status-no-target-hides`): 5669e01ea and ddf63c701 folded the issue-status jq read and error path onto one physical line each.
- #2617 (`bug/bitbucket-checks-lookups-bounded`): 192e63932 and e2a878c7d folded `fi` onto the previous line and put `readonly …; _BB_JEN_BOUND=0` on one line.

In each case a fix agent replaced the joined lines with an honest payment: logic moved into the domain, or dead shell removed. The gate accepted the joins; a reviewer or a later correction caught them.

## Design

### Approach

Change the unit of the count so that joining does not reduce it, or refuse the join. Two candidates:

1. **Count commands, not lines.** Split each non-comment line on unquoted `;`, `&&`, `||` and a trailing `fi`/`done`/`esac` and count the pieces. A shell parser is the exact tool; a `grep`-level splitter miscounts quoted separators, heredocs and `case` arms.
2. **Refuse a joined line.** Compare the change's added lines with its removed lines and fail when an added line holds more separators than the removed lines it replaces.

The gate stores no number and has no override (`check-shell-lines.sh` header); the chosen unit keeps both properties. The count in `count_rev` and the `--per-file` report must use the same definition, because `skills/plot-implement/` and `docs/shell-and-domain.md` quote it.

The refusal text in `report()` and the places that tell a desk how to pay for growth (`skills/plot-implement/SKILL.md`, the worker brief and correction template) name joining as not a payment.

### Open Questions

- [ ] Which unit: commands (option 1) or a refusal of joined lines (option 2)? Option 1 changes the baseline for every file once, so a change that is neutral today could read as growth or shrinkage across the switch. Measure `check-shell-lines.sh pr` on the last 20 merged shell changes under both definitions before choosing.
- [ ] Does the count need a shell tokenizer, or does a conservative splitter that over-counts on ambiguous lines suffice? An over-count refuses honest changes; an under-count keeps the hole.
- [ ] Where does the correction template that tells a desk how to pay live, and does it quote the gate's refusal or restate it?

## Slices

### Count

- `bug/the-shell-lines-gate-counts-a` — change the unit in `scripts/check-shell-lines.sh` (`count_rev`, `--per-file`) so joining does not lower it; update `test/reconcile/shell-lines.test.mjs` with a joined-line case that fails before the change and passes after, and update the refusal text and the desk-facing instructions to name joining as not a payment <!-- builds: a joining-proof size unit in check-shell-lines.sh -->

## Notes

Source: tracker issue #2622, observed 2026-10-24. The plan stops at Draft.
