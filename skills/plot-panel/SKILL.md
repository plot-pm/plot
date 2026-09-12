---
name: plot-panel
description: >-
  Question one plan with N agents reading it through different lenses, each
  writing a verdict file that must name a committed position, reconciled by a
  moderator that names disagreements rather than averaging them. A mechanism
  other reviews call; not a lifecycle step. Use on /plot-panel.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires the `Task` tool for fan-out and
  node ≥ 20 for `skills/plot/scripts/board/plot-panel.mjs`.
---

# Plot: Panel

**N agents read one plan through different lenses. Each writes a file. Each file must name a position, or it is refused. A moderator reconciles what they said.**

This is a **mechanism**, not a lifecycle step. It moves no plan between phases, writes no `State:` line, and decides nothing about a plan's fate — it produces verdict files and a reconciliation for a caller to act on. `/challenge-the-plan` and `/plot-deliver` are the intended callers; both own their own decisions.

## Why a panel rather than more rounds

`/challenge-the-plan` questions a Draft plan **sequentially**, four questions per round, and states that comprehensive coverage takes five to ten rounds. Measured on this repo 2026-09-12: **268 plans, 74 carrying a `Rounds:` field — 27.6%**, and 33 of those 74 stopped at one round.

That is a **cost** measurement rather than a verdict on sequential questioning. Rounds are serial and each one costs a person's attention, so the uptake measures what that attention costs. A panel is the unattended shape of the same question: N lenses at once, on disk, with no one waiting.

**Fan-out alone is a `Task` call.** What makes this worth a skill is the other three parts — one shared prompt, files rather than a transcript, and a gate that refuses a juror who did not commit.

## The subject is one plan, never a wave

A wave holds slices from several plans and is *"sized by the agents available, bounded by what can land"* ([DESIGN-slice.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)). Four personas asked to interrogate a scheduling cohort produce four answers with no shared subject.

**A plan is the coherent unit.** Its slices are one deliverable split for parallelism.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Take the panel's parameters | Small | Read the plan path and the caller's commitment shape |
| 2. Fan out the jurors | Frontier | Each juror reads a plan and judges it; that is the whole task |
| 3. Check every verdict | Small | One script call per file, exit code decides |
| 4. Send a refused juror back | Small | Mechanical: re-run the same juror with the refusal appended |
| 5. Reconcile | Frontier | Naming a disagreement, and naming a shared blind spot, is judgment |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

**A panel is unattended-first.** Its reason for existing is that rounds cost attention, so the attended path is the exception. Every step below has a defined behaviour with nobody watching.

## Parameters

A caller supplies four things. Nothing here is defaulted by the mechanism except where stated.

| Parameter | What it is |
|-----------|-----------|
| **Subject** | The path to **one** plan file |
| **Lenses** | The personas, one per juror. The caller chooses how many |
| **Commitment** | The label and the words that count as a position |
| **Rubric** | The questions every juror answers, identical across lenses |

**How many jurors is the caller's choice, and the mechanism takes N.** Four lenses is a guess nobody has measured; the first real number comes from running it. Do not hardcode one.

### One prompt, the persona as the only variable

**This is the design point that makes the panel worth extracting.** N prompts produce N unrelated reviews with no shared rubric and nothing the moderator can compare. One rubric, varied by lens, is what makes the verdicts commensurable.

So the juror brief is assembled as:

```
<the rubric — identical for every juror>
<the subject — the same plan path for every juror>
<the lens — THE ONLY LINE THAT DIFFERS>
<the commitment — identical, and what the gate will check>
```

If you find yourself writing a second rubric for a second lens, the lens is doing work the rubric should: put the difference in the persona sentence and leave the questions alone.

### The commitment is the caller's vocabulary

A Draft juror commits to `proceed|amend|reject`. A delivery juror commits to `supported|refuted` plus the command it ran. **The mechanism does not know either** — it takes the required shape and validates against it. Hardcoding a vocabulary is what makes the second caller impossible.

## Steps

### 1. Take the panel's parameters

Read the subject plan. Confirm it is **one plan file** and not a wave, a sprint, or a directory. A panel over a cohort is four agents with no shared subject — refuse it and say which parameter was wrong.

Establish the panel directory:

```bash
SUBJECT=$(basename "$PLAN" .md)
PANEL=".plot/panels/$SUBJECT"
mkdir -p "$PANEL"
```

**Verdict files are tracked, not machine-local.** `.plot/state/` is git-ignored and reaped with the desk (`.gitignore:30`); `.plot/panels/` is tracked. A panel's reasoning is an artifact a person reads a week later, and this repo has measured the alternative repeatedly: an observation that exists only in one agent's context dies with it.

> **Unattended (`PLOT_UNATTENDED=1`):** nothing to ask — the caller supplied every parameter. If one is missing, refuse; a panel run with a guessed commitment validates against a vocabulary nobody chose.
> `PLOT-UNASKED: Which commitment shape should the jurors use? — refused — no panel run, the caller must name it`

### 2. Fan out the jurors

Launch one `Task` agent per lens, **in parallel, in a single message**. Each receives the assembled brief from the section above, and each is told exactly where to write:

> Write your verdict to `.plot/panels/<subject>/<lens>.md`.
>
> **Your file must contain a line naming your position:**
>
> ```
> <Label>: <one of the caller's words>
> ```
>
> A file without that line is **refused** and you will be asked again. The line is checked mechanically — hedging in prose around it does not satisfy it, and neither does two different positions in one file.

**Brief each juror to look, not to agree.** The lens is a reading position, not a verdict to reach. A juror told "you are the contracts lens" and asked what it finds is doing the job; one told "find contract problems" will find them whether or not they are there.

### 3. Check every verdict

Never read the files and judge for yourself whether they committed. **Ask the gate**, once per juror:

```bash
node skills/plot/scripts/board/plot-panel.mjs check "$LABEL" "$POSITIONS" "$LENS" \
  < "$PANEL/$LENS.md"
```

Exit `0` is a commitment and prints `committed\t<lens>\t<position>`. Exit `3` is a refusal naming what is wrong. Exit `2` means the arguments were unusable — a broken caller, not a hedging juror.

**This is the part that is more than parallel subagents.** Fan-out, file-writing and reconciliation all work perfectly with the gate absent: the panel runs, produces N files and a summary, and looks finished. The gate's absence is invisible at runtime, which is exactly why it is a check rather than a sentence in the brief. A juror asked in prose to commit can answer "did I?" with yes without it being true.

**If the bundle is missing, say you could not ask.** A missing artifact is a broken installation, not a refusal — report that the panel ran ungated rather than reporting a clean panel.

### 4. Send a refused juror back

Re-run **that juror only**, with the refusal text appended to its brief. The refusal names what was wrong: no line, a word outside the vocabulary, an empty file, or two positions at once.

**Once.** A juror that hedges twice is reported as refused and the panel is refused with it — a juror that will not commit has not reviewed, and a second re-run is a loop that ends when the context does.

> **Unattended (`PLOT_UNATTENDED=1`):** report the panel as refused, naming the juror and the reason. Do not drop the juror to reach a quorum — a panel of three that was asked of four is a different panel, and the record would not say so.
> `PLOT-UNASKED: Proceed with the remaining jurors, or refuse the panel? — refused — panel refused, the hedging juror named`

### 5. Reconcile

Ask the mechanism what the panel amounts to:

```bash
printf '%s\n' "${READINGS[@]}" | node skills/plot/scripts/board/plot-panel.mjs reconcile
```

It answers `unanimous`, `divided` (naming each position and who holds it), or `refused`.

Then **write the moderation** to `.plot/panels/<subject>/panel.md`. This is judgment and the script does none of it:

- **Name the disagreements. Never average them.** Two jurors saying `amend` and one saying `reject` is not "mostly amend" — it is a disagreement about whether a named problem is fatal, and the moderation's job is to say what that problem is. A number replaces the one thing a reader needs.
- **A unanimous panel is reconciled too.** The mechanism reports unanimity and does not skip the moderator, because **a moderator reading four agreements is how a shared blind spot gets named**. Four jurors who all read the same plan and all missed the same thing agree perfectly. Ask what the lenses had in common before accepting what they concluded.
- **Say what each juror actually looked at.** A position reached by reading the plan and one reached by running the code are different evidence, and the moderation is where that distinction survives.

> **Unattended (`PLOT_UNATTENDED=1`):** write the moderation and stop. The panel reports; acting on a divided panel is the caller's decision and has no safe default in either direction.
> `PLOT-UNASKED: The panel is divided — proceed on the majority, or hold? — stopped — moderation written, nothing acted on`

## What this skill does not do

- **It does not decide the subject's fate.** No phase moves, no `State:` line is written, no PR is merged. The caller reads the moderation and decides.
- **It does not judge prose quality.** A juror reporting awkward wording alongside a missed deliverable dilutes both. Do not add a prose lens.
- **It does not choose the lenses.** Which readings a subject needs is the caller's judgment about that subject.
- **It does not bound a juror's tools.** A panel works unbounded. When [a charter bounds what an agent may touch](../../docs/plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) lands, a juror's scope becomes declarable rather than instructed — the dependency runs that way and not this one.

## Related

- [`/challenge-the-plan`](../challenge-the-plan/SKILL.md) — sequential interrogation of a Draft plan; the panel is its parallel counterpart
- [`/plot-deliver`](../plot-deliver/SKILL.md) — step 5 fans out over merged PRs, varying the **PR** rather than the lens
- [Running unattended](../plot/docs/unattended.md) — why the question tool is absent under `claude -p`
