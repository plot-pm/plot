# Release gate labels Must Haves by the wrong key and leaves Should and Could labels empty

> The release gate names unfinished sprint items by the first key-shaped token in their text, and prints an empty label for open Should and Could items.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2324
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2327 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/release-gate-labels-must-haves-by`
- **Delivered:** 2026-10-22
- **Released:** 2026-10-22, v2.28.0

## Changelog

- The release gate labels every unfinished sprint item, in every tier, with the ticket key from the sprint's `Ticket prefixes`.

<!-- Board impact: none. The change is inside the domain package's release workflow; no plan format, template, helper script or docs/plans layout changes. -->

## Motivation

`plot-release-gate.sh` on ewz-kus-portal (field test round 7, main `da789acff`) names four unfinished Must Haves `[AP-0]`, `[AP-1]`, `[AP-2]`, `[AP-2]` instead of `[EWZKUS-3859]` … `[EWZKUS-3862]`. `openShoulds` and `openCoulds` come back as `["","",""]`. The refusal itself is correct; only the names are wrong, so the operator cannot tell which items block the release.

Two defects cause it:

- `packages/domain/src/workflows/release.ts:47` declares `JIRA_KEY = /[A-Z][A-Z0-9]+-[0-9]+/`. `itemLabel` takes the first key-shaped token in the item text, so a token such as `AP-2a` wins over the ticket key. `rules/sprint-release.ts:105` scopes the same match to `Ticket prefixes` and labels the same items correctly, so two rules answer one question differently.
- `release.ts:339-340` maps `openShoulds` and `openCoulds` through `i.plan`, not `itemLabel`. A plan-less item has `plan === ''`, so its label is empty.

## Design

### Approach

One key rule, scoped to `Ticket prefixes`, labels every tier.

- `itemLabel` takes the declared ticket prefixes and matches `\b(<prefixes>)-[0-9]+\b` as `rules/sprint-release.ts` does. It reuses that rule's key extraction instead of keeping a second regex in `release.ts`.
- `openShoulds` and `openCoulds` map through `itemLabel`, as `openMusts` does at `release.ts:314`.
- The release workflow input carries the `Ticket prefixes` value. The caller that builds the input reads the config key; the workflow stays a function of its input.
- Behaviour with no `Ticket prefixes` declared: the label falls back to `[<text>]`, then `[unnamed item]`, as today.
- Shell and domain duplicate no rule here, so no corpus test is needed. A unit test fixes the agreement between `itemLabel` and the sprint-release extraction on the ewz-kus-portal item texts.

### Open Questions

- [ ] Does `itemLabel` receive the prefixes as a parameter or through the workflow input? Both keep the domain pure; the second changes the input type for every caller.
- [ ] Should the label prefer an `Issue:` line key or a `Ticket` frontmatter value, as the sprint-release rule does, before it scans the text?

## Slices

### Release gate labels

- `bug/release-gate-labels-must-haves-by` — scope `itemLabel` to `Ticket prefixes` and label Should and Could items through it, with unit tests for `AP-2a` text and plan-less Should and Could items → #2341

## Notes

- Source: tracker issue #2324, found by the read-only ewz field test, round 7.
