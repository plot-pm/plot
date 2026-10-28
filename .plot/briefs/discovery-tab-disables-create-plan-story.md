## Implementation brief — discovery-tab-disables-create-plan-story

- **Plan (canonical):** docs/plans/2026-10-28-discovery-tab-disables-create-plan-story.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2834 merged
- **Branch:** `bug/discovery-tab-disables-create-plan-story` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per the repo's convention (`Review: pr`)

Single-slice plan: nothing waits on this branch and it waits on nothing. Issue #2836 (Planning-tab fallbacks) is a separate item and out of scope.

### What to build

A fresh page on `?tab=discovery` shows Create plan and Create story as refused with "this git host has no issue read…" on a GitHub host whose issue read works (`/api/fleet` answers `issueAnswer: "answered"`, 5 of 5 reads). Cause: Discovery takes its ticket rows from `/api/board` but its issue answer from `/api/fleet`, which `App.tsx:516` fetches only on the Delivery tab. With `fleet === null`, `App.tsx:1338` defaults to `'unsupported'`.

The fix, in four parts:

1. `/api/board` carries `issueAnswer` and `issueAbsence` beside `tickets`. `discoveryLanes` (`packages/board/src/server/discovery-lanes.ts`) reads them from the `ensureCache(opts)` entry directly. `BoardSchema` gains `issueAnswer: IssueAnswerSchema.nullable().optional()` and `issueAbsence: z.string().nullable().optional()`. Discovery reads both from `board`; `App.tsx:1328` and `:1338` stop reading `fleet`. The fleet guard at `App.tsx:516` stays.
2. The cold cache starts at `null` ("not read yet"). `freshCacheEntry` seeds `issueAnswer: null` (the plan cites `fleet.ts:2889`; on current main the seed is at `fleet.ts:2925`, so grep for `issueAnswer: 'unsupported'`). `CacheEntry.issueAnswer` becomes `IssueAnswer | null`.
3. One domain rule in `packages/domain/src/rules/create-from-issue.ts` takes the binding (`DispatchInfo`), the answer (`IssueAnswer | null`) and the kind (`plan` | `story`) and returns `available`, `pending` (inactive, `aria-disabled`, no sentence) or `refused` with a reason. `CreatePlanButton.tsx`, `CreateStoryButton.tsx` and `storyRefusal` (`menus.tsx`) call it; their duplicated `refusalReason` goes.
4. Every consumer of the answer accepts `null`: the list is in the plan's Design › Approach (`AgentList.tsx`, `rows.tsx`, `menus.tsx`, `StoriesTab.tsx`, both buttons, `/api/fleet` and `FleetShape`).

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **`/api/board`, not a fleet poll, not a per-row loading state.** The ticket rows and their answer come from one cache entry (`fleet.ts:1682-1683`), so the board payload is where they belong together. The tab's existing `Loading…` covers the time before the first board payload. Polling `/api/fleet` from Discovery was considered and dropped.
- **Read the entry, not `ticketLaneData`'s return.** `ticketLaneData` returns `null` while `entry.issueSets === null` (`fleet.ts:1684`), and the `nobody` source has `issueSets === null` with `issueAnswer: 'unsupported'` and a standing absence sentence. Reading through `ticketLaneData` loses exactly that sentence.
- **`null` is not a fourth `IssueAnswer` member.** `IssueAnswer` keeps `answered | unsupported | failed`. `null` lives only in server memory and on the wire. `issues.json` and `IssueFetch.answer` never hold it.
- **`/api/fleet` decodes `IssueAnswerSchema.nullable().default('unsupported')`.** An absent field from an older server still decodes to `unsupported`; `null` passes through. The board's new field has no default: an older server sends nothing, `App.tsx` maps it to `null`, and the buttons stay `pending` rather than printing the Bitbucket sentence.
- **`board.idea` and `board.story` are no evidence.** They report only the localhost binding (`schema.ts:1316-1324`); the issue read is the other half of the question. The two wire fields stay separate.
- **Refusal order** is `unsupported` (host sentence), then `failed` (outage sentence), then an unavailable binding's reason. `create-plan-button.test.ts` pins that order today; keep it.
- **`AgentList.tsx` strict comparisons** (`:1160, 2485, 2500, 2509, 2617, 2632`): `null` matches no arm, so Delivery's WAITING ON YOU shows no issue rows and no issue note until the first read answers. That is intended; add no arm for it.
- **Out of scope:** the Planning-tab fallbacks (`App.tsx:1485, 1498, 1558`, issue #2836) and the "issue lookup is failing" sentence for an unreadable plans directory (`fleet.ts:2085-2090`).

Carried-over rules: absent is not false (a missing `issueAnswer` is `null`, never `'unsupported'`); a view state is a domain property (the button's state is decided in the rule, not in `.tsx`); new functions are arrows.

**One open question stays open** (plan › Open Questions): with fleetd running and no issue index, `readIssuesFromStore` sets `unsupported` with the absence "the fleet has left no issue index to read" (`fleet.ts:2215-2218`), and the button prints "this git host has no issue read". Do not decide it in this slice. Leave that behaviour unchanged and say in the PR that it is unresolved.

### Done when

The plan's `## Tests` and Changelog lines are the specification. The assertions that exist because a naive implementation would pass without them:

- Domain unit tests (`packages/domain/test/create-from-issue.test.ts`) per kind and per case: `answered` + available binding → `available`; `null` → `pending` with no sentence matching `/no issue read/` (catches a rule that maps `null` to `unsupported`); `unsupported` → host sentence; `failed` → outage sentence; unavailable binding → its reason; refused binding with `unsupported` names the tracker first (catches a reordered refusal). The seven cases of `packages/board/test/unit/create-plan-button.test.ts` move here and the story half gains the cases it lacks.
- Browser (`discovery-ticket-card.browser.test.ts`): `board` stub carries `issueAnswer: 'answered'`, `fleet` stub carries `issueAnswer: 'unsupported'`; on a fresh `?tab=discovery`, `[data-create-plan="1688"]` and `[data-create-story="1688"]` carry no `aria-disabled`. The opposite fleet answer proves the board is the source; the assertion must fail before the fix. The current test counts the buttons and never reads `aria-disabled` (lines 91-100).
- The other three Discovery browser tests (`discovery-groups-toggle:69`, `discovery-lanes-by-topic:64`, `discovery-mine-filter:81`) stub `issueAnswer: 'answered'` on a `fleet` response Discovery never fetches. Move it to the `board` stub where the edit is one line; name any left unchanged in the PR.

Plus: `packages/board` and `packages/domain` build artifacts per the repo's rules (never commit a rebuilt `board-server.mjs`), and a changeset with the description first and the `bumps:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run board tests while an operator's board is open.

The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/board/src/server/{fleet,discovery-lanes,index}.ts`, `packages/board/src/contract/schema.ts`, `packages/board/src/app/App.tsx` and the components and agent-row libs named above, `packages/domain/src/rules/create-from-issue.ts` (new) with its test, and the four Discovery browser tests. Other plans in sprint `follow-ups-2-29-1` may touch `App.tsx` and `fleet.ts`; rebase before the PR and resolve conflicts in source, never in a generated bundle.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
