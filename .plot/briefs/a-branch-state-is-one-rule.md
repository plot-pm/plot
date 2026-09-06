## Implementation brief — a-branch-state-is-one-rule (slice: Deciding in one place)

- **Plan (canonical):** `docs/plans/2026-09-04-a-branch-state-is-derived-once.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-branch-state-is-one-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **The plan carries three interrogation rounds.** Read its Notes first, especially round 3 — it sets the verification bar and explains why a whole-estate differential was rejected.

Slice 1 of two. `feature/the-scan-asks-for-the-state` waits on it: the scan cannot ask for a rule that does not exist.

## What this delivers

`branchState(readings)` in the domain — one function producing the eight states three rules already consume.

**THREE DOMAIN RULES READ `BranchState` AND NONE PRODUCES ONE.** `rules/eligible.ts`, `rules/waiting.ts` and `rules/verdict.ts` all take a state and judge it — `waiting.ts` even groups them, `SETTLED = ['merged','deferred']`, `TAKEN = ['claimed','wip']`. **The domain reasons about branch states carefully and cannot say what state a branch is in.**

That answer lives in `plot-fleet-scan.sh` — re-measured 2026-09-06: **4,194 lines**, `branch_state()` at **`:3050`**, and it is not one function but a git reading, a prerequisite judgement and a plan statement merged by a precedence *"carefully reasoned in a comment and enforced by nothing."*

## The eight states are already declared

`entities/fleet.ts:54` — `open`, `wip`, `merged`, `claimed`, `deferred`, `unknown`, `waiting`, `blocked`. **Do not add a ninth**, and do not rename one: the board groups every section by these words and the wire shape does not change.

## Where it goes

**`transitions/branch.ts` exists and is the natural home** — it landed with #737 on 2026-09-06, after this plan was written. It already holds `BRANCH_LIFECYCLE`, `observeBranchState` and `branchStateObservable`.

**IT JUDGES; IT DOES NOT DERIVE.** Its own comment says so: *"Judges a change of branch state **that a scan has already derived**."* That is the gap this slice fills, and the two belong side by side — one derives, one validates a move between derived states.

## The precedence is the deliverable

**STATE IT, AND TEST EACH CASE:**

- a plan's `deferred:` beats a merged ref
- a prerequisite's state beats both
- **`unknown` where a reading is ABSENT, not where it is empty** — the distinction the shell already makes and the one a naive port loses

**`branch_state:63` returns `unknown` when `HOST_VERDICT` is `throttled`, `secondary` or `failed`.** An unreachable host is not a state of the branch; it is the absence of a reading. Carry that.

**READ THE SHELL'S GUARDS BEFORE PORTING.** `:3052` opens *"THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT"* — because a branch name can be reused: merge `bug/flaky`, delete it, recreate it, and the first attempt's merge subject is still on main as **stale evidence**. A port that reorders those two loses a case nobody will notice until it strands work.

## Verification

**Round 3 sets the bar and it is the corpus.** `packages/domain/corpus/` holds the pattern — `eligible.corpus.test.ts` asks *"do `--next` and the board agree about every slice in `docs/plans/`?"* over the **real estate**, with `compare.ts` as the harness.

**Record what the shell answers for every branch on the estate, and assert the rule reproduces it exactly.** ~48 branches with known states; the tier exists; the harness exists. A disagreement is either a bug in the new rule or a defect in the old one, and the corpus makes that visible instead of arguable.

**Plus one unit test per state**, from readings the test supplies — eight cases, no host, no git.

## What must not change

**Asserted: `eligible.ts`, `waiting.ts` and `verdict.ts` are UNCHANGED.** They already take a `BranchState`, so a correct derivation needs no edit to any of them — **and an edit would mean the shape is wrong.** Treat a required change there as a signal to stop and re-read the readings, not as work to do.

**The scan is not touched in this slice.** `branch_state()` stays exactly as it is; slice 2 rewires it.

## Done when

- `branchState(readings)` produces all eight states in the domain
- the precedence is stated in the code and each rule has a test
- `unknown` distinguishes an absent reading from an empty one
- a corpus test asserts the rule reproduces the shell's answer for every branch on the estate
- `eligible.ts`, `waiting.ts` and `verdict.ts` are byte-unchanged
- `plot-fleet-scan.sh` is unchanged
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not edit the three consuming rules.** If you need to, the derivation's shape is wrong.
- **Do not touch `plot-fleet-scan.sh`.** That is slice 2.
- **Do not add or rename a state.** The board groups by these eight words.
- **Do not hoist the merge lookup above the ref check.** The shell says why at `:3052`, and a reused branch name is the case it protects.
- **Do not assert the scan's `--json` is byte-identical.** The plan dropped that deliberately: `pr-list` and `pr-state` make it host-dependent, so two runs of the same code differ when the host throttles — and it fails by looking like a regression.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` — vitest passes where `tsc` fails.
