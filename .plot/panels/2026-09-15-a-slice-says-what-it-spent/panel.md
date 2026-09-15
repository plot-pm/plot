# Panel — a-slice-says-what-it-spent

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` (Draft, `Rounds: 2`)
Read at `a868ec7e8`. Lenses: measurement, persistence, lifecycle.
Reconciliation: **unanimous — amend** (cadence of agreement is not the finding; see below).

## What each juror actually looked at

Not the same evidence, and the difference decides the outcome.

- **measurement** re-derived every number on this machine, including a four-counter sum over the 394 MB transcript, three times.
- **persistence** read the state estate — `.gitignore`, receipts, commit-records, `.plot/panels/` — and then read `registry.ts:137` *to the end of the sentence*.
- **lifecycle** read `plot-worker-loop.sh` end to end and then **sampled 12 real worker transcripts** for distinct `gitBranch` values.

Only the third ran a measurement over the population the plan is *about*. That is why it found what the other two did not.

## The decisive finding: the plan's unit and its mechanism disagree

**Two lenses reached this independently, from opposite directions, and neither was asked to look for it.**

`lifecycle` read the loop: `plot-worker-loop.sh:2088-2297` is the finish path and **it does not exit**. It seals a declaration, clears the manifest branch, blocks in `wait_for_work`, resets the desk, and **loops**. The loop's own comment at `:1044` states the rule the plan needed:

> *"a declaration is about a BRANCH, and a worker hops, so one worker writes several. An ending happens once, to the worker, and the branch it held at the time is a field rather than the subject."*

`persistence` reached the same place by reading the join key's full sentence at `registry.ts:137` — the plan quotes the first half and not the second:

> *"`session` is the transcript join key and **stays fixed across a branch hop by design**."*

**So the plan is titled *"A slice says what it spent"* and proposes a per-WORKER event to produce a per-SLICE fact.**

Measured, not argued — 12 largest worker transcripts, distinct `gitBranch` values: **3 of 12 already span two branches**, and one desk directory holds 49 session files.

**This is how an implementation passes every stated gate and is still wrong.** Walk the `Done when` list against a two-slice worker: all four counters ✓, sum over every turn ✓, no fifth field ✓, scan only at exit ✓, board reads the record ✓, no `.jsonl` on refresh ✓ — and **the first slice's spend is charged to the second**. The word *"run"* carries the whole load and is never defined.

## A second unnamed subject: whose turns?

`measurement` found this and it compounds the finding above. *"Every turn of the run"* never says **whose** turns.

Measured on this project's transcript directory: **604 session files, 421 of them `agent-*` subagent transcripts, 370 with zero main-session turns.** Subagent share here is 1.07% of output tokens and 1.56% of cache creation — small on this estate, **unbounded in principle**.

**The repo already carries a measured warning about exactly this**, `spend.ts:42-50`:

> *"READ PER SESSION, NEVER PER WORKTREE. ... one project directory measured 2026-09-03 held 45 session files, 30 of them subagents, and a sum across them belongs to no one."*

The plan mentions subagents **zero times** — verified by grep. That is notable precisely because the plan *does* argue openly against the other `spend.ts` rule (`output_tokens`), so this is an **omission rather than a disagreement**. An implementation can pass every stated gate and be silently ~1% low, or sum the whole directory and capture other slices' agents.

**So two of the record's three subjects are undefined**: whose branch (above), and whose session (here). Only *which counters* is pinned.

## Two cheap gates the plan is missing

- **"No summed fifth field" is prose, not a test.** `contextSpend` is already on the wire schema (`schema.ts:3381`), so adding a fifth field beside it is a two-line change no review would flag. A key-set assertion closes it cheaply.
- **"The model" is singular and a transcript carries several.** One transcript here holds `claude-opus-5` across 43,550 turns **plus 13 `<synthetic>`**, which is not billable at all.

## The shared blind spot — asking what the lenses had in common

Three jurors verified the plan's quotations meticulously and **all three accepted its architecture argument before testing its population.** The plan's write-once-at-exit design rests on *"a cost is the traversal that bound exists to prevent"*, and:

- **measurement** reproduced the 885–1087 ms timing to within its own spread and called the range vindicated.
- **lifecycle** then asked *which file that was* — and it is `1520fd86-…`, **this session's own transcript**, the master agent's console, not a worker's.

Real worker transcripts: **median 7 KB, largest 7.7 MiB — 48× smaller.** A full sum over the worst case in the entire estate takes **90–250 ms**.

The architecture may still be right. **Its stated reason is not evidence for it**, and two of three lenses missed that because they checked whether the number was reproducible rather than whether it described the subject.

## A dated story decision is overturned silently

`STORY-plot-plan-economics.md:270`, 2026-08-27: **"Cost is derived, never stored — a stored cost is a record that can be wrong."**

The plan's entire mechanism is a stored cost. That may be correct — a real scan cost is a real reason derivation fails — but the plan does exactly this work for `spend.ts`'s `output_tokens` rule (*"says so against that rule rather than appearing not to have read it"*) and does not do it here. **Inconsistent with the plan's own standard**, and the standard is the right one.

## The Open Questions

- **Where does the record live?** Still open, still blocking, and `persistence` did not settle it either — but it is now the *second* question. Deciding a home for a record whose subject is undefined settles nothing. `measurement` adds the sharpest argument for committing it: transcripts are machine-local **and unbacked**, so *"machine-local and labelled"* means the number can **cease to exist entirely** once a desk is reaped on a machine nobody returns to.
- **Which exits does the scan run on?** **Should not block alone, and the question as posed is the wrong one.** Two lenses disagreed in emphasis and both are right on the facts. There are **two traps and they are not alternatives** — `_on_alarm ALRM` at `:1546` and `_cleanup_on_exit EXIT` at `:1591` — and the EXIT trap already runs on every termination **including the bound**. So the real question is a bound on the scan itself, not a choice of exits, and at a worst case now measured in hundreds of milliseconds it is affordable on every path.

  **But `lifecycle`'s finding survives that correction and is the one that matters**: `_cleanup_on_exit` (`:1571-1590`) is a *reaper* — it removes the manifest and kills child trees — so it is where the process ends, not a place work is currently done. `write_ending()` (`:1069-1090`) is unmentioned by the plan and **all five of its call sites are failure endings**; there is no `write_ending` on the success path. The exit is reachable; what is absent is a per-slice hook, which is the subject problem again.

## What survives

- The four-counters-kept-apart design, and the **refusal of a naive summed fifth field** — measured 99.36% cache-read share, reproduced by all three lenses (94.35% on the largest real worker transcript, same conclusion). `measurement` calls this the strongest thing in the document: it turns a plausible feature into a demonstrated trap.
- `contextTokens` / `contextSpend` left alone.
- Every quotation in the plan is verbatim and every line number is exact. One cosmetic slip: "387 MiB" for 393,738,847 bytes, which is 375.5 MiB.

## The amendment this panel asks for

1. **Name BOTH subjects.** Whose branch — a slice or a worker — the title says one, the mechanism does the other. `seal_declaration` at `:2088-2093` already runs per branch at the right moment, *before* the hop moves `$PLOT_BRANCH`, and the transcript carries `gitBranch` per line. The cheap fix exists and the plan currently says the opposite. **And whose session** — per session, never per worktree, as `spend.ts:42-50` already measured.
2. **Replace the timing measurement with one taken over worker transcripts**, and re-argue write-once-at-exit on that basis or drop the argument.
3. **Say plainly that this overturns "cost is derived, never stored"**, in the voice the plan already uses on `output_tokens`.
4. **Name what the four counters exclude** — `usage` carries `server_tool_use` and more, which is billable activity a record claiming to say *what a slice spent* would silently omit.
5. **Gate the fifth field with a key-set assertion**, and make the model field plural.
6. Then settle where the record lives — weighing that a machine-local record is not merely unreadable elsewhere but **destructible**.

**This plan is not ready to dispatch.** It is also not wrong in its core insight — the trap it identifies is real and well proven.
