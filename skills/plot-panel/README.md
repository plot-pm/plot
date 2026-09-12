# plot-panel — developer notes

N agents read one plan through different lenses; each writes a verdict file that must name a committed position; a moderator reconciles. `SKILL.md` is the agent-facing instruction; this file is why it looks the way it does.

Design plan: `docs/plans/2026-09-12-a-panel-questions-one-plan.md`.

## The mechanism is the deliverable, and it has exactly one caller-facing rule

Two reviews in Plot want this shape and neither has it. `/challenge-the-plan` questions a Draft plan sequentially; `/plot-deliver` step 5 fans out over merged PRs. **Step 5 varies the PR, not the lens** — four agents asking one question of four diffs, rather than four questions of one plan.

Both state their commitment rule in prose. Step 5's is:

> *"A deliverable that names a behaviour is only SUPPORTED when someone ran it. 'The diff appears to add it' is a reading."*

That is a rule an agent satisfies by asserting it did. The conversion this package performs is the same one `plot-state-gate.sh` performed for `State:` writes: the rule existed in prose, agents routed around it, and a file check ended the argument.

**Neither caller is built here.** They belong to `a-plan-is-questioned-before-it-is-approved`, which was Draft when this shipped. Building a consumer against an unapproved plan does that plan's work invisibly to its review.

## Where the three parts live, and why the split is where it is

Manifesto Principle 3 — *skills interpret and adapt; scripts collect and report* — puts the seam in an unusual-looking place here:

| Part | Where | Why |
|---|---|---|
| The lenses, the rubric, the fan-out | `SKILL.md` | Which reading a plan needs is judgment about that plan |
| The commitment gate | `packages/domain/src/rules/panel.ts` | "Does this file contain this line" is mechanical and testable |
| The moderation's content | `SKILL.md` | Naming a disagreement is the whole job |
| Which panel state the readings amount to | `rules/panel.ts` | Counting distinct positions is arithmetic |

**The gate is in the domain rather than the skill because of what its absence looks like.** Fan-out, files and reconciliation all work with the gate gone — the panel runs, produces N files and a summary, and looks finished. Nothing fails. That is the failure mode this repo keeps paying for, and it is why `test/panel.test.ts` asserts refusals rather than asserting that N files appeared. A test that only counts files passes against no gate at all.

Verified by mutation rather than by inspection: replacing the missing-line branch with `if (false)` fails 3 of the 16 tests.

## `panel` and `juror`, never `verdict`

`packages/domain/src/rules/verdict.ts` already exists. Its verdict is a **slice's wave eligibility** — `complete` / `empty` / `unapproved` / `eligible` / `blocked` — shipped as `plot-verdicts.mjs` and rendered by the board. It has no relationship to a juror's position.

The collision is in the name only and it is a hazard in both directions: a new `verdicts.ts`, or a new `plot-verdict*.mjs`, would be read by the next person as the eligibility rule. The plan's prose says "verdict file" and that is fine; the identifiers say `juror` so they survive a `git grep`.

## The commitment vocabulary is a parameter

A Draft juror commits to `proceed|amend|reject`; a delivery juror to `supported|refuted` plus the command it ran. `readJuror` takes a `Commitment` and validates against it.

This is not generality for its own sake — **hardcoding either vocabulary is what makes the second caller impossible**, and the second caller is the entire justification for extracting the mechanism. `test/panel.test.ts` pins it by asserting that one text is a commitment under one caller's shape and a refusal under the other's.

## The four hedges the gate refuses

Each is a shape a juror actually writes, not a hypothetical:

| Hedge | Why the naive implementation misses it |
|---|---|
| No `Label:` line at all | The base case; caught by any implementation |
| A word outside the vocabulary | `Position: maybe` is a line, and it is not a position |
| An empty or absent file | A crashed juror leaves nothing, which is not agreement |
| **Two different positions in one file** | **Taking the first line lets it through; taking the last lets it through the other way** |

The last one is the interesting one. It hedges *inside the gate's own field*, so there is no reading of "the position line" that is both natural and safe — which is why neither the first nor the last is taken.

One more shape is refused for a reason worth stating: the label is matched **at the start of a line**. A juror explaining the rubric writes "my Position: line must name one of three words" mid-sentence, and a substring match reads that explanation as the commitment.

## Why an eighth bundle

`plot-ask.mjs` answers `board` and `fleet` by **running** `plot-fleet-scan.sh` — 18.3 s. A skill asking it whether one juror committed would start a whole fleet scan to read one file. `plot-panel.mjs` reads stdin, spawns nothing and opens nothing.

**3.0 KB**, through the narrow import path (`@plot-pm/domain/rules/panel`). The root import measured 334 KB on 2026-09-03; the schema-carrying bundles in this directory are 320 KB.

**The file arrives on stdin** rather than being opened by the bundle, so the domain reaches no filesystem and the one I/O call sits in the shell that owns it — `plot-sprint-transition.mjs`'s choice, for its reason.

**Exit 3 for a refusal**, not 1. A shell reading only `$?` already reads 1 as a broken pipe or a missing file, and a caller must not be able to read a hedge as a verdict. Exit 2 is unusable arguments, which is a broken caller rather than a hedging juror.

## Verdict files are tracked

`.gitignore:30` ignores `.plot/state/` and tracks the rest of `.plot/`. So the path decides whether a panel's reasoning survives its worktree: a desk is transient and `plot-reap.sh` removes it.

The plan parks this as an Open Question and leans toward a panel directory beside the plan. **`.plot/panels/<subject>/` is the answer, stated rather than arrived at by picking a path.** The reason is the measurement this repo keeps re-recording: an observation that exists only in one agent's context dies with it. A panel's moderation is an artifact a person reads a week later.

The cost is real and worth naming: a Draft plan questioned five times carries five sets of juror files into history. If that becomes the dominant cost, the directory is one constant (`PANEL_DIRECTORY`) and the callers are unaffected.

## What is deliberately not decided here

Three Open Questions stay open, because the plan parks them and the first real answers come from running the thing:

- **How many jurors.** The panel takes N. Four lenses is a guess nobody has measured; hardcoding four is the tempting move and it is not made.
- **Whether unanimity skips reconciliation.** `readPanel` reports `unanimous` as a *reading*, not as a licence to skip the moderator. The plan leans no — a moderator reading four agreements is how a shared blind spot gets named — and the caller retains the choice.
- **A juror's tool scope.** A panel works unbounded. `a-charter-bounds-what-an-agent-may-touch` makes a juror's scope declarable; that dependency runs toward the panel and not away from it.

## Testing

```bash
cd packages/domain && pnpm vitest run test/panel.test.ts
```

16 tests, no fixtures and no filesystem: `readJuror` takes the text and `readPanel` takes the readings, so the rule is synchronous and mock-free — the domain's shape rule (*readings as values, not ports*) applied.

The shipped artifact is exercised directly:

```bash
printf 'Position: amend\n' | node skills/plot/scripts/board/plot-panel.mjs check \
  Position proceed,amend,reject contracts   # → committed, exit 0
printf 'Looks fine to me.\n' | node skills/plot/scripts/board/plot-panel.mjs check \
  Position proceed,amend,reject contracts   # → uncommitted, exit 3
```
