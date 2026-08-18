# Add sprint support to Plot

> Time-boxed planning for Plot: sprints group work by schedule, not scope, using MoSCoW prioritization.

## Status

- **Phase:** Delivered
- **Type:** feature
- **Story:** plot-planning-model
- **Approved:** 2026-02-11, eins78, in-session
- **Delivered:** 2026-08-18, jwloka, verified against the source rather than a PR

## Approval

- **Approved:** 2026-02-11T21:04:30Z
- **Approved by:** eins78
- **Assignee:** eins78

## Changelog

- Add sprint support: time-boxed plans with MoSCoW priority tiers, dedicated `/plot-sprint` command, sprint lifecycle (Planning/Committed/Active/Closed), and optional retrospectives

## Motivation

Plot plans are scope-boxed ("what to build"). There is no way to express "what we will achieve this week/month" — a time-boxed grouping of work items with a shared goal and deadline. Sprints fill this gap: they have a goal, start/end dates, and sub-items grouped by priority (Must Have, Should Have, Could Have, Deferred). When time runs short, stretch goals move to Deferred rather than being deleted.

The manifesto already distinguishes time-awareness from effort tracking (Principle 9: "Small models welcome" occupies the slot the original plan assumed was available). Sprints operate as a temporal lens over plans — they don't add a new founding principle, they add an optional coordination layer.

## Design

### Sprint Concept

A sprint is a time-boxed coordination artifact that groups work by schedule. Sprint files live in `docs/sprints/YYYY-Www-<slug>.md`, where the ISO week prefix is derived from the start date. It contains:
- A sprint goal (narrative purpose)
- Start and end dates (time is the constraint)
- Sub-items grouped by MoSCoW priority
- Mixed item types: full Plot plan references (`[slug]`) and lightweight task checkboxes

Sprints are **not plans**. Plans track *what* to build; sprints track *when* to ship it. This distinction matters: Principle 2 ("Plans merge before implementation") does not apply to sprints. Sprint files are committed directly to main — no PR, no review gate. They are coordination artifacts, not implementation plans.

### Sprint Lifecycle

Distinct from the plan lifecycle (Draft/Approved/Delivered/Released):

| Phase | Meaning | Trigger | Pacing |
|-------|---------|---------|--------|
| Planning | Sprint being drafted, items selected | `/plot-sprint <slug>: <goal>` (generates `YYYY-Www-` prefix) | ⏸ natural pause |
| Committed | Team agreed on sprint contents | `/plot-sprint commit <slug>` | ⏳ human-paced |
| Active | Sprint running, work in progress | `/plot-sprint start <slug>` | ⚡ automate ASAP |
| Closed | Timebox ended, retro captured | `/plot-sprint close <slug>` | ⏳ human-paced |

### Sprint File Template

Lives in `docs/sprints/YYYY-Www-<slug>.md` (e.g., `docs/sprints/2026-W07-week-1.md`). Active sprints are indexed via a symlink directory:

- `docs/sprints/active/<slug>.md` — symlinks to active sprints

Closed sprints stay in place (Principle 8) and are identified by their Phase field. No `closed/` directory — closed sprints are not operationally queried.

```markdown
# Sprint: <title>

> <sprint goal - one sentence>

## Status

- **Phase:** Planning | Committed | Active | Closed
- **Start:** YYYY-MM-DD
- **End:** YYYY-MM-DD

## Sprint Goal

<Why this sprint matters. What the team is trying to achieve.>

### Must Have

- [ ] [slug] Plan-backed item description
- [ ] Lightweight task description

### Should Have

- [ ] ...

### Could Have

- [ ] ...

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Optional. Filled during /plot-sprint close. -->

## Notes

> **Followed by** `docs/plans/2026-08-18-a-sprint-names-what-it-ships.md`.
> This plan built sprints; that one closes two gaps found the first time one
> was actually created, on 2026-08-18 — a sprint cannot declare the release it
> is working toward, and its plan-selection step lists every plan in the repo
> rather than the ones serving the stated goal. Neither was visible from the
> design; both were visible within minutes of use.


<!-- Session log, decisions, links -->
```

Item format: `- [ ] [slug] description` (plan reference) or `- [ ] description` (lightweight task).

### Key Design Decisions

1. **Dedicated `/plot-sprint` command** — Sprints get their own skill, not conditional paths in every existing spoke. Sprints have a different lifecycle, directory, and no branch fan-out. Existing spokes get light sprint-awareness only (membership field in plans, sprint gating in release).

2. **Direct to main** — Sprint files are committed directly to main, no PR. Sprints are coordination artifacts, not implementation plans. Principle 2 does not apply.

3. **Minimal manifesto expansion** — Add `## Sprints` paragraph, adjust non-goals, add 1 decision question. ~15 lines total. Sprint lifecycle details live in the `/plot-sprint` SKILL.md.

4. **Adaptation, not deletion** — Items are never deleted from a sprint; they move to `### Deferred`. Scope changes are direct edits on main.

5. **MoSCoW completeness on close** — The close step checks must-haves vs delivered. If must-haves are incomplete, the user chooses: close anyway, move to Deferred, or hold off.

6. **Single symlink directory (`active/`)** — rather than mirroring both plan directories. Closed sprints are not operationally queried — no spoke feeds from them the way `/plot-release` feeds from delivered plans. If `core.symlinks` is off (common on Windows), agents resolve symlinks by reading the file content as a relative path. No workflow step breaks.

### Approach

#### NEW: `skills/plot-sprint/SKILL.md` — Dedicated Sprint Command

New skill directory. Handles full sprint lifecycle: create, commit, activate, close.

Subcommands (argument-based routing):
- `/plot-sprint <slug>: <goal>` — create sprint (Planning phase; generates `YYYY-Www-` prefix from start date)
- `/plot-sprint commit <slug>` — team agrees on contents (Planning → Committed)
- `/plot-sprint start <slug>` — sprint begins (Committed → Active)
- `/plot-sprint close <slug>` — timebox ended, retro (Active → Closed)
- `/plot-sprint` (no args) — show active sprint status

Includes:
- Sprint file template (MoSCoW tiers, dates, goal, retro)
- `docs/sprints/active/` symlink pattern (no `closed/` directory)
- Direct-to-main commits (no PR)
- MoSCoW completeness check on close (must-haves vs should/could/deferred)
- Optional retrospective on close

**Model Guidance** (for the new skill):

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| Create, commit, start, status | Small | Git commands, templates, file ops |
| Close — MoSCoW completeness | Small | Checkbox parsing, plan ref lookup |
| Close — cross-plan lookup | Mid | Reading multiple plan files to check delivery status of `[slug]` refs |

All sprint operations are structural (Small or Mid). No Frontier needed.

**Guardrail:** Sprint files must not contain `## Design` or `## Approach` sections. If the dispatcher detects these in a sprint file, warn: "This looks like a plan, not a sprint."

**Pacing annotations:**
- Creation (`/plot-sprint <slug>: <goal>`) — ⏸ natural pause (drafting). On creation, run `ls docs/plans/active/ 2>/dev/null` to discover active (Draft/Approved) plans. Present list: "Found N active plans. Add any to this sprint?" User selects which to include (or none). Selected plans are added as `[slug]` items under the appropriate MoSCoW tier. Model tier: Small (file listing + user interaction).
- Commitment (`/plot-sprint commit`) — ⏳ human-paced (team agreement)
- Activation (`/plot-sprint start`) — ⚡ automate ASAP (mechanical transition)
- Scope changes (direct edit) — ⏳ human-paced
- Closure/retro (`/plot-sprint close`) — ⏳ human-paced (retrospective)

#### NEW: `skills/plot-sprint/README.md`

Standard README per repo conventions: purpose, structure, tier (reusable/publishable), testing, provenance, known gaps.

#### MANIFESTO.md (~15 lines added)

**New `## Sprints` section** (after Pacing, before "What Plot Is Not"):

> Sprints are an optional temporal lens over plans. A sprint groups work by schedule — start date, end date, MoSCoW priorities. Plans track *what* to build; sprints track *when* to ship it. Sprint files live in `docs/sprints/`, managed by `/plot-sprint`, committed directly to main. Sprints do not spawn implementation branches, so Principle 2 (plans merge before implementation) does not apply.

**Adjusted non-goals** (line 98, "Not a time or effort tracker" becomes):

> Not an effort tracker. No story points, no burndown charts, no estimates. Sprints use deadlines as constraints, not time as a metric — Plot tracks *what* is planned and *whether* it shipped, not *how long* it took.

**New decision question** 8 (renumber existing 7 questions, insert before the closing paragraph):

> 8\. Does it stay focused on scheduling, or creep into effort tracking?

#### plot/SKILL.md (Hub/Dispatcher) — Light-to-moderate additions

- **Plot Config:** add `Sprint directory: docs/sprints/` line
- **Step 1 (Read State):** add `ls docs/sprints/active/ 2>/dev/null` to the parallel state-gathering block
- **Step 2 (Detect Context, on main):** show active sprints with countdown and progress: `week-1 — "Ship auth improvements" | 3 days remaining | Must: 2/4 done`. Past end date: show "ended 2 days ago" factually — no warning tone, no nagging. Model tier: Small (date arithmetic). Only in dispatcher (`/plot`), not in spoke commands.
- **Step 3 (Detect Issues):** warn on sprints past end date, multiple active sprints
- **Phases section:** new sprint phases table alongside existing plan phases table
- **Lifecycle section:** sprint lifecycle Mermaid diagram with pacing emoji
- **Spoke commands list:** add `/plot-sprint`
- **Model Guidance:** 2 new rows (Small — sprint listing is mechanical)

#### plot-approve/SKILL.md (Light Touch)

- **Step 4 (Read Plan):** if plan has `Sprint: <name>` field in Status, note membership in approval metadata
- **Step 8 (Summary):** mention sprint membership if present
- **Model Guidance:** no new rows (sprint field is just a string read)

#### plot-deliver/SKILL.md (Light Touch)

- **Step 3 (Read Plan):** extract `Sprint:` field if present
- **Step 8 (Summary):** if plan was in a sprint, note sprint progress ("3/5 sprint items delivered")
- **Model Guidance:** 1 new row (Small — sprint item counting)

#### plot-release/SKILL.md (Light Touch)

- **Step 1 (Determine Version):** when listing delivered plans, show sprint membership alongside
- **Step 2A (RC Path):** tag sprint items in verification checklist
- **Step 3 (Cross-check):** sprint completion is informational, not blocking
- **Model Guidance:** 1 new row (Mid — sprint grouping across plans)

#### plan-idea/SKILL.md (Template Addition)

- **Step 4 template:** add optional `- **Sprint:** <sprint-name>` field to Status section (empty by default, filled when a plan is added to a sprint)

#### Documentation Updates

- **plot/README.md:** add plot-sprint to spoke list and structure table
- **Root README.md:** add plot-sprint row to skills table

### Edge Cases

| Case | Handling |
|------|----------|
| Sprint with only lightweight tasks | Supported. Completeness check reads checkbox state only |
| Plan ref `[slug]` doesn't exist yet | Valid during Planning/Committed. Warn during Active. Report as "not started" at closure |
| Must-haves incomplete at closure | Warn + 3 options: close anyway / move to Deferred / hold off |
| Multiple active sprints | Allowed but warned by dispatcher |
| Same slug for sprint and plan | Disambiguated by directory (`docs/sprints/` vs `docs/plans/`); ask user if ambiguous |
| Sprint slug collision across weeks | Date prefix disambiguates (e.g., `2026-W07-week-1.md` vs `2026-W09-week-1.md`) |
| Sprint with no end date | Valid during Planning. Required before commit transition |

## Testing

E2E test scenario following the existing `test-plot` pattern from `skills/plot/README.md`:

```
Test scenario: test-sprint
1. /plot-sprint week-1: Ship authentication improvements
2. Add items: 1 plan-backed [slug] reference + 2 lightweight tasks across MoSCoW tiers
3. /plot-sprint commit week-1 — verify end date required
4. /plot-sprint start week-1 — verify active/ symlink created
5. Complete one must-have, leave one should-have incomplete
6. /plot-sprint close week-1 — verify MoSCoW completeness check, deferred handling
7. Verify retrospective prompting works
8. Run /plot on main — verify sprint appears with countdown/progress
9. Verify plan-backed [slug] cross-references resolve correctly
10. Verify active/ symlink removed on close
```

Spoke awareness tests:
- Run a plan lifecycle with `Sprint: week-1` field populated
- Verify `/plot-approve` mentions sprint membership
- Verify `/plot-deliver` shows sprint progress

## Branches

- `feature/plot-sprint-support` — Implement sprint support: new skill, manifesto additions, spoke modifications. **Landed directly on main on 2026-02-11, without a branch or a PR.** The plan recorded a PR number here until 2026-08-18; it pointed at an unrelated PR (the AskUserQuestion tool convention, merged 2026-03-15) and is removed rather than corrected, because no PR exists to name.

## Notes

- Rebased from commit 848811e (pre-PR#4) onto current system with manifesto, model guidance, pacing, RC verification, third-person voice, and sync comments
- Key adaptation: original plan proposed Principle 9 "Time is a constraint, not a metric" — that slot is now taken by "Small models welcome". Sprints are an optional feature, not a founding belief, so they get a manifesto section instead of a principle.
- Key adaptation: original plan extended existing commands (`/plot-idea`, `/plot-approve`, etc.) with sprint type detection. Current design uses a dedicated `/plot-sprint` command — sprints have a different lifecycle, directory, and no branch fan-out, so conditional paths in every spoke would add complexity without benefit.
- Key adaptation: original plan had no model guidance or pacing. All sprint operations are Small or Mid tier; no Frontier needed. Pacing follows the same three categories as the rest of Plot.
- Key adaptation: `docs/archive/` replaced with `docs/sprints/active/` symlink directory, mirroring the plan convention. No `closed/` directory — closed sprints stay in place, identified by Phase field.
