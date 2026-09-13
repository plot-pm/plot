# Implementation brief — a-slice-shows-that-its-brief-was-asked-for

- **Plan (canonical):** `docs/plans/2026-09-12-a-slice-shows-that-its-brief-was-asked-for.md` on `main`
- **Approved:** 2026-09-13, jwloka, in-session
- **Branch:** `feature/a-slice-shows-that-its-brief-was-asked-for` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer who knows the domain's arrow-function rule

The plan has ONE slice and one branch, so nothing waits on this and it waits on nothing. Its pair half, [auto-dispatch-asks-for-the-brief](../../docs/plans/2026-09-12-auto-dispatch-asks-for-the-brief.md), merged on 2026-09-12 — the board now asks for briefs by itself, so the state this renders is a state the board creates. It is already running: `.plot/` holds five `brief-*.log` files today.

## What to build

A row in NOT STARTED that reads `no brief at .plot/briefs/<slug>.md — /plot-implement writes it` keeps saying exactly that while a brief writer is working on it. Measured 2026-09-12 on the operator's own board: `a-marker-names-its-writer` read `approved — nobody has taken it` while its brief was being written, and the operator asked the question the board could not answer — *"shall we indicate that the slice is claimed and the brief is currently written? UI does not show any action."*

Two different truths render as one word:

| what is true | what the board says |
|---|---|
| nobody has asked for a brief | `approved — nobody has taken it` |
| a brief is being written now | `approved — nobody has taken it` |

The fix is a second reading on the same row: a log file beside the repo dates the ask, so the row says **when it was asked for** instead of implying nobody has. `row-identity.ts:149` already draws why the wording matters — *"an operator told `nobody has taken it` runs `/plot-dispatch`; an operator told this runs the thing that helps."* A slice already having its brief written needs neither command. It needs waiting.

The plan is canonical; this is orientation.

## The decisions the plan settles — do not re-derive them

### The log path is `.plot/brief-<slug>.log`, and a second writer disagrees — READ THIS FIRST

**Two writers spell the path two ways, and only one of them has ever produced a file.**

| writer | path it writes | files on disk today |
|---|---|---|
| `plot-dispatch.sh:701` | `.plot/brief-<slug>.log` | **5** |
| `brief-ask.ts:100` | `.plot-brief-<slug>.log` (repo root) | **0** |

The plan names the first, and the first is the one the estate actually has. Build the reader against `.plot/brief-<slug>.log`.

**The disagreement is invisible until this slice exists, and that is exactly why it bites.** Nothing reads either log today, so nothing has ever compared them. This slice is the first reader — so it is the moment a wrong path becomes a user-visible defect, and the defect is SILENT: an absent log is the plan's own no-change default, so a reader pointed at the empty path would report *nobody has asked* forever while every assertion about the absent case passed.

**The slug is the branch name after its LAST `/`** — `feature/x` gives `x`. `briefPath` in `packages/board/src/server/brief-path.ts` already holds that rule for the brief itself and says why the prefix is dropped rather than flattened. The log is a sibling question with the same slug; take the slug the same way, and do not re-implement the split.

**Report the `brief-ask.ts` mismatch rather than silently fixing it here.** Which path is right is a judgement about two components, not this slice's call, and widening scope to repair a second file is how a read-only slice becomes an unreviewable one. Name it in the PR body.

### An absent reading is not a failed one — and the plan's own author got this wrong

**There is no third state, and the plan exists partly because a third state was invented and disproved.** Drafting it, the author read `.plot/brief-a-marker-names-its-writer.log` at 25 seconds and again at 40 seconds, found **0 bytes with no process**, and concluded *the writer died*. It had not. The log reached **2553 bytes** and the brief landed on `origin/main`.

**A brief writer takes minutes and writes nothing until it is done.** So an empty log means *asked recently*, never *failed*.

This is the single assertion most likely to be got wrong by a careful implementer, because adding a liveness check LOOKS like diligence. It is the defect.

**No process check, and no bound.** The row reports when the ask was made and stops:

- A process check tempts the reader — and did tempt this plan's author — to call an absent process a dead one, when a writer that has not yet written is the normal case.
- **Nothing measures how long a brief takes.** 60–75 seconds was typical on 2026-09-12 and one took several minutes. Any threshold would be invented, and a wrong one reports a healthy long brief as stalled.

The plan closed this as an Open Question — *"No bound, and the row reports the age instead."* Do not reopen it.

### The reading is two-way, and the absent case is today's behaviour byte for byte

| log | the row says |
|---|---|
| absent | nobody has asked — names `/plot-implement`, exactly as today |
| present | a brief was asked for `<age>` ago |

**A repository that never asks for briefs sees no change at all.** That is the property to preserve: the existing `briefGapNote` wording and its existing test (`packages/board/test/unit/brief-gap.test.ts`) should still pass untouched.

### It reports and offers nothing — no button

`row-identity.ts:152` settled the adjacent question and the reasoning holds: *"Whether the board should offer the brief-writing action is an Open Point the plan recorded and declined to settle — running `/plot-implement` is a real write, and the board's line is drawn at the acting endpoints it already has."*

**This plan does not reopen that.** It makes the row's existing sentence *true*; it does not add an action. A `WriteBriefButton` already exists for the rows that need one — this slice changes words, not affordances.

### Follow `briefState`, which is the precedent for this exact reading

`packages/board/src/server/fleet.ts:5543` already reads brief presence per branch per pulse. Copy its shape rather than inventing one:

- **Three values, not two.** `BriefStateSchema` is `'present' | 'missing' | 'unknown'`, and its docstring gives the rule — *"a caller that did not look has said nothing, and reporting that as an absent brief would claim a gap nobody measured."*
- **Directory first, and the order is load-bearing.** `existsSync` swallows its own two falses: it returns `false` both for *not there* and for *could not look*. Asking about the directory with a throwing `accessSync` first is what makes the second call's `false` mean the one thing it is allowed to mean.
- **A missing `.plot/` directory is NOT unknown.** A repo that has never asked for a brief honestly has no such log, and that is a real answer.
- **Cost is measured, not assumed.** `briefState` is 0.2 ms per pulse over 60 branches against a 14 s scan. This adds one `stat` per eligible-and-unclaimed slice — nothing for a slice that is claimed or complete, because those have an agent and the board already says so.

### The age unit is seconds here, and the board's existing formatter starts at minutes

`ageLabel` (re-exported from `tuple-row.ts` at `row-identity.ts:27`) renders `45m`, `3h`, `2d`, `5mo`. **The plan's own measurements are in seconds** — *"asked 40s ago"*, 60–75 seconds typical — so a brief asked for 40 seconds ago formats as `0m`, which reads as a stopped clock. `waitingLabel`'s docstring names that exact failure for days: *"Today rather than 0d: a plan approved this morning has not been waiting for a measurable stretch, and '0d' reads like a stopped clock."*

Resolve it deliberately — a seconds arm, or a distinct short-duration label — and say in the PR which and why. **Do not silently render `0m`**: the 40-second case is the one the whole slice is for.

### The reading is per-machine, and that is honest

A brief asked for on another machine leaves no log here, so the row falls back to *nobody has asked* — what this machine can truthfully say. The alternative, inferring an ask from its absence, would invent a state nobody observed.

## Done when

The plan's `## Done when` is the specification; the plan states the slice as *"the two-way reading, the row's wording for each, and a fixture covering a log that exists but is empty."*

Then these assertions, which exist **because a naive implementation passes without them**:

- **A log that exists but holds 0 bytes reads as *asked*, not *failed*.** The plan names this fixture explicitly. An implementation that checks size, or liveness, passes every other test and fails this one — and this is the defect the plan was written about.
- **A log at the WRONG path leaves the row unchanged.** Assert the reader looks at `.plot/brief-<slug>.log`. Without this, a reader pointed at `.plot-brief-<slug>.log` passes every absent-case test, because absent is the default.
- **The absent case renders today's wording byte for byte.** `brief-gap.test.ts` should pass unmodified; if it needs editing, the no-change property has been broken.
- **A 40-second-old ask does not render `0m`.** The measured case, and the one an age formatter starting at minutes gets wrong.
- **A claimed or merged slice reads no log at all.** The reading is scoped to eligible-and-unclaimed; a stat for every row is cost nobody asked for.

Plus the repo's gates:

```bash
nvm use                    # Node 24 — pnpm crashes on 26
pnpm test
pnpm run test:board        # rebuilds the artifact, then its tests
pnpm run typecheck
```

- **`pnpm run build:board` is a root script** — from `packages/board` it is `pnpm build`. A stale artifact fails every new-feature test reassuringly.
- **A changeset is required.** A `packages/board` change uses `'@plot-pm/board': patch` in the frontmatter with **no** `bumps:` block; a change to `skills/` uses `'plot': patch` with the description FIRST and `bumps:` LAST. Add a `plan:` line naming this plan. `.changeset/` holds other people's files — add yours, touch none.
- **Do NOT run `pnpm run test:e2e`.** It is CI's gate. It dispatches real workers into sandbox repos; two agents running it once produced 53 concurrent `node --test` processes and took an operator's board down.

## Bookkeeping

- **Open the PR through the controller:** `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). It takes the title from the plan's slice heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- **Append `→ #<number>`** to this branch's line in the plan's `## Slices` section as soon as the PR exists.
- **Push the first real commit as soon as it exists.** A branch whose work is never pushed reads as `eligible` to the fleet scan, and two implemented green branches were lost that way.
- Name the `brief-ask.ts` path mismatch in the PR body as a finding, not a fix.

## Scope guard

**This branch owns** the row's brief reading and its wording:

- `packages/board/src/app/lib/agent-rows/row-identity.ts` — `briefGapNote` and any new age wording
- `packages/board/src/app/lib/agent-rows/rows.tsx` — the two call sites at 2058 and 2064
- the server-side reading beside `briefState` in `packages/board/src/server/fleet.ts`, plus the contract field it needs in `packages/board/src/contract/schema.ts`
- its own tests under `packages/board/test/`

**Do not touch:**

- `packages/board/src/server/brief-ask.ts` — the mismatched path is a finding for the PR body, not this slice's repair
- `skills/plot/scripts/plot-dispatch.sh` — it is controller-owned and already writes the correct path
- `WriteBriefButton.tsx` and `menus.tsx` — this slice adds no action, and the no-button decision is settled above

**The client CASTS the fleet payload, it does not parse it.** A new field on `AgentRow` needs its schema entry or it arrives `undefined` in the renderer with Zod defaults silently not applying. A board capability typically needs schema, server, contract, and both call sites — `tsc` walks you through them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
