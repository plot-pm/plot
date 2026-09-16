# Readiness lens, round 3 — a-plan-has-one-phase (#924)

Read at `origin/main` = `447f3523d`. My question is the narrow one: would I hand
this to an agent tomorrow. Everything below was run today, not inferred.

## 1. The current claims verify

**The dry run is buildable exactly where the plan puts it, and I built it.**
This is the claim the whole rewrite rests on, and it is stronger than the plan
argues. `write_transition` (`plot-deliver.sh:422-452`) already writes its edits
to scratch files `$a` and `$b` and replaces the plan by one `mv` — the design is
named in its own header, *"BOTH EDITS RUN AGAINST SCRATCH FILES and the plan is
replaced by one `mv`."* So the script does not need a new mechanism to ask the
parser what the file *would* report: **the would-be file already exists on disk
as `$a`, and `plot-plan-meta.sh` takes a path.** I ran the real `flip_phase` awk
(`:271-285`) over the reporter's shape into a scratch file and parsed the scratch:

| | `format` | `phase` | scratch's `State:` line |
|---|---|---|---|
| reporter's file, before | `frontmatter` | `approved` | `Approved` |
| **the scratch `flip_phase` wrote** | `frontmatter` | **`approved`** | **`Delivered`** |
| control (Status-block only) | `canonical` | **`delivered`** | `Delivered` |

The gate discriminates on a real file, and the original was byte-identical after
— I checked, `State: Approved` still on line 10. **No judgement is left to the
implementer about how to ask the parser a hypothetical question.** That was the
open risk in this shape and it is closed by the script's existing design.

**Nothing is committed or pushed when it fires — VERIFIED by tracing the single
path.** `write_transition` returns 1 → `apply_local_writes:543` returns 1 →
`:574` runs `cleanup` (removes the booking worktree) and `exit 1`. The first
`git add` is `:580`, the commit `:592`, the push `:599`. **All three are
downstream of the exit.** The plan's central correction is not merely stated, it
is structurally true of the code.

**The exit-0 contract is untouched.** `:9-11` documents exit 0 as *"the plan is
Delivered on the default branch"*. A pre-`mv` refusal never reaches the push, so
the condition never holds and exit 1 means what `:9-11` already says it means.
r2-blast's amendment — that a post-push refusal would exit 1 on a run meeting the
documented exit-0 condition — is satisfied by construction rather than by a
header edit. Likewise `runAutoDeliver`'s `onExit` (`auto-deliver.ts:349-356`)
logs *"not reaping — the delivery refused"*, which is now **true**: nothing
landed, so the desks genuinely are not finished.

**The two corrected facts are stated correctly.** Two parses — `:98` and `:384`,
confirmed by `grep -n plot-plan-meta.sh` (the other four hits are comments) — and
neither after the write. And the domain answers `write`, not `already`: I ran
`plot-transition.mjs` on the reporter's post-run-1 file and got
`Delivered → 2026-09-16, jw → write → yes`. Both r2 corrections landed accurately.

**One r2 finding is silently resolved and worth naming.** r2-gate asked whether
the gate runs in the `action = "already"` branch (`:541`), where it would refuse
a correctly-idle run. Inside `write_transition` it cannot: that branch does not
call it. And r2-gate's "implementation that passes every gate and is still
wrong" — reading `$a` before the `mv` — **is now the specified implementation**,
not a divergence. The move resolved both.

**The second-run clause holds, and I checked the mechanism rather than the
sentence.** On the unrepaired file `flip_phase` returns 1, but it still writes
`$a` as a faithful copy (`:445-446` depends on this), so the scratch parses
`approved` and the gate fires identically. A second run refuses the same way, for
the same reading — not by a different route that happens to agree.

## 2. Walking `Done when` as an implementer

I can build this. Six gates, all discriminating, and I verified the two that
carry the weight (fires on the reporter's shape; silent on the control) by
running them rather than reading them. The refusal-names-both-values gate is the
estate's existing idiom (`:120`, `:436-438`). The byte-identity gate over the
corpus is the one that protects everybody and it is cheap.

The gap r2 could not close — *pin the read, scratch or plan file* — is closed by
the plan's own prose: *"a DRY RUN of the write, before anything is committed."*
There is exactly one file that is the would-be write and it is `$a`. An
implementer does not have to choose.

## 3. The one blocking defect

**The branch line at `:171` still specifies the abandoned first draft.**

```
- `bug/a-plan-has-one-phase` — report a cross-format phase disagreement through
  the existing `phase_alt` fields, the way the parser already reports a
  within-format one
```

That is the `phase_alt` design — the one this panel killed twice, for being
inert twice over. The `Done when` immediately below it describes the gate. **The
plan now contains both designs, and they contradict each other.**

This is not cosmetic, and it is not the same class as the count slip. **A plan's
`## Branches` line is the canonical specification a dispatched agent reads** —
it is what `plot-plan-meta.sh` extracts as the branch's entry (I parsed the plan:
the line is the wave's sole branch record), and this estate's own working rule is
that the plan line is the settled spec and any brief merely restates it. An
agent that reads `:171` builds the inert `phase_alt` change; an agent that reads
`Done when` builds the gate. Both are honestly following the plan.

The residue has a visible sibling two lines' worth of scroll away: `:133` reads
`### Why it has never surfaced here### Why it has never surfaced here`, a
doubled heading from the same rewrite. Together they say the rewrite edited the
Design and the `Done when` and did not sweep the rest of the file.

**The fix is one line.** Replace `:171` with the gate the plan now proposes —
*verify the write by parsing the would-be file before the `mv`, and refuse where
the parser disagrees with what was written.* Repair `:133` in the same pass.

## 4. What is imprecise but does not block

- **The count.** The plan says 285 twice (`:139`, `:152`) and 289 in `Done when`.
  Measured now: **290 files, 287 with a `State:` line, 0 with front matter.**
  r2-gate flagged this and the number did not move. It is written into a gate's
  own assertion, so it will not match the directory — but an implementer running
  the diff over `docs/plans/*.md` gets the right answer regardless of the
  number in the prose. Fix it while fixing `:171`; do not spend a round on it.
- **`Not in this slice`** names `/plot-approve` and `/plot-undeliver` but still
  not the format question that blocks the reporter — r2-gate's §5 point. The
  refusal naming both values is the honest answer to it and the plan makes that
  argument in Design. Worth a sentence, not a round.

## 5. Would I dispatch it

Yes, once `:171` says what the plan means. The design is settled and I could not
break it: the mechanism is buildable because the script already writes the file
the gate needs to read, the placement is safe because every irreversible step is
downstream of the exit it takes, and the two facts earlier rounds corrected are
now stated correctly. Three rounds found three real defects and this round found
one — a stale line, not a new objection to the design. I am not inventing a
fourth.

**What I checked:** ran `flip_phase` on the reporter's shape and on the control
and parsed both scratch files; traced `write_transition` → `apply_local_writes`
→ `exit 1` against the `git add`/commit/push line numbers; ran
`plot-transition.mjs` on the post-run-1 file; grepped both parse sites; counted
the corpus three ways; parsed the plan itself to confirm `:171` is the branch
record an agent receives.

Verdict: amend
