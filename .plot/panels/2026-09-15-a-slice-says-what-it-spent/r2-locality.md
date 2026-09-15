# Locality lens (round 2) — a-slice-says-what-it-spent

Read at `bc4d00235` (`plot: amend two plans after their panels`).

Reading position: **a fact stored on one machine is a fact most readers will never see.** So the question is not *is machine-local acceptable* — the operator settled that, and it is the right call — but *can this record be told apart from a missing one, from a zero, and from a free run, by every consumer that might read it*.

The answer is **no**, and the reason is not the one round 1 raised. It is a path.

---

## 1. Factual claims — verified

Every claim I checked reads TRUE on `bc4d00235`, with two exceptions noted below.

| Claim | Verdict | Evidence |
|---|---|---|
| `readTranscriptFacts` returns `model`, `contextTokens`, `contextSpend`, `lastActivity` | TRUE | `packages/board/src/server/transcript.ts:26-55` |
| `contextTokens` is *"Tokens the last turn read back as context"*, `cache_read_input_tokens` | TRUE, verbatim | `transcript.ts:30` |
| `contextSpend` is *"Every input token the last turn carried"*, *"the number a context ceiling is a fraction of"* | TRUE, verbatim | `transcript.ts:36-42` |
| `contextSpend` has no render site in `packages/board/src/app` | TRUE | `grep -rn contextSpend packages/board/src/app` → 0 hits |
| `rules/spend.ts:79` defines `CONTEXT_USAGE_FIELDS` as three input fields | TRUE, exact line | `packages/domain/src/rules/spend.ts:79-83` |
| The `output_tokens` comment, quoted at length | TRUE, verbatim | `spend.ts:75-77` |
| `spend.ts:42-50` — *"READ PER SESSION, NEVER PER WORKTREE … 45 session files, 30 of them subagents"* | TRUE, verbatim | `spend.ts:42-50` |
| `transcriptDir(worktree)` resolves `~/.claude/projects/<slug>` | TRUE | `transcript.ts:79-81` |
| `registry.ts:137` documents `session` as *"the transcript join key"* | TRUE | `packages/board/src/server/registry.ts:137` |
| `plot-worker-loop.sh:1591` installs `trap _cleanup_on_exit EXIT` | TRUE, exact line | verified at `:1591` |
| `_on_alarm ALRM` at `:1546` | TRUE, exact line | `trap _on_alarm ALRM` at `:1546` |
| `:1044` comment — *"a declaration is about a BRANCH, and a worker hops …"* | TRUE, verbatim | `:1044-1047` |
| `:2088-2093` is the finish path, `seal_declaration` before the hop | TRUE, and the surrounding comment is stronger than the plan's paraphrase | `:2087-2092`: *"before `--next` is asked and before any hop moves `$PLOT_BRANCH`. Both orderings matter"* |
| `transcript.ts:184` walks backwards; 256 KiB tail bound | TRUE | `transcript.ts:126-138`, `:184` |
| `Worker bound` 28800 | TRUE | `CLAUDE.md` config |

**Two I could not confirm, and one is a real slip.**

- **`.gitignore:35` is the WRONG line, and the error is in my territory.** Line **30** is `.plot/state/` — the repo root's own. Line **35** is `**/.plot/state/`, added for a *different reason*, stated in its own comment at `:31-34`: *"The unanchored `.plot/state/` above only matches the repo root's own; a slash in the pattern anchors it there. This catches the nested ones every fixture produces on a test run."* The plan cites the pattern that exists to catch **nested** state directories while arguing for a record at the repo root. That is not a typo in a citation — it is a citation of exactly the line that describes the failure in §3 below, quoted as if it supported the opposite.
- **The transcript population figures (1,966 files; largest 8,111,230 B; median 7,084 B) rest on a filter the plan never states.** My closest reconstruction — non-`agent-*` `.jsonl` under project dirs whose name contains `plot` — gives **1,144 files** with a largest of **395,589,046 bytes**, i.e. the master-agent console the plan says it excluded. Restricting to project dirs whose path contains `worktrees` gives **747 files**, largest **6,877,025 B** (6.6 MiB), which is close to the plan's 7.7 MiB but not it. The plan's conclusion (worker transcripts are small; the scan is cheap) is almost certainly right; the numbers are **not reproducible from the plan as written**, because the population is named in prose and not by a predicate. Round 1 caught this plan measuring the wrong population once already. The fix is one clause naming the filter.

---

## 2. Did the amendment deliver on "machine-local under `.plot/state/`" honestly?

**Partly. It is honest about the two limits it names, and it names the wrong two.**

What it gets right, and I want to record it plainly because it is the strongest part of the amendment:

- It says a colleague's checkout reads **nothing, not zero** (`:87`).
- It says the record is **destructible** (`:88-89`).
- It declines the committed alternative with an argument, not a preference (`:91-95`), and the argument is the repo's own: `.gitignore:28-29`, *"A checked-in pulse would be one clone telling another what its branches are doing."*
- It states *"the honesty is the deliverable"* (`:97-99`).

That is a real answer to round 1's blocking question, not a declaration that the problem is solved. Credit where due.

**But `.plot/state/` is not one place, and the plan treats it as one.**

Measured on this machine, right now:

```
git worktree list → 7 dispatch desks under .worktrees/
desks with a .plot/state/ directory: 0 of 7
```

And the reason is mechanical. Every existing writer resolves the directory with `git rev-parse --show-toplevel` — `plot-state-receipt.sh:68`, `:84`, `:159`; `plot-commit-record.sh:128`. **In a linked worktree that returns the worktree, not the main checkout.** Verified directly:

```
$ git -C .../scratchpad/wt-897 rev-parse --show-toplevel
/private/tmp/.../scratchpad/wt-897          ← not the main checkout
```

So `.plot/state/` written by a worker resolves **inside the desk**. And `plot-reap.sh:624` runs `git worktree remove --force "$wt"`. The record the plan promises survives a reap is, under the obvious implementation, **destroyed by the reap** — on the *same* machine, not merely on a colleague's.

The plan's own sentence at `:67-68` is what makes this a contradiction rather than an oversight: *"the transcript outlives the desk … so reaping a desk does not destroy the record."* True of the transcript. The plan then puts the **derived** record somewhere the transcript is not, and inherits the desk's lifetime it just finished arguing it had escaped.

**The repo already solved this once and the plan does not cite it.** `plot-install-commit-record.sh:42-43` resolves `git rev-parse --git-common-dir` precisely so *"every dispatch worktree is covered by one install"*. That is the pattern a spend record needs and the plan names neither the problem nor the fix.

**And the precedent round 1 recommended does not exist here.** `.plot/state/commit-records/` is documented at length in `CLAUDE.md` and **is not present on this machine** — no `.git/hooks/post-commit`, no `commit-records/` directory. The one analogue the panel pointed at is an *uninstalled* hook, so "follow `commit-records/`" is guidance drawn from a shape nothing on this estate has ever produced a file in. The plan does not lean on it, which is fine; but it means the plan is inventing a durability story with no working precedent, and it does not say so.

---

## 3. What `Done when` still fails to pin

The gate list is much better than round 1's. It now pins the slice subject with a two-`gitBranch` fixture, the session subject with an `agent-*` fixture directory, the fifth field with a **key-set assertion**, the no-`.jsonl`-on-refresh property, and the second-run-appends property. Those close round 1's items 1 and 5 properly.

**Here is an implementation that satisfies every stated gate and is wrong.**

Write the record to `"$(git rev-parse --show-toplevel)/.plot/state/spend/<branch>.json"` from inside `seal_declaration`. Walk the list:

- four counters and every model ✓ (fixture passes)
- two branches → two records ✓ (the fixture is a transcript, not a filesystem)
- per session, not per worktree ✓ (the fixture is a transcript directory)
- no summed fifth field ✓ (key-set assertion passes)
- scan at `seal_declaration`, board reads the record, no `.jsonl` on refresh ✓
- unreadable transcript records nothing and says so ✓
- `contextTokens`/`contextSpend` unchanged ✓
- second run writes a second record ✓
- `pnpm run test:contracts` passes ✓

**And every record is inside a desk that `plot-reap.sh` deletes.** The board, which runs from the main checkout, reads `.plot/state/spend/` there and finds **nothing** — for every slice, on the machine that ran them. The gate *"a reader on a machine that holds no record is told it was not measured here"* passes perfectly, reporting *not measured here* on the machine that measured everything.

Nothing in `Done when` names a path, a resolution rule, or a survives-the-reap property. Round 1's persistence lens raised this as "§3C — nothing pins WHERE" and the amendment answered the *directory* and still not the *resolution*. That is the shape the brief asked me to watch for: a restatement that reads as a fix.

**A second, smaller one.** *"a reader … is told it was not measured here"* names no representation. The repo has a settled four-outcome vocabulary for exactly this question, in the entity this record sits beside: `DeclarationReading` (`packages/domain/src/entities/declaration.ts:78-81`) is `declared` / `absent` / `unreadable`, with the comment at `:65-76` — *"FOUR OUTCOMES, AND THE LAST TWO ARE NOT ONE … `cannot answer` is not `no`. This repo has twice shipped a collapse of those two."* The plan needs the same three-way at minimum, plus a fourth this record has and the declaration does not: **`elsewhere`** — a record this machine never had because the slice ran on another one. Collapsing *reaped here* into *ran elsewhere* is how a per-plan rollup, the sprint's Should, silently sums a partial estate. The plan says "never shown a zero" and stops one word short of naming what is shown instead.

---

## 4. Is write-once-at-`seal_declaration` still supported now the cost argument is withdrawn?

**Yes, and this is the amendment's best work.** The plan explicitly retires its own timing argument (`:194-195`, *"So cost is not the argument for writing once, and the plan no longer makes it"*) and replaces it with a subject argument: `seal_declaration` is the only moment that knows which branch just finished.

That argument is **independently verified and stronger than the plan states.** `plot-worker-loop.sh:2087-2090` says it in the loop's own voice: *"before `--next` is asked and before any hop moves `$PLOT_BRANCH`. Both orderings matter: a declaration written after the hop would name the branch the worker moved TO, and one written after the loop ends would never exist for any branch but the last."*

And `seal_declaration`'s own header (`:978-1000`) makes the locality case the plan needs and does not make: *"ABSENCE IS LOAD-BEARING, so this runs on exactly one path"* — a bound-killed or monitor-ended worker never reaches the line, and its desk is left with **no** declaration, which is what says the work did not complete. A spend record hung here inherits that property for free: absent means *not finished*, which is exactly the honesty the plan wants. The plan should say so — it is the argument that makes the placement obviously right rather than merely convenient.

**The withdrawal is honest and the replacement holds.** No objection here.

---

## 5. The strongest argument against doing this at all

**The record's only stated consumer is a rollup the plan forbids itself from making meaningful, and locality makes that rollup structurally unsound.**

The plan proves, with its own best measurement, that no unweighted token figure is a cost — cache reads at 99.36%. It therefore refuses a fifth summed field, correctly. So what ships is four numbers a reader cannot combine. The one named future consumer is the sprint's Should, a per-plan rollup — and a rollup is precisely the operation locality breaks:

- a slice run on another machine contributes **nothing**
- a slice whose desk was reaped contributes **nothing** (§3, under the obvious implementation, *all* of them)
- a SIGKILLed worker contributes **nothing** — `plot-worker-loop.sh:1565-1570` says the trap cannot run on SIGKILL

Each absence is individually honest and the **sum over them is not**, because a total over an unknown subset presents as a total. The plan's own closing sentence names this failure mode — *"a per-plan sum over a zero is wrong in the direction nobody checks"* — and then scopes the rollup out, leaving the sprint's next plan to build the wrong thing on an honest record. `STORY-plot-plan-economics.md`'s decision table, 2026-08-27, is the same objection in the estate's own words: **"Cost is derived, never stored — a stored cost is a record that can be wrong."**

**Round 1 asked the plan to overturn that decision in its own voice (item 3). It did not.** `grep -in "derived\|never stored"` over the amended plan returns one hit, `:74`, and it is about *derived on demand* being unreadable elsewhere — not about the story's rule. The plan does this work impeccably for `spend.ts`'s `output_tokens` rule and still does not do it for the story's. Round 1 called that *"inconsistent with the plan's own standard"*; it is unchanged.

**Round 1's item 4 is also unaddressed.** `server_tool_use` appears zero times. A record titled *what a slice spent* that silently omits billable activity should name the omission, to the standard this plan sets everywhere else.

**The counter-argument, which nearly carries.** The four counters are genuinely unrecoverable once a transcript's machine goes away, capture at `seal_declaration` is cheap and correctly placed, and the trap this plan identifies — that a naive four-counter sum is a cache-read count wearing a cost's name — is real, well proven, and worth having in the repository. **The capture is worth doing.** What is not yet earned is a record whose path nobody has pinned and whose absence has no vocabulary.

---

## What would move me to `proceed`

1. **Pin the path's resolution, not just its directory.** Name `git rev-parse --git-common-dir` (the `plot-install-commit-record.sh:42-43` precedent) or an equivalent, and add a `Done when` gate: *a record written from a dispatch desk is readable from the main checkout after `plot-reap.sh` removes that desk.* This is the one item that turns a passing implementation into a working one.
2. **Fix the `.gitignore` citation** — line 30, not 35 — and state which of the two patterns the record relies on.
3. **Name the reader-side vocabulary**, following `DeclarationReading`: at minimum `recorded` / `absent` / `unreadable`, plus `elsewhere` for a machine that never held it. Gate it.
4. **State the filter behind the transcript population figures**, so the measurement is reproducible.
5. **Overturn `STORY:270` in the plan's own voice** (round 1 item 3, still open) and **name what the four counters exclude**, `server_tool_use` among them (round 1 item 4, still open).

Items 1 and 3 are the ones that decide whether a reader can tell this record from a missing one.

Verdict: amend
r2-locality: amend
