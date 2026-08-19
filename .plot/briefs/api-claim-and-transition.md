# Brief: feature/api-claim-and-transition

Implement wave **Act** of `docs/plans/2026-08-18-the-board-answers-agents.md`.
Read the plan first. Waves *Honesty* (#212) and *Ask* (#235) are merged.

## What exists, and the one thing that does not

| Piece | Where |
|---|---|
| `/api/attention` — what needs whom | `index.ts` (#235) |
| `/api/approve`, `/api/continue`, `/api/dispatch` | `index.ts:78`, `:99`, `:110` |
| same-origin guard | `isSameOrigin` (`dispatch.ts:77`) |
| bounded JSON body | `readJsonBody` (`dispatch.ts:99`) |
| the claim mechanism itself | ref push, `plot-dispatch.sh` |
| the phase guardrails | the spokes |

**The loopback boundary is NOT enforced.** Verified 2026-08-19: `HOST` is read
once (`index.ts:34`, defaulting to `localhost`) and never checked. The plan says
*"loopback is the boundary and already in force"* — that holds only while nobody
sets `HOST=0.0.0.0`, and nothing stops them. This branch carries the gate that
makes the claim true, and that is not incidental: these are the first endpoints
that let a caller change repository state rather than start a local process.

## What to build

**`POST /api/claim` and `POST /api/transition`**, each wrapping machinery that
already exists and each returning the resulting state.

**Wrap, do not reimplement.** The claim is a ref push and `plot-dispatch.sh`
already performs it; the transitions are the spokes' phase guardrails. An
endpoint that re-derives either would be a second implementation of a rule with
one home — the defect `one-worker-state-not-two` removed this morning.

**Return the resulting state, not an acknowledgement.** The plan's whole point:
agents change state through validated calls *that return what resulted*, instead
of editing markdown and hoping the derived view agrees. A `200 OK` with no state
leaves the caller doing exactly what this replaces.

**The gate: refuse to serve the write endpoints when `HOST` is not loopback**,
unless explicitly opted in. Loopback means `localhost`, `127.0.0.1`, `::1` —
decide the exact set and state it. The opt-in must be deliberate and named; a
flag that reads like a convenience will be set by someone who has not thought
about it.

**The refusal must be legible.** A developer who bound to `0.0.0.0` for a reason
needs to know why the endpoint refused and what to pass — a bare 403 sends them
to the source.

**Phase guardrails are not negotiable through the API.** A transition the spokes
would refuse must be refused here, with the same reason. If the API can approve
an unreviewed draft, it has become a bypass of the lifecycle rather than an
interface to it.

## Definition of Done

- `POST /api/claim` claims a branch by the existing ref-push mechanism and
  returns the resulting state
- `POST /api/transition` applies a phase transition through the spokes' rules
  and returns the resulting state
- A transition the spokes refuse is refused here, with its reason — assert at
  least one guardrail from each direction
- Both endpoints refuse when `HOST` is not loopback, unless explicitly opted in,
  and say why
- The existing three write endpoints gain the same protection — a gate that
  covers two of five is not a boundary
- Same-origin guard and bounded body reused, not re-written
- A GET on either path gets the blanket 405
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not reimplement the claim or the phase rules
- Do not let the API perform a transition a spoke would refuse
- Do not fold claiming into dispatching. `/api/attention`'s own comment states
  the separation: *an agent asking what is available has not yet committed to
  doing it, and conflating the two would make a survey a mutation.*
- Do not touch `plot-fleet-scan.sh` or `plot-worker-state.sh`

## Platform notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time**.

**A test must not race what it asserts.** Measured twice today: a 1 ms timeout
budget that passed on macOS and lost on CI, and a teardown racing a detached
child where `rmSync`'s `maxRetries` structurally cannot win.

**Expect the board artifact to conflict on rebase** — `-merge` in
`.gitattributes`, so take either side, run `pnpm build:board`, commit the
rebuild. Never phrase it as "take ours": *ours* inverts between merge and rebase.

**Line numbers here may drift.** Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
