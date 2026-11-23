# Juror r2: cost

Lens: what the change spends and whether the plan is honest about it. Ran: `scripts/check-shell-lines.sh pr` (15449 now, 15449 at merge base: zero headroom, confirmed). Ran `node --test test/reconcile/scan.test.mjs`: it did not finish in 120 s (6094-line file, runs the scan), so I have no pass or fail from it. Read code and grep only beyond that.

## Round 1 findings, checked at HEAD

- Confirmed: zero shell-line headroom. The plan still states no offset (Open Points line "Cost").
- Confirmed: no consumer of `stale_tally=` under `packages/` except the literal footer assertion at `test/reconcile/scan.test.mjs:298`.
- Confirmed: duplicated rule exists. `packages/domain/src/workflows/reconcile.ts:130,328` consumes `staleTally` and `packages/board/src/server/entry/reconcile.ts:170` decodes it. The plan's line "the board reads neither" is false for the decoder. Only a domain unit test (`workflows-reconcile.test.ts:332`) exercises it; no corpus file names the tally (`corpus/` grep: only `plan-walk-cache`, unrelated). Option 1 changes what the shell calls "stale" while the domain keeps counting every item it is given, so a kept-open item would not reach the domain only if the shell omits it. That is an undeclared duplicate under `docs/shell-and-domain.md`, and a corpus test would be required.
- Confirmed (cost/estate): any HTML comment cannot be the key, because approve writes a comment on approved items.

## What round 1 missed or understated

1. Option 2 is the only shape with a measured zero cost: a string edit at `plot-reconcile-scan.sh:1866`, no lines added, no corpus pair, no domain change, no writer-preservation test. Option 1 pays in lines (offset needed), a bash read of a domain-written field (`sprint-annotation.ts` / `rendering.ts` rewrite the comment, so an `open:` field must survive approve and deliver re-runs, which needs a domain test), a corpus test, and a re-count of the footer docs. The plan's Approach section does not present these as costs, only the annotation's benefit ("costs the author one comment").
2. The plan's "recommendation: option 1" cost claim is unsupported. Its stated saving (removing a finding that recurs each pass) is also reachable by ticking the item, which `deliver.ts:248` and close step 2a already do.
3. Process cost: section 17 spawns `plot-sprint-release.sh` once per sprint file; the unshipped-release suppression would add a second pass or a hoisted cache. Round 1 estimated about 20 s on 34 sprint files; I could not reproduce a full-scan timing because the scan test exceeded 120 s.
4. Attention cost: with no counter, a kept-open line is indistinguishable from a finding without reading the body, and `skills/plot-reconcile/SKILL.md` says not to re-count section bodies. The plan does not say this.

## Question answers

(1) Contradicted: "the board reads neither"; "plot-sprint-release.sh already answers whether the release shipped"; "any HTML comment" as syntax.
(2) Blocks approval: option 1 vs 2 is still open; with option 1, the shell-line offset, the domain/corpus treatment of the duplicate, and preservation of `open:` by the writers are all undecided.
(3) Change: choose option 2 (or state the offset and corpus pair for option 1); delete the unshipped-release suppression; rewrite Changelog and slice to one outcome; correct the board-impact comment.

Position: amend
