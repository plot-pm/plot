# Round 2, deliverable lens: reconcile-section-13-suggests-an-annotation

Position: amend

Evidence: read. I ran `node --test test/reconcile/scan.test.mjs --test-name-pattern='section 13'`; it hit the 2-minute tool timeout with no output, so no measurement came from it. Everything below is read from code at HEAD.

## Round 1 findings, checked

- **Confirmed: the Changelog and the slice name different deliverables.** Plan line 18 covers "reads an annotation, or its fix hint stops naming one" (both options). The slice (line 61) and its branch `feature/reconcile-13-reads-open-annotation` build option 1 only, with "(and the unshipped-release case, if chosen)". The slice cannot ship until Open Question 1 is answered, because its name and test list depend on it.
- **Confirmed: the section has two header comments.** Line 113 (file index, "13. Stale sprint tally") and line 1809 (section body comment, headed "11. Stale sprint tally"). The numbers disagree: the echo at line 1835 says 13, and line 1986 has a second "13. Stale interrogation rounds". A slice that "updates the section's header comment" must name which. New finding: the body comment at 1809 is stale-numbered, so a grep for "13." finds the wrong block.
- **Confirmed: `any HTML comment` is unworkable.** `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts:44-48`) writes `<!-- pr: #N, branch: x -->` on member lines. Its `branchPattern = /branch:[ \t]*[^,]*/` (line ~64) stops only at a comma, so an `open: <reason>` placed after `branch:` without a comma is swallowed or rewritten by a later approve. Order and delimiter must be fixed in the plan, and a test must run approve over an annotated line (round 1's blind spot, still unmeasured).
- **Confirmed: the footer test pins the literal summary.** `test/reconcile/scan.test.mjs:298` asserts the whole footer string. A new counter edits that line; no counter edits nothing. Section 13's own test (lines ~1700-1870) asserts `stale_tally=2` twice (counter test and CLOSED-sprint test), so these two must stay green with the new item added or be split to a separate fixture.
- **Round 1 on the domain rule: confirmed, with a limit.** `packages/domain/src/workflows/reconcile.ts:125-130` holds `staleTally` and `sprint-tally-stale`; `packages/board/src/server/entry/reconcile.ts:170` decodes it; `packages/domain/test/workflows-reconcile.test.ts:31,332` use it. The plan's line 20 "the board reads neither" is wrong about `staleTally`. I did not trace whether the scan ever feeds that field (the grep shows `stale_tally` only in the footer), so it may be dead on the producer side. The plan must say which.

## What round 1 missed (deliverable)

1. **Test plan is not buildable as named.** The slice says "covering annotated, unannotated and shipped-release items". Missing cases that follow from the plan's own constraints:
   - a kept-open item on a CLOSED sprint (section 13 covers Closed; section 17 skips them);
   - an approved item with only a `pr:`/`branch:` comment, which must stay a finding (the regression that kills "any comment");
   - an annotated item whose sprint release has shipped, which the plan says stays a finding (line 46);
   - a plan listed in two waves (dedupe via `seen_stale_in_sprint`, line ~1851): the kept-open line prints once;
   - an annotation with an empty reason, and one with `-->` in the reason;
   - approve re-run over an annotated line preserves the `open:` field.
2. **The fixture is expensive.** The existing section-13 fixture builds a bare origin, clone and commit per `before()`, and the scan walked slowly enough that a filtered run exceeded 2 minutes here. Adding cases to that shared fixture slows every section-13 test; the plan should say whether the new cases join it or get their own file.
3. **One-branch buildability fails only through the shell-line ratchet.** `scripts/check-shell-lines.sh pr` counts commands and allows no growth. The slice adds a parse, a print and a branch to the loop at lines 1853-1870. The plan states no shell lines to remove, so the branch cannot pass CI as written. Either move the read to a bundle (the shell-and-domain doc's allowed seam) or name the offsetting deletion.
4. **Docs are not in the slice.** `skills/plot-reconcile/SKILL.md` and its README do not mention section 13 or `stale_tally` (grep found nothing), so no doc edit is owed. The scan's header comment at line 27 holds the summary example; it changes only if a counter is added.
5. **No changeset is named.** The slice touches a skill-shipped script; the repo requires a changeset with `bumps:` last. The plan does not say it ships one.
6. **Issue number.** The plan names "Related: #3489" as consumer-side; in this repo it is a different plan. Confirmed round 1.

## Questions

1. Contradicted by code: line 20 "the board reads neither" (`staleTally` is decoded at `entry/reconcile.ts:170`); line 28 "Section 17 already knows whether the sprint's release shipped" (the tag lookup is the scan's own loop, and Closed sprints are skipped).
2. Blocks approval: Open Question 1 (option 1 or 2). The Changelog and the slice cannot be rewritten before it, and the shell-line offset depends on it.
3. Changes before approval: choose option 2 or a fixed `open: <reason>` field with its delimiter; write one Changelog line and one slice for that choice; list the six test cases above; name the shell-line offset or the bundle seam; name both header comments; state whether `staleTally` in the domain is dead or updated; correct the #3489 reference; add the changeset.
