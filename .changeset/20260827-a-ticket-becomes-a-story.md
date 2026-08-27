---
"@plot-pm/board": patch
---

*Create story* acts. `POST /api/story` spawns a `Story command` for
`/story-tracking` on a ticket, and the control's refusal becomes **conditional**
rather than categorical.

**The refusal claimed impossibility and the skill contradicts it.**
`storyRefusal()` took no arguments and returned a constant —

> *a story is a decision you make — where it lives, whether it is wanted yet —
> so it is created with /story-tracking at a terminal, not from a board click*

— and its comment called that permanent: *"not an oversight to be filled by a
later wave … There is nothing to lift: the decision is the point."* A function
with no arguments cannot be reporting a fact about a repo; it was a claim about
stories. Measured against `skills/story-tracking/SKILL.md`, neither named
decision is what it says it is:

- **Where it lives** — the skill states its own escape: *"Skip the question only
  when the repo has exactly one home"*.
- **Whether it is wanted yet** — triage, with the skill's own override: an
  explicit request beats triage advice. **A click on *Create story* IS that
  request.**

And the ground it stood on — *an unattended agent has nobody to ask* — is refuted
by the practice: `/story-tracking` is run unattended several times a day from the
prompt, through the same `PLOT_UNATTENDED` contract that makes *Create plan*
work. A skill run unattended many times a day cannot be categorically unrunnable
unattended.

1. **`/api/story`, the twin of `/api/idea`.** The ticket is written to a FILE and
   only its path is passed. This is a command-injection boundary, not a style
   choice: `Story command` is a shell fragment run through `sh -c`, and an issue
   body is free text from anyone who can file one. `PLOT_UNATTENDED=1`,
   `PLOT_ISSUE` and `PLOT_STORY_PROMPT` are exported.

2. **Homes are counted from `Story directory`, NEVER from the filesystem** — the
   trap the design exists to avoid, and it was measured. A client repo holds
   `packages/website/content/{de,en}/stories/` and
   `images__deprecated/…/success-stories/…` beside its one real home, so a
   `git ls-files | grep stories/` counts **four homes where there is one** and the
   button would refuse *"more than one home"* in a repo with no ambiguity at all.
   Those are website content and image assets. Principle 5: Plot discovers what a
   repo DECLARES, never infers structure from names it did not choose.

3. **Several declared homes refuse and name the question**, rather than guessing.
   The asymmetry is the reason: a missing story is recoverable; a story in the
   wrong home is referenced from elsewhere before anyone notices.

4. **An absent `Story command` refuses and NAMES THE KEY.** An unconfigured repo
   is the ordinary adopting case and stays fully asserted — what changed is that
   the refusal is about THIS REPO rather than about the act.

5. **`Story command` is set in this repo's `## Plot Config`.** The capability and
   its first configuration ship together: `Idea command` was set here and this was
   not, which is exactly why one button worked and the other refused. Shipping the
   capability alone would leave *Create story* still refusing in the repo that
   dog-foods Plot, with its happy path unexercised — and an unset key looks
   identical to a broken feature.

6. **The board offers no triage advice of its own** — a closed Open Point. A
   second opinion rendered in a menu is a second place to keep the heuristic
   correct, and it would drift from the skill's own triage. The brief hands over
   the fact that this is an explicit request and says nothing about whether a
   story is the right answer.

7. **`/api/idea` is unchanged**, and the ticket menu still offers both entries.

One deliberate divergence from `CreatePlanButton`: a created plan removes its
issue row — every plan carries the `Issue:` field the board reads — while a story
carries no such field and moves no row at all. So a success is SHOWN rather than
left to be inferred from silence, which would otherwise be indistinguishable from
a click that did nothing.

What the old refusal got right survives in the words rather than in a block: a
plan is a commitment to do work, a story a commitment to track work — so the
armed label reads `track #N` beside *Create plan*'s `Draft`.
