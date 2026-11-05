# Safety juror: continue and the agent panel refuse unknown-branch with no pulse

Lens: what can this change stop, delete, merge, overwrite or misreport, on this checkout, another checkout or the host, and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Summary

The change renames one refusal in two places. It adds no action path: a `null` pulse refuses before and after, so no agent starts, no desk is written and no host call is made. It removes a misreport (the detail blamed the plan). Two open questions are left for the unattended agent; both answers are safe, so the plan closes them before approval.

## Findings

1. **Nothing new can start, stop, delete or merge.** `continueBranch` (`packages/fleet/src/shared/continue-command.ts:82-99` on origin/main) refuses for a `null` pulse today (`unknown-branch`) and refuses after the change (`no-pulse`). The `null` pulse never reaches `continueOnDesk` (`:100-112`), so the answer, the continuation prompt and the agent start stay unreachable. The board route (`packages/board/src/server/continue.ts:178-189`) and the CLI (`packages/fleet/src/server/entry/continue-command.ts:97-110`) only forward `started.reason`/`detail`. The status stays 404.
2. **The misreport the issue names is real and the fix is the right size.** `branchFromPulse` returns `null` for a `null` pulse (`continue-command.ts:28`), and `bridgedPulse` (`entry/continue-command.ts:50-53`) returns `null` for any untrustworthy bridge. The detail `no plan on this board names that branch` is then false. `no-pulse` with `no current fleet reading to look the branch up in` names the reading, true for both the bridge and the board cache.
3. **No consumer matches on the old string.** `git grep unknown-branch` over `packages/*/src`, `skills` and tests (bundles excluded) finds no caller that branches on the continue or panel reason: `ContinueWithAnAnswer.tsx:36` renders it; `AgentPanelFacts.tsx:364-368` renders it; `WorkerLogModal.tsx:203-210` stores any non-`error` body and polls again every `LOG_POLL_MS`, so a `no-pulse` panel clears itself when the cache warms. fleetd and the registry do not call `continueBranch`. So a renamed reason cannot make an automated caller take a wrong branch.
4. **The agent panel's path boundary holds.** `agentPanel` (`agent-panel.ts:161-163`) reaches `uptimeSeconds`, `readConfigAsync` and `transcriptFacts(found.worktree)` only after a found entry with a worktree. A `null`-pulse return before `branchFromPulse` reads nothing from disk or the process table. The security cases at `packages/board/test/agent-panel.test.mjs:211-218` run against a server whose stub scan supplies a non-null pulse (`:164-166`), so they keep `unknown-branch` and keep proving that request text is not a path.
5. **Order is gated by the compiler, not only by the `waits:` marker.** `no-pulse` in `continueBranch` needs `'no-pulse'` in `ContinueRefusal`, which the restart slice adds (`docs/plans/2026-11-04-restart-refuses-unknown-branch-when-it.md`, Approved; its branch is not yet on origin). If the slice is dispatched early, `tsc` fails by name. `AgentPanelMiss` is a separate union, so the panel half compiles alone; that is harmless.
6. **What still misreports, and it is named.** A non-null but partial pulse (board scan cut short, `pulseFor` beside its completeness companion in `fleet.ts:3303-3310`) that lacks the branch still answers `unknown-branch`. The plan names this as #3118 and out of scope. A fresh bridge that predates a new claim also answers `unknown-branch`; that is the same class.
7. **Claims checked true:** `continue-command.ts:28-29`, `:82-91`; `agent-panel.ts:60-64` (union at `:61-64`), `:161-162`; `fleet.ts:3301-3303`; `continue-command.test.ts:42-44`; `continue-route.test.ts:744-749` (`deps(null)` is `pulse: () => null`, `:312-317`); `AgentPanelFacts.tsx:367`; README row `:85`; entry module doc `:21`.
8. **Small inaccuracy, not a safety defect.** The plan says the existing panel sentence `No scan has reported this branch — the next pulse may know it` stays correct for `unknown-branch` only. It is also true for a cold cache. A distinct sentence is still the better choice because `data-panel-miss` then names a distinct reason.

## Amendments required

1. Close Open Question 2: `no-pulse` keeps 404 on `GET /api/agent-panel`. Reason: `index.ts:661-662` writes 404 for every `ok: false` panel and the client (`WorkerLogModal.tsx:205-210`) reads the body, not the status, so no reader branches on it; the restart plan chose 404 for the same reason.
2. Close Open Question 1: adopt the plan's own sentence `No current fleet reading yet — wait for the next fleet scan.` for the panel strip. Make the `AgentPanelFacts.tsx` branch an explicit three-way choice (`no-worktree`, `no-pulse`, otherwise) so a later miss reason cannot fall into the `unknown-branch` sentence silently.
3. State in the slice that `agentPanel` checks `pulseFor(opts) === null` and returns before `branchFromPulse`, `uptimeSeconds`, `readConfigAsync` or `transcriptFacts`, and that the new `agent-panel.test.mjs` case asserts `status === 404` and `reason === 'no-pulse'` on a board whose scan has not answered.
4. In `continue-route.test.ts:850-857` (`gives each refusal its own reason`), add `'no-pulse'` to the list, so the route file's own distinctness check covers it.

## Decisions that need a person

None beyond approving the two closures above; both are reversible one-literal choices.

## What I ran and what I only read

Ran (read-only): `git fetch`, `git show origin/main:<file>` on `continue-command.ts` (shared and entry), `agent-panel.ts`, `board/src/server/index.ts`, `board/src/server/continue.ts`, `AgentPanelFacts.tsx`, `WorkerLogModal.tsx`, `fleet.ts`, `continue-command.test.ts`, `continue-route.test.ts`, `agent-panel.test.mjs`, `write-gate.test.mjs`, `fleetctl.test.mjs`, and the restart plan; `git grep` for `unknown-branch`, `no-pulse`, `panel-miss`, `api/agent-panel`, `plot-continue-command`; `gh issue view 3117`; `gh pr list` for the restart branch. Read only: the plan, the repo CLAUDE.md. I ran no test, typecheck, build, fleet or board command.
