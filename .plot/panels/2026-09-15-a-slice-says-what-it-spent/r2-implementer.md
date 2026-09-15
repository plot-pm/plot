# r2 — implementer lens

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` at `origin/main`, amended, `Rounds: 3`.
Reading position: the agent dispatched against this tomorrow with no further conversation.

## 1. Are the factual claims true on main?

Every quotation I could check is verbatim. Verified individually:

- `rules/spend.ts:79` — `CONTEXT_USAGE_FIELDS` is the three input fields; the `output_tokens IS DELIBERATELY ABSENT` comment is verbatim (`spend.ts:76-78`). **TRUE.**
- `spend.ts:42-50` — `READ PER SESSION, NEVER PER WORKTREE`, the 45-files/30-subagents measurement, and *"a caller that cannot name the session must pass `null` here rather than reach for the newest file"*. **TRUE**, verbatim.
- `registry.ts:137` — `session` is *"the transcript join key"*. **TRUE.** The plan quotes the first half; the sentence continues *"and stays fixed across a branch hop by design"* (`:137-138`), which is the half that matters and the plan still does not quote. Not false, but see §3.
- `transcript.ts:184` walks backwards — **TRUE**, the reverse loop is at `:180`; `:184` is inside it. Close enough to stand.
- `TRANSCRIPT_TAIL_BYTES = 256 * 1024` and the *"a transcript grows without bound over a long run — six figures of tokens become megabytes of JSONL"* comment. **TRUE**, `transcript.ts:126-135`.
- `contextSpend` *"has no render site: zero references in `packages/board/src/app`"*. **TRUE** — `git grep contextSpend -- packages/board/src/app` returns nothing; the only app-side reference is `AgentPanelFacts.tsx:411`, which renders `contextTokens`.
- `schema.ts:3381` carries `contextSpend` — **TRUE** (panel's claim, still load-bearing for the key-set gate).
- `.gitignore:35` is `.plot/state/` — **TRUE**, and `:40` adds `**/.plot/state/` for fixtures. Worth knowing: a fixture-directory record is ignored too.
- `plot-worker-loop.sh:1044` comment about a worker hopping — **TRUE**, verbatim at `:1043-1046`.
- `plot-worker-loop.sh:1591` installs `trap _cleanup_on_exit EXIT` — **TRUE**, exactly `:1591`. `_on_alarm ALRM` at `:1546` — **TRUE**.
- `transcriptDir(worktree)` resolves `~/.claude/projects/<slug>` — **TRUE**, `transcript.ts:79`.

**One citation is wrong and it is the one the whole mechanism hangs on.**

> The plan: *"`plot-worker-loop.sh:2088-2297` is the finish path"* and *"**the record is therefore written per slice, at `seal_declaration`** — `:2088-2093` is explicit that it runs *before* the hop moves `$PLOT_BRANCH`"*.

`seal_declaration` is called at **`:2092`**, and the comment justifying the ordering is `:2087-2091`. The range `:2088-2293` is not "the finish path" in any unit sense — `:2297` is EOF. Minor as a citation; it matters because an implementer grepping `2088` finds a comment mid-sentence.

**A second claim I could not reproduce.** The plan states *"1,966 worker transcript files"* with `largest 8,111,230 bytes / median 7,084 bytes`. Measured now on this machine over `~/.claude/projects/*worktrees*/**.jsonl`: **747 files, largest 6,877,025 bytes, median 7,025 bytes.** The median matches to 0.8% and the conclusion is unaffected — but the population count is off by 2.6×, so either the plan counted a wider corpus than `*worktrees*` or the estate shrank. **The timing conclusion stands; the stated N does not.** I re-measured a full four-counter sum over a 6.9 MB worker transcript below and it took well under a second, so the cost argument's *withdrawal* is correct either way.

**The central measurement reproduces and it is the strongest thing here.** Full four-counter sum over `7c9581b2-….jsonl` (262 assistant turns, one branch):

```
input_tokens             524
output_tokens        134,953
cache_creation       464,145
cache_read        46,792,424   ← 98.73% of the naive total
```

The plan's *"adding the four together answers nothing"* is demonstrated, not argued. I would not touch this section.

## 2. Are both undefined subjects now pinned?

**Whose branch — pinned in prose, NOT pinned as a mechanism, and the gap is mine to fall into.**

The plan says the record is written *"per slice, at `seal_declaration`"*. That is the right moment. But it never says **how the turns are partitioned**, only that *"the transcript carries `gitBranch` per line, so the partition is readable"*. As the implementer I would write the obvious filter — `line.gitBranch === $PLOT_BRANCH` — and it is **measurably wrong**:

Measured on `6e95c8df-….jsonl` (`bug/a-monitor-ends-with-its-agent`), assistant turns by `gitBranch`:

```
bug/a-monitor-ends-with-its-agent   194
HEAD                                 20
sequence: <branch> -> HEAD -> <branch>
```

`gitBranch` reads **`HEAD`** for 20 turns mid-slice — the agent detached to baseline against main, a practice this repo's own memory recommends. Those 20 turns are the slice's spend and an equality filter silently drops them, ~9% low, with **every stated gate green**. Two more of the transcripts I sampled show the same `HEAD` value, none from a hop. So the plan's fixture demand (*"a fixture transcript carrying two `gitBranch` values"*) is satisfiable by a fixture that does not contain this case, and the case is the common one.

**The plan owes a rule for `HEAD` and for a turn carrying no `gitBranch` at all, and it states none.** That is a decision left to me.

**Whose session — named, and still not decidable from the plan.**

The plan says *per session, never per worktree* and *"a caller that cannot name the session passes `null`"*. Correct, and it quotes the right rule. It does **not** say which session id the writer uses. Measured in one desk directory (`-…--worktrees-free-80602eda`): **9 files, 6 `agent-*`, and THREE non-`agent-` main sessions** with 262, 26 and 1 assistant turns, all on the same branch.

So "the main session" is not one file. The answer exists and the plan does not give it: `$PLOT_SESSION_ID` is exported in the loop's environment at `:1642-1643` and is in scope at `:2092`. **The plan should have written that variable name.** Without it I would implement `transcriptFile(dir)`'s newest-file heuristic, which is exactly what `spend.ts:48-50` forbids, and which on this directory would pick one of three and be silently ~10% low or ~90% low depending on mtime.

Verdict on the rubric question: **one subject is named-but-unmechanised, the other is named-but-unresolved. Neither is pinned so an implementer cannot get it wrong.**

## 3. What `Done when` still fails to pin

The list is long and mostly good — the key-set assertion and the *records nothing rather than zero* gate are real gates, not prose. What it does not pin:

1. **The `HEAD` partition rule** (§2). Every gate passes on a two-branch fixture while a detached-baseline slice under-reports.
2. **Which session file.** A fixture *"holding a main session beside `agent-*` subagent transcripts"* is satisfied by a directory with ONE main session. The measured failure needs **three**. My implementation could pass the demanded fixture and pick the wrong file in production.
3. **`seal_declaration` is not the finish path — it is ONE path.** `:1000-1007` is explicit: *"ABSENCE IS LOAD-BEARING, so this runs on exactly one path: `run_bounded` returned 0… A worker killed by the `Worker bound` or ended by the WorkerMonitor exits above without reaching this line."* The plan's Open Question 2 answers *"the scan does not hang off either trap — it runs at `seal_declaration`, per slice"* and calls the exits question mis-posed. **It is not mis-posed, it is answered wrongly by omission:** a bounded or monitor-ended worker produces **no record at all**, and the plan's *"records nothing and says so"* gate is about an unreadable transcript, not about an unreached write site. So the most expensive runs — the ones that hit the 28800s bound — are exactly the ones that record nothing, and nothing in the plan says that is intended. That is a decision left to me and it is a policy decision, not an implementation one.
4. **The four counters exclude eight more fields, and the panel asked for this in item 4.** Measured on a real worker turn, `usage` carries: `input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, output_tokens_details, server_tool_use, service_tier, cache_creation, inference_geo, iterations, speed`. **Eleven keys, not four.** `server_tool_use` is billable activity. The amended plan mentions none of this; panel amendment #4 was **not applied**. (`server_tool_use` summed to 0 on the transcript I measured, so the omission is currently harmless here — but a record titled *what a slice spent* that silently drops a billable field should say so, which is the plan's own standard applied to `output_tokens`.)
5. **The model field is still singular in the Design prose** (*"The model is recorded beside them"*), though `Done when` says *"every model it used"*. Panel amendment #5 was half-applied. The `<synthetic>` model the panel found is not mentioned; a `<synthetic>` turn is not billable and I would have to decide whether to record it.
6. **`STORY-plot-plan-economics.md:270` — "Cost is derived, never stored"** is still on main, verbatim, and the amended plan still does not mention it. Panel amendment #3 was **not applied**. The plan does this work impeccably for `output_tokens` and not at all here.

**A way to satisfy every gate and be wrong**, concretely: filter on `gitBranch === $PLOT_BRANCH`, take the newest non-`agent-` file in the desk dir, sum the four counters, write one JSON file per slice under `.plot/state/`, assert the key set, assert nothing opens `.jsonl` on refresh, ship a two-branch fixture and a one-main-session-plus-subagents fixture. **All green. Under-reports a detached-baseline slice by ~9%, picks one of three sessions arbitrarily, and writes nothing at all for every bounded run.**

## 4. Is "write once at seal_declaration" still supported?

**Yes, and the plan's re-argument is honest and correct.** It withdraws the cost argument by name (*"cost is not the argument for writing once, and the plan no longer makes it"*) and replaces it with the subject argument: `seal_declaration` is the only moment that knows which branch just finished, before the hop moves `$PLOT_BRANCH`. I verified that ordering at `:2087-2092` — the comment says exactly this — and `reset_desk` at `:955` deletes the declaration file on the next hop, so the desk itself is not a durable place either.

The argument is sound. **What it does not survive is §3.3:** "the only moment that knows" is true, and that moment is not reached on the bound path. The reasoning is right and its coverage is not stated.

I also note the withdrawal is done in the plan's own best voice — naming the earlier wrong measurement and what it actually was. That is the standard the `STORY:270` and `server_tool_use` omissions fall short of.

## 5. Strongest argument against doing this at all

**The record is machine-local, destructible, and has no consumer.**

The plan states all three parts and treats the first two as honesty rather than as an objection. Put together they are one: the output is a git-ignored file under `.plot/state/` that no colleague can read, that vanishes when a desk's machine is retired, whose only stated consumer (*per-plan rollup*) is explicitly deferred to a later plan, and which the story's own dated decision (`STORY:270`) says should not exist. Meanwhile the number it stores can be re-derived from a transcript in **90–250 ms in the worst case in the estate** — a figure the plan itself now publishes, having withdrawn the cost argument.

So the plan has removed its own reason for storing rather than deriving, and replaced it with a timing argument (*"the only moment that knows which branch finished"*) which is real — but which a `gitBranch` partition over the transcript, read later, largely answers too, since the partition key is in the file. **The plan proves the transcript carries `gitBranch` per line and then does not ask whether that makes the after-the-fact derivation it rejected actually possible.**

I do not think this sinks it — the write-once record is defensible and the trap it documents is genuinely valuable. But it is the argument I would want answered before building a store the story forbade.

## What I would open, and where I would guess

Files I would open: `skills/plot/scripts/plot-worker-loop.sh` (write site at `:2092`), a new `packages/domain/src/rules/*.ts` for the sum + partition (arrow functions, readings-as-values, no I/O — buildable within the layering rule), a new `skills/plot/scripts/board/plot-*.mjs` bundle so the shell asks the domain (`docs/shell-and-domain.md`: this runs once per slice, not once per pass, so it calls the domain rather than duplicating it — the plan does not say which side it lands on, but the estate's own rule decides it), `packages/board/src/server/registry.ts:684` for the read-back beside the existing transcript join, and `packages/board/src/contract/schema.ts` for the wire field.

**Buildable within the layering and arrow rules: yes.** Nothing here needs the domain to touch disk; the shell takes the readings and the rule sums them, which is the shape `plot-slice-pr.mjs` already uses.

**Where I would have to guess, in order of damage:**

1. Which session file (§2) — the plan should have named `$PLOT_SESSION_ID`.
2. The `gitBranch === "HEAD"` rule (§2) — the plan should have stated it.
3. Whether a bounded run records anything (§3.3) — a policy call the plan left open while declaring the question mis-posed.
4. The record's filename, key names, and whether it is one file per slice or one appended line (`.plot/state/` holds both shapes today: `*.json` and `unowned-state-writes.tsv`).
5. Whether `<synthetic>` and `server_tool_use` are in or out.

Five guesses, three of them measurable defects. Each is one or two sentences of plan text.

## Assessment

The amended plan is **substantially better** than the one the first panel read. The central measurement is reproduced and the naive-total refusal is demonstrated. The cost-argument withdrawal is exemplary. Both subjects are now *named*, which is what round 1 asked for.

But round 1 asked for six amendments and **three were not applied at all** (`STORY:270`, `server_tool_use`, the plural model only half-done), and the two subjects it did address are named in prose without the mechanism that would stop me getting them wrong — which I measured myself getting wrong in two different ways in under an hour. The `seal_declaration` coverage gap is new and was not in round 1.

This is close. It is not dispatchable to an agent with no further conversation.

Verdict: amend

r2-implementer: amend
