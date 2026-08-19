# Brief: feature/continue-with-an-answer

Implement wave **Answer** of `docs/plans/2026-08-17-working-shows-the-agent.md`.
Read the plan first — **section 4 and the Done-when list, not only the branch
line.**

## Read the plan's PROSE, not its branch line

The branch line in the Branches section says *"prompted with the transcript and
the answer"*. **That is stale.** The plan was interrogated on 2026-08-19 and
section 4 plus its Done-when criterion were rewritten; the one-line summary was
not updated with them.

The decision that stands:

> **Its prompt is the brief plus the answer plus what already landed — not the
> previous transcript.**

The reasoning, which you should not re-litigate: a worker that ran an hour
produces a six-figure-token transcript, and handing it over fills the new
worker's context before it begins. The brief is the specification and has not
changed; the answer is the new fact; and what the previous run committed is
already in git, which the worker reads anyway and which cannot go stale the way
a copied transcript can.

**If the branch line and section 4 disagree, section 4 wins.** Fix the branch
line as part of this work.

## What already exists — build on it, do not reinvent

| Piece | Where |
|---|---|
| a POST endpoint that spawns a worker | `/api/dispatch` (`index.ts:85`) |
| same-origin guard for spawning endpoints | `isSameOrigin` (`dispatch.ts:77`) |
| bounded JSON body reader | `readJsonBody` (`dispatch.ts:99`) |
| the spawn itself | `handleDispatch` (`dispatch.ts:144`) |
| the question the worker is waiting on | the `waiting` row's note (#241) |
| the panel the control belongs on | `/api/worker-log` + the agent panel (#239, #244) |

The board can already start workers. This wave adds **a continuation**, not a
second spawning mechanism. Reuse the same-origin guard and the body limit —
they exist because this endpoint class spawns processes.

## What to build

**Given an answer, start a fresh worker in the same worktree.**

**Name it a continuation, not a reply.** The plan is explicit and the reason is
honest UI: *the agent that asked is gone — what continues is the work, not the
conversation. A UI that implies otherwise would promise a channel that does not
exist.* Call the control **"Continue with an answer"**.

**The prompt is: brief + answer + what already landed.** Name the commits the
previous run made; do not paste their contents, and do not embed the transcript.

**It is a NEW run.** Do not reuse the previous pid. The row must show the new
worker as a new worker.

**Clear the marker, or say why you did not.** The `PLOT-BLOCKED`/`TODO(you)`
marker in the tree is what makes the branch read `waiting`. A continuation
started while the marker still stands leaves a worker that has been answered
looking unanswered — measured today: a stale marker survived its own answer by
55 minutes and made finished work read as blocked. Decide deliberately whether
the continuation clears it or the new worker does, and write the reason down.

## Definition of Done

- Answering starts a **new** run and says so — assert the previous pid is not reused
- The control is named as a continuation, not a reply
- The prompt contains the brief and the answer and names what already landed
- The prompt does **not** embed the previous run's transcript — assert this
  explicitly; it is the decision the interrogation turned on
- The spawning path reuses the existing same-origin guard and body limit
- A branch with no marker, or no worktree, cannot be continued — a clear refusal,
  not a spawn
- The stale-marker case is handled and the choice is documented
- The plan's branch line is corrected to match section 4
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not implement *Machine* or *Registry* — later waves
- Do not build a chat channel, a reply thread, or anything implying the previous
  agent receives the message
- Do not add a second process-spawning path beside `/api/dispatch`'s
- Do not re-derive worker liveness — `plot-worker-state.sh` decides it once

## Scope note — this wave crosses a line the sprint drew

The sprint `2026-W34-working-shows-the-agent` is deliberately **read-only**, and
this wave was listed under Deferred for that reason. It was pulled in on
2026-08-19 by an explicit decision. **It is the only acting wave in the sprint**
— *Machine* and *Registry* stay out. Keep the blast radius to continuation:
the panel still acts on nothing else.

## Platform and machine notes

`fleet.ts` is held by two sibling branches as this is written
(`a-terminal-branch-is-asked-once`, `the-cadence-knows-what-a-refresh-costs`).
Rebase before you push and **expect the board artifact to conflict** — it is
`-merge` in `.gitattributes`, so take either side, run `pnpm build:board`, and
commit the rebuild. Never phrase it as "take ours": *ours* inverts between merge
and rebase.

CI runs Linux; you are probably on macOS. Run the suites **one at a time**.

**A test must not race what it asserts.** Measured today: a 1 ms timeout budget
on a two-file repo passed on macOS and failed on CI, where the work finished
inside the millisecond.

**Line numbers in this brief may have drifted** — a sibling agent found one off
by 280 lines today. Follow the rule, not the number.

**Other agents run on this machine.** Kill only servers you started — `pkill -f
board-server.mjs` matches every board including the operator's.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
