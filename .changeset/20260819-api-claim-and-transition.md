---
"@plot-pm/board": minor
---

board: agents change state through validated calls that return what resulted

The read path is the most engineered part of this system — a 5 s scan cache, a
60 s PR refresh with backoff, a disk-persisted last-good pulse, staleness
rendered honestly. The write path was two endpoints, both human-clicked, and an
agent's whole loop was *read several scripts, guess which applies, edit
markdown, push, and hope the derived view agrees*. Each step can fail quietly,
and one did: a hand-written plan parsed correctly, carried the right phase, sat
on `origin/main`, and was **invisible** to every unscoped scan. Valid and
unreachable at the same time, with nothing saying so at the moment of writing.

`POST /api/claim` and `POST /api/transition` close that loop. Each wraps
machinery that already exists, and each returns the resulting state — which is
the whole point rather than a nicety. A `200 OK` with no state leaves the caller
doing exactly what this replaces: asking a second endpoint whether the first one
landed, and guessing when the answer is stale.

## Wrapped, never reimplemented

`/api/claim` runs `plot-dispatch.sh --no-start --max 1`. The claim stays a **ref
push whose tip is an empty commit**, and that detail is the entire mechanism:
two independent claims diverge, so the loser's push is rejected as
non-fast-forward, and git is the lock. Pushing a branch that merely points at
`origin/<main>` would not work — the remote already has that commit, both pushes
succeed, and both callers believe they won. Server-side claim state would put a
second source of truth beside the repository and break the property that makes
the fleet restartable: kill anything, and the next pulse re-derives truth from
git.

`--no-start` is a flag the script already had. **Claiming is not dispatching**:
an agent that has committed to doing work has not asked for a second agent to do
it. `/api/attention` states the same split from the other side — a survey that
reserved would be a mutation.

`/api/transition` contains **no phase logic at all**. It runs the spoke's script
and reports what the script said, so a transition the spoke refuses is refused
here in the spoke's own words. That is the plan's open question answered:
wrapping keeps one implementation and inherits its prose, while superseding
would put the four guardrails in two places and make the API a bypass of the
lifecycle rather than an interface to it.

The subtlety that vindicates the choice is one a reimplementation would have
lost. `Approved → approve` **is not refused**: `plot-approve.sh` treats it as the
idempotent repair, because a run that finds the phase already flipped still has
holds to clear and a record that may be missing. It reads like it should be an
error, and an API writing its own rules would have "helpfully" made it one —
silently breaking the path the script documents as *run it again is the repair
for every interruption*. A test now keeps that inherited.

Both endpoints answer **200 on a refusal**. Losing a claim race is the normal
outcome of a fleet working correctly, and a guardrail refusal is the lifecycle
operating as designed; a 4xx would train callers to treat their own healthy
behaviour as a fault and retry what will be refused identically every time.
What resulted is in the body, which is the premise.

## The loopback boundary is now a gate rather than a sentence

The plan recorded the trust model as answered — *"loopback is the boundary and
already in force"* — and it was not. Verified 2026-08-19: `HOST` was read once
in `index.ts` and **never checked**. Nothing stopped `HOST=0.0.0.0`, which
published `/api/dispatch` — an endpoint that spawns detached agents — to every
interface the machine had. The claim held only while nobody set it, and these
are the first endpoints that change repository state rather than starting a
local process.

The check now lives in the **router**, once, ahead of every write route, and
that placement is the change rather than an implementation detail. Three
handlers each carried their own copy, which is what this repo calls a rule:
correct today, correct tomorrow only if every future write route remembers. A
check where routes are *dispatched* is a gate — the sixth write endpoint
inherits it by construction, the same argument the blanket 405 makes one branch
further down.

The three copies are removed rather than left beside it, and the reason is
sharper than tidiness. Once the gate grew a named opt-in, a surviving copy would
have honoured a **different policy**: the opt-in would open `/api/claim` and be
refused at `/api/dispatch`, so one variable would mean two things depending on
which route read it. That is precisely the failure `approve.ts` records for
capability flags. `dispatchAvailability` and its two siblings stay — they answer
*will this button act*, which is a different question asked at a different time,
and they remain the source the gate reads so the two cannot disagree about what
loopback means.

Loopback is `localhost`, `127.0.0.1`, `::1`. `0.0.0.0` is deliberately excluded:
it is what the fleet user test uses to read the board over Tailscale, and
"sitting at the machine that owns the worktrees" stops being true the moment the
address is reachable from elsewhere. **Reads are untouched** — a phone reading
this board over Tailscale is the workflow the gate must not break.

The opt-in is `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand`, and the awkwardness
is the feature: a flag that reads like a convenience gets set by someone who has
not thought about it. The **value** is checked, not the variable's presence, so
`1`, `true` and `yes` — what a person types when guessing — leave the gate shut.
The refusal names the binding, the boundary, the exact escape, and what the
escape costs, because a bare 403 sends a developer who bound wide for a reason
to the source.

## What the plan did not anticipate: only one transition is mechanised

Plot has four phases and three transitions, and exactly **one** has a script.
`plot-approve.sh` performs `Draft → Approved` as seven writes with no judgement
in any of them. `Delivered` and `Released` are written by `/plot-deliver` and
`/plot-release` as *prose an agent applies* — there is no mechanical entry point
to wrap.

So supporting them would have meant writing those guardrails a second time
beside the ones that already exist, which is the one thing this branch was told
not to do. They are refused by name with **501**, naming the command that owns
each: the caller asked for something real and correctly spelled, and a 400 would
send it to fix a spelling that is right. A refusal that names the owner is a
smaller failure than a duplicate guardrail that drifts.

Making them real is a larger change — it means giving deliver and release the
mechanical halves approve got — and it deserves its own interrogation rather
than being folded in here.

## Testing

The guardrail tests run the **real** `plot-approve.sh`, not a stub. A stub
exiting non-zero would prove the wiring and nothing about the property that
matters — that the API cannot approve a plan the spoke would refuse. Only the
real script can show that, because the real script is where the rule lives. It
is safe because those refusals fire from the plan file before any host contact,
in a fixture repo with no remote: nothing could be merged or pushed even if a
guardrail had failed to hold. The suites that would reach the host use the stub.

The load-bearing assertions are the negative ones — a refused request **spawned
nothing**, and a refused transition **wrote nothing to the plan file**. Every
other assertion in those suites can pass while the side effect still happened.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched — `plot-dispatch.sh` and `plot-approve.sh` are wrapped exactly as they
are, which is the point, and `plot-fleet-scan.sh` and `plot-worker-state.sh` are
deliberately untouched. The `/api/board` and `/api/fleet` payloads are unchanged.
