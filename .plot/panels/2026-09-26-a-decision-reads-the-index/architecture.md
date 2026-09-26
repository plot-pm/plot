# Architecture lens — a decision reads the index

Position: amend
Evidence: executed

## The headline: the index already exists, and the plan does not know it

`PrIndexStore` is a port (`packages/domain/src/ports/pr-index.ts:37`), with a file-backed
adapter (`packages/domain/src/adapters/pr-index/pr-index-file.ts:69`), a fold rule
(`packages/domain/src/rules/pr-index.ts:82`), a versioned entity
(`packages/domain/src/entities/pr-index.ts:80`) and a live store on this machine:

```
.git/.plot/state/index/github.json   351082 bytes, written 2026-09-26 14:53
v: 2 | connector: github | rows: 967 | watermark: 2026-09-26T12:50:20Z | complete: false
row keys: number, head, state, draft, checks, review, url, mergeable, failing_checks, author, updatedAt
```

It was delivered yesterday by `docs/plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md`
(**State: Delivered**, same sprint as this plan).

**It holds exactly what this plan's Design section specifies, property for property:**

| the plan's requirement | where it already is |
|---|---|
| "Answers, never verdicts" | `ports/pr-index.ts:32` — *"NOTHING HERE DECIDES. The port reads and writes; `foldPrIndex` says what a refresh means."* Rows carry `state`, `checks`, `mergeable` — bought answers only |
| "every entry carries what it was read against" | the `watermark`, taken from the ROWS and never from the clock (`rules/pr-index.ts:69`) |
| "an answer that could not be obtained is not an entry" | `complete` latches down; a partial answer keeps what it did not see and never licenses *"asked, and there is no PR"* (`rules/pr-index.ts:84`) |
| "a shell consumer must not depend on a running board" | `--git-common-dir`, a plain JSON file, no HTTP |
| "Where it lives — three candidates, open" | **decided and built**: a port, written by an adapter, to a file under `.plot/state/` |

The plan's first slice, *The index has a home* — "Decide among the three candidates above with
the argument written down, then build the store and its two properties" — is **already done**,
and the argument is written down in the port's own docblock, including the two rejections the
plan would have had to rediscover (why not a field on `Host`; why `--git-common-dir` and never
`--show-toplevel`).

That is not fatal to the plan. It is fatal to its slice 1 and to its "Where it lives" section,
and it changes the plan's subject from *build a seam* to *extend and consume the seam that
exists*. That is an amendment, but a large one: a third of the plan is describing work already
merged in the same sprint.

## The 35-spawn measurement is the predecessor's error, repeated

The plan leads with **"35 spawn sites across three deciders — `dispatch.ts` 10, `deliver.ts` 15,
`approve.ts` 10"**, and puts the figure in its epigraph, its Motivation table and its Changelog.

Counted as invocations:

| decider | plan says | `grep -c spawn` | **actual call sites** |
|---|---|---|---|
| `deliver.ts` | 15 | 13 | **1** (`:529`) |
| `dispatch.ts` | 10 | 9 | **1** (`:356`, `spawnSync`) |
| `approve.ts` | 10 | 9 | **1** (`:295`) |

```
$ grep -nE '(^|[^a-zA-Z.])(spawnSync|spawn|execFile|execFileSync)\s*\(' \
    packages/board/src/server/{dispatch,deliver,approve}.ts
packages/board/src/server/dispatch.ts:356:  const implResult = spawnSync(
packages/board/src/server/deliver.ts:529:  const child = spawn(
packages/board/src/server/approve.ts:295:    const child = spawn(
```

**35 is 3.** The remainder are the import line and prose — `deliver.ts` alone spends eight of its
"spawn sites" on docblock sentences such as *"Never spawns, never blocks"* (`:312`), which is a
comment asserting the opposite of what it was counted as.

This is the exact methodological failure the panel refuted four hours earlier: *"The plan's
numbers were `grep -c plot-host.sh` — mostly comments and operator-advice strings."* The plan's
Notes section acknowledges that finding — *"The cost claims in that plan were wrong in every row;
this plan does not repeat them"* — and then repeats it in the epigraph. A plan that names its
predecessor's error and reproduces it in its own first sentence has not absorbed the panel.

## The three spawns are performances, not retrievals — which breaks the plan's rule

This is the architectural objection, and it survives fixing the count.

The plan's rule is `tool call ──writes──► index ──read by──► decision`, and its diagnosis is
*"Each retrieves and judges in one pass."* Read the three sites: none of them retrieves anything.

- `approve.ts:295` spawns after `recordActionReceipt(...)` — the receipt that says *the controller
  already authorised this action* (`:291`). The spawn is the **write**, downstream of the decision.
- `deliver.ts:529` is identical: `recordActionReceipt(opts.repoRoot, 'deliver', slug)` at `:528`,
  then the agent starts. The docblock at `:523` says so — *"THE RECEIPT, BEFORE THE AGENT STARTS."*
- `dispatch.ts:356` spawns `/plot-implement` to **create a brief**, then `:403` — *"The implement
  succeeded — the brief exists. Now spawn the dispatch."* Sequenced side effects.

So the plan has inverted its own subject. These are not decisions buying answers; they are
decisions **performing** their outcome. An index cannot remove them, because no index makes a
`claude -p` agent unnecessary. The plan's own rule permits them — part 1 says *"A tool call writes
the index and returns nothing a decision consumes"* — and it lists them as the defect anyway.

**Meanwhile the actual decisions are already indexless and spawnless**, and the plan does not
mention it. `packages/domain/src/workflows/approve.ts:104` is `approve(readings, …)` taking
readings as values — nine refusals, zero spawns, zero awaits. CLAUDE.md's own note on shape
already states the estate's answer: *"The domain here takes readings as values, not ports —
`reap(readings, input)` … No rule or workflow imports a port or awaits anything."*

**The real, unnamed defect is the opposite of the plan's:** the board's `approve.ts`, `deliver.ts`
and `dispatch.ts` **do not import the domain at all.**

```
$ grep -n domain packages/board/src/server/approve.ts    → NO DOMAIN IMPORT
$ grep -n domain packages/board/src/server/dispatch.ts   → NO DOMAIN IMPORT
$ grep -n domain packages/board/src/server/deliver.ts    → one comment, line 31
```

`workflows/approve.ts` exists, states nine refusals, takes readings as values — and has no board
caller. That is `CLAUDE.md`'s own named defect class: *"Where a rule exists and nothing calls it,
that is a defect to report."* A plan about separating retrieval from decision that misses three
controllers bypassing the decision rules entirely is aiming at the wrong seam.

## What the code contradicts

**1. The `entry.pulse` claim is true, and it is the plan's strongest paragraph.**
Verified: 31 references, `fleet.ts` only (`:2232, 3141-3360, 3559-3690, 6009, 7623-7730`), plus
three test files. Nothing outside it reads the buffer. The plan's escape from the predecessor's
refutation is sound: `publishPartial` accumulates for one renderer, and that refutation does not
reach a cross-consumer index. **This is the one claim I could not dent, and it is why my position
is amend rather than reject.**

**2. `ci.yml:333` is cited, and the quotation comes from `ci.yml:403` — a different gate.**
The plan says: *"`ci.yml:333` counts spawn sites outside adapters — `allowed=28`, target 0. Its own
comment names why it cannot reach zero: 'A RATCHET AT NINE, NOT A REFUSAL.'"*

Those are two gates:

- `ci.yml:332` **One place reaches a process** — `allowed=28`. I ran it: **20 sites**, eight under
  budget, and it prints `::notice::the ratchet can tighten`. It is not stuck; it is slack.
- `ci.yml:409` **A script is named in an adapter** — the ratchet at nine, whose comment the plan
  quotes. I ran `./scripts/check-script-names.sh`: `9 (allowed 9, target 0)`, exit 0.

**The plan's central structural argument fuses them.** *"That is this plan's gap. The ratchet is
not stalled on effort; it is stalled on a missing destination"* — the number stalled at nine is the
**script-name** gate, and the nine are `plot-deliver.sh`, `plot-approve.sh`, `plot-dispatch.sh`,
`plot-reap.sh`, `plot-fleet-scan.sh`, `plot-fleetctl.sh`, `plot-release-refs.sh`,
`plot-worker-state.sh`, `plot-resolve-artifact.sh`. An index is not the destination for any of
them: `plot-deliver.sh` performs a lifecycle write, `plot-reap.sh` removes a worktree,
`plot-release-refs.sh` deletes refs. **You cannot read a ref deletion out of an index.** The gate's
own comment says what they need — *"seven of the nine are lifecycle commands no port answers yet"*
— and the missing thing is a **performer port**, not a store. `ports/performer.ts` already exists.

So the plan claims a gate's blockage as its justification, names the wrong gate, and proposes a
remedy the right gate's own comment excludes.

**3. "Done when: the CI spawn ratchet falls" is not checkable as written.** The spawn ratchet is at
20/28 and already below its literal, so it can fall without this plan and cannot fail because of
it. Its sibling — *"its comment no longer names that decider's scripts as portless"* — is the real
criterion and belongs to the other gate.

## Through the architecture lens: does an index fit the layering direction?

**A store fits; the plan's version of it cuts across.**

The layering rule is `controller → domain → port ← adapter → script/git/process`, and
`PrIndexStore` sits in it exactly: the port declares, `prIndexFile` implements, `foldPrIndex`
decides, `fleet.ts:2537` calls. The purity gate passes. That is the proof the shape is admissible
here — it is already admitted.

Two of the plan's three candidates violate it:

- *"Behind a port — an adapter writes, the domain reads … but adds async to a core that has none."*
  The plan names the cost and understates it. `approve(readings, input)` is synchronous and
  `Outcome`-returning; making the domain *read* a port means `await` inside a rule, which is the
  one property CLAUDE.md declares deliberate. This candidate is not open — it is refused by the
  settled shape, and the plan should say so rather than offer it.
- *"In the domain as readings"* is the estate's shape and is what happens today.

Only the third candidate is live, and it is built. So the honest reading of "Where it lives" is not
*"honest scoping"* and not *"unbuildable"* — it is **a decided question presented as open**. Two
candidates are excluded by rules the plan cites elsewhere, and the third is merged. Leaving it open
would have been defensible on 2026-09-24; on 2026-09-26 it asks a slice to re-decide what its own
sprint delivered.

**And part 3 of the rule is the unexamined one.** *"A decision may be triggered by an index update
… The supervisor's tick and the board's poll both become index subscriptions."* The supervisor is
deliberately stateless — *"It holds nothing between ticks, and that is measured rather than argued:
a daemon `kill -9`ed two seconds into a 3.4 s tick was followed by a whole tick reaching the
identical decision, with no state file written"* (CLAUDE.md). A subscription is state between
ticks. The plan proposes inverting the supervisor's central safety property in one sentence, with
no argument and no slice. That is the largest unowned claim in the document.

## Is "a decision may not spawn" achievable?

**No, not as an absolute — and the estate has already priced the exception.**

`plot-pr-merged.sh` is the counter-case: ref deletion is not undoable, so `plot-release-refs.sh`
asks the host at the moment it acts, and *"an unreachable host answers not merged, so silence is
never permission."* An index read cannot give that answer. A stale `merged: true` in front of an
irreversible `git push --delete` is a defect an index **creates**.

The index's own `complete` latch is the estate's acknowledgement of this: a partial store may not
license *"asked, and there is no PR"*. So the rule that is achievable is narrower than the plan's:

> A decision reads the index where a stale answer costs work, and asks the host where a stale
> answer costs something unrecoverable.

That distinction is already gated for the sibling question — `check-ancestry-decisions.sh` makes
every ancestry call declare `prefilter` or `evidence`, and *"there is deliberately no third kind."*
An index needs the same declaration and the plan has no equivalent. Without it, "a decision may not
spawn" is a rule in the sense this repo uses pejoratively: a sentence an agent can satisfy by
routing a `mergedAt` read through a file.

## What it must say before someone builds it

1. **Replace the epigraph.** 3 call sites, not 35, and say what they are: performances after a
   receipt, which the plan's own rule permits. If the plan keeps a count, count invocations.
2. **Name `PrIndexStore` and delete slice 1.** State what the existing store already answers, and
   scope this plan to what it does not: PR rows only, one connector, no issues, no ref state, no
   shell reader. That gap is real and is a plan's worth of work.
3. **Close "Where it lives" by pointing at the built answer**, and record why the other two
   candidates are excluded — a port the domain reads means `await` in a synchronous core.
4. **Fix the gate citation.** Separate `ci.yml:332` (20/28, slack) from `ci.yml:409` (9/9, stuck),
   and drop the claim that an index unblocks the second. Name `ports/performer.ts` as the seam the
   nine need, or say the nine are out of scope.
5. **Add the declaration rule**, in `check-ancestry-decisions.sh`'s shape: every index read declares
   whether a stale answer merely costs work or could license an irreversible act, and the second
   kind still asks the host. Without this, `plot-release-refs.sh` regresses.
6. **Either drop part 3 of the rule or give it a slice.** Making the supervisor's tick a
   subscription contradicts its measured statelessness; it is not a sentence.
7. **Say what the real finding is**: the board's three controllers do not import the domain
   workflows that already decide their actions. Report it, per CLAUDE.md, whether or not this plan
   fixes it.

## Rubric

1. **Is the defect real?** Partly, and not as stated. Retrieval and decision are *not* interleaved
   in the three named deciders — the decisions are in `packages/domain/src/workflows/`, synchronous
   and readings-taking. What is real: bought answers are re-bought per consumer, and the four shell
   consumers share nothing. The index for one of those questions is built and unshared.
2. **Does the design fix it, or is this the rejected plan renamed?** Not a rename — the
   `entry.pulse` argument is verified and genuinely escapes the refutation. But it is the rejected
   plan's *method* renamed: same `grep -c` measurement, same reliance on a quoted line whose
   context inverts it.
3. **What does the plan claim that the code contradicts?** 35 spawn sites (3). A ratchet stalled on
   a missing destination (two gates conflated; the slack one cannot stall, the stuck one needs a
   performer). An open question about where the index lives (decided, built, running, 967 rows).
4. **What must it say before someone builds it?** The seven items above; 2 and 4 are blocking.
5. **Architecturally sound here?** The shape is — it is the estate's own, already in the layering
   rule and already passing the purity gate. This plan's *account* of it is not: it aims at three
   spawns that are performances, misses three controllers that bypass the domain, presents a
   delivered decision as open, and proposes inverting the supervisor's statelessness in passing.
   Amend, substantially — the seam is sound and this is not yet the plan for it.
