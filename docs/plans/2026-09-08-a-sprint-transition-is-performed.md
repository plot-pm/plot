# A sprint transition is performed

> `setSprintState` named nine refusals, carried its own test file, and had **no caller outside it**. `/plot-sprint` described the file edit in prose and a master agent made it with `sed`. **This plan is written after the work merged, and says so.**

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-08, Jan Wloka, in-session
- **Delivered:** 2026-09-11
- **Released:** 2026-09-11, v2.16.0

## Changelog

- A sprint's start, commit and close perform their transition through the rule that owns it, so the nine refusals guarding a sprint's lifecycle can actually fire.

<!-- Board impact: a sprint whose state was written by hand may carry a word
     the schema does not contain, and the board then parses none of its items. -->

## Motivation

**This plan is a record, not a proposal.** The work merged as PR #839 on 2026-09-08 (`3c95b0120`), +874/−21 across fourteen files, before any plan file existed. It is written on 2026-09-11 because the release gate refused 2.16.0 for exactly that absence — and the refusal was correct.

### The rule was finished and dead

`setSprintState` states nine refusals and is fully tested. Until #839 it had **zero callers** outside its own test file, and `/plot-sprint` told an agent in prose which line to edit.

**Measured 2026-09-08, by the agent that writes these rules:** a master agent activated a sprint by writing `State: Planned` with `sed` and linking `active/` with `ln -s`. `Planned` is a word `SprintStateSchema` does not contain. The sprint file was written by hand rather than from `templates/sprint.md`, so the board parsed **none of its nine items** — and `state-unrecognised`, `commitment-empty` and `state-unreachable` sat exported and silent throughout. The cost was about an hour, and the failure was invisible to review: no diff of a script, no test, no PR.

**A rule nothing calls is not a guardrail; it is documentation with a test suite.**

## What this is not

- **Not the state gate.** `plot-state-gate.sh` refuses a `State:` line changed without a receipt — that is `a-lifecycle-field-has-one-writer` (#847, #851). This plan supplies the writer that *has* a receipt to leave.
- **Not a change to the nine refusals.** They are unchanged; this makes them reachable.

## Slices

### The sprint lifecycle is performed through its rule (Branch: feature/a-sprint-transition-is-performed, PR: #839)

`/plot-sprint`'s start, commit and close call `setSprintState` through `plot-sprint-state.sh`, which asks `board/plot-sprint-transition.mjs`.

**The shell owns the I/O and the rule owns the decision.** The sprint file arrives on **stdin as text**: the domain reaches no filesystem, and a bundle that opened the file would put the one I/O call this rule needs inside the artifact rather than in the shell that owns it.

**The state is carried through unparsed, and that is what makes the rule reachable.** Narrowing in the parser would refuse in the parser's words and leave `state-unrecognised` exactly as dead as it was.

**The `active/` symlink follows the decided state** rather than being a second decision — the two records disagreed twice in four days before this, each time found by a person reading the directory.

**A refusal writes nothing.** The file is replaced by one `mv` from a scratch copy, so a refused sprint is the sprint that was found. The script commits nothing: the caller owns that, as `/plot-sprint`'s steps already do.

**Done when** — all measured on `3c95b0120`:

- `/plot-sprint` start, commit and close reach `setSprintState`; `skills/plot-sprint/SKILL.md` +43/−19 replaces the prose edit with the call — measured.
- A state the schema does not contain is refused by name, and the file is unchanged afterwards — measured, and it is the case that cost the hour.
- `--states` asks the schema for the four words, so a skill listing them cannot invent a fifth — measured.
- `packages/board/test/unit/sprint-transition.test.ts` (+216) and `packages/domain/test/transitions-sprint.test.ts` (+19) cover the entry and the transition.

## Notes

### Wiring it found a crash the rule's own tests could not reach — 2026-09-08

Every gate indexes `NEXT` by the current state, and a state read from a **file** can be any word. The rule's tests only ever passed it a valid one, so the lookup returned `undefined` and the gate threw rather than refusing.

**That is the argument for wiring a finished rule rather than trusting its test suite.** A rule tested only against inputs its own type permits has never met the input a file can hold.

### Why this plan is dated 2026-09-08 and delivered 2026-09-11

The filename carries the date the work merged, so it sorts beside its siblings. The `Delivered:` record carries the date the record was written. **Both are true and they are different facts** — the plan states both rather than pretending the gap did not exist.
