# Round 1 — moderation

Subject: `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` at `acb9d2bda` (Draft).
Lenses: estate, contradiction, deliverable, cost. Commitment: `Position: proceed|amend|reject`.
Siblings: 10 read, 0 unread (every unfinished plan; the 6 open members of sprint `the-fleet-runs-through-its-limits` are among them).

Gate: `plot-panel.mjs check` exit 0 for all four. Reconcile: `unanimous amend estate,contradiction,deliverable,cost`.

## What each juror looked at

- **Estate** read the domain rules and the four hooks, and searched the estate. It ran the line, function and history counts.
- **Contradiction** read `docs/shell-and-domain.md`, the manifesto, `hooks/hooks.json`, the plot-init hooks contract and the sibling plans' slice lines. It ran `gh pr view 1244` and the counts.
- **Deliverable** ran `plot-plan-meta.sh` on the plan and checked the four branch names against origin. It ran no timings.
- **Cost** is the only juror that measured runtime: process starts, the four hooks warm and cold, and 85 shell-touching commits on main with their line deltas. It also counted the open PRs.

## Findings held by more than one juror

These are the amendments the panel agrees on. Each is backed by at least two independent readings.

1. **Slice 3 needs a no-`node` fast path** (estate, contradiction, cost). The hook runs on every Bash call of every session, fleet agents included. The token loop sits before the desk exemption. Today the gate costs 19–21 ms, and one bundle start adds 27–52 ms. The same file already sets the shape at `plot-controller-gate.sh:159`: a `case` substring test for the three basenames runs before any `node` start. That test only skips work, so it decides nothing.
2. **Slice 3 must name its failure direction** (contradiction, cost). `trap 'exit 0' ERR` makes a missing bundle switch the gate off with no message. `docs/shell-and-domain.md` §1 says a rule that cannot be asked refuses. The plan says "exactly as strict" and does not choose between the two.
3. **Slice 3 must reuse `rules/ci-suite.ts`** (estate). `withoutQuotes`, `programWords` and `ciSuiteRefusal` already split a command and tell RUN from mention, and the same hook asks them at `:184`. One juror found this and no other contradicted it. Three more hooks expand globs the same way: `plot-phase-gate.sh:92`, `plot-state-gate.sh:87` and `plot-brief-name-gate.sh:127`. So #1245 ends for one hook of four unless the slice covers the shared reading.
4. **The ratchet refuses approved work and names none of it** (estate, contradiction, cost). Five Approved siblings edit `plot-dispatch.sh` or `plot-worker-loop.sh`, and both open shell PRs would be refused: #1234 (+37) and #1244 (+19). On main over 14 days, 76 of 85 shell-touching commits grew the count. The plan must say who pays: an offset in the same PR, a baseline taken after the in-flight work lands, or a named and counted override.
5. **The ratchet's shape** (contradiction, deliverable, cost):
   - It cites the wrong precedent. `check-helper-table.sh` has slack and an env override (`PLOT_HELPER_ROW_BASELINE`). The slack-free precedent is `check-script-names.sh` with its allowance test.
   - A stored baseline makes concurrent shrinking PRs conflict on one line.
   - Cost proposes comparing against the merge base (`count(HEAD) <= count(merge-base)`). It stores nothing, refuses the same growth, and needs no bookkeeping. CI already fetches full history.
6. **The cost rule's duplicate row and the ratchet contradict each other** (contradiction, cost). `docs/shell-and-domain.md` §1 tells a per-pass call site to duplicate in shell, and §2 allows heredoc seams. The ratchet charges both. The plan says the cost rule "stays" and does not state this price.
7. **Slice 4 against `a-branch-carries-no-built-bundle`** (estate, contradiction, cost). Under that Approved sibling, `main` holds a launcher 3–5 minutes before it holds its bundle. The plan must order slice 4 against the sibling and say what the launcher does when its bundle is absent. `plot-release-gate.sh:30–33` already refuses with exit 2 and names the build command, so it is the template.
8. **The inventory duplicates a gated table** (estate, cost). `skills/plot/scripts/README.md` holds one row per script, and `check-helper-table.sh` gates it. A second hand-written per-script file goes stale at about 255 code lines a day. Its measured columns should join the gated table, or a script should generate them.
9. **Slice 4 names no deliverable, and "further slices by amendment" has no lifecycle path** (deliverable, cost). After slice 4 merges, the plan delivers, and a slice added to a Delivered plan needs `/plot-reject`. Slice 2's ranking metric ("decision lines") has no counting command. The fix: slice 4 picks the first-ranked script that runs once per operator command, and slice 2 writes that script's name into the plan. Each later script becomes its own plan.

## Findings held by one juror

- **The Notes contradict the sibling** (contradiction). The sibling's slice line still reads `builds: a file-changing unpushed reading in plot-worker-loop.sh`, and #1244 still carries `plot-empty-claim.sh`. Moving that reading into a bundle is a per-pass call site, so it needs the per-call-site argument from §1.
- **The count misses shipped shell** (estate). `skills/ralph-plot-sprint/ralph-sprint.sh` holds 347 code lines, agents run it, and the ratchet does not see it.
- **The Changelog omits the contract change** (deliverable). Slice 2 amends `CLAUDE.md` and `docs/shell-and-domain.md`, and the Changelog says nothing about that.
- **Two Motivation numbers are wrong** (estate, cost, on the same numbers):
  - The 2026-09-01 count is 6,904, not 6,876, measured at `91a89d95b`.
  - The function count is 509–515 by cost's regex. Estate reproduced 481 with a top-level-only regex. The plan must name the regex.

## No disagreement, and what the four lenses shared

The panel is unanimous, so there is no disagreement to name. Every `amend` names concrete text to change, and no juror called a finding fatal.

**The shared blind spot: all four read the plan's slices, and none asked whether the slices move the number.** Slices 1–3 remove close to nothing. Slice 4 moves one script. The plan sets a ceiling and names no descent, with no target and no rate. The five largest scripts hold 6,930 of 15,024 code lines (46 %): `plot-host.sh` 1,737, `plot-dispatch.sh` 1,651, `plot-fleet-scan.sh` 1,412, `plot-reconcile-scan.sh` 1,269 and `plot-worker-loop.sh` 861. The first is the connector, which the Layering Rule treats as its own kind of adapter. The next three run per pass or per scan, and the last is the loop the cost rule names. So the inventory's likely top-ranked script for slice 4 is a small operator command. The scripts that hold the mass are exactly the ones the plan's Open Questions leave undecided. A plan whose direction is "the shell shrinks" should state either what share it moves, or that it only stops the growth and that the large scripts get their own plans.

**A second shared assumption:** all four jurors accepted code lines as the measure. A line ratchet counts size, not decisions. A rule moved into a `node -e` heredoc inside a script, which §2 allows, lowers nothing. A decision kept in shell behind a smaller function passes the gate. No juror tested the metric against the direction it serves ("decisions go to the domain").

## For the caller

Unanimous `amend`, so nothing blocks approval once the plan is amended. Before `/plot-approve`, the amendment should cover items 1–9 above and say one sentence about the shared blind spot.
