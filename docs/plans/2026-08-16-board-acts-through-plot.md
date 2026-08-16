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
- A plan card in Design or Development carries **Start work** — it runs
  `plot-dispatch.sh` for that plan, exactly as `/plot-dispatch` does. Available
  only while the board is bound to localhost.

Board impact: **yes, and it is the whole plan.** No plan-format change and no
new helper script — `plot-dispatch.sh` already does the work. The board gains
its first non-GET route, which is a change in kind rather than degree and is
why the localhost condition is designed rather than added.

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
`path`, but no PR numbers** (verified against the contract). The plan's `prs`
are parsed by `plot-plan-meta.sh` and dropped when the card is built. Carrying
them through is the whole of the PR-link work.

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
      → plot-dispatch.sh --max 1 <slug>
      → 202 with the script's summary line

`--max 1` because a button is one decision. Fanning out a whole wave stays with
`/plot-dispatch`, where the human sees the count first.

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
only asks. Principle 5: nothing project-specific. Principle 12: the outcome is
read back from a pulse rather than assumed from a 202.

### Open Questions

- [ ] What does the button do when the plan has **no eligible branch** — every
      wave blocked or every branch claimed? `plot-dispatch.sh` reports
      `dispatched=0`, so the honest answer is to show that. Whether the button
      should be disabled beforehand needs the eligible count on the card, which
      it does not carry today.
- [ ] Should a card in **Design** offer it at all? A plan without a `Started:`
      record has never been dispatched, so the first click is also the first
      start — which `/plot-implement` normally records. Possibly the button
      belongs only to Development, and Design keeps a link to the plan.
- [ ] Does the story link belong on a row, given the Agents tab has no story
      grouping? Scrolling to a swimlane means switching tabs first.

## Branches

### Navigation

- `feature/board-artifact-links` — PR numbers on cards, links from rows and cards to plan, PR and story

### Dispatch

- `feature/board-start-work` — `POST /api/dispatch`, localhost-only, Start work on plan cards

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

Deliberately not here: stopping workers, reading worker logs in the board, and
anything that acts over a network. Each is a separate plan, and the last one is
an authentication design before it is a feature.

Definition of Done: `docs/definition-of-done.md`.
