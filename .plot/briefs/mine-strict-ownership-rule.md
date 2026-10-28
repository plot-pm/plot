## Implementation brief — mine-hides-rows-with-no-known (wave 1: Strict ownership rule)

- **Plan (canonical):** docs/plans/2026-10-28-mine-hides-rows-with-no-known.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2812 merged
- **Branch:** `feature/mine-strict-ownership-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Wave 1 of 4. Waves 3 (`feature/mine-mode-control`) and 4 (`feature/is-mine-removed`) wait on this branch. `feature/waiting-hidden-split` touches `waiting-tickets.ts` only and is independent.

### What to build

«Mine» keeps every row whose owner the board cannot determine, because `isMine` answers true for `mine` and `unknown` (`packages/domain/src/rules/ownership.ts:288`) and no count says how many such rows exist. This slice adds the domain half of a stricter mode. It changes no component and no filter site.

1. A strict ownership answer beside `isMine`: true only where `ownership(row, reader) === 'mine'`.
2. One effective «Mine» mode, computed from the reader and the two stored strings: `all` when «Mine» is off or `comparableLogin(reader)` is `''` (the chip's own test, `chip-row.ts:163`); `mine-and-unknown` when «Mine» is on and the strict mode is off (today's view); `mine` when both are on. Add the reader of the stored keys: the existing `plot-board:agents:mine-only` (`1` = «Mine» on, unknown rows shown, meaning unchanged) and a NEW key for the strict mode, where an absent key reads as off.
3. `agentOwnership` (`ownership.ts:247-250`) answers `mine` for a synthesized desk whose state shows it is on this machine, as it does for a manifest agent today. A state in `NO_DESK_HERE` (`elsewhere`, `unknown`) or a missing state stays `unknown`.

Put the pure logic in `packages/domain`, as arrow functions (`export const f = (…) => …`), with factual TSDoc and no decision history in comments.

### Settled decisions — do not re-derive them

- **The gate is `comparableLogin`, not `readerIsKnown`.** `readerIsKnown` answers true for a reader with only a git email (`ownership.ts:301-302`), has no production caller, and every ownership arm compares `comparableLogin` (`:104,120,154,184`). Gating on it would let a disabled chip sit beside a filter that empties the board.
- **Filters must read the effective mode, never the raw flag.** Today five sites read the stored `mineOnly` directly (`AgentList.tsx:499,726,758,1085`, `App.tsx:1481`) while a disabled chip reports `on: false` (`chip-row.ts:165`). Moving those sites is slice 3, not this one.
- **`isMine` and its tests stay unchanged here.** Slice 4 removes `isMine` once slice 3 has moved its six call sites. Do not rewrite the 37 unit tests that pin the lenient view (list in the plan's Contract Change); they keep their meaning as the `mine-and-unknown` mode.
- **The stored key keeps its meaning.** A reader who never touches the new control sees today's view exactly.
- **Absent is not false.** A missing, unparseable or other-valued key reads as off, never as an error.

### Done when

The plan's slice line is the specification: strict answer beside `isMine`, effective mode with its stored-key reader, synthesized desk here answers `mine`; `isMine` and its tests unchanged; `ownership.test.ts:107` changes deliberately (the synthesized-desk case).

Assertions a naive implementation would pass without:
- Effective mode is `all` for «Mine» on with `comparableLogin(reader) === ''`, including a reader with only a git email. A `readerIsKnown` gate fails this.
- Strict mode stored on while «Mine» is off yields `all`, not `mine`.
- An `elsewhere` agent stays `unknown` and a synthesized desk with state `running` answers `mine`. Without both, the desk change hides or shows the wrong agents.
- The git `git diff` on `isMine` and its existing tests is empty.

Plus: a changeset (description first, `bumps:` block last; skill/package names must be real); no bundle diff. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the CI suites run in CI. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns `packages/domain/src/rules/ownership.ts`, a new rule file for the mode if one is needed, and `packages/domain/test/ownership.test.ts` plus new domain tests. Does not touch `packages/board/**`, `chip-row.ts`, `lanes-for-reader.ts` or `waiting-tickets.ts`. In flight elsewhere: `feature/waiting-hidden-split` (`waiting-tickets.ts`), and `bug/draft-rows-obey-mine` in `2026-10-28-empty-jira-inbox-read-as-a` adds a seventh `isMine` caller, which slice 3 moves if it lands first. Issue #2819 (`[other, me]` multi-assignee answers `theirs`) is open and must ship before slice 3 exposes the `mine` mode; it does not block this domain-only slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
