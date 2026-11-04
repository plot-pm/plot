# Safety juror: restart refuses unknown-branch when it has no current pulse

Position: amend

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal.

## Summary

The change replaces one refusal with another refusal. It starts, stops, deletes and merges nothing new, and the path that does start a worker (null pulse plus a worktree from `PLOT_RESTART_WORKTREE`) stays unchanged. The safety risk is therefore small. The plan is still incomplete: it misstates the board impact, it omits a type union and a board switch that the build depends on, and it omits two existing tests that assert the old refusal on a no-pulse path.

## Findings

1. **The change is refusal-only and keeps the start path.** `restartBranch` (`packages/fleet/src/shared/restart-command.ts:115-119`) refuses only when `found` is null. `found` is non-null when `input.worktree` is set (`:116`), so a null pulse with a worktree continues to `continueOnDesk` and to `restartWorker`'s guards (`:126-153`). The plan's order (no pulse and no worktree → `no-pulse`) keeps that path. No case moves from refusal to start. Rubric 4 passes for the new case.

2. **"Board impact: none" is false.** `POST /api/restart` calls the same `restartBranch` (`packages/board/src/server/restart.ts:64-67`) with `pulseFor(opts)`, and `pulseFor` returns `null` on a cold cache (`packages/board/src/server/fleet.ts:3288-3303`). After the change the board answers `no-pulse` with status 404 while its first scan has not landed. The board shows the reason through `refusalWord` (`packages/board/src/app/components/RestartTheWorker.tsx:87`).

3. **The build breaks unless two more files change.** `reason` is typed `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99`, `:402`, `:406`), so `no-pulse` must join that union. `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76`) is a `switch` with no `default` under `strict: true`; a new union member leaves a path with no return and fails `pnpm run typecheck`. The plan names neither file. A Sonnet agent finds this through `tsc`, but then writes a user-facing sentence the plan has not decided.

4. **The detail misreports on the board.** `the fleet has written no current reading` is true for the bridge file (`packages/fleet/src/server/entry/restart-command.ts:49-52`). On the board, a null pulse means the board's own scan cache is cold, not that the fleet wrote nothing. The detail must name the reading, not its writer.

5. **Two existing tests assert the old refusal on a no-pulse path.** `packages/fleet/test/unit/restart-command.test.ts:54-56` ("refuses unknown-branch where there is no pulse at all") flips by design. `test/reconcile/restart.test.mjs:478-483` runs `plot-dispatch.sh --restart feature/never-dispatched` in a sandbox with no bridged pulse and asserts `/unknown-branch/`; after the change that sandbox prints `no-pulse`. The comment at `test/reconcile/fleetctl.test.mjs:505-508` also names `unknown-branch` for the no-pulse case. The plan names none of these, so the slice can go red in CI on a contract test it did not expect.

6. **Docs that state the old refusal set.** `skills/plot/scripts/README.md:86`, the TSDoc at `restart-command.ts:105-106`, and the entry header at `packages/fleet/src/server/entry/restart-command.ts:17-18` say restart refuses `unknown-branch` and `no-worktree`. They must name `no-pulse` too.

7. **No consumer branches on the reason string or the status.** `plot-dispatch.sh:1841` exits 1 on any non-zero exit. `restart-stopped-command.ts:117` prints the reason and continues with the next branch. The board UI reads `body.ok` and `body.reason` (`RestartTheWorker.tsx:55-58`). So 404 against 503 changes no behaviour; it is a wording choice, and an unattended agent must not be left to decide it.

8. **One mislabel of the same class stays.** A non-null pulse cut short by an incomplete scan (`pulseComplete` false, `fleet.ts:3305-3320`) that lacks the branch still refuses `unknown-branch: no plan on this board names that branch`. This plan's scope excludes it; it deserves a follow-up issue rather than a slice here.

## Required amendments

- A1. Replace "Board impact: none" with the board facts: `POST /api/restart` shares `restartBranch`, and a cold board cache now answers `no-pulse`.
- A2. Add to the slice: `no-pulse` joins `ContinueRefusal` (`continuation.ts:99`), `refusalWord` gains a `no-pulse` case with a decided sentence, and `continue-control.test.ts`'s distinct-sentence list gains `no-pulse`.
- A3. Change the detail to a source-neutral wording, for example `no current fleet reading to look the branch up in`.
- A4. Name the tests that change: rewrite `restart-command.test.ts:54-56` to assert `no-pulse`; decide whether `test/reconcile/restart.test.mjs:478-483` asserts `no-pulse` or writes a bridged pulse so it keeps testing `unknown-branch`; update the comment at `fleetctl.test.mjs:505-508`.
- A5. Name the doc lines to update: `skills/plot/scripts/README.md:86`, `restart-command.ts:105-106`, entry header `:17-18`.
- A6. Close the 404/503 and `continue` open questions before approval. My recommendation: keep 404 (no caller reads the status), and file `continue` as a follow-up issue, since `continue-command.test.ts:42-44` pins the same behaviour there.

## Decisions for a person

- The user-facing sentence for `no-pulse` on the board (A2).
- Whether `continue` gets the same fix in this plan or a follow-up (A6).

## What I ran versus read

Ran: `git fetch origin main`, `git show origin/main:<file>` and `git grep` over `packages`, `skills`, `test` and `docs` for `restartBranch`, `unknown-branch`, `ContinueRefusal`, `pulseFor`. Read: the plan, the juror brief, `restart-command.ts` (shared and entry), `continuation.ts:99-406`, board `restart.ts`, `ContinueWithAnAnswer.tsx`, `RestartTheWorker.tsx`, `fleet.ts:3288-3320`, `plot-dispatch.sh:1829-1844`, `test/reconcile/restart.test.mjs:478-483`, `test/reconcile/fleetctl.test.mjs:495-512`. I did not run `tsc` or any test suite; finding 3's typecheck failure is inferred from `strict: true` and the switch with no `default`, not observed. I did not read issue #3100 on the host.
