# The section is called Waves, and a wave heading carries its own facts

> `## Branches` names the wrong level: the `### ` under it are waves. And the
> branch and PR live in the prose line beside the description, so meta and
> content share a sentence. The heading takes the meta; the line keeps the work.

## Status

- **Phase:** Approved
- **Type:** infra
- **Story:** plot-planning-model
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #306 merged
- **Started:** 2026-08-22, Jan Wloka, `infra/the-parser-reads-a-wave-heading`
- **Started:** 2026-08-22, Jan Wloka, `infra/the-parser-reads-a-wave-heading`
- **Started:** 2026-08-22, Jan Wloka, `infra/the-template-writes-waves`
- **Started:** 2026-08-23, Jan Wloka, `infra/the-parser-reads-a-wave-heading`

## Changelog

- A plan's implementation section is called `## Waves`, and each wave heading
  names its branch and PR — so a reader sees the structure without reading the
  prose, and a tool reads the facts without parsing a sentence.

<!-- Board impact: this IS the plan format. `plot-plan-meta.sh` is the contract,
     and `plot-approve.sh`, `plot-impl-status.sh`, `plot-reconcile-scan.sh`,
     `plot-fleet-scan.sh` and `plot-dispatch.sh` all read the section. The board
     consumes their output rather than the file, so it changes only if a field
     changes — and none does. -->

## Motivation

### The section names the wrong level

    ## Branches          ← names the lower level
    ### Removed          ← is a WAVE
    - `bug/an-agent-…`   ← this is the branch

A reader has to infer that the middle level is a wave. It is the one term Plot
asks a newcomer to learn, and the file never says it — while the heading above
says something else.

The name is historical rather than wrong-headed: it predates waves. Since
2026-08-21 a wave carries exactly one branch (`MANIFESTO.md`), so `## Branches`
is now a list whose heading names the contents of its contents.

### Meta and content share a line

    - `bug/an-agent-is-not-a-machine-you-wait-on` (PR #300) — `machineProcesses`
      loses its `origin: 'local'` half and … Tests: a running worker with no PR
      appears in WORKING only; …

Three different kinds of thing in one sentence: **which branch** (meta), **which
PR** (meta), and **what the work is and how it is verified** (content). The
operator's framing: *"This way we don't mix content and meta info."*

The cost is not aesthetic. A parser that reads meta out of prose has to guess
where prose begins — `plot-plan-meta.sh` takes the first backticked name as the
branch, which is why the format documentation warns that quoting a branch name
in a paragraph declares a branch. Measured when it did: a plan mentioning three
branch names in an explanatory table dispatched three branches belonging to
another plan.

Facts in the heading cannot be mistaken for prose, because the heading is not
prose.

### And it makes the one-branch rule visible

    ### Removed (Branch: bug/an-agent-is-not-a-machine, PR: #300)

One heading, one branch, said in the structure rather than asserted in a
manifesto. You cannot write two branches into that heading without it looking
wrong — which is the difference between a rule and a gate, the distinction
`CLAUDE.md` names and this repo has broken three times today.

## Design

### The shape

```markdown
## Waves

### Removed (Branch: bug/an-agent-is-not-a-machine, PR: #300)
- `machineProcesses` loses its `origin: 'local'` half. Tests: a running worker
  with no PR appears in WORKING only; …

### Surfaced (Branch: feature/a-broken-agent-needs-you, PR: #303)
- a crashed agent appears in WAITING ON YOU, naming what went wrong. Tests: …
```

`PR:` is omitted where none exists yet — an absent field is not a claim, the
same rule `Issue:` follows in `## Status`.

### Migration, measured

Re-counted 2026-08-22; the estate grew since the first count:

    plans with `## Branches`            85
    of those, with `### ` waves         62
    with no subheading (unnamed wave)   23
    branch lines to move               192

The 23 without a subheading are the case that needs deciding, not the 60:
they parse today as one unnamed wave, and the new shape has nowhere to put a
branch without a heading to hang it on. **All 23 are finished work** — every one Released or
Delivered, and not one open plan has an unnamed wave (measured 2026-08-22). So
the question is not what to invent for someone else's live plan, but what
heading a historical one gets: a derived name, since nobody reads those to
decide anything. An open plan in this set would be named by reading it.

### The parser goes first, and reads both

**The proposed shape parses to nothing today.** Measured against the current
`plot-plan-meta.sh`:

    ## Waves
    ### Removed (Branch: bug/one, PR: #300)
    - work here

    -> branches: 0   prs: 0   waves: 0   error: null

Silently — and the consumers inherit the silence rather than catching it. The
fleet scan prints `(no branches)` and moves to the next plan
(`plot-fleet-scan.sh:2645`); `/plot-deliver`'s unaccounted-branches gate has an
empty list and passes. A plan migrated one commit before the parser learns the
shape does not fail, it **disappears** — an approved plan reading as having no
branches at all, which is the silent-empty failure the first Open Question
already refused.

So the ordering is a property of this plan rather than an implementation
detail, and it is the branch order below: the parser learns the new shape while
still reading the old one, THEN the estate moves, THEN the template stops
writing the old spelling. Nothing in between reads as empty, and a file that
moves wrongly can move back.

Two spellings exist while 85 files are being moved, and that does not
contradict *one shape*: the decision is about what Plot **writes and
documents**, never about what a parser tolerates during a migration it is
performing.

### What must not change

- **The emitted fields.** `plot-plan-meta.sh` must produce the same `branches`,
  `prs` and `waves` arrays from the new shape as from the old. This is what
  makes a one-move migration safe to verify: every plan's JSON before and after
  must match byte for byte, so the migration is provably a re-spelling. Every consumer
  reads its JSON, so a faithful parser change is invisible to all of them —
  and any consumer that breaks was reading the file directly, which is itself
  the finding.
- **The claim and deferral comments.** `<!-- claimed: -->` and
  `<!-- deferred: -->` ride the branch line today. They are meta too, but they
  are *written by tools*, not by hand, and moving them is a separate question.

### Open Questions

- [x] **ONE SHAPE, no transition period** — decided 2026-08-21, refined
      2026-08-22. Plot **writes and documents** one shape: `## Waves`, facts in
      the heading. The parser keeps **reading** the old spelling, which is not a
      second source of truth but the compatibility a format change owes to
      estates it does not control. What was decided stands — no alias in the
      template, no deprecation window in the docs; what changed is that a
      parser refusing the old spelling would make 85 files invisible between
      two commits.

- [x] What names do the 23 unnamed waves get? **Derived.** All 23 are Released
      or Delivered — zero open plans have an unnamed wave — so no heading here
      will be read to decide anything. An open plan in that set would be named
      by reading it.

- [x] How does this interact with `the-plan-is-the-wave`? **Different layers.**
      That plan governs RENDERING — whether the board draws a wave row, by the
      wave COUNT, named or not. This governs the FILE. A one-wave plan still
      writes `## Waves` with one `### ` heading; the board draws no row for it.
      Neither rule needs to know the other.

## Branches

> **Written in the OLD shape on purpose.** This plan proposes `## Waves` with
> the branch in the heading — and `plot-plan-meta.sh` does not read that yet.
> Drafted in the new shape it parsed as **zero waves and zero branches**:
> invisible to `plot-dispatch`, to the board, and to `plot-fleet`. That is the
> proof its first wave is needed, and the reason it cannot be written in the
> shape it argues for. The new shape appears above, as an example rather than
> as this plan's own structure.

### Parsed
- `infra/the-parser-reads-a-wave-heading` — `plot-plan-meta.sh` reads
  `## Waves`, and reads `Branch:` and `PR:` out of a `### ` heading, emitting
  the same JSON it emits today. Tests: a new-shape plan yields identical
  `branches`, `prs` and `waves` arrays to its old-shape twin; `## Branches`
  still parses, so no existing plan changes meaning; a heading with no `PR:`
  yields no PR rather than an empty string; a backticked branch name in a
  PARAGRAPH is not a branch, which is the defect the old shape invited; the
  format contract tests cover both shapes. → #367

### Written
- `infra/the-template-writes-waves` — the plan template and `/plot-idea` write
  the new shape. Tests: a plan created by `/plot-idea` carries `## Waves`; its
  wave heading names branch and PR; `plot-plan-meta.sh` parses what was just
  written; the template's guidance says a wave heading is required and why; no
  skill still instructs a writer to put the branch in the list line.

### Migrated
- `infra/the-estate-speaks-waves` — all 85 plans convert in one move. 62 have
  named waves and convert mechanically; the 23 with none take a derived name,
  defensible because all 23 are Released or Delivered, so no live work is given
  an invented name. `## Branches` keeps PARSING and stops being WRITTEN: a repo
  that pulls Plot mid-migration must not have its estate go invisible, and
  retiring the old spelling from the parser is a later decision with its own
  timing. Tests:
  every converted plan yields byte-identical `plot-plan-meta.sh` output to its
  pre-migration self; `plot-reconcile-scan.sh` reports no new drift; the ten
  scripts naming `## Branches` are updated or documented as accepting both;
  nothing under the plan directory still mixes a branch name into a
  description line.
  >
  > The un-backticked "plan directory" above is not a style choice: writing it
  > as code made `plot-plan-meta.sh` read it as a SECOND branch of this wave,
  > which is the defect this plan exists to remove, reproduced in the plan
  > proposing the removal.

## Notes

Raised while reading `/plan/2026-08-20-every-section-has-one-subject.md` on the
board, where the three waves appear as the 18th, 19th and 20th headings on the
page — under a section called Branches.

Third of the four plans filed 2026-08-21 against `plot-planning-model`. It is
the only one that changes the FILE; the others change what the board does with
it. Sequence matters: this one should land before `the-plan-is-the-wave`, since
that plan asks what a one-wave plan writes, and this one decides what any plan
writes.

**Interrogated 2026-08-22.** The finding was an ordering hazard the plan's own
one-move decision created: the proposed shape parses to `branches: 0, prs: 0,
waves: 0, error: null` under today's parser, and every consumer treats that as
*a plan with no branches* rather than as a parse failure. The fleet scan prints
`(no branches)` and continues; the delivery gate checks an empty list and
passes. So a plan migrated a commit early does not break — it vanishes.

The plan already ordered its waves parser-first, which is why the hazard is a
sharpening rather than a redesign: what was missing is that the ordering is
load-bearing and that the parser must read BOTH spellings while the estate
moves. `## Branches` therefore keeps parsing and stops being written, which
turns out not to weaken the one-shape decision at all — that decision is about
what Plot writes and documents.

All three Open Questions closed. The naming one closed cheaply once measured:
all 23 unnamed waves belong to Released or Delivered plans, so the judgement the
plan feared — inventing a wave name for someone else's live work — does not
arise.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": false, "implementation": false},
    "domain": {"rules": false, "workflows": false, "data": false},
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  },
  "_note": "Back-filled 2026-08-22: this plan was interrogated once on 2026-08-22 (see ## Notes). The round count is recorded, but the questionHistory could not be reconstructed from prose after the fact, so it is left empty rather than invented."
}
END-CHALLENGE-THE-PLAN-METADATA -->
