# Juror: layering

Position: amend

## Summary

The change routes nothing past a controller, buys no host answer, and adds no shell. It reads the fleet-written bridge, which is the index direction. Its defect under this lens is scope: the new refusal reason is a member of the shared `ContinueRefusal` union, and the plan claims "Board impact: none" while the board's `.tsx` refusal switch must change or the board typecheck fails.

## Findings

1. **The new reason enters a shared union with a board consumer.** `restartBranch` returns `DeskContinuation`, whose refusal `reason` is `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99-147`). `'no-pulse'` is not a member, so the slice must add it there. `refusalWord(reason: ContinueRefusal): string` in `packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76` is an exhaustive `switch` with no `default`, under `"strict": true` (`packages/board/tsconfig.json`). A new member without a case fails `pnpm run typecheck` with TS2366. `RestartTheWorker.tsx:2,26,55` imports the same type. The plan's "Board impact: none" (plan line 19) is false, and the slice text names no board file.
2. **The wording decision lives in a component.** `refusalWord` decides user-facing text in `.tsx`, which the layering rule ("Every rendered state is a domain property") names as a decision not yet extracted. This is pre-existing. The plan must not grow it silently: either add the case there and say so, or (preferred, smaller) let the board render the refusal's `detail` that `restartBranch` already returns.
3. **The rule sits outside the domain, as its neighbour already does.** The `unknown-branch` / `no-worktree` classification is in `packages/fleet/src/shared/restart-command.ts:114-123`, not in the domain's `restartWorker` (`packages/domain/src/workflows/dispatch-verbs`). The plan adds a third branch to that shared helper. CLAUDE.md says "No domain-specific code or behaviour lives outside the domain". The addition is two lines next to an existing out-of-domain lookup, so this is a note, not a blocker; moving the lookup into the domain is a separate plan.
4. **The detail text names the wrong source for one caller.** Three callers pass `pulse`: the bundle (`packages/fleet/src/server/entry/restart-command.ts:49-52`, the bridge), `restart-stopped-command.ts:38-45,102` (the bridge), and the board route (`packages/board/src/server/restart.ts:67`, `pulseFor` at `packages/board/src/server/fleet.ts:3301`, the board's own cached scan). The detail "the fleet has written no current reading" is true for the first two and wrong for the board, whose `null` means its own scan has no reading. The plan names only the bridge (Motivation, lines 28-30).
5. **No shell growth, no controller bypass, no host purchase.** The change touches TypeScript only. `plot-dispatch.sh --restart` (the launcher) does not match on the reason string per the grep below, so `scripts/check-shell-lines.sh` is unaffected. The restart controller stays the route.
6. **Docs name the refusal set.** `skills/plot/scripts/README.md:85-86` and the module doc at `packages/fleet/src/server/entry/restart-command.ts:18` and `restart-command.ts:105` (shared) list "`unknown-branch` and `no-worktree`". The slice must update them; Open Question 3 asks for the search but the slice line does not require the edit.

## Amendments required

1. Replace "Board impact: none" with the board files the slice touches: `continuation.ts` (`ContinueRefusal` gains `'no-pulse'` with a TSDoc line), and `ContinueWithAnAnswer.tsx` `refusalWord` gains a case. Name `pnpm run typecheck` as a check the slice runs.
2. Make the detail caller-neutral, for example `no fleet reading is available to look the branch up in`, or state that the board route maps the reason to its own text. Do not name "the fleet" for the board's scan.
3. Add to the slice: update `skills/plot/scripts/README.md:86`, and the TSDoc at shared `restart-command.ts:102-113` and entry `restart-command.ts:18`, to list `no-pulse`.
4. Resolve Open Question 2 in the plan before approval: keep 404 (one fewer decision for a Sonnet agent; the board route forwards the status). Resolve Open Question 1 as a follow-up issue, not this slice, since `continue-command.ts:74-90` returns the same union and the same fix there doubles the board-text work.

## Decisions for a person

- Whether `continue` gets the same refusal now or in a follow-up (Open Question 1).

## Ran versus read

Ran (read-only): `git show origin/main:` on `packages/fleet/src/shared/restart-command.ts`, `packages/fleet/src/server/entry/restart-command.ts`, `packages/fleet/src/shared/continue-command.ts`, `packages/fleet/src/shared/continuation.ts`, `packages/board/src/app/components/ContinueWithAnAnswer.tsx`, `packages/board/tsconfig.json`, `packages/fleet/src/server/entry/restart-stopped-command.ts`; `git grep` for `ContinueRefusal`, `restartBranch`, `unknown-branch`, `no-pulse` over `packages` and `skills`. Read only: the plan and the repo CLAUDE.md. Did not run typecheck or any test; the TS2366 claim follows from the exhaustive switch, its `string` return type and `strict: true`.
