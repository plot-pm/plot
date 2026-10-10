# A shell script asks the domain

Plot's rules live in `packages/domain`. Its scripts live in `skills/plot/scripts` and run in bash. This document answers three questions about the seam between them, and no more:

1. **When does a shell script call the domain rather than duplicate it?**
2. **Where does the call go?**
3. **How does a test prove a duplicate agrees?**

It settles the estate's existing practice. `plot-pr-merged.sh` is sourced by four scripts and asks `gh` itself, while the TypeScript host adapter's `prMerged` (`adapters/host/host-shell.ts`) asks `plot-host.sh pr-merged` — two LOOKUPS answering *did this land*, the most consequential refusal here, deliberately implemented twice and held together by `corpus/pr-merged.corpus.test.ts`. The RULE is not the duplicate: both sides reach `rules/landed.ts`, the shell through `board/plot-landed.mjs`, and one implementation cannot disagree with itself. `plot-approve.sh` pays a `node` hop once per run and holds no copy of the transition rule. Both are correct, and the difference between them is measured rather than preferred.

## 1. When a shell script calls the domain

**The cost rule is a measurement.** Measured 2026-09-07 on this machine: bare `node -e ''` starts in **34 ms**, and a shipped bundle under `skills/plot/scripts/board/` answers in **39 ms**.

| how often the script runs | what it does |
|---|---|
| once per operator command | **calls the domain.** 39 ms against a command a person waited to type is free. |
| once per agent per pass | **duplicates the rule**, and a test holds the pair. |

`plot-approve.sh` and `plot-deliver.sh` are the first case: each pays one hop through `board/plot-transition.mjs`, and `plot-deliver.sh` pays a second through `board/plot-ask.mjs`. The per-pass case that forced the question is no longer `plot-worker-loop.sh` — since `the-worker-loop-runs-in-js` (v2.24.0) that script is an 18-line launcher that resolves `board/plot-worker-loop.mjs` and `exec`s it, and the loop itself runs in JS. The per-pass case is now the loop's own shell-outs: `plot-config.sh`, `plot-host.sh`, `plot-worker-state.sh` and the rest of the scripts `readPass` reaches on a busy pass, each still a `bash` start the loop pays per agent per pass.

**`the-pass-is-measured` (2026-10-09) measured those shell-outs against a launcher conversion, at 1, 4 and 8 concurrent synthetic agents, on this machine (16 cores):**

| variant | agents | wall ms/pass | cpu ms/pass | load avg |
|---|---|---|---|---|
| today (bash + script) | 1 | 400 | 50 | 21.0 |
| launcher (bash + launcher + node + bundle) | 1 | 1140 | 660 | 21.0 |
| in-process (one long-lived process, no start) | 1 | 0.01 | 0.01 | 21.0 |
| today | 4 | 270 | 40 | 21.0 |
| launcher | 4 | 3695 | 680 | 21.0 |
| in-process | 4 | 0.00 | 0.00 | 21.0 |
| today | 8 | 660 | 40 | 21.0 |
| launcher | 8 | 6945 | 740 | 21.0 |
| in-process | 8 | 0.00 | 0.00 | 21.0 |

Medians over 7 runs per cell, taken by `scripts/measure-pass.mjs`. **The launcher variant adds 1750 % CPU per pass at 8 agents** (40 ms today against 740 ms launcher) — the `node` start dominates every cell regardless of concurrency, because a `node` process start costs roughly the same whether 1 or 8 of them run at once; what concurrency changes is the WALL time (660 ms → 6945 ms at 8 agents), not the per-start CPU.

**The threshold fixed in advance (jwloka, 2026-10-09) was: route 1 (amend this cost rule, convert the per-pass scripts to launchers) if the launcher variant adds less than 5 % CPU per pass at 8 agents, else route 2 (answer per-pass questions inside the fleet's own long-lived process, no shell/bundle hop at all). Measured overhead is 1750 %, three orders of magnitude over the threshold — so this is route 2.** The per-agent-per-pass row of the table above stands: a script reached once per agent per pass still duplicates the rule in shell rather than paying a `node` start, and the fleet's own long-lived worker-loop process is where a per-pass question is answered directly, in-process, once the loop itself owns that reading (`the-fleet-runs-without-the-board`).

**One `node` start may replace several `bash` starts, and then it is cheaper.** The cost rule above compares one hop against nothing. `the-gates-are-launchers` (2026-10-10) found the case where the comparison is one hop against five: every Bash call starts the five `plot-*-gate.sh` PreToolUse hooks, each paying its own `bash` and `jq`. Measured on `main` at `c9d63311d` for `ls -la` (no commit, no gated script): the five shell gates cost **70.5 ms wall and 59 ms CPU** summed, and one `bash` → `exec node` launcher over a small bundle costs **33.9 ms wall and 28 ms CPU**. Five launchers would cost 140–310 ms CPU, so the shape that costs less than what it replaces is one launcher over one bundle that answers every gate: `plot-gates.sh` over `board/plot-gate.mjs`. This is inside the *purpose* of the rule (less CPU per call than the shell it replaces) and outside its *letter* (the table has no fan-in row). The acceptance test is therefore relative, not a fixed figure — no more CPU than the shell gates at the same load — and `scripts/measure-gates.mjs` takes it.

**The boundary is the frequency, not the caller's language and not the rule's importance.** `plot-reap.sh` runs once per sweep and calls `rules/reapable.ts` for the most destructive decision Plot makes. `plot-pr-merged.sh` answers the same class of question and is duplicated, because it is sourced inside loops.

**And the frequency is per CALL SITE, not per script.** `plot-worker-loop.sh` is in the table above as the second case, and that line is about its idle pass. The same script asks the domain once per PROMPT EXIT, through `board/plot-prompt-exit.mjs`: a prompt runs for minutes or hours, so one 39 ms hop after it adds nothing measurable, where a hop on the idle pass is paid by every agent on every pass. A shell copy of that rule would need a corpus test to hold the pair together and would save no cost — and the rule it would copy reads a wall-clock time in an IANA zone, which bash has no way to resolve. So one script sits on both rows of the table, and which row applies follows from the call site's frequency.

**The target: an agent runs a command, and a command is a JS entry point.** `the-shell-shrinks-into-the-domain` names it directly — a command an agent runs goes entry → domain → port → adapter, the layering rule above. A `.sh` file that remains is a **launcher**: it resolves its bundle and `exec`s it, and decides nothing. `skills/plot/scripts/README.md`'s *kind* column names which scripts already are one and which still hold a decision or a per-pass duplicate the rest of this section allows.

**The price: a new declared duplicate pays in lines, not just in prose.** Both seams this section permits — the per-agent-per-pass duplicate above and the quoted heredoc in §2 — remain allowed, and both now cost: `scripts/check-shell-lines.sh` ratchets the shipped shell's line count against its merge base, so a change that adds a new duplicate must remove an equal number of lines elsewhere in the same change. The gate stores no number and grants no exemption for a declared duplicate; the price is paid in the same diff that incurs it.

**A rule that cannot be asked refuses.** Where a script calls the domain, `node` missing, an import failing, or the module throwing must leave the script refusing, not proceeding. `plot-reap.sh:451` states it: silence is never permission.

**Refusing means not taking the action the rule would have licensed, which is not always stopping.** `plot-reap.sh` removes a worktree, so the action it withholds is the removal and withholding it is doing nothing. The prompt-exit call is the other shape: the action the rule licenses is the WAIT, so an unaskable rule means no wait — and a non-zero prompt exit then takes the retry path it took before the rule existed. That path ends the worker after three attempts, so the unaskable case is strictly less permissive than the answer it replaces, never more. The test is what the refusal WITHHOLDS, not whether the script continues.

## 2. Where the call goes

There are two seams, and which one applies follows from where the script ships.

**A shipped bundle under `skills/plot/scripts/board/`.** This is the seam for a script that ships in the published npm package, where `packages/` does not exist. `plot-movable.mjs`, `plot-landed.mjs`, `plot-branch-state.mjs`, `plot-task.mjs` and their siblings are each one entry point in `packages/board/src/server/entry/`, bundled by `pnpm build:board`, resolving in both the repo checkout and the published layout.

- **One bundle per question.** `plot-ask.mjs` answers `board` and `fleet` by *running* `plot-fleet-scan.sh`; a dispatcher asking it would be an artifact calling a script that calls the dispatcher. A bundle that spawns nothing gets its own artifact.
- **Tab-separated in, tab-separated out**, where the caller is bash reading one line per subject. A JSON round trip means `jq` per line — a second process to avoid a second format.
- **A new bundle is a new entry point plus a `build.mjs` block.** `main` builds its own bundles after every merge (`build-bundles.yml`) and a pull request carries none (`scripts/check-no-bundle-diff.sh`) — `a-branch-carries-no-built-bundle`'s contract, adopted whole here.

**A quoted heredoc importing the rule directly.** This is the seam for a script that runs only inside the plot checkout. `plot-reap.sh` imports `packages/domain/src/rules/reapable.ts` through a path derived from its own `BASH_SOURCE`, never from the cwd: node 24 strips the types, so there is no build step between the script and the decision.

**Never `plot-ask.mjs` for a new rule.** It is the board controller's entry point and it runs the fleet scan. A rule question routed through it buys a scan nobody asked for.

## 3. How a duplicate is held

**Neither side is authoritative. The test says they agree.**

A duplicated rule joins the corpus tier at `packages/domain/corpus/`, which already compares adapters against production over this repository's live estate. A rule-versus-shell comparison is the same shape with a different pair:

> **Read every X on the estate, score it both ways, assert equal.**

The comparison is parameterised over what is read. Production supplies the *readings* and its own *verdict*; the domain rule re-scores the same readings; the two verdicts are compared. Production's parsing is never reused to build the domain's input in a way that could only agree — the readings are the wire's own fields.

**A disagreement names both answers and the subject.**

```
the-scripts-say-slice :: state :: shell=open rule=withdrawn
```

`describeDisagreement` in `corpus/compare.ts` renders this, and one empty-array assertion collects every disagreement rather than failing on the first. One item disagreeing and all 134 disagreeing are different findings pointing at different bugs.

**A known divergence is declared, not skipped.** Where the shell answers a case the domain cannot yet express, the comparison lists those subjects by name with the reason, and asserts the list is exactly what is expected — so the divergence shrinks when the plan that closes it lands, and a *new* one still fails.

**On a disagreement the branch stops.** Which side is wrong is judgement. Adjusting either side to make the comparison pass is the one move forbidden — it is the permissive failure, and it cements a production bug behind a green test.

**A comparison that can only pass proves nothing.** Every rule comparison asserts a floor on its corpus size and asserts that the corpus exercises each answer the rule can give. A universal claim over an empty set is true.

## The first comparison

`corpus/sprint-score.corpus.test.ts` compares `scoreItem` (`entities/sprint.ts`) against what `plot-sprint-release.sh` reports over every MoSCoW item in every sprint file on the estate — 134 items across 10 sprints, exercising `done`, `open` and `disputed`.

It was the smallest case on purpose: 12 lines of bash, one function. **Proving the contract on the smallest case is the point** — and the case was small enough to go the whole way, so the 12 lines are gone and the script now asks.

It carried a declared divergence until 2026-09-08, and that divergence is now closed rather than described. `item_state` takes a third reading — `delivered: "none"`, meaning the item names no plan — and takes such an item at its checkbox; `scoreItem` had no way to say *no plan named*, so it read the same item as `disputed`. [`a-sprint-item-has-one-scorer`](plans/2026-09-07-a-sprint-item-has-one-scorer.md) gave the domain `PlanDelivery`, and the comparison now skips no item.

**AND `plot-sprint-release.sh` STOPPED BEING THE SECOND IMPLEMENTATION.** The same plan made it CALL `scoreItem` through `board/plot-sprint-score.mjs` — section 1's first case, a script that runs once per operator command — so the pair this file compares is now a rule against the shipped shell that asks for it. The comparison is worth no less for that: it is what proves the wire carries the shell's readings unchanged, and it is what fails if the two ever part again.

## The second comparison, and what a constructed corpus is for

`corpus/desk-reset.corpus.test.ts` compares `resetRefusals` (`rules/reapable.ts`) against `desk_reset_refusal` (`plot-worker-loop.sh`) — the decision an agent makes about its own desk, and the loop is the case this document was written for.

**Its corpus is BUILT rather than read, and the difference is not a shortcut.** A sprint item is checked into the repository, so every runner scores the same 134. A desk is not: it is a worktree on a machine, and what holds it is whatever an agent happened to leave there. Measured 2026-09-08 on this estate — 17 desks answering `resettable`, `uncommitted-changes` and `blocked-marker`, never `unpushed-commits`, with the split moving between runs as agents edited files. **CI's checkout has one worktree and it is clean.** A live corpus there would exercise one answer of four, which is the *comparison that can only pass* this document already refuses.

So each state is built in a real repository with a real origin, and read back through the loop's own `plot_worker_blocked` and `plot_worker_dirty`. **The shell under test is the shipped shell; only the estate it reads is made.** The rule stated in section 3 is unchanged — production supplies the readings and its own verdict, and the domain re-scores the same readings.

**Where a subject cannot be checked in, the corpus builds it.** What must never be built is the READING: assembling `dirtyPath` from a `git status` written in the test would compare the domain against the test's idea of a dirty tree, and `plot_worker_dirty` drops editor leftovers and Plot's own `.plot-worker.*` records for measured reasons.

## The merge-lookup comparison

`corpus/pr-merged.corpus.test.ts` compares `pr_merged` (`plot-pr-merged.sh`) against the host adapter's `prMerged` (`adapters/host/host-shell.ts`). It is the one comparison here whose pair is two LOOKUPS rather than a rule and its shell copy: the rule moved into `rules/landed.ts` and both sides reach it, so what can still drift is how each asks the host. The shell calls `gh` directly — `plot-pr-merged.sh`'s header states why, and `scripts/check-host-cli-callers.sh` exempts it by name — and the adapter calls `plot-host.sh pr-merged`, which calls `gh` too. One stub `gh` on `PATH` is therefore reachable by both sides, and that is what makes a single-stub comparison possible.

**The compared verdict is one boolean: may a caller treat this branch as merged.** The shell's is `pr_merged`'s exit code 0; the adapter's is an `ok` result whose value is `merged`, with a failed result, `not-merged` and `unknown` all refusing, exactly as `registryd-main.ts` maps them. The three-valued answer is deliberately not compared — the shell has no `not-merged`/`unknown` distinction at exit-code level, so unequal vocabularies could only be made to agree by translating one into the other, which is the permissive failure section 3 forbids wearing a different hat.

**The corpus is built, for the reason the desk-reset one is**, and the reason is sharper here: the case the plan exists for is an EMPTY branch, and no branch on the estate is empty. Seven cases — an empty branch, one merged PR, a newer unmerged PR in front of a merged one, no PR, only an open PR, `gh` absent from `PATH`, and `gh` failing with an authentication error.

**Two assertions exist because the verdict sweep alone would pass without them.** The empty-branch case asserts the shell recorded no `gh` call: the stub appends its argv on every invocation, so a guard moved after `command -v gh` answers the same boolean and fails here. And the stub HONOURS `--limit`, so a lookup regressed to `--limit 1` reads only the newer unmerged PR and reports *not merged* about a branch whose work is on main — the regression measured against the live host on 2026-08-27. Both were injected on 2026-10-02 and both were caught, naming opposite sides: `subject="" (empty) :: may-treat-as-merged :: adapter=false shell=true`, and `subject="feature/masked" (newer-unmerged-in-front) :: may-treat-as-merged :: adapter=true shell=false`.

**What it leaves out is named in the file.** `pr_open` has no TypeScript counterpart to compare against, so `test/reconcile/host.test.mjs` holds `pr_open ""` instead; and the comparison covers `github` only, because `_plot_merged_lookup` asks `gh` on every backend while `plot-host.sh pr-merged` also serves Bitbucket.

## The listing-page comparison

`corpus/listing-page.corpus.test.ts` compares `pagePossiblyTruncated` (`rules/listing-page.ts`) against `pr_list_report_truncation` (`plot-host.sh`). `pr-list` runs on every board refresh, so the shell keeps its copy. The corpus is built: 63 cases over GitHub and two `bb` versions, three limits and seven row counts, run through `plot-host.sh pr-list` against stub CLIs. The rule reads each case's paging through `listingPagingFor`, so the comparison also holds the two page-length tables together: `BITBUCKET_PAGE_LENGTHS` in `adapters/host/listing-paging.ts` and `BB_LIST_PAGE_VERSIONS` in the script.
