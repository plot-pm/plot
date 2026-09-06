## Implementation brief — an-empty-slice-is-not-finished (slice: An empty slice is not complete)

- **Plan (canonical):** `docs/plans/2026-09-05-the-slice-contract-says-what-it-reads.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/an-empty-slice-is-not-finished` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two. Two rounds; the first turned this plan from `infra` into a `bug`.

## The defect

**Two domain rules disagree about a slice with no branches, and one of the answers is wrong.**

`rules/eligible.ts:80`, the **first** test in `sliceVerdict`:

```ts
if (readings.outstanding === 0) return 'complete';
```

`rules/deliverable.ts:75`, in the same estate:

```ts
if (branches.length === 0) continue;
```

**A heading with no branches has `outstanding === 0`, so `eligible` calls it finished work.** The check sits above every other test — above the approval test, above the phase test — so nothing downstream can correct it. `deliverable` skips the same shape, which is the other reasonable answer, and the two have never been reconciled.

**THE CONSEQUENCE:** a plan reads deliverable on a heading nobody worked. A `## Slices` section can be satisfied by prose.

## Why nothing has caught it

Measured 2026-09-06 across **474 slices in 207 plans**:

```
empty slices    22   ALL on Released or Superseded plans
multi-branch    24   ALL on Released plans
active plans     0   of either shape
```

**Live in the code, dormant in the estate.** It surfaces the first time somebody writes a prose heading under `## Slices` in a plan that has not shipped — which is exactly what I did on 2026-09-06 while extending `a-lifecycle-is-enforced-by-a-test`, and the parser silently reported one fewer branch.

## The decision this slice must make aloud

**Both answers are defensible; `complete` is not one of them.**

- *Skip it* — treat the heading as prose the parser should not have reported.
- *Refuse it* — treat it as a malformed slice that should be visible.

**What it may not be is `complete`**, which asserts work finished that never existed.

**`outstanding === 0` IS THE LINE, and its position matters.** It is the first test in `sliceVerdict`, above the phase check. **A slice with zero branches and a slice whose branches all merged are not the same fact** and must stop sharing a return.

## The third site, named so it is not a surprise

`board.ts:762` also special-cases `branches.length === 0` — but it is a **different question**: it short-circuits when the whole estate has no branches. **Leave it.** Name it in the code so the next reader looking for *what does empty mean here* is not confused by finding three sites.

## What this slice does NOT do

**It does not report multi-branch slices.** `plot-reconcile-scan.sh` **section 7** already does — *"Uncut slices (a slice holds one branch — candidate /plot-reslice)"* — counting into `uncut_slices=` in the footer with a reslice hint. That was found by reading the eight open drafts together, and the slice proposing it was dropped.

**It does not rewrite any plan file.** The 22 empty and 24 multi-branch slices shipped; `git blame` stays intact.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**A test holding both rules to one answer** is the deliverable — the defect is that two rules disagree, so a test asserting only one of them proves nothing.

**22 estate slices change shape under this rule.** `pnpm run test:reconcile` holds the plan-format contract and is the gate that will notice.

## Done when

- an empty slice does not read as `complete`
- `eligible` and `deliverable` give the same answer for it
- a test holds both
- `board.ts:762` is named in a comment as a different question
- the gates above pass

## Do not

- **Do not leave `complete` as the answer.** It asserts finished work that never existed.
- **Do not add a multi-branch finding.** Section 7 already reports it.
- **Do not rewrite plan files.** 46 historical slices stay as written.
- **Do not change `board.ts:762`.** Different question; comment it and move on.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
