# The board navigates, and acts through Plot

> Links to the artifacts a row names, and one button that starts work — by
> asking the same chain `/plot-dispatch` asks, never by deciding itself.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- Board rows and cards link to what they name: the plan (in the existing
  viewer), the pull request, and the story.
- A plan card whose plan is approved carries **Start work** — it runs
  `plot-dispatch.sh` for that plan, exactly as `/plot-dispatch` does. Available
  only while the board is bound to localhost, and only for requests the browser
  reports as same-origin.

Board impact: **yes, and it is the whole plan.** No plan-format change and no
new helper script — `plot-dispatch.sh` already does the work. The board gains
its first non-GET route, which is a change in kind rather than degree and is
why the localhost condition is designed rather than added.

That change is smaller than it sounds, and must stay that way. `handleRequest`
opens with a blanket `if (req.method !== 'GET') return 405`, which is why no
existing route has ever had to think about verbs. Rather than remove that
guard, the dispatch route is **allow-listed ahead of it**: the guard keeps
protecting `/api/board`, `/api/fleet` and `/plan/*` exactly as it does today,
and precisely one path-and-verb pair slips past.

    if (url.pathname === '/api/dispatch' && req.method === 'POST') { … }
    if (req.method !== 'GET') { 405 }   // unchanged, still the default

Per-route method checks would be the more conventional shape, and are rejected
for the reason this repo rejects prose MUSTs: a check every future route has to
remember is a rule, while a default that refuses is a gate.

## Motivation

The Agents tab answers *what are my agents waiting for*. It answers nothing
else: a row names a branch, a plan and a wave, and every one of those is a dead
end. To see the PR you leave for the browser, to read the plan you leave for the
editor, and to start the work you leave for the terminal.

Two different gaps hide behind that, and conflating them is how a read-only tool
becomes an unauthenticated remote control.

**Navigation** is the artifacts a row already names. The data is present — the
plan viewer has existed since July, rows carry the plan slug, and
`pr-list --rich` has carried PR numbers since yesterday. Nothing about the
board's posture changes.

**Acting** is starting work. `plot-dispatch.sh` already creates the worktree,
pushes the claim and starts a detached worker; `/plot-dispatch` is a thin prose
wrapper over it. What is missing is a button — and a button on a server with no
authentication is a different proposition from a link.

## Design

### Approach

**Navigation first, and it is unremarkable.** A row's branch links to its PR
where one exists, its plan opens the viewer at `/plan/<file>`, and its story
scrolls to that swimlane. Cards gain the same. All read-only, all GET.

One thing is missing and must be added: **cards carry `slug`, `story` and
`path`, but no PR numbers.** `PlanMetaSchema` parses `prs` as
`z.array(z.number())`; `CardSchema` has no such field; and `board.ts` contains
**no occurrence of the string `prs` at all** — so the numbers are parsed and
dropped without anything in between. Carrying them through is the whole of the
PR-link work, and the absence is a grep result rather than a reading of the
contract.

Where a row has no PR, it links nothing rather than guessing a URL — the same
rule the fleet already follows for absent data.

**Acting is where the design lives.**

The button says *Start work* and sits **on the plan card**, not on an agent row.
That placement is not cosmetic. `plot-dispatch.sh` takes a **slug**, not a
branch: it asks `plot-fleet-scan.sh --next` which branch is eligible, and its
own comments say *"Eligibility is NOT decided here"* and *"a blocked wave can
never be fanned out by accident"*. A button on a branch row would promise
"start this one" and deliver "start whichever is next" — a lie the layout would
tell on the board's behalf.

So the board expresses an **intent about a plan**, and the existing chain
decides everything else: which branch, whether the wave is open, whether the
claim succeeds, whether the phase gate allows it. The board cannot bypass a
rule it never evaluates.

    POST /api/dispatch { slug }
      → spawn plot-dispatch.sh --max 1 <slug>, stdout → <repo>/../plot-dispatch-<slug>.log
      → 202 { slug, log } immediately — before the script has done anything

`--max 1` because a button is one decision. Fanning out a whole wave stays with
`/plot-dispatch`, where the human sees the count first.

**The 202 is a real 202, and the response body cannot carry a result.** A
dispatch creates a worktree and pushes a claim — a network write, strictly
slower than the 0.5–1.05 s scan that already forced the fleet cache to exist on
this single-threaded server. Awaiting the script would freeze every viewer's
board for the duration of someone else's click. So the handler spawns and
returns, and the script's summary line — which only exists once the run is
finished — is not in the response at all.

That the outcome is missing from the response is not a gap to paper over: it is
the same shape as `start_worker`'s own detached spawn, and it is why the row
moving is the answer rather than the reply being one.

**Where the script's words go.** The server picks the log path *before* it
spawns, keyed by slug, because it cannot know the branch: `--max 1` asks
`--next` at runtime which branch is eligible, and the worktree path derives
from that answer. `<repo>/../plot-dispatch-<slug>.log` is knowable at 202 time;
`<worktree>/.plot-worker.log` is not. Both exist and neither replaces the
other — the first records what the dispatcher did, the second what the agent is
doing.

This matters most in the case that looks like nothing: with no `Worker command`
configured, `start_worker` returns 1 **and that is not an error**. It creates
the worktree, pushes the claim, and prints a `cd <path>` plus a CLAUDE.md hint,
because Plot hardcodes no agent tooling (Principle 5). The board surfaces those
lines verbatim rather than restyling them — Principle 3, and a second copy of
that message in TypeScript is a second copy to drift.

**The button condition is the gate's condition: `phase === approved`.** Not a
board column. `plot-dispatch.sh` refuses every other phase — Draft exits 1 with
*"Review it, then: /plot-approve"* — so a button on an unapproved plan could
only ever fail, which is the same lie about the layout that kept the button off
agent rows. But "Development" in the board's phase model means
*approved **and** started*, and a plan that is approved and **not** started
renders under Design. That is the first-dispatch case — the one the button is
most for. Keying on the column would hide it from exactly those plans, so the
button follows the phase the script actually checks, in whichever column the
card happens to sit.

The card already computes this. `PlanCard` renders its **Ready** badge on
`card.phase === 'Design' && card.started === false` — precisely "approved but
not started". The button reuses that condition and adds Development cards,
which are approved and started. Nothing new on `CardSchema`, and the badge and
the button cannot disagree, because they are the same expression.

**Start work is a `<button>`, never an anchor.** Open is an anchor on purpose —
it has a URL, and cmd/ctrl/middle-click must open the plan natively. Start work
has no URL and must never be openable in a new tab, prefetched, or bookmarked;
it is a state change, not a destination. A real button also gives keyboard
activation and a native `disabled`, so the *starting…* state is a real disabled
control rather than a simulated one.

    <button type="button" disabled={starting} aria-busy={starting}>
      {starting ? 'starting…' : 'Start work'}
    </button>

**The wait has a bound.** If the pulse never confirms — the claim lost its
race, no branch was eligible, the script failed — the button stops after about
three pulses (~12 s: enough for a worktree create plus a push, short of leaving
someone staring) and says **"no change — see log"** with the path. It does not
guess which of the three happened. The script already wrote the truth to the
log; inventing a reason in the UI would be the board asserting something it
does not know, which is the failure mode this whole design is arranged against.

**A double click is safe but not quiet.** Two clicks, or two tabs, fire two
runs at one slug; the claim race handles the danger (the loser's non-fast-
forward push is rejected and its worktree removed), so nothing is corrupted.
What is left is a confusing story: two spinners, one worktree. The button
therefore goes to *starting…* and stays disabled until the pulse moves the row
or a few cycles pass. Local state, no in-flight registry on the server —
git remains the only thing holding the lock.

**The binding is the authorisation.** The route exists only while the server
listens on localhost; with `HOST=0.0.0.0` — which the fleet user test uses for
Tailscale — it returns 403 and the button renders disabled with the reason.

This is a deliberate refusal to invent an auth scheme. Whoever reaches
`localhost:7777` is sitting at the machine that owns the worktrees; that *is*
the permission, and it needs no token to express. A hand-rolled token in a URL
would look like security while being a shared secret in shell history, and
authentication is the category of decision where amateur schemes fail quietly.
When the board legitimately needs to act over a network, that is a plan with an
auth design in it — not a flag.

**But the binding answers reachability, and the browser is not a network
question.** Any website the user happens to visit can issue

    fetch('http://localhost:7777/api/dispatch', {method:'POST', mode:'no-cors', …})

and the browser will send it. The server sees a request from localhost and
accepts. The attacker cannot read the reply — and does not need to: the
worktree exists and the claim is pushed before the response is written. Textual
CSRF, and the one hole the binding argument cannot cover on its own. No route
in the server validates `Origin` today, because until now no route did anything.

The route therefore requires that the request came from the board itself:

    if (req.headers['sec-fetch-site'] &&
        req.headers['sec-fetch-site'] !== 'same-origin')     → 403
    if (req.headers.origin &&
        req.headers.origin !== `http://localhost:${PORT}`)   → 403

Both headers are set by the browser and cannot be forged by page JavaScript,
which is exactly why they are worth checking and a token is not. This is not
the auth scheme the plan refuses to invent — it invents nothing, stores nothing,
and shares no secret. It only insists that a state-changing request came from
the page allowed to make it.

It also settles a road not taken: `GET /api/dispatch?slug=…` would have avoided
the 405 question entirely and been strictly worse — a verb that lies, fireable
by a prefetcher or a link, and not even nominally protected by the preflight
rules that constrain cross-site POSTs.

**Only start, never stop.** The asymmetry is real: a start is reversible for the
price of `--stop`, while a stop kills a running session and whatever it had not
committed. `--status` and `--stop` stay in the terminal, where the person
running them has the context to know what dies.

**Feedback is derived, not asserted.** The button does not move the row. The
4-second pulse re-reads git and the row travels from *not started* to *working*
on its own — Principle 1, and the same reason the fleet has no database. Between
the click and the next pulse the button shows *starting…*; if the pulse does not
confirm within a few cycles, it says so rather than pretending.

An optimistic update would be faster and would make the board display something
it does not know. Three defects this week were exactly that shape — a board
update that never happened looking like a board nobody configured — so the
board keeps saying only what git told it.

**Manifesto check.** Principle 1: the button changes git, and the display still
derives from git. Principle 3: `plot-dispatch.sh` collects and acts; the board
only asks — and where the script speaks (the missing `Worker command`), the
board quotes rather than paraphrases. Principle 5: nothing project-specific;
the `Origin` check names the board's own port, not a deployment. Principle 12:
the outcome is read back from a pulse rather than assumed from a 202, and when
the pulse says nothing the board says *nothing changed* rather than inferring a
cause.

### Open Questions

- [ ] What does the button do when the plan has **no eligible branch** — every
      wave blocked or every branch claimed? `plot-dispatch.sh` reports
      `dispatched=0` and the row never moves, so the click reads as a click
      that did nothing. Disabling it beforehand needs the eligible count on the
      card, which it does not carry today; the log names the reason, which is a
      worse answer than a disabled button and a better one than silence.
- [ ] Does the story link belong on a row, given the Agents tab has no story
      grouping? Scrolling to a swimlane means switching tabs first.

Two questions left this section during interrogation, both answered by reading
the script rather than by deciding anything. Whether **Design** cards get the
button: the phase gate settles it — the condition is `approved`, not a column
(see Approach). Whether the 202 can carry the script's summary: it cannot, and
the attempt to have both is what surfaced the log-path design above.

## Branches

### Navigation

- `feature/board-artifact-links` — PR numbers on cards, links from rows and cards to plan, PR and story

### Dispatch

- `feature/board-start-work` — `POST /api/dispatch` allow-listed ahead of the 405 guard, localhost-bound and same-origin-checked, spawn-and-202 with a slug-keyed log; Start work on cards whose plan phase is `approved`

<!-- Two waves, one branch each. Both touch the board bundle, so they cannot
     run concurrently; navigation goes first because it is the half that is
     unarguable, and it ships value even if the button is never built. -->

Navigation ships first deliberately. It is the half nobody has to think about,
it is useful alone, and it keeps the board read-only — so if the dispatch half
stalls in review, what landed is still an improvement rather than a half-built
control panel.

## Notes

Shaped in conversation on 2026-08-16, from the observation that the Agents tab
is informative but inert. The first framing was about linking artifacts; it was
corrected to *acting through the orchestrator rather than in the board*, which
is what put the button on the plan card and the decision-making in
`plot-dispatch.sh`.

Interrogated over four rounds before approval. What the rounds changed came
almost entirely from reading `plot-dispatch.sh`, `index.ts` and `PlanCard.tsx`
rather than from reasoning about the design: the blanket 405 that had to be
preserved instead of removed, the phase gate that answered an open question
outright, the `start_worker` return-1-is-not-an-error case, and the 202/summary
contradiction that could not survive contact with a network write on a
single-threaded server.

The fourth round found the one thing the design was actually wrong about rather
than vague on. "The binding is the authorisation" reads as a complete argument
and is not: it reasons about who can *reach* the port and says nothing about
what a browser will *send* on a visited page's behalf. The fix is small and the
gap was invisible from inside the plan's own framing — which is the argument
for interrogating a plan whose security reasoning sounds finished.

The same round found the opposite kind of surprise: `PlanCard` already computes
`Design && !started`, the exact "approved but not started" state round 3 had
derived from the script's gate. Two independent paths to one condition, with
the code there first.

Deliberately not here: stopping workers, reading worker logs in the board, and
anything that acts over a network. Each is a separate plan, and the last one is
an authentication design before it is a feature.

Definition of Done: `docs/definition-of-done.md`.
