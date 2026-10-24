## Implementation brief — a-slice-pr-left-as-a-draft-by-a-finished-agent-never-becomes-ready

- **Plan (canonical):** `docs/plans/2026-10-24-a-slice-pr-left-as-a.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2561 merged
- **Branch:** `bug/a-slice-pr-left-as-a` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One branch, one wave (`Fix`). Nothing waits on it and it waits on nothing. Issue: #2559.

### What to build

A finished agent's draft slice PR stays a draft. PR #2550 (`bug/board-status-banner-states`) opened as a draft at 2026-10-24T13:19Z, all four checks passed at 13:37Z, the desk was gone by 14:10Z, and the PR was still a draft. The sibling slice `bug/board-offline-tickets-age-and-rows` waits on that branch, so the whole plan stopped behind one stranded draft. #2468 and #2422 are older instances.

The mechanism has two parts, in the order the layering rule gives them:

1. **A domain rule**, `markReadyDecision`, in `packages/domain/src/rules/`. Inputs: the agent's worker state, the PR's draft flag, the PR's open state, and whether the PR head equals the agent's last push. It answers yes only for `finished` + open + draft + head equals the last push. `failed`, `ended`, `stalled`, `waiting`, `running`, `none` and `elsewhere` answer no. Write it as an arrow function with a TSDoc block that states behaviour and no history.
2. **A step in the agent loop** that performs the decision after the run ends. The loop's decision table is `agentLoop` in `packages/domain/src/workflows/agent-loop.ts` (1031 lines; the sealing path is `seal` at `:413` and `ciWait`/`settled` below it). The `pr-ready` write kind already exists in the `Write` union (`workflows/decision.ts:160`, `PrReadyWrite`) and is already named in `BEYOND_THE_FILESYSTEM` in `adapters/performer/perform-fs.ts:56`. The board performs it through `ctx.scripts.host(['pr-ready', String(n)])`, as `packages/board/src/server/entry/approve.ts:1072` does. The shell launcher `plot-worker-loop.sh` is 18 lines and `exec`s `board/plot-worker-loop.mjs`; the loop is JS, so the change is not in shell.

Read `skills/plot/scripts/plot-host.sh:4204` (`pr-ready`) before wiring the call: on GitHub it runs `gh pr ready`, on Bitbucket `bb pr update --ready`, and a host refusal surfaces as the CLI's own message.

### Decisions the plan settles — do not re-derive them

**The loop never calls `gh`.** `scripts/check-host-cli-callers.sh` gates it. The call goes through `plot-host.sh pr-ready` and nothing else.

**`awaitsMarkReady` stays.** `packages/domain/src/rules/pr-row.ts:97` shows a "mark ready" row for a green draft with no live agent (`finished` or `none`). It is the fallback for drafts the loop leaves alone, and the plan's board-impact comment says "none expected". Do not delete or loosen it. Confirm once the new rule exists that the board row and the loop do not contradict each other: the loop acts on `finished` alone, the row also shows on `none`.

**Only `finished` marks ready.** An agent that ended `failed`, `ended`, `stalled` or `waiting` has not delivered what the draft promises, so a person decides. `plot-worker-state.sh:46` (and its domain equivalent) decides `stalled` and `waiting` from the tree, not the process; read the worker state, do not recompute it.

**The head must equal the agent's last push.** A PR whose head moved after the agent's last push carries someone else's commit. Marking it ready would publish work the agent never reviewed. The plan names this test case explicitly.

**A DECISION READS THE INDEX** (`CLAUDE.md`). The PR's draft flag and head come from what the loop already holds or the PR index, not from a fresh host call made for the decision. Only a terminal answer may be read from the index as final: `MERGED`. `OPEN` and draft rows can be stale in both directions and record no SHA to revalidate against, so a draft read from the index must be confirmed through the host before `pr-ready` runs, or the decision must carry the head SHA and refuse on a mismatch. Absent is not false: a missing or unreadable PR reading answers no, never yes.

### Open questions the plan leaves — resolve them in the PR and say how

The plan lists four. They are the first thing a reviewer asks, so answer each in the PR body:

1. Whether the brief template and `skills/plot-implement/SKILL.md:315` keep recommending `plot-open-pr.sh --draft`. This brief still recommends it for work in progress; the finished-agent step makes it safe. Leave the recommendation unless you can show a reason to change it, and change both places together if you do.
2. Whether the step belongs in the worker loop or in fleetd's PR pass. The plan's approach chose the loop (it sees the last push directly). Keep that unless you find the loop cannot reach the PR number.
3. Whether to wait for green checks. The loop's `ciWait` already settles before a finished agent exits, so a `finished` run has seen its checks. Use that and add no second wait.
4. Whether a failed `pr-ready` blocks the loop's exit. It must only log: the draft stays visible through `awaitsMarkReady`, so a failure costs one manual click, while blocking the exit strands the agent.

### Done when

The plan's `## Slices` section and Changelog entry are the specification: when an agent's run ends `finished` and its branch has an open draft slice PR whose head is the agent's last push, the worker loop marks it ready through `plot-host.sh pr-ready`; every other worker state leaves the draft alone.

Assertions that exist because a naive implementation would pass without them:

- **One test per worker state** (`running`, `finished`, `failed`, `ended`, `stalled`, `waiting`, `none`, `elsewhere`). Catches a rule that tests `!== 'failed'` and so marks ready for states nobody listed.
- **Head mismatch with `finished`.** Catches an implementation that checks only state and draft.
- **Already-ready PR and closed PR with `finished`.** Catches a call to `pr-ready` on a PR that is not a draft.
- **An unreadable PR reading with `finished`.** Catches absent treated as draft.
- **A failing `pr-ready` call leaves the loop's exit unchanged.** Catches the call's exit code leaking into the loop's.
- **A `finished` loop run with no write to `pr-ready` in the decision for a non-draft.** Proves the step performs nothing rather than performing a no-op.

Plus: a changeset (`pnpm changeset`, description first, `bumps:` block last, `plan:` line pointing at this plan). The board bundle is generated output: do not commit `board-server.mjs` or any rebuilt bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the change touches a `.sh` file, growth is paid for in the same change: remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. This slice should not need to touch shell; the loop is JS.

If the loop needs a duplicate of the rule in shell, `docs/shell-and-domain.md` allows it only with a corpus test in `packages/domain/corpus/` that names both answers on a disagreement. Prefer not to duplicate.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new rule and its test), the `pr-ready` step in `packages/domain/src/workflows/agent-loop.ts` and its performer wiring in `packages/board/src/server/entry/`, a changeset, and the plan's `## Slices` annotation.

It does not own the board row (`pr-row.ts`'s `awaitsMarkReady`), `plot-host.sh`, the brief template, or `skills/plot-implement/SKILL.md`, except the one-line change in open question 1 if you make it. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
