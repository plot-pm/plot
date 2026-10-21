# Release gate names an unfinished Must Have with no plan as []

> The release gate's `must-haves-open` refusal names a Must Have that carries no plan by its Jira key, else by its item text, instead of `[]`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2281
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The release gate names an unfinished Must Have that has no plan by its Jira key, else by its item text, where it printed `[]`.

<!-- Board impact: none. The plan format, template, helper scripts and docs/plans layout are unchanged. -->

## Motivation

On ewz-kus-portal, `plot-release-gate.sh` refuses with `must-haves-open — 6 unfinished Must Have(s): [] — not delivered (sprint kafka-gp-sync); [] — …`, six times. The six Musts name no plan and carry a Jira key in the item text. This is the first message an operator sees from `/plot-release` on a Jira project, and it names nothing. Found by the read-only ewz field test, round 6, on main `b33d3ee22`.

## Design

### Approach

`plot-sprint-release.sh` already emits `slug` and `text` for every item (`slug` is `""` for a lightweight task), and `ticket` for an item whose plan resolves. `packages/board/src/server/entry/release-gate.ts` (`tierFrom`) keeps only `slug`, as `ReleaseSprintItem.plan`. `packages/domain/src/workflows/release.ts` (the `openMusts` message) formats each item as `[${i.plan}]`, so an empty `plan` prints `[]`.

The fix carries a label for the item from the wire into the domain and prints it. The label is the Jira key when the item has one, else the item text.

- Add a field to `ReleaseSprintItem` for the item's name where `plan` is empty. The domain owns the choice of label, so the rule is unit-testable without a board.
- `tierFrom` reads `text` from the collector's item and passes it on. It does not decide the label.
- The Jira key comes from the item text, which holds it for a plan-less item (the collector's `ticket` is read only for slugged items). The domain extracts the first Jira-shaped key (`[A-Z][A-Z0-9]+-\d+`) from the text. If the tracker config names a project key, the key shape should follow it.
- An item with a plan keeps `[<plan>]`.

### Open Questions

- [ ] Does the label for a Jira-keyed item show the key alone, or the key and the item text?
- [ ] Should the collector emit the key as its own field instead of the domain parsing it from the text?
- [ ] The issue cites `release-gate.ts:113` and `release.ts:195`. Confirm no other message (`disputed` items, the override note) formats `plan` the same way.

## Slices

### Gate label

- `bug/release-gate-names-an-unfinished-must` — name a plan-less unfinished Must Have by Jira key, else item text, in the `must-haves-open` message, with a domain unit test and a `release-gate.ts` wire test

## Notes

- Created from tracker issue #2281.
