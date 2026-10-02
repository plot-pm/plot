## Implementation brief — a-draft-slice-waits-on-its-approval (slice: The draft rule reads every state)

- **Plan (canonical):** `docs/plans/2026-10-02-a-draft-slice-waits-on-its-approval.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-draft-rule-reads-every-state` (base: `main`, claimed at `526f800b5`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR, CI green

The plan's only slice. Nothing waits on it, and it waits on nothing. Its one ordering duty is #1150 (`a-handed-slice-reads-as-taken`): that plan is delivered through PR #1178, so `withHandOver` is on `main` (`packages/board/src/server/fleet.ts:6363`, applied at `:7935`) and **this slice merges second and owns the #1150 test** (see Done when).

### What to build

#1161: on 2026-10-02 the board placed 15 rows in NOT STARTED under *approved — nobody has taken it*, each with the note `waits for <branch>, which has no pull request`. The same payload gave each row `verdict: unapproved` and `startability: waiting-on-approval`. The cause is in `classifyGroup` (`fleet.ts:4159` on `main` today; the plan's line numbers are about 63 lower). It checks `planPhase === 'draft'` in only two arms, `deferred` (`:4510`) and `open` (`:4798`). The no-work arms (`blocked`/`waiting`/`unknown`, plus the unrecognised catch-all, `:5186-5201`), the fresh `claimed` and `wip` returns, and every `localActivity` return place a Draft plan's branch in NOT STARTED.

The fix is one pure domain rule, `draftPlacement` in `packages/domain/src/rules/draft-placement.ts`, exported from `packages/domain/src/index.ts`. It returns `waiting-on-you`/`'draft'`, `quiet`/reason, or `null`. `classifyGroup` calls it at five sites, each below the worker block, and maps the token `'draft'` to `DRAFT_PLAN_NOTE`. The plan's Design holds the readings interface, the answer table and the exact call sites. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **A rule in the domain, not a sixth inline `if`.** The two inline checks that exist are the defect: each new arm forgot the phase (`a-slice-nobody-worked-on-reads-not-started` added the no-work arms in v2.22.0 without one). One rule called at every site means a later arm cannot forget it. The domain style applies: an arrow function, readings as values, no port, and factual TSDoc only.
- **The rule returns the token `'draft'`, not the sentence.** `DRAFT_PLAN_NOTE` lives in the board's contract (`packages/board/src/contract/schema.ts`), and the domain does not import the board. The caller maps the token to the sentence.
- **`state` and `planPhase` are plain `string`, read verbatim.** An unrecognised state word must get an answer too (`waiting-on-you`), and `planPhase: ''` (a pre-#140 scan) must answer `null`, as every phase check in `classifyGroup` already does. Do not narrow either one to an enum in the signature.
- **A stale `claimed`/`wip` answers `null`.** The arm's own stale path already answers WAITING ON YOU with an abandonment note. That note says more than the draft note, so the rule does not override it. "Stale" means neither `fresh` (`ageMinutes !== null && ageMinutes <= quietMinutes`) nor `local`.
- **`merged` answers `null`.** The merged arm answers DONE.
- **Every call goes below the worker block.** A live worker on a Draft branch still reads WORKING. Measured: `localActivity` (`fleet.ts:5543`) answers `not-started` on every path and never `working`. So the comment at the `open` arm's draft return, which said "a branch being edited has someone working on it", does not hold. In the `open` arm, the rule call moves ABOVE the worktree check and replaces the inline return. Delete or rewrite that comment; do not keep its argument.
- **The `deferred` arm keeps its position**, above the PR arm. Only its inline returns become the rule call.
- **The plan head's `section` (`deriveSlices`) is a non-goal.** Both plan-head call sites pass a `here` set, so `slicesElsewhere` never reads it. Leave it.
- **Invariants carried over:** a missing phase is not `draft`, so `''` answers `null`. A live process outranks every branch state. A placement is a domain property, tested in a unit test and not in a browser.

### Done when

The plan's `## Done when` is the specification. These assertions exist because a naive fix passes without them:

- **The cross-product sweep** (every `BranchState`, with and without a deferred reason, × age `null`/5/5000 at `quietMinutes` 30 × worker `none`/`elsewhere`/`running` × no worktree or a held one). It asserts that no row is `not-started` and that every non-merged `running` row is `working`. It must also assert that the fixture holds an age-5, worker-`none` row for `claimed` and for `wip`. Without that guard the sweep passes vacuously when a fixture bug drops the fresh rows, and those rows are the ones a fix of only the no-work arms misses.
- **Approved `blocked` still reads `not-started` with `waits for <branch>, which has no pull request`.** This catches a fix that drops the phase test and moves every blocked slice.
- **Draft `blocked` with a `running` worker reads `working`.** This catches a rule call placed above the worker block.
- **Draft `open` with a held local worktree reads `waiting-on-you`/`DRAFT_PLAN_NOTE`.** This catches a rule call left below the worktree check in the `open` arm.
- **The #1150 test, owned by this slice:** classify a Draft `blocked` branch and a Draft fresh `claimed` branch through `classify`, pass each row to `withHandOver` with a `running` agent that names the branch, and assert both rows are unchanged in `waiting-on-you` with `DRAFT_PLAN_NOTE`.
- **The two `fleet.test.ts` cases** (*changes no state but `open` and `deferred` on a draft plan*, *changes no state that carries real work*): take the `['wip', 'eligible', 5]` tuple out of the equality loop and assert it on its own. The `claimed`-at-`QUIET+1` and `wip`-at-200 tuples stay in the loop. Rename the first case to *changes no stale or merged state on a draft plan*.
- **Domain:** `packages/domain/test/draft-placement.test.ts`, with 100 % branch coverage of `draft-placement.ts` under the coverage gate.
- `draft-plan-row.test.ts` and `classifier-is-total.test.ts` pass unchanged.

Repo gates: run `nvm use` first (Node 24). Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. Also run `pnpm run test:board`, `pnpm run typecheck`, `pnpm --filter @plot-pm/domain exec vitest run --coverage` and `pnpm test`. Do not run `test:e2e` locally; it runs in CI. The changeset is `'@plot-pm/board': patch`, with the description first; the domain rule ships inside the board. No browser test, and `EXPECTED_TESTS` does not change. After a source change, `pnpm build:board` rebuilds `skills/plot/scripts/board/board-server.mjs`, and the artifact is committed.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Never run `gh pr create`.
- When the PR exists, append it to the slice heading inside the parentheses: `(Branch: bug/the-draft-rule-reads-every-state, PR: #N)`. This plan uses the heading form, and a trailing `→ #N` parses as `prs=[]`. Write the annotation on `main`, from a detached scratch worktree.

### Scope guard

This branch owns `packages/domain/src/rules/draft-placement.ts`, its test, one export line in `packages/domain/src/index.ts`, the five call sites in `classifyGroup` (`packages/board/src/server/fleet.ts`), the two `fleet.test.ts` cases, new board unit tests under `packages/board/test/unit/`, the rebuilt board artifact and one changeset.

Verified at dispatch (2026-10-02) against every remote branch:

- `bug/the-full-read-asks-verdicts-of-open-prs-only` edits `fleet.ts` near `refreshPrs` (`:2923`). It does not overlap.
- `bug/the-largest-caller-follows-the-account-rate` edits `fleet.ts` (imports at `:45`, plus `:589`, `:2064` and `:3352-3377`) and `packages/domain/src/index.ts`. Expect a one-line export conflict in `index.ts` if it merges first. Keep both lines.
- No other branch touches `classifyGroup` (`:4159-5210`).

Out of scope, per the plan's Open Points: the Open menu item linking to a `branchUrl` with no remote ref (`menus.tsx`). If you find something the plan did not anticipate, report it rather than improvising outside scope.
