---
"@plot-pm/board": patch
---

board: a deferred row answers to the phase too

Wave 2 of the same rule, and it exists because the rule had two doors and #231
put a guard on one of them.

Measured on the live board 2026-08-18, minutes after #231 merged:

```
NOT STARTED: 20 rows — 17 open, 3 deferred
  feature/the-pulse-repairs-the-artifact   plan phase: NONE
  feature/a-repaired-row-says-so           plan phase: approved
  feature/plot-sprint-support              plan phase: RELEASED
```

The `open` rows moved as designed — `a-squashed-branch`, `bb-state-vocabulary`
and `the-gate-reads-what-was-shared`, all Released, left the section. The
`deferred` rows did not.

`classify` answers a deferred branch in an arm **above** the one the phase check
sits in, so those rows reached NOT STARTED by a route that never met the guard.
Two doors into one room, and a rule guarding one of them is not the rule.

`feature/plot-sprint-support` is the case in full: annotated `deferred` because
the branch was **never created** — February's work landed directly on main — and
its plan has read `Released` since v1.0.0-beta.3, four months ago. The board
offered it as available work throughout.

**The phase now answers first for every row in the section, whatever route
brought it there.**

## The narrowing is exactly the terminal phases

The deferred arm is not removed, and its `'you'` answer is not replaced — it is
**bounded**:

| Plan phase | A deferred branch of it | Why |
|---|---|---|
| Draft | NOT STARTED, waiting on **you** | not finished — a shelved branch of a plan under review waits on a person twice over |
| **Approved** | **NOT STARTED, waiting on you** | **unchanged** — somebody shelved it, somebody may un-shelve it |
| Delivered | DONE | the work is done; nothing on the shelf waits for anyone |
| Released | DONE | the plan shipped, and the shelf is part of its history |

`deferred` keeps its meaning *within* a plan that can still move. It stops being
a waiting state once the plan is finished.

The check sits **above** the arm's three exits — a PR, a commit age, no commits
— rather than beside one of them. Those distinctions refine what a live plan's
shelf says, and a finished plan has nothing for them to refine.

An unrecognised phase is placed with its name said aloud, as in the `open` arm
and by the same allowlist argument. `''` falls through untouched:
`feature/the-pulse-repairs-the-artifact` rendered `plan phase: NONE` in the same
measurement, its plan unresolvable from the branch name — and filing that under
DONE would be the same guess in the opposite direction.

`waitingOnFor` is unchanged. Its comment said the deferred row was *the one row
here that a phase check does not account for*; that was true, and was the
defect. The line is now correct because the route is guarded rather than in
spite of it, and the function still derives its answer from the group rather
than repeating the phase test — a second copy of the rule there is the drift its
shape exists to prevent.

`FINISHED_PLAN_NOTE` covers both routes with one sentence. A finished plan's
branch reaches the section as `open` when git has no ref for it and as
`deferred` when the plan shelved it; the reason is identical either way — the
work landed elsewhere, so no branch was needed.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` changed but the generated `board-server.mjs` artifact, which is
rebuilt output rather than authored skill content. The `/api/fleet` payload is
unchanged — this decides differently with data the pulse already carried.
