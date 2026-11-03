# Seams juror — plot-approve-reads-the-plan-from

Position: amend

Read on `origin/main` at `ee678d5c8`. Plan PR #3097, issue #3093.

## Rubric

1. **Fix and sprint.** The approach removes the defect #3093 names: the named route (`idea/<slug>`) and `remotePlanOf` read different PRs. A reader verifies it with the named test: two open PRs change one plan, one on `idea/<slug>`, the copies differ in `Review:`; after the fix the approval judges the `idea/<slug>` copy or refuses. It moves the sprint goal only a little: no fleet path reaches this today except a person's approval with two open PRs for one slug.
2. **Claims.** The cited lines hold on `ee678d5c8`: `remotePlanOf` reads `first.pr.headSha` at `packages/board/src/server/entry/approve.ts:452-457`; `planPrOf` returns the named PR with `rivals: []` at `packages/domain/src/rules/plan-pr.ts:205-219`; the controller takes that answer at `approve.ts:934-945`; `pr-ambiguous` is at `packages/domain/src/workflows/approve.ts:325-333`; `needs-design.ts:393-397` and `:232` hold as stated. One claim is false: Approach step 1 says "`remotePlanOf` and the `needs-design` read both ask the same rule". `needs-design.ts:225-238` holds its OWN board-local `planPrOf`, a different function with the same name as the domain's. It returns the named PR only when it is `OPEN`, then the first carrying PR, then a named `CLOSED`/`MERGED` PR. It never calls `rules/plan-pr.ts`'s `planPrOf`, and it has no `rivals`. Step 3 names only `rules/plan-pr.ts` and `workflows/approve.ts`; the needs-design half has no domain home in the plan.
3. **Breaks and half-done.** See the seams below: the sibling plan's files, the named-route fetch, the needs-design refusal, docs, changeset, sprint line.
4. **Failure modes.** The named PR's head commit may not be in the local object store: the named route never fetches (`readPlanPr`, `approve.ts:262-277`, reads `pr-state` only; only `openPrsOf` fetches, `:342-362`). Reading the plan at an unheld sha makes `readPlanAt` (`:304-318`) return `undefined`, which the workflow reports as `plan-unparseable` — a wrong name. A named `idea/<slug>` PR that does not change the plan file at all (the plan lives on a batch PR) also reads `undefined`. Each needs its own named refusal.
5. **Unattended build.** A Sonnet agent cannot build the slice from the plan alone: the three open questions are the design, and Approach steps 1 and 2 already contradict Q1 (step 1 is "reorder", step 2 is "compare").
6. **Tests.** The one named test covers `approve.ts` only. No test covers needs-design or the domain rule.

## Seams

### S1 — overlap with `plot-approve-finds-no-plan-on` (HIGH)

That plan is Approved and Started on `origin/main` (`d347e346f`); its branch `bug/plot-approve-finds-no-plan-on` is not on the remote yet (`git ls-remote origin` shows only `idea/plot-approve-reads-the-plan-from`), so the fleet can hand it to an agent at any moment. Its slice edits every file this plan touches:

- it moves `openPrsOf` and `holdsCommit` out of `approve.ts:320-362` and `needs-design.ts:163-201` into a new `packages/board/src/server/entry/open-prs.ts`;
- it changes `OpenPr.headSha` to the full sha that `holdsCommit` resolves;
- it changes the merged-route comparison in `plan-pr.ts:241` to a prefix match;
- it adds named unread rows to the `plan-not-found` text in `approve.ts:546` and `needs-design.ts:428`.

This plan rewrites `remotePlanOf` (`approve.ts:441-459`, directly below the moved block), the needs-design read (`needs-design.ts:393-397`) and `planPrOf` (`plan-pr.ts:205-250`). Run in parallel, the two branches conflict in three files, and this plan's line numbers go stale the day the sibling merges. The slice must carry `<!-- waits: bug/plot-approve-finds-no-plan-on -->`, and its design must name `open-prs.ts` as the place the shared read lives.

There is a second, semantic dependency. On Bitbucket the named route's `headSha` comes from `pr-state`, a 12-hex short hash (`plot-host.sh:2221`, `bb_state_row`). The sibling resolves short hashes to full ones only inside the open-PR lookup. A read "from the head of the PR that `planPrOf` names" must take the same path: fetch `idea/<slug>`, resolve `<sha>^{commit}`, and use the full sha for `readPlanAt` and for the merge pin. Without the sibling's helper this plan would write a second copy of it.

### S2 — needs-design has no rule, no refusal and no test (HIGH)

- `packages/domain/src/workflows/needs-design.ts:42` lists the refusals; none covers rival PRs. A `pr-copies-differ` refusal in needs-design needs a new reason there, and the plan does not name that file.
- `needs-design.ts` (board) writes onto `origin/<head>` as fetched in `bookOnPlanPr` (`needs-design.ts:~495-505`), not onto a listed head sha. `writePlan` re-reads the text inside the booking worktree, so the WRITTEN copy is always the branch tip; only the judgement (`phase`, `review`, `impl`, `spec`) comes from the read. The consistent fix there is to read the gating record from `origin/<head>` after that fetch — the same ref the write checks out — not from a listed sha.
- The two board-local functions named `planPrOf` (domain `rules/plan-pr.ts` and `needs-design.ts:225`) disagree on the named route: the domain one takes the named PR in any state, the needs-design one only when `OPEN`. Sharing "the same rule" (Q3) changes needs-design behaviour unless the plan says which semantics win.
- Add a case to `packages/board/test/unit/needs-design-route.test.ts` with the same two-PR fixture.

### S3 — docs that describe plan-PR resolution (MEDIUM)

- `skills/plot-approve/SKILL.md:271` describes the plan-PR order and says "Two open PRs that both change the plan file are refused, before any merge." After this change that sentence is either still true for the open route only, or extended to the named route (Q2). It must state which.
- `skills/plot-approve/SKILL.md:397` lists the refusals; a new `pr-copies-differ` (or whatever name) belongs there.
- `skills/plot/scripts/README.md:34` says "A plan absent from the checkout is read from `origin/<main>` or from that PR's head" — "that PR" is today the first carrying PR. It must name the plan PR.
- `skills/plot/scripts/README.md:77` (`board/plot-needs-design.mjs`) says the move lands on "the open plan PR's head branch"; it should say the record is read from the same branch.
- A `SKILL.md` edit requires a `plot-approve` bump in the changeset.

### S4 — changeset and Files list absent (MEDIUM)

The plan carries no changeset and no `Files:` list, while its sibling carries both. An unattended agent then picks the package set and the bumps itself. Required: `'plot': patch`, `'@plot-pm/board': patch` (both controllers), and `'@plot-pm/domain'` only if `check-changeset-packages.sh` admits it — CLAUDE.md says the package must be `plot` or `@plot-pm/board`, so domain changes ride under those. Bumps: `plot-approve: patch` (SKILL.md), `plot: patch`. Description first, the `plan:`/`bumps:` block last.

### S5 — Bitbucket arm (LOW, settled by S1)

The plan says Bitbucket reaches the path once #3089's fix lands. That is true for the open route only. The named route reaches Bitbucket today: `pr-state idea/<slug>` already returns a head on Bitbucket. What blocks the split on Bitbucket today is `remotePlanOf`'s open read, which drops every plain row. After the sibling merges both halves are live, so the waits annotation also fixes the order of exposure.

### S6 — the in-checkout split stays (LOW, name it out of scope)

`approve.ts:885-888` reads the plan from the checkout when the checkout holds it, then merges the named PR. Run from an `idea/<slug>` worktree with unpushed edits, the same split happens between the working copy and the PR head. The plan should state this is out of scope, or extend the rule to it.

### S7 — sprint line (LOW)

The plan names `Sprint: follow-ups-2-30-1`, and `docs/sprints/2026-W45-follow-ups-2-30-1.md` holds no line for `plot-approve-reads-the-plan-from` on `origin/main` or on the idea branch (`git diff origin/main...HEAD` touches only the plan and its active symlink). The sprint line belongs in the same change.

### Shell ratchet and bash 3.2

The change is TypeScript only; `plot-host.sh` is not touched. `check-shell-lines.sh` and `check-bash32-syntax.sh` are unaffected.

## The three open questions, settled from the code

- **Q1 — reorder.** Read the plan PR first, then its head. On the open route `planPrOf` already picks the first carrying PR, which is the PR `remotePlanOf` reads today, so no split exists there. The split exists only on the named route, and reordering removes it by construction. Comparing two copies keeps two reads, and on the named route the second read has no PR to merge, so it reports a rival rather than gating the merge. Drop Approach step 2 as written, or restate it as Q2's answer.
- **Q2 — a rival beside `idea/<slug>` stays allowed.** The `pr-ambiguous` comment (`workflows/approve.ts:325-326`) gives the reason for the refusal: the choice would follow "whichever the host listed first". The named route does not depend on listing order, and after the reorder the gating record is the merged copy. So the named route keeps `rivals: []`. If the panel wants the rival reported, it is a warning line in the step output, not a refusal; that is the only part that needs a person.
- **Q3 — share the read, not the choice.** Put one function in the sibling's `open-prs.ts` that takes a chosen PR (number, head branch, head sha) and returns the plan record read at its fetched, resolved head, and its refusal on an unheld head or an absent file. Both controllers call it. Each controller keeps its own choice of PR, because the two `planPrOf` functions answer different questions (approve may merge a MERGED PR's record; needs-design writes only to an OPEN one). Rename the board-local `needs-design.ts:225` function (for example `needsDesignPrOf`) so the name stops implying the domain rule.

## Required amendments

1. Add `<!-- waits: bug/plot-approve-finds-no-plan-on -->` to the slice, and rebase the design on `open-prs.ts` and the full-sha `OpenPr.headSha`.
2. Settle Q1–Q3 in the plan as above (or as the person decides Q2's warning), and remove the step 1 / step 2 contradiction.
3. State the named-route read: fetch `idea/<slug>`, resolve the head to a full sha, read the plan there; name the refusals for an unheld head and for a named PR that does not change the plan file.
4. Name the needs-design changes: read at `origin/<head>` after the fetch in `bookOnPlanPr`, and either a new reason in `packages/domain/src/workflows/needs-design.ts` or a statement that needs-design needs none after the reorder.
5. Add a `Files:` list, the changeset (description first, `plan:`/`bumps:` last, `plot-approve: patch`), the doc edits in S3, and a `needs-design-route.test.ts` case.
6. Add the sprint line for this slug to `docs/sprints/2026-W45-follow-ups-2-30-1.md` in the plan PR.

## Decisions that need a person

- Whether a rival open PR beside `idea/<slug>` is reported as a warning, silently allowed, or refused (Q2). The code supports "allowed"; the safety cost of a later conflicting merge is a judgement.

## What I ran versus read

Ran: `git fetch`, `git ls-remote origin`, `git show origin/main:<file>` for `approve.ts`, `needs-design.ts` (board and domain), `rules/plan-pr.ts`, `workflows/approve.ts`, `plot-host.sh`, the sibling plan and the sprint file; `git grep` over `skills/` and `docs/` for plan-PR wording; `git worktree list`, `git branch -a`, `git diff origin/main...HEAD --stat` in the idea worktree; `gh issue view 3093`; `gh pr list --search`. Read only: the test fixtures in `approve.test.ts` (by grep). I ran no test suite and no host write.
