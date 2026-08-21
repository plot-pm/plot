# The section is called Waves, and a wave heading carries its own facts

> `## Branches` names the wrong level: the `### ` under it are waves. And the
> branch and PR live in the prose line beside the description, so meta and
> content share a sentence. The heading takes the meta; the line keeps the work.

## Status

- **Phase:** Draft
- **Type:** infra
- **Story:** plot-planning-model
- **Review:** pr
- **Impl:** own branches

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

    plans with `## Branches`            83
    of those, with `### ` waves         60
    with no subheading (unnamed wave)   23
    branch lines to move               185

The 23 without a subheading are the case that needs deciding, not the 60:
they parse today as one unnamed wave, and the new shape has nowhere to put a
branch without a heading to hang it on. Giving them one means inventing a wave
name for someone else's plan.

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

- [x] **ONE SHAPE, no transition period** — decided 2026-08-21. `## Branches`
      is not kept as an alias, and all 83 plans migrate in one move. Two
      accepted shapes is the second source of truth Principle 1 refuses, and a
      deprecation window is that second source with a date attached.

      It makes the third wave a hard migration rather than an optional one, and
      it means the 23 plans with no `### ` heading must be given wave names —
      naming somebody else's work, which the wave that does it has to answer
      for. The alternative was worse: a plan written against old docs parsing
      as *no waves at all*, silently, because an empty section is legal.

- [ ] What names do the 23 unnamed waves get? A generated one (`Wave 1`) says
      nothing and defeats the naming rule; a derived one (from the branch)
      repeats what the heading already carries; a human one costs 23 readings.
- [ ] `the-plan-is-the-wave` proposes hiding the wave row for one-wave plans.
      If a plan's waves are named in headings, does a one-wave plan still write
      `## Waves` with one `### `, or does the plan-level metadata carry it?

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
  format contract tests cover both shapes.

### Written
- `infra/the-template-writes-waves` — the plan template and `/plot-idea` write
  the new shape. Tests: a plan created by `/plot-idea` carries `## Waves`; its
  wave heading names branch and PR; `plot-plan-meta.sh` parses what was just
  written; the template's guidance says a wave heading is required and why; no
  skill still instructs a writer to put the branch in the list line.

### Migrated
- `infra/the-estate-speaks-waves` — all 83 plans convert in one move, and
  `## Branches` stops parsing. One shape, no alias, no window: 60 plans have
  named waves and convert mechanically; the 23 with none must be given names,
  which is the judgement this wave cannot avoid and must not automate. Tests:
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
