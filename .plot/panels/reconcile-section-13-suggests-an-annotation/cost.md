# Juror: cost

Lens: what the change spends (attention, CI, the shell-line ratchet, blast radius, footer consumers) and whether the plan states it.

## Findings

1. **The shell-line ratchet is not mentioned, and it has zero headroom.** `./scripts/check-shell-lines.sh pr` on this branch reads `15449 lines now, 15449 at merge base 6632419a4`. Every command added to `plot-reconcile-scan.sh` must be removed elsewhere in the same change (`scripts/check-shell-lines.sh:1-25`, no allowance). Option 2 is a string edit at `plot-reconcile-scan.sh:1866` and costs 0. Option 1 with the annotation read only costs about 4 to 6 commands. Option 1 with the unshipped-release case adds a `plot-sprint-release.sh` call, two `jq` reads, a version extract and a tag loop, about 10 to 15 commands, which is a copy of section 17's body at `:2213-2240`. The plan must name the offset or pick a shape that adds no lines.

2. **"Section 17 already answers" hides a process cost.** Section 17 spawns `plot-sprint-release.sh` once per sprint file (`:2219`). That script calls `plot-config.sh` three times and a node bundle; one call measured 0.62 s wall here. This checkout has 34 sprint files, so section 17 costs about 20 s already. Section 13 runs before section 17 in file order (`:1835` vs `:2210`), so reuse is not free: either a second pass of 34 spawns (about 20 s more per reconcile), or a hoisted per-sprint cache that both sections read, which moves lines rather than adding them. The plan names neither.

3. **Open Question 2 is settled by the data, and "any HTML comment" disables the section.** `/plot-approve` writes `<!-- pr: #N, branch: <b> -->` on every approved member line (`packages/domain/src/rules/sprint-annotation.ts:48`). Measured: 217 of 576 member lines across `docs/sprints/*.md` carry a comment, including all three unchecked items of the active sprint `delivery-ui-polish`. Reading any comment as "kept open" suppresses the finding for nearly every approved plan. The key must be fixed.

4. **The proposed syntax does not survive the existing writers.** `annotateSprintItem` inserts into an existing comment (`sprint-annotation.ts:59`: `<!--` becomes `<!-- pr: #N,`), so `<!-- open: r -->` becomes `<!-- pr: #N, open: r -->` after approval. `rendering.ts:277` rewrites the same comment at delivery. The read must find `open:` as a field inside the comment, not a comment that starts with `open:`. A reason that holds a comma, or an `open:` written after `branch:` without a comma, is cut by `branchPattern = /branch:[ \t]*[^,]*/` (`sprint-annotation.ts:63`). The slice's test list (annotated, unannotated, shipped-release) covers neither case.

5. **The board-impact note is overstated.** Line 19 says "the board reads neither". The board's approve and deliver controllers write the member-line comment through the domain (`packages/board/src/server/entry/approve.ts`, `workflows/rendering.ts`). The board does not parse `open:`, but it rewrites the comment that holds it. The plan's own line 47 asks only whether the board parses comment text; it must also ask whether the writers preserve an `open:` field, with a domain test.

6. **A bash read of a domain-written field is an undeclared duplicate.** The comment's field layout is a domain rule (`sprint-annotation.ts`, `rendering.ts`). `docs/shell-and-domain.md` puts a script that runs once per operator command (reconcile) on the calling side, or requires a corpus pair. The plan proposes a bash regex and names neither route.

7. **Open Question 4 is settled: no consumer reads `stale_tally=`.** `git grep stale_tally -- packages` (excluding bundles) returns 0 hits. The counter is read only by people and by the literal footer assertion at `test/reconcile/scan.test.mjs:298`. A new counter costs edits at `scan.test.mjs:298`, `plot-reconcile-scan.sh:27` (already stale: it lacks `review_bypass` and later keys), `skills/plot-reconcile/SKILL.md:192` and `:305`, for no reader. A printed `kept open:` line with no counter is sufficient.

8. **Attention cost of option 1 is real and unstated.** Each kept-open item still prints a line on every pass. With no counter, a reader cannot tell "explained" from "found" without reading section bodies, which `plot-reconcile/SKILL.md:305` forbids ("do not re-count section bodies"). This is acceptable for an advisory section, but the plan must say it.

9. **CI cost is small if the test uses a fixture repo.** The full scan over this checkout did not finish within 120 s offline. The new test must follow the existing section-13 fixture at `scan.test.mjs:1712-1720` (temp origin, few sprint files), not a scan of the real estate. The local check selects `node --test test/reconcile/scan.test.mjs`, a 6094-line file, and adds no new CI suite.

10. **Changelog and slice hedge.** The Changelog line ("reads ... or its fix hint stops naming an annotation") and the slice ("if chosen") describe two different deliverables. Each is acceptable for a Draft; both must name one shape at approval.

## Settles

- OQ2: fixed `open:` field inside the comment (finding 3, 4).
- OQ4: no counter (finding 7).
- OQ3: cost favours "annotation only", or a hoisted cache shared with section 17 (finding 1, 2).

Position: amend
