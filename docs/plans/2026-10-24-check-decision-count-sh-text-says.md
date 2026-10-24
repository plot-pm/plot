# check-decision-count.sh text says readings and paired rows are uncounted

> The gate's header and refusal name `readings` and `paired` as uncounted kinds, while `counted()` counts every row that is not `launcher`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2565
- **Review:** pr
- **Impl:** own branches

## Changelog

- `scripts/check-decision-count.sh` states the current counting rule in its header and its refusal: every row whose Kind is not `launcher` counts, and only a conversion to `launcher` lowers the count.

Board impact: none. The change edits comment and message text in a CI gate and touches no plan format, template, helper-script contract or `docs/plans` layout.

## Motivation

`counted()` (`scripts/check-decision-count.sh:171`) counts every README script row whose Kind is not `launcher`. #1416 set that rule on 2026-10-09. The script text still describes the earlier rule, under which `readings` and `paired` rows were not counted:

- The header (lines 17-18) calls `launcher`, `readings` and `paired` "the three uncounted kinds".
- The refusal (line 198) says "or convert a row of the same count to launcher, readings or paired with its evidence". A conversion to `readings` or `paired` lowers nothing.

Measured 2026-10-24: the desk for PR #2468 added a `readings` row with its bundle evidence, and the gate refused it as +1 (48 rows against 47). The desk read the header, concluded the gate was wrong, and stopped with a PLOT-BLOCKED marker that asked for an override. The gate was right and the text misled the reader.

## Design

### Approach

Rewrite two pieces of text. No behaviour changes.

- Header: replace "one of the three uncounted kinds" with wording that names `launcher`, `readings` and `paired` as the kinds that carry an evidence rule, and states that only `launcher` is uncounted. The evidence rule proves the Kind label; it does not exempt the row from the count.
- Refusal at line 198: say that only a conversion to `launcher` lowers the count, and that a `readings` or `paired` row counts like any other.

The refusal text is tested if `test/reconcile/` asserts on it. The slice greps for the old wording in tests and updates any assertion in the same change.

### Open Questions

- [ ] Does any test assert on the old refusal wording?

## Slices

### Gate text

- `bug/check-decision-count-sh-text-says` — correct the header and the refusal text in `scripts/check-decision-count.sh`

## Notes

- Source: tracker issue #2565, planned by `/plot-idea`.
