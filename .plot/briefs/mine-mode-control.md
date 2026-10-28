## Implementation brief — mine-hides-rows-with-no-known (wave 3: Mine mode control)

- **Plan (canonical):** docs/plans/2026-10-28-mine-hides-rows-with-no-known.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2812 merged
- **Branch:** `feature/mine-mode-control` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate, required since 2026-10-15)

This branch is wave 3 of 4. It needs wave 1 (`feature/mine-strict-ownership-rule`, PR #2823) and is needed by wave 4 (`feature/is-mine-removed`). Both waves 1 and 2 are merged into `main` already — this brief was written straight from `main`, so nothing here is stale relative to them.

### What to build

Today `isMine` (`packages/domain/src/rules/ownership.ts:287`) treats `unknown`-owner rows as visible, and every «Mine»-filter call site reads the raw stored flag `mineOnly` directly. Wave 1 already landed the fix's ingredients — `isMineStrict`, `ownership`, and the effective-mode function `mineMode` (`packages/domain/src/rules/mine-mode.ts:40`), which takes a `Reader` and a `MineModeStorage` (`{ mineOnly, strict }`, both raw stored strings) and returns `'all' | 'mine-and-unknown' | 'mine'`. Wave 2 landed `waitingTickets`'s `unassigned`/`assignedToOthers` split. Neither wave touched the board package or any `isMine` call site — that is entirely this wave's work.

This wave does three things:

1. **Move every call site from the raw flag to `mineMode`.** Six sites read `isMine` or the raw `mineOnly` boolean directly and must read the effective mode instead:
   - `packages/board/src/app/lib/agent-rows/mine-filter.ts:159` (`rowsForReader`)
   - `packages/board/src/app/lib/agent-rows/mine-filter.ts:173` (`agentsForReader`)
   - `packages/board/src/app/lib/agent-rows/mine-filter.ts:207` (`ticketsForReader`)
   - `packages/board/src/app/lib/agent-rows/mine-filter.ts:222` (`boardForReader`)
   - `packages/domain/src/rules/lanes-for-reader.ts:67` (`filterByReader`, used by `lanesForReader`)
   - `packages/domain/src/rules/chip-row.ts:168` (`mineChip`'s `hiddenCount`)

   Every raw-flag *reader* moves too, not just these six filters: `AgentList.tsx:422,499,726,742,758,1085` and `App.tsx:280,281,284,1310,1481,1494` currently thread `mineOnly: boolean` through `useState(readMineOnly())`. That boolean becomes the input to `mineMode`, alongside a second stored string for the new strict key, and the filters above take the resulting `MineMode` instead of a boolean `on`.

2. **Add the storage key and its reader/writer for the strict mode**, parallel to `readMineOnly`/`writeMineOnly` (`mine-filter.ts:17,44,56,64`) — same `localStorage` namespace, same silent-failure discipline (`readMineOnly`'s try/catch, defaulting to off on any failure), same `'1'`-is-on convention. The plan does not fix this key's name; pick one that reads as the strict-mode sibling of `plot-board:agents:mine-only` (e.g. `plot-board:agents:mine-strict`) and keep it next to `MINE_KEY`.

3. **Build the hide/show-unknown control and wire its counts.** On the Delivery chip row, `mineChip` (`chip-row.ts:154`) needs its `hiddenCount` and label widened: in `mine-and-unknown` mode, `hiddenCount` is unchanged (rows answering `theirs`); in `mine` mode, it additionally counts `unknown` rows, so the number always names everything the filter currently hides. `MineChipReadings` (chip-row.ts) widens to carry the registry agents too — today it filters only `visibleRows`; the unknown count must cover branch/PR rows *and* registry agents (not tickets — *Waiting on you* counts its own hidden tickets via wave 2's split). The control itself renders beside the chip only while the mode is `mine-and-unknown` or `mine` and the unknown count is above 0, and toggles the strict key.

   Planning and Discovery have no chip row; they share one «Only my work» header checkbox (`App.tsx:1305-1316`) reading the same `mineOnly` key. The same control renders beside that checkbox, fed from `boardForReader`'s hidden-card count (Planning) and `lanesForReader`'s `hiddenByOwner` counts (Discovery, `lanes-for-reader.ts:23`). The checkbox itself gets the chip's disabled treatment (`mineDisabledReason`, `chip-row.ts:136`) when `comparableLogin(reader) === ''` — see the decision below on why that gate, not `readerIsKnown`.

### Decisions the plan settles — do not re-derive them

**The gate is `comparableLogin`, not `readerIsKnown`.** `readerIsKnown` (`ownership.ts`) answers true for a reader with only a git email and has no production caller; every ownership arm already compares `comparableLogin`. `mineMode` (already landed) encodes this: `comparableLogin(reader) === ''` forces `'all'` regardless of either stored key. Do not add a second identity check in the board layer — the domain function is already the single source of this gate, and a disabled chip must never sit beside a filter that empties the board (the chip's `disabledReason` and the mode's `'all'` answer must agree, which they do only if both read `comparableLogin`).

**Stored state: the existing key's meaning does not change.** `plot-board:agents:mine-only` (`'1'` = on, anything else = off) still means "«Mine» on, unknown rows shown" — today's default view. The new key is additive: absent reads as off, so a reader who never touches the new control sees exactly today's behaviour. Do not repurpose or rename the existing key.

**The control reuses `N hidden`; it adds no second count.** The chip's existing `N hidden` already counts `theirs` rows. In `mine` mode that same number grows to include `unknown` rows — there is no separate "N others" figure. This was an explicit panel decision (plan Decisions, 2026-10-28): a second count was considered and rejected as redundant.

**Tickets are out of the unknown count.** *Waiting on you* already counts its own hidden tickets (wave 2's `unassigned`/`assignedToOthers` on `waitingTickets`, `waiting-tickets.ts:33,35`). The chip/control's unknown count covers only branch/PR rows and registry agents, so the two counts never double-book the same ticket.

**Agents: a desk on this machine answers `mine`, not `unknown`.** Wave 1 already changed `agentOwnership` (`ownership.ts:247-250`) so a synthesized or manifest agent with a desk on this machine answers `mine` — the board's machine is the reader's machine. Only `elsewhere` or no-state agents stay `unknown` (and so hide under strict mode, counted in the unknown total). This wave does not touch `agentOwnership`; it only has to make `agentsForReader` read the mode instead of the raw flag.

**`isMine` is not removed in this wave.** Wave 4 (`feature/is-mine-removed`) removes `isMine` and its tests once nothing calls it. This wave's job is to make that true — move every caller — not to delete the function. Leave `isMine` itself untouched.

**A seventh `isMine` caller may or may not exist yet — check before you start.** The plan's Notes flag that `bug/draft-rows-obey-mine` (in a different plan, `2026-10-28-empty-jira-inbox-read-as-a`) was expected to add a caller for Draft plan rows. As of this brief being written, no such branch exists on the remote and `isMine` has exactly the six callers enumerated above. If that branch has since merged into `main`, grep `isMine` again before starting and move its caller too — the plan requires this wave to be the one that moves every caller, wherever it lives at the time you start.

### Done when

The plan's `## Done when` is implicit in its Contract Change section: applying the strict answer as the *only* rule (i.e., `isMine` fully replaced with `mineMode`-gated filtering) was measured to break 37 unit tests across 7 files and 2 browser tests — these are listed by exact path and count in the plan's Contract Change section. Each of those tests currently pins the *lenient* (`mine-and-unknown`) view; rewriting them to assert the lenient view explicitly (rather than deleting or loosening them) is this wave's responsibility, and each rewritten assertion is a named contract change in this PR's description, not a silent diff.

Plus:
- Every one of the six call sites reads `mineMode`, not a raw boolean — grep `isMine(` in `packages/board` and `packages/domain/src/rules/lanes-for-reader.ts` and `chip-row.ts` after your change; only `ownership.ts`'s own definition and wave-4's eventual removal target should remain.
- The strict-mode `localStorage` key follows the exact silent-failure discipline `readMineOnly`/`writeMineOnly` already use (try/catch, default-to-off, no throw on a blocked-cookie context).
- The board artifact rebuild is required (per plan's "Board impact" line) — `scripts/check-no-bundle-diff.sh` refuses a PR carrying a committed rebuild; run `pnpm build:board` only to test locally, never commit the generated bundle.
- Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related domain/board vitest suites and typechecks for the files you touch. The `CI suites` config key's full suites (e2e, contracts, domain coverage) run in CI; do not run them locally as a matter of course.

Name the shell gate if you touch any `.sh` file (unlikely for this wave): `scripts/check-shell-lines.sh` refuses growth in `skills/`'s shell line count at the merge base. This wave is board/domain TypeScript only, so it should not apply — note it only if you end up touching a script.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads the plan, titles the PR from this wave's heading, and bodies it with the plan and this brief. Push the first real commit as soon as it exists — do not wait for the whole wave to finish before the branch has any history. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `### Mine mode control` heading, `feature/mine-mode-control` bullet, docs/plans/2026-10-28-mine-hides-rows-with-no-known.md:102).

### Scope guard

This wave owns:
- `packages/board/src/app/lib/agent-rows/mine-filter.ts`
- `packages/board/src/app/components/AgentList.tsx` (the `mineOnly`-reading lines only)
- `packages/board/src/app/App.tsx` (the `mineOnly`-reading lines and the «Only my work» checkbox area only)
- `packages/domain/src/rules/chip-row.ts` (`mineChip`, `MineChipReadings`)
- `packages/domain/src/rules/lanes-for-reader.ts` (`filterByReader`, `lanesForReader`)
- The test files listed in the plan's Contract Change section, where they pin the behaviour this wave changes.

Other branches in this plan, verified at dispatch time (not guessed):
- `feature/mine-strict-ownership-rule` (wave 1, PR #2823) — **merged into `main`**. Touched only `packages/domain/src/rules/ownership.ts`, `mine-mode.ts`, and their tests. No overlap with this wave's files.
- `feature/waiting-hidden-split` (wave 2, PR #2829) — **merged into `main`**. Touched only `packages/domain/src/rules/waiting-tickets.ts` and its test. No overlap.
- `feature/is-mine-removed` (wave 4) — not yet started; needs this wave to merge first, since it removes `isMine` once nothing calls it. Do not pre-emptively remove `isMine` yourself — leave that deletion to wave 4.

If you find something the plan did not anticipate — e.g. an eighth call site, or the draft-rows-obey-mine caller having landed — report it rather than improvising outside scope.
