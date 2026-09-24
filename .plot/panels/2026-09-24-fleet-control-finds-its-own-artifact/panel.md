# Panel moderation — fleet-control-finds-its-own-artifact

**Reconciliation: `divided` — proceed=estate, amend=adoption,manifesto.**

The first divided panel of the session, and it is **not a tie to average**. The three agree on everything the plan asserts; they disagree about whether what the plan OMITS is disqualifying.

## What all three confirm

**The count is exact.** Estate recounted it independently: 26 script-relative sites across 14 files, 1 repo-root site at `plot-fleetctl.sh:89`. The plan's table is right to the number.

**`$script_dir` is correct under a plugin install** — estate verified it against the live install on this machine rather than arguing it, and adoption traced the registryd bundle to confirm the daemon is already plugin-correct: `registryd-main.ts:87` resolves scripts beside ITSELF. Only the launching shell is wrong. **`Board impact: none` holds.**

**Refusing the probe is right.** Manifesto judged the DESIGN-process.md §1 argument sound rather than evasive.

## Why estate says proceed

Its three findings are offered as non-blocking: a 27th site (`plot-pr-merged.sh:105`) inlines the `BASH_SOURCE` expression rather than using a `$script_dir` variable, so **a gate grepping for `$script_dir/board/` will not see it**; and `plot-board-probe.sh:266` legitimately builds a repo-root bundle path as its documented `artifact_source="checkout"` fallback, so **any gate must exempt it by name or fail on the file that already does this correctly.**

Both are about slice 3's gate, not the fix.

## Why two say amend, and the moderator agrees with them

### The finding the plan missed — verified by the moderator

`plot-fleetctl.sh:110` — `pinned_major()` reads **`$repo_root/.nvmrc`**, the consumer's.

A consumer repository has no `.nvmrc`, so the node-version check evaluates to nothing and **refusal 2 silently vanishes for exactly the population this plan serves.** That check exists to stop a wrong interpreter being baked PERMANENTLY into the unit — the plan quotes that danger itself and then leaves the guard against it disabled for every consumer.

**The moderator confirmed the line and the surrounding population.** The other `$repo_root` uses in the file — the start marker (`:176`), the worktree root (`:260`), the logs (`:567`) — are **correct**: they belong to the consumer's estate. Only `:89` and `:110` are wrong, and for different reasons: one resolves a shipped artifact, the other reads a pin that is Plot's, not the consumer's.

**So the plan's "one line" is true of the bug and false of its own Done-when**, which promises a working `/plot-fleet`.

### The gate is written as a gate and is a rule

Manifesto's central objection. Done-when 4 asks for a gate counting `$repo_root`-resolved bundle paths at zero, and nothing in the slice builds one. Estate's two findings make it harder than it reads: the grep must catch an inlined form it would miss and exempt a file that is correct.

**A gate that is described and not built is the shape CLAUDE.md names**: *"If prose-only, it's a rule and will eventually be violated."*

## What the moderator does not average

Estate's `proceed` is not wrong about anything it examined — it verified the plan's claims and found them sound. **It was asked a narrower question.** The two `amend`s looked past the plan's assertions to its promises, and found the gap there. A panel that averaged these to *"mostly proceed"* would ship a plan whose Done-when it knows to be unreachable.

## The disposition

**Amend before building.** The diagnosis, the fix and the recommended idiom all survive untouched. What changes: `:110` joins the slice, the gate's two known blind spots are named, and the Done-when stops promising more than the slice delivers.
