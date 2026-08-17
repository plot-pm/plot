## Implementation brief — dispatch-hands-over-work, wave 2 (Start)

- **Plan (canonical):** `docs/plans/2026-08-17-dispatch-hands-over-work.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #152 merged (two interrogation rounds)
- **Branch:** `feature/dispatch-reports-no-worker` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

Two halves of one gap: **the summary reports the consequence**, and **the first
dispatch asks the question** that would remove it.

Wave 1 landed (#158, #159), so the brief is written and the row reads the worker
state. What is still missing is that a dispatch which prepares worktrees and
starts nobody says so only in per-branch output — after the fact, where a reader
skimming the last line never sees it.

**Measured on this repo, twice tonight**, dispatching #162 and this very plan:

```
summary: dispatched=1 reused=0 skipped=0 started=0 brief=missing
```

`started=0` and `brief=missing` are already there — wave 1 put them there. What
is absent is *why* nothing started, in the same line.

### Five decisions the plan settles — do not re-derive them

**The summary states the consequence up front.** The target shape:

> *"3 worktrees prepared, 0 workers started, no `Worker command` configured"*

In the **summary**, not per branch. The plan is explicit that this is the point:
a caller reading only the last line is the case this exists for, and per-branch
output is exactly where the message hides today.

**The asking belongs to the SKILL, not to this script.** A bash script cannot
put an interactive question to a human inside an agent session — and this repo's
direction is that skills interpret while scripts collect and report
(Principle 3). Round 1 of the plan corrected an earlier draft that had this
backwards; do not put a prompt in `plot-dispatch.sh`.

`skills/plot-dispatch/SKILL.md` is the layer that asks. It already drives the
script through its phases.

**It asks at the FIRST DISPATCH, never at `/plot-init`.** Adoption runs long
before anyone fans out work, so a question about headless agents then is a
question about a need the answerer does not have. It gets a shrug, the key is
written empty, and nobody revisits it — **an answered-and-wrong config is harder
to fix than a missing one**, because nothing later notices it was never really
decided. At the first dispatch the consequence is concrete and immediate.

The shape from the plan:

```
3 branches eligible.
No `Worker command` configured — worktrees will be prepared
but no agent started.

How does this project run an agent headless?
(leave empty to keep starting them yourself)
```

**It asks; it never suggests.** No example command in the prompt. An example
becomes a template, and then Plot has effectively hardcoded a tool it is not
supposed to know (Principle 5). The problem was never *which command* — it was
that nobody learns the option exists.

**Empty is a first-class answer, and is not re-asked every run.** Hand-starting
is what this repo did all evening and it works; the config removes a step rather
than declaring the manual path wrong. A prompt that returns on every dispatch is
a nag, and nags get answered with whatever silences them. Record that the
question was asked.

**`--no-start` keeps meaning exactly what it says.** It is the right default for
a human inspecting before letting an agent loose, and this session used it
deliberately every single time. The defect was never that dispatch obeyed
`--no-start`; it was that nothing downstream noticed the result. **Do not make
`--no-start` imply anything new.**

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A dispatch with no `Worker command` says so in the summary**, with counts.
  Assert the **summary line**, not per-branch output — a caller reading only the
  last line is the case this exists for, and a per-branch message passes any
  test that greps the whole output.
- **The `Worker command` question is asked at the first dispatch, not at
  `/plot-init`.** Assert adoption never raises it.
- **It asks rather than suggests.** Assert no example command appears in the
  prompt.
- **An empty answer is accepted and not re-asked every run.**
- **`--no-start` still starts nothing, and still writes the brief.** The two are
  independent; conflating them would remove the inspect-first workflow.
- **The script never invokes a skill.** Assert `plot-dispatch.sh` contains no
  such call — the plan's own first draft proposed exactly that, and it would
  invert the Manifesto's direction as well as being impossible in bash.

Plus: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
`pnpm run validate` all pass; a changeset is present. macOS bash 3.2 — **no
`declare -A`**.

Bump the `metadata.version` of every skill you change, and the plugin version in
all three metadata files (see `CLAUDE.md` › Versioning). Update the
`## Model Guidance` table of any skill whose steps you change.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists** — this repo lost sight of finished work three times on one branch in a
single day because it was never pushed.

### Scope guard

`skills/plot/scripts/plot-dispatch.sh` (the summary line),
`skills/plot-dispatch/SKILL.md` (the first-dispatch question), their READMEs,
and the skill/plugin version metadata.

**Do not touch `plot-fleet-scan.sh` or `packages/board/`** — wave 1 finished
there and one branch is in flight over the board's contract
(`feature/pr-state-travels-as-a-field`, editing `schema.ts` and `fleet.ts`).

**Do not re-open the brief mechanism.** `feature/dispatch-writes-brief` (#158)
settled it; you consume its result rather than changing it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
