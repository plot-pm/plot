# Brief: feature/an-issue-becomes-a-plan

Implement wave 2 of `docs/plans/2026-08-18-an-issue-is-a-signal-the-board-can-see.md`.
Read the plan first. Wave 1 (#236) is merged, and its dependency
`the-scan-asks-once-not-once-per-branch` was delivered 2026-08-19.

## What wave 1 already shipped — build on it

| Piece | Where |
|---|---|
| open issues the host reports | `plot-host.sh issue-list` (line 522) |
| issues no plan references | `fleet.ts:305`, `fleet.ts:1031` |
| the row, read-only, in WAITING ON YOU | `IssueRowSchema`, `schema.ts:1730` |
| `issueAnswer` — asked / unsupported / failed | `schema.ts:1737` |
| the reference that makes a row disappear | `Issue: #228` in a plan, parsed at `plot-plan-meta.sh:256` |

The row exists and is honest today. **This wave adds its one action.**

## What to build

**The row's one action hands the issue to `/plot-idea` as a problem statement,
producing a Draft that references the issue.**

**It creates a Draft. Never an Approved plan.** The whole design rests on this:
the row is *"not a plan in an earlier state, it is a signal that has not become
one yet"*. An action that skipped Draft would decide something the operator has
not decided.

**The reference is what makes the row disappear.** The created plan must carry
`Issue: #<n>` in its `## Status` block — that is the field `fleet.ts:1031`
reads. Get this wrong and the row survives its own answer, which is the exact
failure `an-issue-is-a-signal` exists to remove.

**Nothing is written to the tracker.** No comment, no label, no state change.
Plot reads the tracker and never writes to it — a plan referencing an issue is
Plot's record, not the tracker's.

**Follow the existing write-endpoint shape.** `/api/approve` (`index.ts:77`),
`/api/continue` (line 98) and `/api/dispatch` (line 107) already establish it:
POST, same-origin guard, bounded JSON body. Do not invent a fourth shape, and do
not add a second process-spawning path.

**A tracker that cannot be asked has no action.** `issueAnswer` already
distinguishes `unsupported` (Bitbucket has no issue listing — `plot-host.sh`
exits 4) from `failed` (the lookup broke). Neither may offer an action that
cannot work, and `failed` must not read as "no issues".

## Definition of Done

- The created plan names the issue in an `Issue:` field that `plot-plan-meta.sh`
  parses — assert by parsing it, not by string-matching the file
- The row disappears once the plan exists — assert the round trip
- The plan is **Draft**, never Approved — assert the phase
- **Nothing is written to the tracker** — assert no write call is made
- The action follows the existing POST + same-origin + bounded-body shape
- An `unsupported` or `failed` tracker offers no action
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not write to the tracker in any form
- Do not create anything past Draft
- Do not change what wave 1 renders — #236 settled the row's shape, and its
  tests will tell you if you did
- Do not re-derive which issues are unreferenced; `fleet.ts` already does

## Platform and machine notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time**.

**A test must not race what it asserts.** Measured twice today: a 1 ms timeout
budget that passed on macOS and lost on CI, and a teardown racing a detached
child where `rmSync`'s `maxRetries` structurally cannot win. If you spawn
anything, make the teardown deterministic.

**Expect the board artifact to conflict on rebase** — it is `-merge` in
`.gitattributes`, so take either side, run `pnpm build:board`, and commit the
rebuild. Never phrase it as "take ours": *ours* inverts between merge and rebase.

**Line numbers in this brief may have drifted** — a sibling agent found one off
by 280 lines today. Follow the rule, not the number.

**Other agents may run on this machine.** Kill only servers you started —
`pkill -f board-server.mjs` matches every board including the operator's.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
