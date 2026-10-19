# Only my work says no identity is configured while the board names one

> The Delivery tab's "Only my work" control reads `no identity configured — nothing to match` while `/api/board` answers `server.hostUser` and `server.gitEmail` non-empty.

## Status

- **State:** Delivered
- **Type:** bug
- **Issue:** #2079
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2081 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/only-my-work-says-no-identity`
- **Delivered:** 2026-10-19

## Changelog

- The Delivery tab's "Only my work" control reads the identity the board names. It shows `no identity configured` only when `server.hostUser` and `server.gitEmail` are both empty.

Board impact: yes. The change is in `packages/board/src/app`; the plan format and helper scripts stay unchanged.

## Motivation

On 2026-10-19 the control showed `no identity configured — nothing to match` while `/api/board` answered `{"hostUser":"jwloka","gitEmail":"jan.wloka@quatico.com","people":{...}}`. The control sets `data-mine-known` from `reader.hostUser` and `reader.gitEmail` (`AgentList.tsx:976`). With `known` false, `rowsForReader` hides nothing, so the operator sees an unfiltered board under a hint that says the filter cannot act.

## Design

### Approach

The call sites read correctly on `main`. `App.tsx` passes `server={board?.server}` to `AgentList` (`App.tsx:1260` region), and `AgentList.tsx:465` derives `reader` with `readerFrom(server)` (`mine-filter.ts:120`), which passes `hostUser` and `gitEmail` through. The cause is therefore not yet known. Candidates, in the order to check:

1. `board.server` reaches `AgentList` without the identity fields: the payload is cast, not parsed, so a stale or partial object type-checks.
2. The page runs a stale bundle against a newer server (see the memory note that the board does not reload its bundle).
3. `readerFrom` receives `server` while `board` is still the first payload, and `reader` never updates because the memo key is the `server` object identity.

The first slice reproduces the symptom in a browser test against a board whose `/api/board` names an identity, and records which candidate holds. The fix follows the finding. Rule placement: whether `known` holds is a view state, so it moves into the domain as a property of the reader (`mine-filter.ts` or the ownership rule) and the component renders it, per *Every rendered state is a domain property*.

### Open Questions

- [x] Which of the three candidates produces the symptom, or is there a fourth? A fourth: none of the three held on reproduction. `App.tsx` casts rather than parses (candidate 1), but the cast carries the fields through intact — no data is lost. No stale bundle was in play (candidate 2). `reader` DOES update once `board` resolves (candidate 3's literal framing — "never updates" — does not hold). The actual cause is a render-timing race: `AgentList` on the Delivery tab is gated on `fleet` alone, never on `board` (`App.tsx` around line 1227), and the fleet poll answers from a cheap server-side cache while the board poll runs a live scan — so landing on or switching to Delivery routinely renders `AgentList` with `server` still `undefined`, which read as "board checked and found nobody" rather than "board hasn't answered yet". Reproduced live with a Playwright `route` delaying `/api/board` by 3000ms: the hint showed, then correctly cleared once the delayed payload landed — confirming the symptom is real, transient, and self-healing. Fixed by gating the hint text specifically on a new `boardAnswered = server !== undefined` signal, alongside `known` (now `readerIsKnown`, a domain property); `data-mine-known` and the filtering logic (`rowsForReader` etc.) are unchanged, since both already treat "board pending" and "board answered empty" alike by design.
- [x] Does `/api/board` ever answer a first payload without `server.hostUser` and a later one with it? Not from the server's own timing — `server-info.ts`'s identity computation is `await`ed inline per request with no stale/partial intermediate state. The gap is client-side: `server` is `undefined` until the board's own fetch resolves at all, regardless of what it will answer.

## Slices

### Reproduce and fix

- `bug/only-my-work-says-no-identity` — a browser test where `/api/board` names `hostUser` or `gitEmail` and the hint is absent; the fix that makes it pass; `known` extracted as a domain property with a unit test → #2090

## Notes

- Source: issue #2079, https://github.com/plot-pm/plot/issues/2079. Nothing is written to the tracker.
- Unattended run: the Design question was not answered in the prompt, so the plan starts in `Draft`. Ceremony answers follow `Plan PRs: required` (`Review: pr`) and the default for a multi-step fix (`Impl: own branches`).
