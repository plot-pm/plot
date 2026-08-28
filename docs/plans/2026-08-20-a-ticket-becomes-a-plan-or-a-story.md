# A ticket becomes a plan or a story, by the same route

> A ticket gets one of two treatments: `/plot-idea` turns it into a plan, or
> `/story-tracking` turns it into a story. The operator does this **several times
> a day from the prompt**. The board offers both and can only do one — *Create
> story* refuses on principle.
>
> Measured 2026-08-20: the principle does not hold here.

## Status

- **Phase:** Released
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Delivered:** 2026-08-28
- **Released:** 2026-08-28, 2.11.0

## Problem

### The refusal claims impossibility and the skill contradicts it

`storyRefusal()` (`AgentList.tsx`) and its comment:

> *"there is no `/api/story`, and this is **not an oversight to be filled by a
> later wave** … There is nothing to lift: the decision is the point."*
>
> `'a story is a decision you make — where it lives, whether it is wanted yet —
> so it is created with /story-tracking at a terminal, not from a board click'`

Two decisions are named. Measured against `skills/story-tracking/SKILL.md`, neither
is what the refusal says it is.

**"Where it lives"** — the skill states its own escape:

> *"**Skip the question only when the repo has exactly one home**"*

This repo has one: `docs/stories/`, holding `plot-board`, `plot-gates`,
`plot-planning-model` — stories inside one home, the way `docs/plans/` holds plans.
So the question does not arise here at all.

**"Whether it is wanted yet"** — triage, with an override the skill writes down:

> *"if the user explicitly wants a story the triage advises against, push back
> once with the reasoning, then create it and note 'created on explicit request
> over triage advice'"*

**A click on *Create story* IS that explicit request.** The skill already has the
shape for it.

### And the practice refutes the premise

The refusal's ground is *an unattended agent has nobody to ask.* But
`/story-tracking` is run unattended several times a day, and Plot has a contract
for exactly this case — `PLOT-UNASKED`, which every skill is required to declare:
a skipped question names itself in the log with the shape its author chose.

`/plot-idea` uses it and `/api/idea` works because of it. A skill that runs
unattended cannot simultaneously be impossible to run unattended.

### What the refusal got right

The distinction it reaches for is real, and it is worth keeping when the route is
built: **a plan is a commitment to do work; a story is a commitment to track
work.** Choosing wrong is cheap for a plan (reject it) and less cheap for a story
(it accumulates references). That argues for the triage staying loud — not for the
route being absent.

## Design

### `/api/story`, exactly parallel to `/api/idea`

`/api/idea` is the working precedent, configured today and measured:

    - **Idea command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

It writes the issue — number, title, body — to `.plot/idea-issue-<n>.md`, exports
`PLOT_IDEA_PROMPT` and `PLOT_ISSUE`, and appends **one argument** naming that
file. Nothing from the issue is ever a shell word, because `Idea command` is a
fragment through `sh -c` and an issue body is free text from anyone who can file
one.

`/api/story` takes the same shape with a `Story command` key: same file-not-argument
rule, same `PLOT_UNATTENDED=1`, same refusal when the key is absent — *the button
refuses and names the key*, never accepts a click and does nothing.

**The ticket is already carried the right way.** This is not new work: the prompt
file is written by the route, and the skill reads it. The only difference from
*Create plan* is which skill the command runs.

### The triage stays loud, and unattended it is a log line

`story-tracking`'s triage runs as it does at a terminal. Where it advises against
and there is nobody to push back to, the run **proceeds and says so** — the skill's
own override wording (*"created on explicit request over triage advice"*) goes into
the story, and a `PLOT-UNASKED` line names the question that went unasked.

So a story created from a click is indistinguishable from one created at a
terminal over triage advice — which is what it is.

### Counting homes reads the config, never the filesystem

Measured across two repos on 2026-08-20, and it is the trap this design would
otherwise walk into.

Both have **exactly one** story home. This repo: `docs/stories/` holding
`plot-board`, `plot-gates`, `plot-planning-model`. And
`Quatico.Webseite/quaweb-website`: `docs/stories/` holding five stories and a
README.

But a naive search finds more in the second:

    docs/stories/                             ← the home
    packages/website/content/de/stories/      ← website content
    packages/website/content/en/stories/      ← website content
    packages/website/images__deprecated/…/success-stories/…  ← images

Those are customer stories on a website and image assets. A
`git ls-files | grep stories/` would count four "homes" where there is one, and
the button would refuse with *"more than one home"* in a repo that has no
ambiguity at all.

**So the home count comes from `Story directory` in Plot Config** (default
`docs/stories/`), which is the key Plot already reads — not from a filesystem
search for a directory named `stories`. A repo declaring several homes declares
them; a repo that happens to contain the word does not.

This is Principle 5 applied: Plot discovers what a repo declares, and never
infers structure from names it did not choose.

### Where more than one home exists

The single-home escape is a property of the repo, not of the board. A repo with
several homes must not have one guessed: the run writes `PLOT-UNASKED: which home
for <slug>? — stopped — no story created` and the board reports the refusal with
the reason. **A missing story is recoverable; a story in the wrong home is
referenced from elsewhere before anyone notices.**

That makes the availability of *Create story* repo-dependent, which the board
already models for *Create plan* (`idea.available`).

### What must not change

- **`/api/idea`.** Untouched. It already passes the ticket completely.
- **The refusal *shape*.** A button whose key is unset refuses **with the key
  named**. Only the reason changes, from *this cannot be a board action* to *this
  repo has not configured it*.
- **`/story-tracking` itself.** No change. It already handles one-home repos, the
  explicit override, and unattended runs.
- **The menu pairing.** *Create plan* and *Create story* stay side by side on a
  ticket row: the reader is deciding between exactly those two, which is the one
  thing `storyRefusal`'s comment gets exactly right.

### Open Points

- [x] Should the board offer the **triage's advice** before spawning — *"this
      looks like a plan, not a story"* — or is that the button's job only to
      start it? **Answered 2026-08-27: just start it.** The board decides
      nothing, and a second opinion rendered in a menu is a second place to keep
      the heuristic correct — it would drift from the skill's own triage, which
      is the duplication this codebase keeps removing. `/api/idea` already
      behaves this way, and the parallel is the whole design.

### The key is set here, not left to the reader

Measured 2026-08-27: `Idea command` is set in this repo and `Story command` is
not. That is exactly why one button works and the other refuses — and it means
that after this wave ships the capability, *Create story* would **still refuse
here**, correctly and for a new reason.

A refusal that names its key is the defect being fixed, so that is progress. It
is not enough: an unset key looks identical to a broken feature, and nobody could
confirm the happy path in the repo that dog-foods Plot.

**So the wave sets `Story command` in this repo's `## Plot Config`**, mirroring
`Idea command`:

    - **Story command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

The capability and its first configuration ship together. The refusal path stays
fully tested — a repo that has not set the key is the ordinary case for an
adopting project, and item 3 below still asserts it names the key.

## Waves

### Routed (Branch: feature/a-ticket-becomes-a-story, PR: #472)
- `/api/story` spawns a `Story command` for `/story-tracking` on a ticket, writing the issue to a file exactly as `/api/idea` does; `storyRefusal` becomes a not-configured refusal rather than a categorical one. Tests: the route writes the issue to a file and passes only its path; `PLOT_UNATTENDED=1` and `PLOT_ISSUE` are exported; an absent `Story command` refuses and **names the key**; a repo with more than one **declared** story home refuses with the home question named rather than guessing; **a repo containing unrelated `stories/` directories — website content, image assets — is still a one-home repo**, because the count reads `Story directory` and not the filesystem; nothing from the issue body reaches the shell; `/api/idea` is unchanged; the ticket menu still offers both entries.

## Done when

1. **`/api/story` spawns the `Story command` on a ticket**, writing the issue to
   a file and passing only its path — nothing from the issue body reaches the
   shell.
2. **`PLOT_UNATTENDED=1` and `PLOT_ISSUE` are exported** to the spawned run.
3. **An absent `Story command` refuses and NAMES THE KEY.** The refusal becomes
   conditional rather than categorical, which is the whole defect; a repo that
   has not configured it is the ordinary adopting case and must stay tested even
   though this repo now sets it.
4. **A repo with more than one DECLARED story home refuses, naming the home
   question** rather than guessing. A missing story is recoverable; a story in
   the wrong home is referenced from elsewhere before anyone notices.
5. **A repo containing unrelated `stories/` directories is still a one-home
   repo.** The measured trap: a client repo holds website content and image
   assets under paths matching `stories/`, and a filesystem search would count
   four homes where there is one. The count reads `Story directory`, never the
   filesystem.
6. **`Story command` is set in this repo's `## Plot Config`**, so the button is
   exercised end to end here rather than only in theory.
7. **`/api/idea` is unchanged**, and the ticket menu still offers both entries.
8. **The board offers no triage advice of its own** — closed Open Point; the
   heuristic lives in the skill and nowhere else.
9. `pnpm run validate`, `pnpm run test:board` green; artifact rebuilt and
   committed.

## Notes

The operator's argument is the one that settles it: *"Wir machen das im Prompt
mehrfach täglich."* A skill run unattended many times a day cannot be
categorically unrunnable unattended.

My own reasoning was the failure worth recording. I read `storyRefusal`'s comment
and repeated it — *"a story is a decision you make"* — without checking the skill
it describes. The skill names its own escape (one home → skip the question) and
its own override (explicit request beats triage), and this repo satisfies the
first. **I quoted a justification instead of measuring the thing it justified**,
which is the same error this estate keeps finding in its own code: a claim that
was true when written, restated later without re-checking.

### Interrogated 2026-08-27

Two questions, and a `## Done when` section that did not exist before — the wave
carried its assertions inline in the wave body, where `/plot-deliver` does not
look for them.

**The config key ships with the capability.** `Idea command` is set in this repo
and `Story command` is not, which is precisely why one button works and the other
refuses. Shipping only the capability would leave *Create story* still refusing
here — honestly now, but with its happy path unexercised in the repo that
dog-foods Plot. An unset key looks identical to a broken feature. The refusal
path stays asserted (item 3), because a repo that has not configured it is the
ordinary adopting case.

**The Open Point is closed as the plan leaned:** the board offers no triage
advice. A second opinion rendered in a menu is a second place to keep the
heuristic correct, and it would drift from the skill's own triage — the
duplication this codebase keeps removing. Item 8 pins it.

Verified while interrogating: with `Story directory` unset, the default resolves
to `docs/stories/`, which exists here holding four stories — so this repo takes
the single-home escape and the design holds.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Story command is unset here \u2014 should the wave set it?", "a": "Yes; capability and first configuration ship together, or the happy path is unexercised in the repo that dog-foods Plot", "category": "technical"},
    {"q": "Should the board offer the triage's advice before spawning?", "a": "No \u2014 just start it; a second opinion in a menu is a second place to keep the heuristic correct", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": true, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
