# Board files rows in the wrong section: claimed slice under NOT STARTED, abandoned branches under WAITING ON YOU

> One function maps a row's state to both its section and its label, so a label cannot contradict the section it sits in.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #3096
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board lists a claimed slice in WORKING, or in a visible "claimed, nobody watching" state, and never under NOT STARTED.
- The board lists a branch labelled `abandoned` under QUIET, and never under WAITING ON YOU.

<!-- Board impact: changes the board's section assignment (packages/board/src/app/lib/agent-rows/sections.ts, tuple-row.ts). No change to the plan format, template or helper scripts. Rebuild the board artifact with pnpm build:board to test; do not commit it. -->

## Motivation

Measured 2026-11-03 on Plot 2.30.0 (marketplace checkout `820a708`), the board files two kinds of row in the wrong section.

1. **A claimed slice under NOT STARTED.** `feature/mat-spiel-durchstich` is claimed on `origin` (empty claim commit) and a hand-started worker runs in its worktree, because the registry does not hand out a Design plan's spike (#3092). The row reads `someone is on it` under NOT STARTED, while WORKING reads `0 manifests, 6 synthesized` and lists nothing. The label comes from the startability verdict (`someone-is-on-it`, which reads the claim). The section comes from a second reading that asks only whether an agent manifest names the branch. A claimed branch with no manifest gets `not-started` plus `someone is on it`. It also reads as unstarted work that auto-dispatch might pick up.
2. **Abandoned branches under WAITING ON YOU.** Three branches (`feature/success-story-ewz-leg`, 291 days; `feature/aeo-retest-2026-06-28` and `feature/seo-quick-wins-2026-06-28`, 128 days) carry the label `abandoned` and `"state": "wip"`, `"group": "waiting-on-you"` in `/api/fleet`. WAITING ON YOU is the operator's action list. Three stale branches at its top push down the rows that need a decision today (plans in Design, open tickets), and they stay for months. The cleanup decision stays available from the row's menu and from `/plot-reconcile` section 19, which already reports them as "a person decides".

Both defects have one cause: a row's section and its label come from two enums (`waiting-on-you`, `working`, `waiting-on-machine`, `quiet`, `not-started`, `done` against `start-work`, `needs-brief`, `waiting-on-approval`, `someone-is-on-it`) read from two places, and nothing ties them together.

## Design

### Approach

- **One mapping.** A single domain function maps a row's reading (claim, manifest, process, PR, quiet kind) to a `{ section, label }` pair. The board components read both from that pair. Per `CLAUDE.md`, "every rendered state is a domain property", so the function lives in `packages/domain` as an arrow function and a unit test asserts it.
- **Invariant test.** Every startability label maps to the allowed sections only: `someone-is-on-it` never to `not-started`, and `abandoned` never to `waiting-on-you`.
- **Claimed without a manifest.** A claimed branch with no manifest or live process confirming a worker gets its own visible state in WORKING (working title: "claimed, nobody watching"). A hand-started worker then shows as work in progress, and a dead claim stays distinguishable from a live one.
- **Abandoned goes to QUIET.** The quiet rule already returns `abandoned` for a branch with commits and no PR (`packages/domain/src/rules/quiet.ts:149`). The section assignment honours it.

### Open Questions

- [ ] Wording and icon of the "claimed, nobody watching" state, and whether it counts in WORKING's header number.
- [ ] Does the server-side `group` field (`/api/fleet`) change, or only the client's section assignment? `sections.ts` already notes a slice with two possible sections.
- [ ] Where a plan row with one claimed slice files: NOT STARTED counts plans, so the plan row may need the same rule.
- [ ] Does the `abandoned` verdict at `packages/board/src/server/attention.ts:236` (dead worker, "restart it") stay in the action list? It names a different case (a failed worker) and likely stays.

## Slices

### Single mapping

- `feature/board-files-rows-in-the-wrong` — derive section and label from one domain function, move claimed-without-manifest rows to WORKING with their own state, move `abandoned` rows to QUIET, and add the label-to-section invariant test

## Notes

- Created from tracker issue #3096. The issue's suggested fix is the starting design; the first slice's author confirms the open questions above.
- Related: #3092 (the registry hands out no Design-plan spike, which caused the hand start in case 1).
