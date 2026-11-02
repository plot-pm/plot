# A slice held by an open wait reads as eligible

> A slice whose every branch is held by an open `waits:` annotation reads `eligible` on the board and offers a dispatch; the dispatch then starts a brief run that cannot succeed.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3049
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- A slice whose every branch waits on an unmerged branch reads as waiting on the board, names the branch it waits for, and offers no dispatch. The dispatch controller refuses a plan with no startable branch before it starts a brief run.

<!-- Board impact: yes. The row status, the row note, the section and the dispatch menu in packages/board change; the plan format, template and helper scripts do not. Rebuild the board artifact if the plan contract changes. -->

## Motivation

On 2026-11-02 the board showed the Fleet index slice of `every-plan-reference-shows-its-issue` (#2993, #3040) as `eligible`, with the note *approved — nobody has taken it*, in the *Not started* section. The slice cannot start: its branch `feature/the-fleet-payload-indexes-its-plans` carries `<!-- waits: feature/the-panels-name-a-plan-one-way, feature/the-scan-script-is-a-launcher, bug/an-issue-reads-its-plan-from-main -->`, and `feature/the-scan-script-is-a-launcher` (plan `the-plan-walk-moves-into-the`, #2980) has not merged.

The pulse holds both answers (`.plot/state/last-pulse.json`): the slice reads `"verdict":"eligible"` and its one branch reads `"state":"waiting"` with `waits_on` naming the three branches. `/api/fleet` reports the branch correctly. The wrong word comes from the slice verdict alone:

- `sliceVerdict` in `packages/domain/src/rules/eligible.ts` answers the slice ordering only. The `waits:` annotation is a separate fact, combined in `isClaimable` (`verdict === 'eligible' && state === 'open' && held === ''`).
- The row status and note read the slice verdict alone: `packages/board/src/app/lib/agent-rows/rows.tsx:1163` (`group.verdict === 'eligible' ? 'approved — nobody has taken it'`) and `sections.ts:108`.
- The dispatch menu gates on the same field (`rows.tsx:937`, `rows.tsx:1469`), so the row offers a dispatch for a branch whose wait is open.

Cost, measured 2026-11-02: `plot-dispatch-command.mjs every-plan-reference-shows-its-issue` started the brief writer three times. Two runs ended at `IMPLEMENT_TIMEOUT_MS` (5 min, `packages/fleet/src/shared/implement-run.ts:126`) with exit 124 and the row read *brief failed*. The third run read the plan, found the unmerged wait and wrote no brief. Machine load was about 4 throughout.

## Design

### Approach

1. **A domain property decides the word.** The domain gains a slice-level reading that combines the slice verdict with each branch's `held` value. A slice with the verdict `eligible`, where every non-deferred branch is `held` by `waiting` or `blocked`, reads as waiting and names the branches it waits for. A unit test asserts it with no browser (*Every rendered state is a domain property*).
2. **The board reads that property.** `rows.tsx` (status, note, dispatch gate) and `sections.ts` read the new property instead of `group.verdict` alone. The row moves out of *Not started* and offers no dispatch.
3. **The dispatch controller refuses.** `plot-dispatch-command.mjs` and the `dispatch` endpoint refuse a plan whose eligible slices hold no startable branch (`isClaimable` false for every branch), naming each branch and its unmerged prerequisite, before the brief run starts.

The two surfaces call one rule, so the board and the controller cannot disagree.

### Open Questions

- [ ] Does a slice with one held branch and one open branch read `eligible` (some branch startable) or a mixed state? The issue names only the all-held case.
- [ ] Does the scan (`plot-fleet-scan.sh`) emit the slice `verdict` as `waiting`, or does the domain derive the new reading from the verdict plus `waits_on` at the consumer? The pulse is read by `plot-dispatch-command.mjs`, so a changed pulse field is a contract change.
- [ ] `blocked` and `waiting` are both `held` values today. Does the board word them differently at slice level?

## Slices

### Slice reading

- `feature/a-held-slice-reads-as-waiting` — the domain reading for an eligible slice with no startable branch, and the board row status, note, section and dispatch menu reading it <!-- builds: sliceStartable, a slice-level reading of verdict plus held -->

### Dispatch refusal

- `feature/dispatch-refuses-a-plan-with-nothing-startable` — the dispatch controller refuses before the brief run, naming each held branch and its prerequisite <!-- waits: feature/a-held-slice-reads-as-waiting -->

## Notes

- Related, delivered: `a-slice-waits-on-every-branch-it-names` (#1153) made the parser keep every `waits:` entry; `a-blocked-wave-is-not-eligible` made a blocked wave read blocked. Neither covers the slice verdict reading `eligible` over a branch held by an open wait.
- Refs #2993, #2980.
