# Round 2 — Deliverable lens

Position: amend

## 1. Did the round-1 amendments hold?
- Sibling branch names: VERIFIED by grep. `feature/delivery-section-header`, `feature/delivery-you-groups`, `feature/delivery-agent-roles` (plan 4, `delivery-fleet-rows-per-agent`), `feature/delivery-release-card`, `feature/delivery-release-plan-rows` all exist as slice names in the siblings. Plan 5's `delivery-release-plan-rows` does wait on `feature/delivery-work-items-gates`, so the dependency is declared on both sides, no cycle seen.
- Waits markers: the gates slice waits on section-header and you-groups; the By slice waits on the gates slice and agent-roles. Consistent with plan 4's `agent-roles` (waits section-header only). Holds.
- `GATE_MARK`/`gateValue` at `delivery-row-form.ts:91,139`: VERIFIED exact.
- `isUnbegun` at `row-identity.ts:77`: VERIFIED, but the file is `packages/board/src/app/lib/agent-rows/row-identity.ts`, not domain; the plan gives a bare filename beside domain-path citations.
- `AgentList.tsx:1219` Start/dispatch: VERIFIED (`dispatch={start && !oneSlice ? dispatch : undefined}`). Path is `packages/board/src/app/components/`.
- `FIXER_ATTEMPTS_BUDGET` = 2 in `rules/fixer-attempts.ts:5`; `entities/fixer-attempts.ts` exists. Holds.
- `delivery-row-form.ts:221` cited for "unread gate yields a null cell": WRONG. Line 221 is a TSDoc line of `itemRowCells`; the null-for-unread behaviour is `gateValue` returning `null` at 140 and the `RowCells | null` return at 223. Citation drifted, behaviour exists.
- `prUrl` "is `() => null` today": VERIFIED at `AgentList.tsx:1097`, in the board component, not in the row form. The plan says the gates slice "fills" it; the slice therefore touches `packages/board`, which the slice text does not name.
- `local_ahead`: VERIFIED in `plan-walk-assembly.ts:506`, so the commit count exists for the pulse. Whether it reaches the board payload for an item row: only inferred, not traced.

## 2. Claims the source does not support
- Changelog and Done When say "each [gate] linked to the PR's checks or review", built from "the repository URL the board already holds". The only URL base found is `fleet.branchUrlBase` (AgentList.tsx:1095); a PR/checks URL base was not found. INFERRED gap: unverified that a PR URL can be built without a new field.
- Plan says `gateValue` is extended "to show CI and review side by side". Today it is an if-chain returning ONE string (CI wins, review only when CI is unread; lines 140-144). The extension changes its return type from `string | null` to two cells; callers `itemRowCells` (line 227) and any test on `ROW_COLUMNS` (`status` column, line 13) change. The plan's "Group columns" ALSO needs a per-group column, but `ROW_COLUMNS` is a fixed seven (`kind item where status do by age`), where `status` already plays the group-column role. The plan does not say whether the three headings replace `status` or add to it.
- Review `–` for `review: none`: the type has `'none'` (line 232) so the value exists. Holds.
- Plan 1 header facts ("oldest waits <age>") assume a per-row age; `ageMinutes` exists (line ~89). Holds.

## 3. What a builder would guess
- Slice 1 is large: header, three groups, three column kinds, Where column, Queued membership change, prUrl wiring, link construction, pulse commit-count plumbing. Six distinct deliverables in one branch; one agent could land it only if the pulse reading and repository URL already reach the payload, which is not shown. Candidate split: (a) header + groups + Where, (b) Gates cells with links, (c) Progress + Waits on + Queued membership.
- Waits-on "the earlier slice the marker or slice order names": whether the `waits:` marker is on the board payload per branch (it is parsed in `plan-walk-assembly.ts:129`) is not traced to the row facts.
- Queued membership: `stage: 'building'` with no live/stopped agent; `delivery-placement.ts:33` has `ItemStage = 'queued' | 'building' | 'pr'` so the stage exists, but "live/stopped agent" is not a field of `ItemPlacement` that I checked.
- Open Point on Draft/Design plans and approval-owed items is still `[ ]` and a question for Jan; the builder must guess Queued membership for those until it is answered. Not a code gap, but Done When "A queued row names what it waits on" does not cover those cases.

## 4. Done When vs slices (mapping)
- Lines 1-2 (columns, header counts): slice 1; unit-testable (domain). OK.
- Line 3 (gates, links, `–`, no cell): slice 1; the "no cell" sentence is the one the row form supports. Link targets need a PR URL base (see 2).
- Lines 4-6 (progress, waits, Where): slice 1; testable provided commit count is on facts.
- Line 7 (By): slice 2; testable, depends on plan 4's chip fact.
- Changelog matches Done When, one-to-one; no unshipped Changelog claim found.

## Most serious gap
The row column model (`ROW_COLUMNS` with fixed `status`) and the one-string `gateValue` are not reconciled with "one column per group" and "CI and review side by side", and the single gates slice carries six deliverables. Fixable by editing the plan (name the column change, split slice 1, fix the `:221` citation, state where the PR URL base comes from). Not fatal.

Verified by reading/grep: all line citations above. Inferred only: PR URL base availability, commit-count reaching the payload, live-agent field in placement.
