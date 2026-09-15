# Sprint: A declared agent costs what it costs

> An agent kind is declared and dispatched by name, and a plan states what its agents spent.

## Status

- **State:** Active
- **Start:** 2026-09-15
- **End:** 2026-10-06
- **Release:** 2.18.0

## Sprint Goal

**Two stories that have been `draft` since 2026-08-27 with zero plans each, and
both are further along than their files say.**

**The first half of `plot-agent-identity` already shipped, under another name.**
The story drafted `.plot/roles/<slug>.md` carrying name, model, effort, tools
and command. What v2.17.0 delivered is the **charter** — `CharterSchema` carries
`name`, `harness`, `model`, `effort` and `capabilities`, and
`plot-dispatch.sh` reads them: measured 2026-09-14, **16 readers for `harness`,
14 each for `model` and `effort`, 7 for `capabilities`**.

**And nobody has declared one.** `.plot/charters/` holds **zero files** on this
estate. So the mechanism is complete and its adoption is nil — the defect class
CLAUDE.md names: *"Where a rule exists and nothing calls it, that is a defect to
report."* The story's remaining work is not to build the noun again; it is to
use it, and then to build the half that was never started — a slice saying what
kind of agent it needs.

**The second story has no foundation at all, and its scope is already narrowed
to what can be derived.** `plot-plan-economics` asks *what did this plan cost*.
`entities/budget.ts` sounds like the answer and is not: it carries `connector`,
`account`, `bucket`, `spent`, `limit`, `remaining` — an API rate-limit window,
not a token count.

**Re-measured 2026-09-14 while writing this sprint, and the gap is narrower than
it first looked.** `transcript.ts` already reads `input_tokens` (4 references)
and `cache_read_input_tokens` (3), and the board's panel has rendered a context
figure from them since 2026-08-19. `output_tokens` and
`cache_creation_input_tokens` are read **nowhere**, and **no rule in
`packages/domain/src/rules/` sums anything per plan or slice**. So the work is
two counters plus attribution and a rollup — not capture from nothing.

The story narrowed itself on 2026-08-29 by measurement: a transcript carries all
four token counters and the model per turn, **and no monetary field**, so tokens
are a derivation and francs are not. That still holds. This sprint stops at
tokens.

**Both halves are measurable, which is why they are in one window.** An agent
declared by kind is the thing whose cost is worth attributing, and a cost
attributed to an undifferentiated worker answers a less useful question.

### Must Have

- [x] [a-charter-reaches-the-agent-it-declares](../plans/2026-09-14-a-charter-reaches-the-agent-it-declares.md) — a read-only reviewer charter, a `--agent` selector, and a prompt file that honours what Plot exports. Closes a zero-adoption gap on a mechanism that is already complete.
- [x] [a-slice-names-the-agent-it-needs](../plans/2026-09-15-a-slice-names-the-agent-it-needs.md) — a per-branch `<!-- agent: <name> -->` annotation, read by dispatch when `--agent` is absent. Without it an unattended fleet runs every slice as the same undifferentiated worker.
- [ ] [a-slice-says-what-it-spent](../plans/2026-09-15-a-slice-says-what-it-spent.md) — sum the four token counters and the model across a run's whole transcript and record it per slice. The existing readings describe the LAST TURN and are a context ceiling, not a cost.

### Should Have

- [ ] **A plan states what its slices cost** — the per-plan rollup over the recorded counters. **Deliberately unplanned**: it is trivial once [a-slice-says-what-it-spent](../plans/2026-09-15-a-slice-says-what-it-spent.md) records a number and worthless before, so it is drafted after that lands rather than against an intended shape. Reporting is worth less than capture and depends on it, so it is a Should rather than a Must.

### Could Have

<!-- Raised by the operator 2026-09-15: bb polling too hard, and Jenkins builds
     absent from the board entirely. Could rather than Must because the sprint's
     goal is a declared agent and its cost; these are connector defects found in
     the same window. Ordered by dependency. -->

<!-- [the-board-asks-the-build-resolver] REJECTED 2026-09-15: its premise was false. `buildShell` IS the resolver's caller (build-resolve.ts:64) and the Jenkins arm already resolves. The operator's blank board is unexplained and needs a different plan. -->
- [ ] [a-jenkins-job-is-read-by-its-shape](../plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md) — `plot-host.sh` asks Jenkins with `job list`, which answers for a multibranch job and returns `null` for a plain one, so a CD pipeline reads as `failed`. Measured on a live instance 2026-09-15. Supersedes [the-deploy-job-shows-on-main](../plans/2026-09-15-the-deploy-job-shows-on-main.md), rejected: it named the need correctly and the mechanism wrongly — a config key would have been read correctly and the reader would still have returned `null`.
- [ ] ~~[a-connector-declares-its-ceiling](../plans/2026-09-15-a-connector-declares-its-ceiling.md)~~ — **Rejected 2026-09-15.** `refreshIntervalMs` genuinely takes no ceiling, but `targetStretch` clamps at `MAX_CADENCE_STRETCH` above ~120/hr and every live connector observes 6x that, so the output cannot move. The board is 0.75% of Bitbucket's spend; the operator's report is about the other 99.25%.

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

**Both stories sat unchanged from 2026-08-27 until this sprint was written, and
both were stale in ways that matter to whoever plans them. Each now carries an
amendment dated 2026-09-14 above its August text.**

`plot-agent-identity`'s `## Current Plan` describes `.plot/roles/<slug>.md`
and names a blocker — `the-domain-moves-out-of-the-board`'s Entities slice —
that is **released**. The amendment says so and points at the charter; the
August design is kept below it as the record of what was thought then.

`plot-plan-economics` carries its own narrowing note from 2026-08-29 and that
note is still correct. Read it rather than re-deriving the francs question. Both
stories were amended on 2026-09-14 with the measurements above, in place: the
August text is kept as the record of what was thought then, under a line saying
so.

**`Release: 2.18.0`, added 2026-09-14 when the sprint was committed.** It was
deliberately absent while the sprint was `Planning` — a version promised for work
whose first plan was unwritten is a gate with nothing behind it. `setSprintState`
settled when it stops being optional: committing to a sprint **requires** one,
because *"the release is the gate's key, and a commitment nothing is judged at is
not one."* So the field arrives with the commitment rather than with the file.

2.18.0 because v2.17.0 shipped on 2026-09-14 and this sprint's first Must is a
feature.

**Three Musts and one Should for a three-week window is deliberate.** Both
stories start with zero plans, so each Must carries its own `/plot-idea` and
interrogation before any code. The window is sized for shaping, not only for
building.

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->
