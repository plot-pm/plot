# Consistency pass: the step

A person runs this step by hand on a plan after the plan's review and before `/plot-approve`. One agent checks every claim the plan takes from a source outside itself against that source, and writes each contradiction into the plan's `### Open Questions`. The plan is [a-consistency-pass-checks-the-plan-against-its-sources](../plans/2026-11-07-a-consistency-pass-checks-the-plan-against-its-sources.md); this document is the trial's working copy of the step. Each run is logged in [the run record](2026-11-07-consistency-pass-run-record.md).

## Inputs

- The plan file, as committed at the commit to read.
- The commit to read. For `Review: pr`, this is the head of the plan PR at the time of the run. For any other review channel, it is the commit the approval would record. The run record names this commit. A run on a head that later moves is stale and is repeated.
- Read access to the repository at that commit. No other access is needed, and none is used.

## Actions

1. **List the claims.** Walk the plan and list every claim it takes from outside itself: spec or design ids, existing code and config (names, signatures, paths, defaults), other plans (what they build, what state they are in), and the environment (versions, intervals, limits).
2. **Check each claim at the commit.** Read the source with `git show <commit>:<path>`, never from the working tree. A claim about the environment that only a live system answers gets the mark `live check`. The pass does not run anything to answer it.
3. **Write each contradiction into `### Open Questions`.** Each entry carries three parts: the quoted source line, the plan line that makes the claim, and a severity. The entry is a checkbox question, like any other open question in the plan.
4. **List the claims found consistent.** Record every claim that was checked and found fine, and every `live check` claim, in the run record. Without this list nobody can compute a false-positive rate, and nobody can see what the pass did not look at.

## Severity scale (working draft)

| Severity | Meaning |
|---|---|
| `blocks` | A slice cannot be built as written. |
| `misleads` | The plan is wrong, but the build would notice. |
| `cosmetic` | A name or path differs. |

The words are a draft for the trial. The final scale is not decided here. Each run record notes where a flag fitted none of the three badly.

## What the pass does not do

- It runs nothing. It reads sources and marks what needs a live system.
- It does not find behaviour that only the running system shows: host reach, tooling on the build machine, missing binaries, unbuilt metrics. The plan's own live checks stay.
- It does not judge the design. A claim can match its source and still be a bad idea.
- It does not decide anything and does not edit a claim. A contradiction stays an Open Question until a person answers it.
- It adds no plan field. The run record is not a status line, and the plan carries no trace of the run except the Open Questions the pass wrote.

## After the build

When the plan's slices are built, a person fills the outcome column of the run record for each flag: `confirmed` (the build hit the defect), `refuted` (a later check showed the claim was true), or `untested` (the build gave no evidence either way). Keep `untested` separate. An untested flag is neither true nor false, and counting it as either corrupts the rate. The same pass on a plan whose build is still ahead is the only test of whether the step saves anything.

## Not decided by the trial

Which skill runs the step, the final severity words, per-plan or per-repo opt-in, and whether the approval records that the pass ran. The trial's result decides whether the second slice is built, changed or dropped.
