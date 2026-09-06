# A stated state is one the domain admits

> Three stories write `status: archived` and one sprint writes `Phase: Planned`. Neither value parses. Both were found by hand, in one session, because nothing checks a written state against the schema that defines it.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 2
- **Started:** 2026-09-06, Jan Wloka, `bug/a-stated-state-parses`
- **Started:** 2026-09-06, Jan Wloka, `bug/four-files-say-what-they-are`

## Changelog

- The parser refuses a stated state the domain does not admit, so every consumer gets the refusal instead of each checking for itself.

<!-- Board impact: the board renders parsed states; an unadmitted value stops
     rendering as if it were valid. No plan-format change. -->

## Motivation

**Four files hold a state their schema rejects.** Measured 2026-09-06:

```
docs/stories/plot-gates/…                        status: archived
docs/stories/setup-asks-what-the-repo…/…         status: archived
docs/stories/the-board-is-blank-where-it…/…      status: archived
docs/sprints/2026-W36-a-half-landed-workflow…    Phase: Planned
```

`StoryStatusSchema` admits `draft ready active in-review paused done`. `SprintStateSchema` admits `Planning Committed Active Closed`. **Neither `archived` nor `Planned` is in either.**

**BOTH WERE FOUND BY A PERSON READING FILES, IN ONE SESSION.** Nothing reported them. `plot-story-lint.sh` answers `0 finding(s)` over the three stories; the reconcile scan has thirteen sections and none asks whether a state parses.

**THE PLAN PARSER ALREADY DOES THIS, FOR PLANS ONLY.** `plot-plan-meta.sh:338` matches the seven plan states and returns `UNKNOWN` for anything else — a refusal every consumer inherits.

**AND THERE IS NO SINGLE PARSER TO EXTEND — CORRECTED 2026-09-06.** The plan's first draft said `plot-plan-meta.sh` *"parses all three file kinds"*. It does not: its `sprint` and `story` fields are what a **plan file** declares about its sprint and story, not a parse of those files. Three different readers exist:

| file kind | who reads its state |
|---|---|
| plan | `plot-plan-meta.sh:338`, refuses to `UNKNOWN` |
| story | `plot-story-lint.sh:81`, an `awk` over frontmatter — no validation |
| sprint | `plot-reconcile-scan.sh` — no validation |
| **both** | `packages/board/src/server/board.ts` — `parseSprintFile`, `parseStoryContent` |

**Only the board parses both, and only the board already holds both schemas.** `contract/schema.ts:189` declares `SPRINT_PHASES` and `:196` the story statuses. So the one place a single refusal can live without a fourth reader learning to validate is the board's parse.

**`archived` IS THE MORE INTERESTING OF THE TWO.** `transitions/story.ts:26` says the six statuses are *"what a person writes"* and `archived` is *"what the plans say"* — derived, never stored. #707 made it unrepresentable in TypeScript and nobody swept the files. So three of them assert by hand a value the type system has since forbidden.

## What this is not

**Not a fifth lint.** The refusal belongs where the parse happens, so every consumer inherits it. A check bolted onto `plot-story-lint.sh` would leave sprints uncovered, and a sprint check would leave the next entity uncovered.

**Not a rewrite of the four files.** They are corrected — the stories through `archiveStory`, which writes status and date together, and the sprint by one word — but that is the repair, not the plan. The plan is that the fifth cannot arrive silently.

**Not a change to any schema.** `archived` stays derived and `Planning` stays spelled as it is. What changes is that a file cannot claim otherwise.

## Slices

### The parse refuses an unadmitted state (Branch: bug/a-stated-state-parses)

`parseSprintFile` and `parseStoryContent` refuse a value their schema does not admit, as `plot-plan-meta.sh` already does for a plan phase.

**THE SEVEN PLAN STATES ARE THE PATTERN.** `plot-plan-meta.sh:338` matches an explicit list and falls through to `UNKNOWN`; `:339` maps two legacy spellings onto `approved`. The board's two parsers need the same shape — an admitted list, and a reading for anything else.

**IT IS THE BOARD BECAUSE THE BOARD ALREADY HAS BOTH SCHEMAS AND BOTH PARSERS.** `parseSprintFile` (`board.ts:1086`) and `parseStoryContent` read the files; `contract/schema.ts:189` and `:196` hold the values. Neither shell reader has either, and teaching two shell scripts to validate would be two more hand-copies rather than one refusal.

**THE SHELL READERS INHERIT NOTHING AND THAT IS STATED RATHER THAN HIDDEN.** `plot-story-lint.sh:81` and the reconcile scan keep reading what the file says. They do not gain validation here; what they gain is a board that no longer renders an unadmitted value as if it parsed.

**`UNKNOWN` IS A READING, NOT AN ERROR.** The parser reports what it read and refuses nothing — `plot-plan-meta.sh` is the contract, and a consumer decides what an unparseable state means for it. That is the same direction `unaskable` takes for a host.

**NO NEW COPY OF EITHER LIST.** The board imports the domain's schemas — that is what `the-workflow-has-phases` (#721) just established for `BOARD_PHASES`, and `SPRINT_PHASES` at `contract/schema.ts:189` is the next hand-copy to go the same way. **This slice must not add a third spelling of either list**, which the first draft's shell-side approach would have.

**THE ROUND'S EARLIER ARGUMENT NO LONGER APPLIES AND IS RECORDED RATHER THAN DELETED.** Round 1 argued a hand-copy in the shell was acceptable because it would be asserted against the domain's export, unlike the four silent copies removed this session:

**IT WOULD HAVE BEEN A FIFTH HAND-COPY IN A SESSION SPENT REMOVING FOUR** — `BOARD_PHASES`, `SPRINT_PHASES`, `STORY_STATUSES` and `statusOrder` — so it needs the distinction stated rather than assumed.

**The four removed were SILENT copies nobody checked.** They agreed by maintenance, drifted when one was edited, and `statusOrder` had already drifted — omitting three of the six values.

**This one is declared and tested against the domain's export.** It fails CI when the two diverge, which is the property the other four lacked. A checked copy is the honest form of a constraint the shell genuinely has: `plot-plan-meta.sh` is `awk` over markdown and cannot import TypeScript.

**A bundle was considered and rejected for that shell caller.** `plot-approve.sh` reads `plot-transition.mjs` and `plot-pr-merged.sh` reads `plot-landed.mjs`, so the pattern exists — but both call `node` once per invocation, while `plot-plan-meta.sh` is called per file by every scan on the estate. A `node` spawn per plan is the cost `DESIGN-machine.md` measures as the headroom signal, paid on the hottest path Plot has.

**Moving the refusal to the board makes the whole argument moot**: the board is TypeScript, imports the schemas directly, and spawns nothing.

**Done when** a story status or sprint phase outside its schema parses as `UNKNOWN`, the plan path is unchanged, and a test asserts each shell list against the domain's.

### The four files are corrected (Branch: bug/four-files-say-what-they-are)

The three stories go `done` with the archive date `archiveStory` writes; the sprint goes `Planning`.

**THE STORIES GO THROUGH THE TRANSITION, NOT AN EDITOR.** `transitions/story.ts:324` writes the status and the `archived:` date together and refuses `archive-date-missing`. Editing the status alone would trip S3 — *"done and an `archived:` date are two writes that must agree"* — swapping one invalid state for three lint findings.

**All three are archived in fact:** 6 of 6, 15 of 15 and 1 of 1 plans Released, so the derivation agrees with what the files assert.

**THE SPRINT IS ONE WORD.** `Planned` → `Planning`. It has not been touched since 2026-08-29 and none of its eight items ever became a plan, so nothing else about it changes here.

**Done when** all four files parse, `plot-story-lint.sh` exits 0, and the reconcile scan reports no unadmitted state.

## Notes

### Why this outranks the two plans that found it — 2026-09-06

`a-story-says-what-it-is` and `a-sprint-knows-when-it-ended` each found one instance and each proposed a check in its own lint. Reading them together showed one defect: **nothing validates a stated state anywhere.** Two lints would have left the third entity uncovered, and the fourth after it.

Those plans keep their other slices — the status-versus-plans drift, the index disagreement, the timebox — and hand this one over.
