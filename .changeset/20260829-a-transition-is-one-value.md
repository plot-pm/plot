---
'@plot-pm/domain': patch
---

A transition is one value, and it checks its own gate.

`plan.approve()`, `plan.deliver()` and `plan.release()` land in
`@plot-pm/domain` as `src/transitions/plan.ts` — the package's first
*transitions*, after its entities and its first rule. Each returns
`Decision | Refusal` and **returns what should be written rather than writing
it**: the domain reaches no disk, no host and no process, and the purity gate
stays empty.

**A phase and its record are one value, because the pairing came apart in
practice.** The measured defect: a phase flip written without its record made a
delivered plan invisible to the scan, which reported zero. Today that pairing
is a rule four call sites must remember. `Decision` makes it structural —
`phase` and `record` are both required and `readonly` on a single object, and
the only way to obtain one is through a transition. **A phase without its
record does not typecheck**, which is what the plan asked for: impossible in
the type, not merely untested.

**The refusals are `plot-approve.sh`'s and `plot-deliver.sh`'s, and they are
named.** Those scripts already refuse on the phase and on the review channel
before writing anything, and say which refusal fired. The *mechanical* ones
move here as a `RefusalReason` a caller branches on rather than matching prose:
`phase-terminal`, `phase-too-early`, `phase-wrong`, `phase-unreadable`,
`review-human`, `review-unrecognised`, `version-missing`,
`precondition-unmet`.

**What could not move is the PR check, and it is not faked.** It needs a host,
so it arrives as a supplied `Precondition` reading — `{ name, met, detail }`.
The adapter reads the host; the domain decides. That keeps the refusal
expressible without the domain reaching for it, and it is the same shape the
branch-merge check needs for `deliver()`.

**`approvable()` stays callable alone, and `approve()` does not trust it.** The
board's Approve button must know whether to *offer* an action before anyone
takes it, but a caller that checked is indistinguishable from one that did not,
so the transition re-checks. The separation is deliberate and narrow: the two
are not collapsed, and neither assumes the other ran.

**The idempotent cases survive the move.** `approved` is not a refusal for
`approve()`, nor `delivered` for `deliver()` — those are the half-states the
shell scripts exist to *repair*, where the phase is flipped and the record is
still missing. `alreadyRecorded` tells a repair from a no-op, so a caller can
report "nothing to do" without re-deriving it.

**41 cases, one per refusal, named for it** — so a refusal that stops firing
fails loudly rather than silently widening what is allowed. Coverage of the
package is **100% of 261 statements, 144 branches and 69 functions**, with the
threshold failing the build when unmet.

The three house rules hold: the new file adds **zero** occurrences of the
counted vocabulary misuse, declares no `function`, and carries factual TSDoc —
what each export does, its parameters, its return, its failure modes. The
reasoning is in the commit message, dated and findable with `git log -S`.
