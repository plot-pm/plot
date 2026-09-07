# A story says what it is

> Three story files carry `status: archived`, a value the domain refuses and `transitions/story.ts` calls derived. A fourth is `draft` while all three of its plans are Approved. The lint reports none of it.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 3
- **Started:** 2026-09-06, Jan Wloka, `bug/a-story-status-meets-its-plans`
- **Delivered:** 2026-09-07

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

### A written status is one the domain admits (Branch: bug/a-story-status-parses) <!-- moved: 2026-09-06 to a-stated-state-is-one-the-domain-admits — one defect found from two ends; the refusal belongs at the parse, where every consumer inherits it -->

**MOVED — see [`a-stated-state-is-one-the-domain-admits`](2026-09-06-a-stated-state-is-one-the-domain-admits.md).** The text below is kept as the record of what this plan found; the work is that plan's.

`plot-story-lint.sh` reports a `status:` value outside the six, and the three files are corrected.

**THE THREE ARE ARCHIVED IN FACT.** Verified 2026-09-06 — every plan of all three is Released: `plot-gates` 6 of 6, `the-board-is-blank-where-it-matters` 15 of 15, `setup-asks-what-the-repo-already-knows` 1 of 1. `deriveStoryStatus` (`transitions/story.ts:402`) answers `archived` when every plan is released, so the derivation agrees with what the files assert by hand.

**BUT `done` ALONE WOULD TRIP THE LINT, AND THIS IS THE ROUND'S FINDING.** None of the three carries an `archived:` date. S3 refuses `done` without one — it is *"the shell half of `archivalIsConsistent` … done and an `archived:` date are two writes that must agree, so either alone is a half-archived story."* Changing the status by hand would swap one invalid state for three lint findings.

**SO THE TRANSITION MAKES THE CHANGE, NOT AN EDITOR.** `archiveStory` (`transitions/story.ts:324`) writes the status and the date together and refuses `archive-date-missing`. Running it against the three is what makes the two writes that must agree be made by the thing that knows they must — and it is the transition's first real use, which is its own reason to prefer it over three hand edits.

**S5, AND THE FOOTER COUNTS IT.** The lint has four findings and a machine-countable footer; this is the fifth, and it gates like the others — an unparseable status is not a browsing gap.

**IT FIRES THREE TIMES ON DAY ONE AND EACH HAS AN OBVIOUS FIX.** That is the bar a new finding must clear: actionable the day it fires. A check that reports a state with no clear repair is the one that teaches a reader to skip the output.

**Done when** the lint reports a status outside the six, the three files carry `done` **and** an `archived:` date written by `archiveStory`, and `plot-story-lint.sh` exits 0 on this estate.

### A story that disagrees with its plans says so (Branch: bug/a-story-status-meets-its-plans, PR: #746)

The lint reports a story whose written status and derived standing disagree.

**REPORTED, NEVER CORRECTED.** The status is the person's statement about knowledge, and `entities/story.ts:3` gives the reason nothing may derive it: *"no mechanism can observe whether knowledge is still being added to, so a story whose plans have all delivered may still be `active`."* A story can legitimately be `paused` with approved plans; it cannot legitimately be nothing at all.

**THE BOARD ALREADY COMPUTES BOTH SIDES, AND THE COMPARISON IS ALREADY WRITTEN.** Checked against the estate 2026-09-06: `computeStatusDrift` (`board.ts:1416`) takes the declared status and the derived standing and returns a message — *"All plans released"*, *"All plans delivered"*, *"Has approved plans"* — and warns **only when the declared status is behind the derived one**, which is this slice's stated rule, already implemented.

**SO THE SLICE IS A MOVE, NOT A BUILD.** The logic is a board function, not a domain rule: `plot-story-lint.sh` cannot call it, `contract/schema.ts:718` carries its output as a nullable string, and a person reading the board is the only thing that catches the drift today.

**It moves to `transitions/story.ts` beside the standing it compares against**, and the lint reads it through a bundle the way `plot-approve.sh` reads `plot-transition.mjs`. That is the layering rule applied to a rule already correct and living in the wrong layer — the same shape `the-board-decides-nothing` is about.

**Its four-value `statusOrder` is a second declaration and travels with it.** `['draft','active','done','archived']` sits inline in the board while `StoryStatusSchema` holds six and `StoryStanding` adds the seventh — three lists, and the ordering one silently omits `ready`, `in-review` and `paused`. Whether a paused story can be *behind* its plans is a question that list answers by accident.

**ONE MEASURED CASE, AND IT IS THE DIRECTION THAT MATTERS.** `the-domain-knows-what-plot-knows`: `draft` on disk, three approved plans, nothing said. A story behind its plans is a story nobody updated; a story ahead of them is one that finished early. The first is the common one.

**Done when** the lint reports a story whose status is behind what its plans say, names both, and corrects neither.

## Notes

### Why this is not `a-story-lifecycle-refuses` — 2026-09-06

That plan made the seventh value unrepresentable in the domain, and it did. This one is about the files, which the type system never touched: three of them still hold a value that no longer parses, and they were written before the rule existed. A rule that ships without a sweep of what it now forbids leaves exactly this.

### Slice 1 handed over — 2026-09-06

`bug/a-story-status-parses` moved to [`a-stated-state-is-one-the-domain-admits`](2026-09-06-a-stated-state-is-one-the-domain-admits.md).

**One defect, found twice.** This plan found three stories writing `archived`; `a-sprint-knows-when-it-ended` found one sprint writing `Planned`. Each proposed a check in its own lint — and two lints would have left the third entity uncovered, and the fourth after it.

**The refusal belongs at the parse.** `plot-plan-meta.sh:338` already answers `UNKNOWN` for an unadmitted plan phase, and it parses all three file kinds. This plan keeps its second slice, the status-versus-plans drift, which is a different question: not *does this value parse* but *does it agree with the plans*.
