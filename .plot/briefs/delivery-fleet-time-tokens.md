## Implementation brief — delivery-fleet-rows-per-agent (wave 4: Time and tokens)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-fleet-time-tokens` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the fourth slice of plan 4 of the six-plan Delivery-tab design. It waits on `feature/delivery-fleet-agent-rows`, merged on `main` as PR #3509 (`agentRowCells` there already carries `tokens: null` and `timeLeft: null`). `feature/delivery-fleet-header-switches` waits on this slice and takes the per-agent token fact from it, so the header counts, the switches and the "output tokens today" figure are not yours. Before you start, confirm the agent-rows merge: `git log origin/main --oneline -- packages/domain/src/rules/delivery-row-form.ts` must show `69d83c9e3` and `c2a17fae8`, and `agentWaitsOn` and `freeLine` must exist in that file; if not, stop and report.

### What to build

Two cells of the agent row read "—" for every agent today: Tokens and Time left (`AGENT_COLUMNS`, `packages/domain/src/rules/delivery-row-form.ts:333`; both set to `null` in `agentRowCells`, about `:460`). This slice fills them from two readings and pays for each once.

1. **Time left.** A domain rule over two readings passed in: `time left = bound − (now − start)`, with `null` for either input giving "—" and no bar. It returns the fraction left as well, so the bar drains and turns red below 20 % left (the design's writer's call). The start time is `startedAt` on `AgentPlacementReading` (`delivery-placement.ts:107`); the bound is chosen per role by the server and passed in:

   | Role | Bound passed in |
   |---|---|
   | loop, design, verify | `Worker bound` (28800 s in this repo) |
   | reviewer | `REVIEW_BOUND_MS`, 3600 s (`packages/fleet/src/shared/auto-review.ts:64`) |
   | fixer | `FIXER_BOUND_SECONDS`, 3600 s (`packages/domain/src/rules/fixer-attempts.ts:8`) |
   | idea, brief | `null`: these runs have no bound (`packages/fleet/src/shared/brief-ask.ts:103-107`) |

   Design and verify carry a `null` start time on the payload (the plan-runs slice left it so), so their cell shows "—" until a start exists. Do not invent one.
2. **The `Worker bound` read.** `workerBoundSeconds` (`packages/board/src/server/fleet.ts`, about `:8434`) runs an uncached config subprocess (0.12 to 0.94 s measured) and is called only where `anyFreeWaitEnded` holds (`:8671`), because `/api/fleet` polls every 4 s per viewer. Read it once per board process, and again only when one `stat` of the file that declares it shows a new modification time. The stat runs once per `/api/fleet` build, never once per agent.
3. **Tokens.** The Tokens cell shows the output tokens of the agent's last finished run, labelled as output tokens, with the other three counters (input, cache creation, cache read) in the cell's tooltip, and "—" for a run in progress. The reading is `.plot/state/slice-spend.jsonl` (`packages/domain/src/entities/slice-spend.ts`): run lines (`kind: 'run'`, keyed by `branch`, `sessionId`, `role`, with cumulative per-model counters) and seal lines (no `kind`). Run lines are cumulative per session, so a run's own figure is the difference against the same session's previous line. The board already reads the record for plan cost through `spendRecordFor(opts).lines()` (`packages/board/src/server/board.ts:459`, called once at about `:2907`). Parse it at most once per `/api/fleet` build, and only when one `stat` of the record shows a new size or modification time; otherwise serve the last parse. No transcript is read on the poll.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Tokens are output tokens, never a sum.** `packages/domain/src/rules/slice-tokens.ts` refuses a single summed figure: measured there, cache reads are 99.36 % of a naive four-field total, so a sum is a cache-read count wearing a cost's name. `TokenCountsSchema` is a four-key contract and a test asserts the key set. Show `outputTokens` in the cell and the other three in the tooltip; add no fifth field.

**A running agent shows "—" in Tokens.** Jan Wloka decided this on 2026-11-16: no live reading exists, and reading a transcript on a 4 s poll is what the 7.7 MiB figure (`packages/domain/src/workflows/slice-spend.ts:58`, `packages/board/src/server/entry/slice-spend.ts:23`) rules out. A run line is written when a run ends, so "last finished run" is the newest line, not a live one. Do not estimate.

**The domain imports `zod` only.** `REVIEW_BOUND_MS` lives in `packages/fleet`, so the domain rule takes the bound as a reading and the server passes it in. An import of `@plot-pm/fleet` from `packages/domain` fails the purity gate (`ci.yml:186`).

**Absent is not zero.** A missing record, an unparseable one and a branch with no line all read "—", not "0". `spendRecordFor(...).lines()` returns `ok: false` for a failed read, and `null` for a start or a bound is "—" with no bar, never an empty bar and never 0 % left. A bound of `0` or a start in the future must not divide by zero or draw a negative fraction; clamp and assert it.

**One stat decides both re-reads.** The cost bound is a stat-based cache, not a timer: `lines()` parses the whole record on every call, and `board.ts:2885-2907` already hoisted it above a per-plan loop for that reason. Do not call `readPlanSpend` per agent for the same reason. Put the cache where the build can seam it, so a unit test proves "one parse for N agents" with no filesystem.

**Domain first.** Every time-left value, fraction, "red below 20 %" flag and token figure is a domain property with a unit test built on `agentRowCells`; a browser test only proves the value is seen. `agentRowCells` is changed, not replaced, and `ROW_COLUMNS` stays the item rows' set.

### Done when

The plan's Done When item for this slice is the specification: Time left uses the bound the table names per role, shows "—" for a role with no bound or no start time, and the bar turns red below 20 % left, asserted in a unit test over the fraction; the Tokens column shows the last finished run's output tokens labelled as such, with the other counters in the tooltip, and "—" for a run in progress; the board reads `Worker bound` at most once per change of its file, parses `slice-spend.jsonl` at most once per `/api/fleet` build and only when its stat changes, and reads no transcript on the poll.

Lift these assertions, because a naive implementation passes without them:

- Exactly 20 % left is not red and 19.9 % is: the threshold is asserted on both sides. This catches `<=` against `<`.
- An agent with a bound and a `null` start shows "—" and no bar, and an agent with a start and a `null` bound (idea, brief) shows "—" and no bar. This catches a rule that treats `null` as 0.
- Start older than the bound gives 0 % left and a red bar, not a negative figure.
- Two run lines in one session give the second run's difference, not its cumulative total; a first line in a session gives its own figure. This catches showing a cumulative number as one run's output.
- A fixture whose record has `cacheReadTokens` in the millions and `outputTokens` in the thousands shows the output figure in the cell and the cache figure only in the tooltip. This catches a sum, and a fixture where the counters are equal would hide it.
- Eight agents in one build cause one `stat` and at most one parse of the record, and a second build with an unchanged stat causes zero parses; a changed stat causes one. The same pair for `Worker bound`: two builds, one config read; a changed modification time, a second. This catches a read inside the per-agent loop.
- A failed record read shows "—" for every agent and leaves the rest of the row intact. This catches a throw that blanks the Fleet section.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. `pnpm run typecheck` does not cover `packages/domain`: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` for any domain file you change. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Never run board tests while an operator's board is open on this machine. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md` line inside the comment block; `scripts/check-changeset-packages.sh` checks the order and the package name. The slice changes no skill, so the changeset names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. Any function you write is an arrow, and `packages/domain` takes TSDoc that states what an export does and returns, not the history of the decision; leave neighbouring declarations alone.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the time-left rule and its bar, the Tokens cell and its tooltip, `tokens` and `timeLeft` in `agentRowCells` (`packages/domain/src/rules/delivery-row-form.ts`), the agent facts that carry them (`lib/agent-rows/delivery-row-facts.ts`), the cached `Worker bound` read in `packages/board/src/server/fleet.ts`, the once-per-stat spend parse, and the tests that select these cells.

It does not own the header counts, the switches, the stepper or the "output tokens today" figure (`feature/delivery-fleet-header-switches`, and plan 1's section header), the groups, Acting on, Doing now or Waits on (`feature/delivery-fleet-agent-rows`, merged), the role chip and readings (`feature/delivery-agent-roles`, merged), design and verify runs (`feature/delivery-fleet-plan-runs`, merged), a start time for design or verify, `ROW_COLUMNS`, the item rows, or plan cost on the plan cards (it shares `spendRecordFor` with `board.ts`; do not change what that call returns). Measured at dispatch on 2026-11-18, `git ls-remote --heads origin 'feature/delivery-*'` lists `feature/delivery-slice-states`, `feature/delivery-tab-footer`, `feature/delivery-work-items-gate-cells` and `feature/delivery-you-loose-prs`: none is a Fleet slice, but verify it, do not assume, and report a collision with `fleet.ts`, `board.ts` or `delivery-row-form.ts` rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
