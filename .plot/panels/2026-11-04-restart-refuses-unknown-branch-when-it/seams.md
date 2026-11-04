# Seams juror: restart refuses unknown-branch when it has no current pulse

Position: amend

## Findings

1. **The new reason lands in a shared union, and the board breaks on it.** `restartBranch` returns `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99`), the type `continue`, `restart` and the board share. `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76`) is a `switch` over that union with no `default` and a `string` return type, under `"strict": true` (`packages/board/tsconfig.json`). Adding `'no-pulse'` to the union without a `case` makes `pnpm run typecheck` fail (TS2366). `RestartTheWorker.tsx:3,87` renders that word for a restart refusal. The plan says "Board impact: none" and names neither file.

2. **`restartBranch` has a second caller: the board route.** `packages/board/src/server/restart.ts:64-68` calls `restartBranch` with `pulseFor(opts)`, which returns `null` on a cold board cache (`packages/board/src/server/fleet.ts:3301`, its doc: "No pulse yet"). After the change `POST /api/restart` answers `no-pulse` too, and the planned detail "the fleet has written no current reading" is wrong there: the board's own scan has not arrived, the fleet bridge is not read. The plan scopes itself to `plot-restart-command.mjs` and does not name this caller. `packages/board/test/unit/restart-route.test.ts:52-55` asserts `unknown-branch` with a stubbed pulse; the plan must say whether that stub is null.

3. **Open PR #3109 edits the same files.** #3109 (`bug/an-answer-records-its-true-author`, plan `a-desk-s-design-question-waits`) changes `packages/fleet/src/shared/continuation.ts`, `ContinueWithAnAnswer.tsx`, `packages/board/src/server/continue.ts` and `packages/fleet/src/server/entry/continue-command.ts`. Both changes touch the `ContinueRefusal` union and the `refusalWord` switch. Whichever merges second rebases on a textual conflict in the union. The plan names no ordering.

4. **Open PR #3112 edits `skills/plot/scripts/README.md`.** Rows 85-86 of that file document `plot-continue-command.mjs` and `plot-restart-command.mjs` as refusing "`unknown-branch` and `no-worktree`". Row 86 becomes incomplete after this change. The doc comments at `packages/fleet/src/server/entry/restart-command.ts:18` and `packages/fleet/src/shared/restart-command.ts:101-103` say the same. The plan's third Open Question asks to "search", but the search result is known and the plan should name these files as slice scope.

5. **`continue` and the agent panel share `branchFromPulse`.** `packages/fleet/src/shared/continue-command.ts:83` and `packages/board/src/server/agent-panel.ts:161-162` both refuse `unknown-branch` on a null pulse. The plan names `continue` as an Open Question only. Scoping `restart` alone leaves two controllers that give different answers for the same missing bridge; that is a drift the plan creates on purpose and must record as a follow-up issue rather than an open checkbox, so the unattended agent does not decide it.

6. **No shell or corpus seam.** `plot-dispatch.sh --restart` matches no refusal string (grep for `unknown` near `restart` returns nothing). No corpus test in `packages/domain/corpus/` covers restart or continue refusals; no declared shell/domain duplicate exists for this rule. The shell-lines ratchet is not touched.

## Required amendments

- Replace "Board impact: none" with the board files the slice must change: `ContinueWithAnAnswer.tsx` (`refusalWord` case for `no-pulse`) and, if it is decided to keep the board's wording distinct, `packages/board/src/server/restart.ts`.
- Name the board route as a second caller of `restartBranch`, and choose a detail that is true for both callers (for example "no current fleet reading is available"), or let the caller pass the detail.
- Add `skills/plot/scripts/README.md` row 86 and the two doc comments to the slice scope.
- Name the ordering against #3109: rebase after it merges, and expect a conflict in the `ContinueRefusal` union.
- Close the three Open Questions before approval: `continue` becomes a filed follow-up issue (a person decides), the status is fixed (404 or 503, a person decides, because a board caller reads it), and the string search is recorded as done with the result above.

## Decisions for a person

- Whether `continue` and the agent panel get the same fix in this plan or a follow-up.
- 404 versus 503 for `no-pulse`.

## Ran versus read

Ran: `gh pr list`, `gh pr view --json files` for #3105 #3109-#3116, `gh pr diff 3109` (file list), `git grep` on `origin/main` for `unknown-branch`, `restartBranch`, `ContinueRefusal`, `branchFromPulse`, `pulseFor`. Read: `restart-command.ts` (shared and entry), `continuation.ts:99-124`, `ContinueWithAnAnswer.tsx:25-90`, `board/src/server/restart.ts:40-90`, `board/src/server/fleet.ts:3295-3320`, `board/tsconfig.json`. Did not run typecheck; the TS2366 claim follows from the switch shape and `strict`.
