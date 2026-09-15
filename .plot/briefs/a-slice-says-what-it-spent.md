# Implementation brief — a-slice-says-what-it-spent

- **Plan (canonical):** `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `feature/a-slice-says-what-it-spent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention

Sole slice of a one-wave plan. Nothing waits on it and it waits on nothing. It is the third Must of sprint W41 and the first plan of `plot-plan-economics`, a story that has been `draft` with zero plans since 2026-08-27.

## What to build

Plot reads a transcript today and reports **one turn** of it. `readTranscriptFacts` (`packages/board/src/server/transcript.ts:160`) returns `contextTokens` and `contextSpend`, both snapshots of the newest assistant line, both answering *how full is this agent's window*. Neither answers *what did this slice cost*, and nothing on the estate does.

Build the second reading: sum all four token counters across a run's whole transcript, record the models used, and write that record per slice at `seal_declaration` — the one moment that knows which branch just finished. Then read it back without re-deriving it.

The plan is canonical and its Design section carries the full argument. This is orientation — **with one exception, immediately below, where a measurement taken during this brief's preflight contradicts the plan.**

## READ THIS FIRST — the plan's session rule is wrong, and the plan is canonical everywhere else

**The plan says the sum is keyed by `$PLOT_SESSION_ID`. Implementing that ships a number that is wrong by a factor of five and looks right.**

The plan's reasoning is sound and its source is real. `spend.ts:42-50` does say *"READ PER SESSION, NEVER PER WORKTREE"*, and it measured *"45 session files, 30 of them subagents, and a sum across them belongs to no one."* That rule is correct **for a context ceiling** — one turn, one session, one window — and it does not transfer to a sum over a run, for the same reason the plan itself argues `output_tokens` does not transfer. The plan caught that inversion for the output field and missed it for the session key.

**Measured 2026-09-15 over every dispatch desk transcript directory on this machine:**

```
branch desks (free-* excluded)      : 40
  holding MORE THAN ONE main session: 39      ← one is the exception, not the rule
  largest-session share, median     : 92.5%
  largest-session share, worst case : 39.1%   (--worktrees-bug-an-empty-branch-reads-open)

one free-* desk, ONE branch throughout:
  main sessions                     : 41
  sum across all of them            : 401,603,037 tokens
  largest single session            :  73,028,938 = 18.2%
```

A worker runs **many prompts per slice** — `run_bounded` is re-entered on every correction (`Correction budget: 2`) and on every continuation — and `session_flag()` (`plot-worker-loop.sh:779`) hands out `--session-id` for a fresh conversation and `--resume` for a continuing one. Each new id is a new `.jsonl`. `transcriptFile(dir, sessionId)` (`transcript.ts:98`) resolves a session by **exact filename**, so a sum keyed on one id reads one file and silently omits the rest.

**So the subject is the BRANCH within a desk, and `agent-*` files stay excluded.** Partition the desk's non-`agent-*` transcripts by the `gitBranch` each line carries — which is the partition the plan already specifies for the branch subject — and sum every main session that contributed turns to this branch. The plan's actual concern is preserved exactly: subagent transcripts still belong to no one and are still excluded, which is the half of `spend.ts:42-50` that does transfer.

**Do not "fix" this by taking the newest file.** That is what `spend.ts:48-50` genuinely forbids, and the 41-session desk is precisely the case where mtime picks one of 41.

**Record this in the plan as an amendment before you finish** — the estate's own convention, the way `CLAUDE.md`'s superseded paragraphs are amended rather than quietly broken. The plan's `Done when` clause *"the session is keyed by `$PLOT_SESSION_ID`, pinned by a fixture directory holding three main sessions where the record names the right one"* is the clause that changes: the fixture stays, and the assertion becomes that the record counts **all** main sessions carrying this branch's turns and none of the `agent-*` ones.

## The decisions the plan settles — do not re-derive them

**`output_tokens` is counted, and `spend.ts:79` says it must not be.** That rule is right for what it guards. `CONTEXT_USAGE_FIELDS` holds three fields and states the reason: *"counting it would charge the agent twice for text that arrives as input on the next turn anyway."* That double-count is of **context occupancy**, not of spend — output tokens are generated once and billed once. So this is a new derivation beside `contextTokensFromUsage`, never a widening of it. **Widening `CONTEXT_USAGE_FIELDS` breaks the ceiling that field exists for**, and `contextVerdict` reads it.

**Four counters, kept apart — and a summed fifth field is FORBIDDEN.** Measured over three real transcripts, cache reads are 98.6%, 99.3% and 99.36% of a naive four-counter total. The largest:

```
input_tokens                     86,922
output_tokens                22,016,579
cache_creation_input_tokens 117,015,335
cache_read_input_tokens  21,479,234,105     ← 99.36% of the sum
```

A four-field total is a cache-read count wearing a cost's name, and cache reads are the cheapest tokens there are — a slice that re-read a large context cheaply would outrank one that generated heavily. A single actionable figure needs price weighting, which needs a price table, which the story excluded by measurement on 2026-08-29. **A reader wanting one number gets none.** The `Done when` pins this with a **key-set assertion rather than prose**, deliberately: `contextSpend` is already on the wire schema, so a fifth field beside it is a two-line change no review would flag.

**The model is recorded beside the counters** — the same count on two models is two different costs, and a reader holding a price table needs to know which.

**Write at `seal_declaration`, and the reason is the subject, NOT the cost.** An earlier draft argued timing from a 394 MB transcript at 885–1087 ms — **that file is the master agent's own console, not a worker's.** Re-measured over the right population, 1,966 worker transcripts: largest 7.7 MiB, median 6.9 KiB, and a full four-counter sum over the largest takes **90–250 ms**. So cost is not the argument and the plan no longer makes it. The argument is that `seal_declaration` (`plot-worker-loop.sh:1010`, called at `:2092`) is the only moment that knows which branch just finished — it runs **before** `--next` is asked at `:2196` and before any hop moves `$PLOT_BRANCH`. **A cheap scan at the right moment beats an expensive one at the wrong moment.** Leave the 256 KiB tail bound on `readTranscriptFacts` exactly as it is; it serves a different reader.

**The worker does not exit between slices.** `plot-worker-loop.sh:2088-2297` seals, clears the manifest branch, blocks in `wait_for_work`, resets the desk, and loops. The loop's own comment at `:1044`: *"a declaration is about a BRANCH, and a worker hops, so one worker writes several."* A sum taken at worker exit charges every slice the worker ever held to whichever branch it held last. Of the 12 largest worker transcripts, **3 already span two branches**.

**A detached (`HEAD`) segment belongs to the preceding real branch.** Settled by a three-lens panel (`.plot/panels/2026-09-15-a-slice-says-what-it-spent/decision-head.md`), divided 2-1, with the dissent dissolved by measurement rather than outvoted. Over 938 worker transcripts: 44 files carry a `HEAD` segment, **37 return to the same branch, 0 sit between different branches.** The between-slice detach is invisible by construction — `reset_desk` detaches at `:962` and re-attaches at `:967-968`, two consecutive `git` calls with no agent turn emitted between them. So every `HEAD` segment carrying tokens is a **mid-slice baseline**, an agent A/B-ing against main, which is this estate's recommended practice; one measured segment carries 4,792,932 cache reads. **The test is one-sided and backward-looking** — no lookahead, because at `:2092` the next branch has not been chosen and a forward-looking rule could not be computed at all. **This is not a heuristic**: the agent detached from a branch and returned to it, and both facts are in the transcript. A `HEAD` segment with **no** preceding real branch belongs to no slice — 4 of the 44 files, the honest `none` case.

**The record path uses `--git-common-dir`, never `--show-toplevel`.** Verified on this machine:

```
in .worktrees/feature-one-monitor-watches-the-slice
  --show-toplevel   → …/.worktrees/feature-one-monitor-watches-the-slice   ← the DESK
  --git-common-dir  → …/plot/.git                                          ← the shared dir
```

Every existing writer uses `--show-toplevel` (`plot-state-receipt.sh:68,84,159`; `plot-commit-record.sh:128`). Measured: **8 dispatch desks, 0 holding a `.plot/state/`** — and `plot-reap.sh:624` runs `git worktree remove --force`. A record written to the desk is destroyed by the reap, on the machine that measured it, **with every gate green.** `plot-install-commit-record.sh:42-43` already solved this: write to the common git dir *"so every dispatch worktree is covered by one install"*. Inherit that rule; do not re-derive it.

**Machine-local, and the honesty is the deliverable.** `.plot/state/` is git-ignored — `.gitignore:30` is the root pattern, `:35` the nested one catching test fixtures. A committed record was weighed and declined: it would be readable anywhere and make a rollup trivial, at the price of per-run token counts in permanent git history, for a consumer that does not exist yet. **A reading cheap to re-take does not earn permanent storage in git.** The stated limits: a colleague's checkout reads **nothing, not zero**, and the record is **destructible**.

**Written once, never updated. A second run writes a second record.** That keeps it a measurement with a timestamp rather than a running total nobody can place in time.

**The bound path records nothing, and that is a stated gap.** `seal_declaration` runs on exactly one path — its comment at `:992-997` says so (*"run_bounded returned 0"*) — and a worker killed by `Worker bound` (28800s) or ended by the WorkerMonitor takes `exit 124` at `:1956` and never reaches it. For a declaration that absence is load-bearing; **for a spend it inverts** — a worker that burned the full bound is the most expensive run there is, and it is exactly the run this records nothing for. **The rollup is biased LOW in a direction nobody can see from the records alone.** Do not fix it here: a write on the bound path is a second write site with its own failure modes. Do not be silent about it either.

**This overturns a dated story decision, deliberately.** `STORY-plot-plan-economics.md:270`, 2026-08-27: *"Cost is derived, never stored."* Deriving on demand needs the transcript, the transcript is machine-local and unbacked, and the desk goes first. So "derived, never stored" does not preserve accuracy here — it preserves accuracy on one machine and produces silence everywhere else. **Amend the story entry rather than quietly breaking it.** Manifesto Q1 is unaffected (git is the database for *plan state*; this is explicitly not in git) and Q8 likewise (four token counters with no price table and no rollup is a measurement, not effort tracking).

### Out of scope, and each was decided

- **No price table, no francs.** Narrowed by measurement 2026-08-29 — a transcript carries four token counters and **no monetary field** — re-checked 2026-09-14, still true.
- **No per-plan rollup.** The sprint's Should; depends on this, trivial once slices carry a number, worthless before.
- **No change to `contextTokens` or `contextSpend`.** They answer a ceiling question and are rendered today. `contextSpend` has **zero render sites** in `packages/board/src/app` as of 2026-09-15 — it is computed and not yet shown. **That is not an invitation to remove or repurpose it.**

### Carried over unchanged

- **Zero is the dangerous answer here.** A transcript that cannot be read, a desk reaped elsewhere, a run that never started — each records *nothing* and says so. A recorded zero is indistinguishable from a free run, and a sum over a zero is wrong in the direction nobody checks.
- **Absent is not false; `unknown` is not `no`.** The direction `plot-worker-state.sh` already takes, and `contextTokensFromUsage` already takes when a `usage` carries none of its fields.
- **Read the exit code, not the emptiness.** An empty result and a failed call are different answers.
- **The layering rule.** A shell script is reached only from an adapter; the domain takes readings as values (`reap(readings, input)`), imports no port and awaits nothing. New domain functions are **arrow functions**. TSDoc states what an export does, not the history of the decision — that goes in the plan and the commit message.

## Done when

The plan's `## Done when` is the specification — read it there, in full. It is one paragraph and every clause is load-bearing.

Lifted here are the assertions that exist **because a naive implementation would pass without them**:

| Assertion | What it catches |
|---|---|
| Fixture transcript shaped **`B → HEAD → B`** | A two-distinct-`gitBranch` fixture does not contain the detach case at all — and `HEAD`-between-different-branches has **zero** occurrences, so the obvious fixture tests the shape that never happens and misses the one that does. Measured maximum is five branches in one session. |
| **Key-set** assertion on the written record | Prose cannot catch a fifth summed field appearing beside `contextSpend` — a two-line change no review would flag. |
| A test that fails if a **refresh path opens a `.jsonl`** | The board re-deriving per refresh passes every correctness test and reintroduces the cost the record exists to remove. |
| Record written from a **dispatch desk**, read from the **main checkout**, surviving that desk's removal | `--show-toplevel` passes every test run in the main checkout and destroys the record in the only place it is ever written. |
| Fixture directory of **three main sessions** where the record names the right one | Per the correction above: the assertion is that **all** main sessions carrying this branch's turns are counted and no `agent-*` one is. |
| A run with **no readable transcript records nothing** and says so | Recording `0` is the failure the whole plan is built to avoid. |
| A reader on a machine holding no record is told **not measured here** | Distinguishes absence from a free run at the point a person reads it. |
| A second run writes a **second record** | Mutating the first turns a measurement into an unplaceable running total. |
| `contextTokens` / `contextSpend` unchanged, board panel renders as before | The regression lock on the ceiling reading this must not disturb. |

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install                 # if node_modules is missing
pnpm test
pnpm run test:contracts      # named explicitly in the plan's Done when
pnpm run test:board          # if packages/board is touched
pnpm run typecheck
```

**Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one. Two agents running it once produced 53 concurrent `node --test` processes and load average 8.69.

**A changeset is required.** Description **first**, `bumps:` block **last** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note. A `packages/board` change uses `'@plot-pm/board': patch` frontmatter with no bumps block; a skills/scripts change uses `'plot'` with a bumps block. Name the plan on a `plan:` line inside the comment. `.changeset/` holds other branches' files — add yours, touch none.

## Bookkeeping

**Push the first real commit as soon as it exists.** Fifteen branches once carried finished work nobody could see because no PR was raised.

**Open the PR through the controller:**

```bash
skills/plot/scripts/plot-open-pr.sh            # or --draft while the work moves
```

**Do not run `gh pr create`.** Measured 2026-09-08: three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`. `plot-open-pr.sh` reads which plan names the branch and titles the PR with that plan's wave heading.

**When the PR exists, append `→ #<number>`** to this branch's line in the plan's `## Branches` section. `/plot-deliver` back-fills a missed one, but written-at-creation keeps the plan current. Use the `→ #N` form — `plot-plan-meta.sh` parses no other.

**On a `board-server.mjs` conflict, do not read the diff.** It is generated output marked `-merge` in `.gitattributes`. Take either side, run `pnpm build:board`, commit the result. Never phrase it as "take ours" — *ours* inverts between merge and rebase.

## Scope guard

**This branch owns:**

- the new spend derivation — a new rule in `packages/domain/src/rules/`, beside `spend.ts` and **not inside it**
- the reading adapter and the record writer, on the adapter side of the port
- `seal_declaration`'s call site in `skills/plot/scripts/plot-worker-loop.sh`
- the record's read-back path
- fixtures and tests for the above
- the amendment to `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` (session rule) and to `docs/stories/plot-plan-economics/STORY-plot-plan-economics.md:270` (derived-never-stored)

**Do not touch:** `CONTEXT_USAGE_FIELDS`, `contextTokensFromUsage`, `contextVerdict`, `readTranscriptFacts`, `TRANSCRIPT_TAIL_BYTES`, or the board panel that renders `contextTokens`. They answer the ceiling question and the plan's `Done when` pins them unchanged.

**Other branches in flight** — verified on origin at brief time, not guessed: `feature/a-connector-declares-its-ceiling` (sibling plan, same sprint, same story) touches the **host connector's** rate-limit ceiling. Different subject, different files; the shared word *ceiling* is the only overlap and it means a rate limit there and a context window here. `feature/one-monitor-watches-the-slice` holds a desk under `.worktrees/`.

**A `.plot/state/` record is machine-local and git-ignored** — it must never appear in your diff. If `git status` shows one, the path resolution is wrong.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The session-rule correction above is exactly that shape, caught in preflight; a second one is more likely than not.
