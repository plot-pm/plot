# Deliver flips the Status block but not front matter again

> `plot-deliver.sh` reports `phase=flipped` on a plan that carries both front matter and a `## Status` block, and the front matter still says `Approved` afterwards — the half-landed delivery #924 described.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2439
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2492 merged

## Changelog

- `/plot-deliver` no longer reports `phase=flipped` for a plan whose front matter still names an earlier phase. It either moves the front matter fields too or refuses before it writes.

<!-- Board impact: none expected. The plan format and the board's parser are not changed; only the writer's behaviour on a plan carrying both formats. Confirm during design. -->

## Motivation

Issue #2439 reports, from plot 2.28.0, three plans in an adopting repo that carry YAML front matter (`status: Approved`, `phase: Approved`) and a `## Status` block. `plot-deliver.sh <slug>` printed `phase=flipped record=written index=moved sprint=updated push=clean`. Afterwards only the `## Status` block read Delivered. The delivery-landed gate in the reconcile scan then reported, for each plan, `status: 'Delivered' disagrees with phase: 'Approved' (phase is machine-read)`. The reporter fixed the three files by hand.

This is the shape of #924, closed by `a-plan-has-one-phase` (2026-09-16, released in 2.18.0), whose commit `b147e6a6b` made the delivery verify its write by re-reading the plan through the parser. #944 (`fef2cf296`) later changed the parser to read the `## Status` block ahead of front matter. The scan check at `skills/plot/scripts/plot-reconcile-scan.sh:1011` still compares the two, so a plan the writer left half-flipped is still named.

## Design

### Approach

Reproduce first, on the reporter's shape: a plan with front matter `status: Approved` and `phase: Approved` plus a `## Status` block of `Approved`, delivered through the current `plot-deliver` entry point. Record which of three things happens: the Status block flips and the front matter stays (the report), the delivery refuses (the #924 fix working), or the verification passes because the parser now reads the block first (#944) and so cannot see the disagreement.

The third case is the likely regression. After #944 the parser answers from the block, so #924's read-back proves nothing about the front matter the reconcile scan still reads. The fix then has to name the front matter fields the scan reads (`status`, `phase`) rather than ask the parser.

Choose between the two outcomes the issue names:

1. **Flip both.** The delivery also writes the front matter `status` and `phase` fields, where present, to the same value as the block.
2. **Refuse up front.** The delivery refuses a plan whose front matter and block name different phases, or that carries both formats at all, and names the field to fix.

Option 1 repairs the plan without a person. Option 2 is smaller and keeps the write in one place. The same decision applies to `plot-approve` and `plot-undeliver`, which #924 recorded as writing the block under the same guard; the slice must read all three so the fix does not recur on the next transition.

The acceptance test is what the scan reports after a delivery, never whether a line changed. A fixture with both formats is delivered, and the reconcile scan reports no disagreement afterwards.

### Open Questions

- [ ] Does the bug reproduce on current `main`, or only on the 2.28.0 plugin the reporter ran?
- [ ] Flip both fields, or refuse? The issue accepts either.
- [ ] Do `plot-approve` and `plot-undeliver` show the same disagreement on a plan with both formats?
- [ ] Which side owns the front matter's meaning: the adopting repo's documented extension, or Plot's parser contract?

## Slices

### Delivery writes both formats

- `bug/deliver-flips-the-status-block-but` — reproduce on the reporter's fixture, then make `plot-deliver` leave front matter and `## Status` block in agreement or refuse, with a test that asserts the reconcile scan's answer after the delivery.

## Notes

- Source: https://github.com/plot-pm/plot/issues/2439, a regression report of #924.
- Prior art: `docs/plans/2026-09-16-a-plan-has-one-phase.md`, commits `b147e6a6b` and `fef2cf296`.
