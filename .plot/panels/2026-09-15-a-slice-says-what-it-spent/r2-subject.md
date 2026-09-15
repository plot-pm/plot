# r2 — subject lens

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md`, amended text read at `bc4d00235`.
Lens: **for every recorded fact, what is this a fact ABOUT, and can a reader place it without guessing.**

Round 1 asked for six amendments. Three landed, three did not, and my own measurement found a
**fourth subject the plan never names** that the round-1 panel also missed.

## 1. Every factual claim, verified

Read at `origin/main`. All of the following are **true**:

| claim | verified |
|---|---|
| `spend.ts:79` `CONTEXT_USAGE_FIELDS`, three fields, `output_tokens` deliberately absent | `packages/domain/src/rules/spend.ts:69-84` — quotation verbatim |
| `spend.ts:42-50` "READ PER SESSION, NEVER PER WORKTREE", 45 files / 30 subagents | `spend.ts:42-50` — verbatim |
| `contextTokens` / `contextSpend` docstrings | `packages/board/src/server/transcript.ts:26-54` — verbatim |
| `contextSpend` has zero render sites in `packages/board/src/app` | confirmed, 0 references |
| the 256 KiB tail, and the backward walk | `transcript.ts:127-138` (`TRANSCRIPT_TAIL_BYTES`), backward loop at `:184` |
| loop comment at `:1044`, "a declaration is about a BRANCH, and a worker hops" | `plot-worker-loop.sh:1044-1047` — verbatim |
| `seal_declaration` at `:2088-2093` runs before the hop moves `$PLOT_BRANCH` | `:2087-2092` — the comment says exactly this |
| `_on_alarm ALRM` `:1546`, `_cleanup_on_exit EXIT` `:1591` | both confirmed |
| `.plot/state/` is git-ignored at `.gitignore:35` | `:30` is the anchored root pattern, `:35` is `**/.plot/state/` — **both** ignore it; the cite is right in substance |
| 604 session files, 421 `agent-*` | exact, re-measured |
| largest worker transcript 8,111,230 bytes | exact |
| median worker transcript 7,084 bytes | I measure **7,025** over 2,693 files — same population, immaterial |
| cache_read 99.36% of the four-counter sum | recomputed from the plan's own table: **99.36%** |

**Could not verify / correction:** the plan cites `registry.ts:137`. The file is
`packages/board/src/server/registry.ts` and the quoted half-sentence sits at **`:137`** — correct,
but the plan quotes only *"the transcript join key"* and stops. The **second half of the same
sentence** is the one that decides this plan: *"and **stays fixed across a branch hop by design** —
`plot-worker-loop.sh` rewrites `branch` and `worktree` on a hop and leaves `session` alone."*
Round 1 flagged exactly this elision and **the amended plan still quotes only the first half.**

**Timing is now conservative rather than wrong:** I measure a full four-counter sum over the largest
worker transcript at **24–27 ms**, not the plan's 90–250 ms. The plan overstates its own cost by ~10x,
which is harmless — but it means the cost argument is even deader than the plan admits (see §4).

## 2. The two subjects round 1 named: one pinned, one only asserted

**Whose branch — PINNED, and correctly.** The plan says the record is written *"per slice, at
`seal_declaration`"* and that `:2088-2093` runs *before* the hop. I verified both, and I verified the
partition is readable: `gitBranch` is present on **65 of 65** assistant lines in the file I sampled,
and on every assistant line of every worker transcript I scanned. Good.

**Whose session — ASSERTED, NOT PINNED.** The plan says *"per SESSION, never per worktree"* and
*"a caller that cannot name the session passes `null`"*. That is the right rule. But the plan
**re-measures the wrong directory to justify it**: its 604/421 figures are `~/.claude/projects/-Users-...-plot`,
which is the **master agent's** directory — the same population error round 1 caught in the timing
argument, repeated in the session argument and not noticed.

Measured over the population this plan is about — 287 worker desks, 2,693 files, 1,761 `agent-*`
files, 139 desks containing subagent transcripts — the subagent share of a directory-wide sum is
**not the ~1% round 1 reported**:

```
25 worker desks holding subagent transcripts
  output_tokens    13.78%   subagent
  cache_creation   16.43%
  cache_read        6.26%
  turns            21.95%
```

**An implementation that sums the desk directory is ~14% high on output, not ~1%.** The plan's rule
is right and its evidence is for someone else's directory. That does not change the rule, and it does
change how wrong an implementer who ignores it will be.

## 3. The subject NOBODY has named: `HEAD`

This is my lens's own finding and it is not in round 1.

`gitBranch` is not always a branch. Scanning 593 worker transcripts over 200 KB:

```
spanning MORE THAN ONE real branch:   4
containing a HEAD (detached) segment: 45
containing NO real branch at all:      7
max real branches in one session:      5
```

`plot-dispatch.sh` cuts every desk **detached at `origin/<main>`**, and `reset_desk`
(`plot-worker-loop.sh:960-966`) passes through `git checkout --detach "origin/$main_branch"` between
slices. During that window the runtime records `gitBranch: "HEAD"`. A real one, measured — one session,
one desk, four slices, with a `HEAD` segment **in the middle of a slice**:

```
 110 turns  2026-09-12T09:36:43Z  feature/a-charter-bounds-what-an-agent-may-touch
 108 turns  2026-09-12T11:21:17Z  feature/an-absent-agent-is-noticed
  17 turns  2026-09-12T11:34:21Z  HEAD            <-- 4,792,932 cache reads, 6,257 output
 277 turns  2026-09-12T11:35:18Z  feature/an-absent-agent-is-noticed
  91 turns  2026-09-12T14:14:28Z  feature/a-delivery-verdict-names-what-it-ran
 189 turns  2026-09-12T15:01:55Z  feature/auto-dispatch-asks-for-the-brief
```

**Three things follow, and the plan handles none of them.**

- **The plan says a hopping worker writes "two" records.** Measured, one session produced **five**
  slices, twice. *Two* is an example that reads as a bound, and the Done-when's fixture demands
  exactly two `gitBranch` values — so a fixture satisfying the stated gate would never exercise the
  five-branch case that actually occurs.
- **`HEAD` is a fact about no slice.** 17 turns and 4.79M cache reads that belong to the desk's reset,
  not to either neighbouring branch. Filter it and the run's spend does not sum to the slice records;
  charge it to a neighbour and the record is wrong. The plan does not say which, and **both are
  defensible**, which is exactly the definition of an unpinned subject.
- **7 worker transcripts carry NO real branch at all.** Under the plan's `seal_declaration` rule
  those correctly produce nothing — but nothing in the Done-when distinguishes *this run had no
  branch* from *this run was not measured*, and the plan's own closing paragraph says that
  distinction is the deliverable.

## 4. What `Done when` still fails to pin

**Here is an implementation that satisfies every stated gate and is wrong.**

Write the record at `seal_declaration`, keyed on `$PLOT_BRANCH`, summing every assistant turn in the
session file whose `gitBranch` equals that branch. Now:

- four counters ✓, model ✓, no fifth field (key-set assertion) ✓
- two branches → two records, each covering only its own turns ✓ (the fixture has two)
- per session, not per worktree ✓ (fixture has `agent-*` beside a main session)
- scan at `seal_declaration` ✓, board reads the record ✓, no `.jsonl` on a refresh path ✓
- no transcript → records nothing ✓, second run → second record ✓, `test:contracts` ✓

**And on the measured five-slice session it silently drops 4.79M cache-read tokens and 6,257 output
tokens into a `HEAD` bucket nobody reads, or charges them to whichever branch the implementer
happened to pick.** Every gate green.

**A second way through, and it is worse because it is invisible.** `seal_declaration` runs on
**exactly one path** — its own comment at `:992-997` says so: *"this runs on exactly one path:
`run_bounded` returned 0."* A worker killed by the `Worker bound`, or ended by the WorkerMonitor as
quiet, takes `exit 124` at `:1956` and **never reaches `seal_declaration`**. The plan attaches the
spend record to that call site and inherits its absence semantics without saying so.

For a *declaration* that absence is load-bearing and deliberate — no declaration means the work did
not complete. **For a spend it is the opposite:** a worker that burned the full 28,800s bound is the
**most expensive run there is**, and it is precisely the run this design records nothing for. The
plan's own Notes say *"Zero is the dangerous answer here"*; an unrecorded bound-killed run is that
failure with the sign flipped — the runs that cost most are systematically the ones that go
unmeasured, and a later per-plan rollup is biased low in a direction nobody can see.

The Done-when does not mention the bound path at all. An implementer reading it will attach at
`seal_declaration`, pass every gate, and ship that hole.

**Third, smaller:** `Done when` says *"every model it used"* (plural, good — round 1's ask #5 landed),
but says nothing about `<synthetic>`, which round 1 measured and which is not billable.

## 5. Is write-once-at-seal_declaration still supported now the cost argument is withdrawn?

**The stated reason is sound; the placement is not fully argued.**

The plan now says plainly: *"cost is not the argument for writing once, and the plan no longer makes
it. The argument is the subject: the reading must be taken while the worker still holds the slice it
describes, because `seal_declaration` is the only moment that knows which branch just finished."*

That is the right argument and it is honestly made — this is the strongest thing the amendment did.
My timing (24–27 ms worst case) confirms cost could not have carried it.

**But "the only moment that knows which branch just finished" is not true, and the plan asserts it
rather than establishing it.** The transcript carries `gitBranch` on every line — the plan says so
itself, two paragraphs earlier, to justify the partition. If the branch is recoverable from the
transcript, then the attribution does **not** depend on being at `seal_declaration`; it depends only
on the transcript surviving, which the plan also argues it does (*"the transcript outlives the desk"*).

So the plan holds two claims that do not sit together:
- *the transcript carries `gitBranch` per line, so the partition is readable* (used to pin the subject)
- *`seal_declaration` is the only moment that knows which branch just finished* (used to pin the timing)

If the first is true the second is false, and the real argument for writing at `seal_declaration` is
something the plan never states — most plausibly that the desk is about to be reset and the
**session-to-slice** mapping is what becomes hard to recover later, not the branch. That may well be
right. **It is not written down**, and the whole design rests on it.

## 6. The strongest argument against doing this at all

**`STORY-plot-plan-economics.md:270`, 2026-08-27: *"Cost is derived, never stored — a stored cost is
a record that can be wrong."*** I verified the line; it is in the story's Decisions table, dated, with
the rationale *"Keeps manifesto Q1 (git is the database) and Q8 (no effort tracking)."*

**Round 1 asked for this to be addressed. The amended plan mentions it zero times** — grepped:
`derived, never stored` = 0, `never stored` = 0.

This is the sharpest objection because the plan **demonstrates it knows how to do this properly**.
It spends three paragraphs arguing openly against `spend.ts`'s `output_tokens` rule — *"says so
against that rule rather than appearing not to have read it."* That is the correct standard, the plan
states it, and then does not apply it to the one decision that governs its entire mechanism.

And the story's rationale has teeth here rather than being ceremony. This plan stores a number that is:
- **machine-local** and unreadable elsewhere (the plan concedes this),
- **destructible** with the desk (the plan concedes this),
- **systematically absent for the most expensive runs** (§4, the plan does not concede this),
- **ambiguous about `HEAD` turns** (§3, the plan does not concede this).

*A stored cost is a record that can be wrong* is not an abstract worry about this record. It is a
list of four ways this specific record is wrong, three of which the plan has not noticed.

**The counter-argument is real and I want to state it fairly:** derivation genuinely fails here,
because the desk is reset and reaped, and a number nobody can re-derive is a number that must be
stored. That is a legitimate overturn of a dated decision. It needs one paragraph in the plan's own
voice. It does not have one.

## What I am NOT objecting to

- **Four counters kept apart, and the refusal of a summed fifth field.** I recomputed the plan's table:
  cache_read is **99.36%** of the naive sum, exactly as stated. This turns a plausible feature into a
  demonstrated trap and it is the best-argued thing in the document.
- **The key-set assertion** (round 1 ask #5) landed.
- **`contextTokens` / `contextSpend` left alone**, and the honest statement that a colleague's
  checkout reads *nothing* rather than zero.
- **`server_tool_use` (round 1 ask #4) is a weaker finding than round 1 implied.** It is present on
  69.5% of turns (9,266 of 13,330) — but summed across the 15 largest worker transcripts,
  `web_search_requests` and `web_fetch_requests` are both **0**. The plan omitting it costs nothing
  measurable on this estate. I would not hold the plan for this.

## What would make this proceed

1. **Say what happens to `HEAD` turns**, and fix *"two records"* to reflect the measured five.
2. **Say what happens on the bound path**, where `seal_declaration` never runs and the run was most
   expensive. Either record there too, or state plainly that bound-killed runs are unmeasured and
   that a later rollup is biased low.
3. **Address `STORY-plot-plan-economics.md:270`** in the voice the plan already uses on `output_tokens`.
4. **Re-argue the `seal_declaration` placement**, since the transcript's own `gitBranch` undercuts the
   stated reason — or re-measure the session argument over worker desks, where the subagent share is
   13.78% and not 1%.

The core insight is right, the four-counter trap is well proven, and the branch subject is genuinely
fixed. Three of round 1's six asks were not answered, and my own reading found a fourth subject
(`HEAD`) and an attachment-point hole (the bound path) that no lens has named yet. Each is a way to
pass every gate and record a fact nobody can place.

Verdict: amend
