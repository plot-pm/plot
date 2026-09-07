## Implementation brief — the-workflow-owns-the-word-phase (slice: Renaming the field every plan carries)

- **Plan (canonical):** `docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `infra/a-plan-file-says-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

**Slice 5 of five, and the last.** The other four merged: `a-plan-has-a-state` (#711), `the-workflow-has-phases`, `a-phase-names-its-work`, `a-plan-can-be-rejected` (#757). They renamed the CODE; this renames the FILES.

**IT WAITS, AND THE ANNOTATION SAYS SO.** The plan carries `<!-- waits: feature/the-scan-asks-for-the-state -->` on this branch line, so the scan reports `state: waiting` until #768 merges. **Do not start before that clears** — this rewrites 226 files and collides with anything touching them.

**A SECOND RENAME FOLLOWS THIS ONE.** Six stale `Wave.plan` / `Wave.section` comments in the board name a payload type that is now `Slice`. Sequenced after this, small enough to be its own PR. Not this slice's work; noted so nobody folds them in.

## The numbers moved — re-measure before trusting the plan

The plan says **196 plan files** and **9 sprint and story files**, and **24 files mentioning `Phase:` more than once**. Measured 2026-09-07:

| | plan says | now |
|---|---|---|
| plan files with a `Phase:` field | 196 | **226** |
| sprint + story files | 9 | **10** |
| files mentioning `Phase:` more than once | 24 | **27** |

**The estate grew while the plan waited.** Re-run the counts as your first step and put the real numbers in the PR body — a migration reporting a stale count cannot prove it touched everything.

## What this delivers

`- **Phase:**` becomes `- **State:**` in every plan file and every sprint/story file. The template, the skills that name the field, and the shell writers follow. The parser reads either; the domain writes `State:`.

## Reuse `withPhase`'s scoping — do not write a `sed`

**`workflows/rendering.ts:110` already solves the hard half.** It is confined to the `## Status` section for exactly this reason, in its own words: a plan that QUOTES a status block in its prose *"would otherwise have its illustration rewritten too, silently corrupting the very files that specify the format."*

**27 files mention `Phase:` more than once** — one of them six times. A blanket `sed` rewrites the documentation of the field it is renaming. **Reuse the rule; do not re-learn it.**

## The dual read is permanent, not scaffolding

Plot writes `State:` and reads **either**, for good. A plan file may have been written a year ago or copied from another project — a Plot that refused to read `Phase:` would be worse at its own job than the one that confused two words.

**The parser already has a two-field shape to follow.** `plot-plan-meta.sh:33` reads front matter's `status:` as primary and `phase:` as the alternate, reporting `phase_alt` so callers can flag disagreement. Read that contract before adding the bullet-form dual read: the file already answers *what if two values disagree*, and your answer must not contradict it.

## Prose is a second pass, decided per file

Leaving 27 files describing a field that no longer exists trades one wrong document for another. **A person decides each one:**

- a **delivered plan** explaining why the old format read `Phase:` is history — it stays
- a **skill or template** telling somebody what to type must say `State:`

Do this as a separate commit so a reviewer can read the mechanical rename and the judgement calls apart.

## Sprints are renamed too, on purpose

Ten sprint and story files carry `**Phase:**` with `SprintState`'s values — `Planning`, `Committed`, `Active`, `Closed`. A sprint has a **state** for the same reason a plan does: it is an artefact Plot writes, so Plot records what it did to it.

**Assert: `plot-sprint-release.sh` reads a renamed sprint unchanged.**

## The assertions this slice owes

- **Every existing plan still parses, byte-for-byte identically.** Parse the whole plan directory before and after; **zero** differences in the JSON `plot-plan-meta.sh` emits.
- **A file carrying `Phase:` still parses**, because the dual read is permanent.
- **`plot-sprint-release.sh` reads a renamed sprint unchanged.**
- **The board renders identically** — its wire key is not this field.

## Watch for

**The scan reads plans from `origin/main`, not the working tree.** An annotation or a field change is invisible to the fleet until pushed. Measured 2026-09-07: a `waits:` annotation read `open` locally until the push, then `waiting`.

**Corpus tests compare the domain against production over the LIVE estate.** A 226-file rewrite moves what they read. A corpus failure naming a plan file you touched is expected mid-migration; a persistent one after main settles is not. Measured 2026-09-07: a plan edit pushed **31 seconds** before a corpus run made it fail, and the identical commit passed on rerun.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile    # the plan-format contract — THE one that matters here
pnpm run typecheck
pnpm run test:board
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one.

## Done when

- Every plan file and every sprint/story file says `State:`.
- The template, the skills naming the field, and the shell writers follow.
- The parser reads `Phase:` and `State:` alike, permanently.
- Every existing plan parses byte-for-byte identically, asserted over the whole directory.
- The prose pass is a separate commit with a per-file decision.
- The PR body carries the **re-measured** counts, not the plan's.
