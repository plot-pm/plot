# A story says what it is

> Three story files carry `status: archived`, a value the domain refuses and `transitions/story.ts` calls derived. A fourth is `draft` while all three of its plans are Approved. The lint reports none of it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A story's written status is one the domain admits, and a status that disagrees with its own plans is reported.

<!-- Board impact: the board derives a standing from plan phases; a file that
     writes a derived value is what `a-story-lifecycle-refuses` (#707) made
     unrepresentable in code and not yet on disk. -->

## Motivation

**`a-story-lifecycle-refuses` merged as #707 and settled the rule.** `transitions/story.ts:26` states it: *"The six are what a person writes; `archived` is what the plans say"*, and keeping the seventh out of `StoryStatusSchema` is *"the whole point of this file"* because *"a seventh value in that enum would make a derived answer storable."*

**Three story files store it.** Measured 2026-09-06 over all 10 stories:

```
plot-gates                              status: archived
setup-asks-what-the-repo-already-knows  status: archived
the-board-is-blank-where-it-matters     status: archived
```

`StoryStatusSchema` admits `draft ready active in-review paused done`. None of the three parses.

**The rule shipped and the estate was never checked against it.** #707 made the value unrepresentable in TypeScript; nothing looked at what the files already said.

**AND A SECOND DISAGREEMENT, OF THE OPPOSITE KIND.** `the-domain-knows-what-plot-knows` is `status: draft` while **3 of its 3 plans are Approved** — a story nobody has started, whose entire plan estate is approved and in flight. `deriveStoryStatus` would answer `active`; the file says `draft`; nothing reports the gap.

**`plot-story-lint.sh` answers `0 finding(s)` for all of it.** It checks four things — a missing STORY file, missing frontmatter, done-but-not-archived, and index membership — and none of them reads whether the status is a value the domain admits.

## What this is not

**Not a change to the six.** `entities/story.ts:3` says they are *"written by a person, never derived"* and that stands. What changes is that a file cannot write a seventh.

**Not a change to how `archived` is derived.** #707 built that and it works: every plan released means archived. The three files are asserting by hand what the board computes.

**Not a status rewrite.** A story whose file disagrees with its plans is reported, not corrected. Which is right — the person's word or the plans' state — is a judgement, and `DESIGN-story.md` is explicit that the status is *"written by a person"*.

## Slices

### A written status is one the domain admits (Branch: bug/a-story-status-parses)

`plot-story-lint.sh` reports a `status:` value outside the six, and the three files are corrected.

**THE THREE ARE ARCHIVED IN FACT AND THAT IS THE POINT.** They sit under `docs/stories/` with every plan released, so the derivation would answer `archived` for all three. Writing it by hand was never needed — the file should say `done`, and the archival is what the plans and the directory already prove.

**S5, AND THE FOOTER COUNTS IT.** The lint has four findings and a machine-countable footer; this is the fifth, and it gates like the others — an unparseable status is not a browsing gap.

**Done when** the lint reports a status outside the six, the three files carry one of the six, and `plot-story-lint.sh` exits 0 on this estate.

### A story that disagrees with its plans says so (Branch: bug/a-story-status-meets-its-plans)

The lint reports a story whose written status and derived standing disagree.

**REPORTED, NEVER CORRECTED.** The status is the person's statement about knowledge, and `entities/story.ts:3` gives the reason nothing may derive it: *"no mechanism can observe whether knowledge is still being added to, so a story whose plans have all delivered may still be `active`."* A story can legitimately be `paused` with approved plans; it cannot legitimately be nothing at all.

**THE BOARD ALREADY COMPUTES BOTH SIDES.** `deriveStoryStatus` produces the standing and `computeStatusDrift` compares them — the board warns, and a person reading the board is the only thing that catches it today. The lint is where a gate can.

**ONE MEASURED CASE, AND IT IS THE DIRECTION THAT MATTERS.** `the-domain-knows-what-plot-knows`: `draft` on disk, three approved plans, nothing said. A story behind its plans is a story nobody updated; a story ahead of them is one that finished early. The first is the common one.

**Done when** the lint reports a story whose status is behind what its plans say, names both, and corrects neither.

## Notes

### Why this is not `a-story-lifecycle-refuses` — 2026-09-06

That plan made the seventh value unrepresentable in the domain, and it did. This one is about the files, which the type system never touched: three of them still hold a value that no longer parses, and they were written before the rule existed. A rule that ships without a sweep of what it now forbids leaves exactly this.
