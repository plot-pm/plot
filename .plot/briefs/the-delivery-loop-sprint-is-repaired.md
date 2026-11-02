## Implementation brief — a-plan-that-joins-a-sprint (wave 5: Repair)

- **Plan (canonical):** docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Branch:** `bug/the-delivery-loop-sprint-is-repaired` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (see `## Plot Config` — plot-review required)

This is the last wave of the plan. It waits on `feature/approve-and-deliver-find-the-sprint-by-rule` (PR #3005) and `feature/a-plan-joins-a-sprint-through-one-command` (PR #3013) — both confirmed merged. Nothing else in the plan depends on this branch.

### What to build

Run the now-merged `plot-sprint-member.mjs add delivery-loop <slug> --tier should` for each of the three Should Have plans in `docs/sprints/2026-W44-delivery-loop.md` that are already listed and already name the sprint but are missing the bookkeeping their current state owes, and commit the result through the writer:

- `the-plan-walk-moves-into-the` (plan PR #2981) — Approved → needs the annotation (plan PR + first branch) on its member line.
- `the-commit-gates-match-only-the` (plan PR #2984) — Delivered at `251b2abfc` with no `Sprint:` line at delivery time (field later filled by hand at `b3e145659`) — needs annotation **and** its member line ticked `- [x]` (currently `- [ ]` on `origin/main`).
- `every-plan-reference-shows-its-issue` (plan PR #2994) — Approved → needs the annotation.

Each of these three plans is already correctly listed on a Should Have line and already carries `- **Sprint:** delivery-loop` in its own `## Status` — this slice does not add membership, it repairs the annotation/tick bookkeeping that approve/deliver skipped before their rule-based fix (wave 2) existed. Running `add` with the plan already on the matching tier is specified to be a no-op on placement and only fills in what the plan's current state (Approved → annotate; Delivered → annotate + tick) owes.

### Decisions the plan settles — do not re-derive them

**Use the writer, not a hand edit.** The whole point of this repair slice, per the plan's Approach ("The current sprint is repaired through the new code"), is to prove the new writer on the live drift it was built to fix. Editing `docs/sprints/2026-W44-delivery-loop.md` by hand defeats the purpose and is exactly the kind of edit the new gate (wave 4, already merged) now refuses at commit time for any *added or moved* member line — though these three are neither added nor moved (already correctly tiered), so the gate itself won't catch a hand edit here. Use `plot-sprint-member.mjs add` anyway, because the brief's job is to prevent re-deriving a decision already made, not just to avoid a gate refusal.

**Why `add` and not a manual annotation/tick.** The annotation inputs (plan PR from the `Approved:` record, first branch from `## Slices`) and the tick logic are the exact mechanism `annotateSprintItem`/`tickSprintItem` (wave 3) implement against `memberLineIndex`, scoped to edit only the member line — not the `### Scope Changes` log, not other lines containing the slug. A hand edit risks touching the wrong line (the plan's Motivation section measured this exact bug: `f57425ec0` ticked the wrong sprint's Deferred line because old code did a first-match text search). Calling the writer sidesteps that whole failure class by construction.

**Scope is one file.** The plan's Repair slice description is explicit: "Touches only `docs/sprints/2026-W44-delivery-loop.md`." The writer's per-plan `add` call touches that sprint file and the named plan's own file each time — but since all three plans already hold the correct `- **Sprint:** delivery-loop` field, the plan-file write for each should be a no-op (writer re-runs with no change are specified to exit 0 and change nothing, per the Writer slice's "a re-run is a no-op" done-when row). Verify this after running: `git status --porcelain` should show only the sprint file touched, or confirm via the writer's own commit diff (`git show --stat`) that only the sprint file and already-correct plan files appear with no byte diff on the plan files.

**This plan (`a-plan-that-joins-a-sprint`) already lists itself in `delivery-loop`.** Checked on `origin/main`: line 37 of the sprint file already carries `[a-plan-that-joins-a-sprint] ... <!-- pr: #3000 -->` — the plan-PR annotation a Draft/Approved plan gets when it joins, not an impl-branch annotation. No further action needed for this plan's own entry; the Repair slice's scope is the three Should Have plans named above.

**Known invariant carried over:** absent is not false — if the writer refuses (e.g. `not-a-member` because a plan turns out not to be tiered the way the plan text assumes), that is a report to act on, not a signal to fall back to a hand edit.

### Done when

The plan's `## Done when` table row for this slice is the specification: "The current sprint is repaired | `add delivery-loop <slug> --tier should` for the three Should Have plans | three annotations (#2981, #2984, #2994); `the-commit-gates-match-only-the` is `- [x]`; the commit passes the gate | the repair commit's diff | Repair".

Concretely:
- All three plans' member lines in `docs/sprints/2026-W44-delivery-loop.md` carry the `<!-- pr:, branch: -->`-style annotation with their plan PR (#2981, #2984, #2994 respectively) and first branch.
- `the-commit-gates-match-only-the`'s line reads `- [x]` (ticked), the other two stay `- [ ]` (Approved, not Delivered).
- The commit(s) pass `sprint-member` gate (`plot-gates.sh` at commit time) — expected to pass cleanly since these are annotation/tick writes, not added-or-moved member lines.
- `git show --stat` on each writer commit lists only the sprint file and (if genuinely unchanged) no diff noise on the plan files.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this slice touches `docs/sprints/**` and the writer bundle only if something is amiss, so expect it to print little to nothing beyond the always-on gate scripts. The suites named in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite locally.

No `.sh` file is touched by this slice as specified (only `docs/sprints/2026-W44-delivery-loop.md` changes), so `scripts/check-shell-lines.sh` is not expected to be a factor — confirm the diff stays that narrow.

### Bookkeeping

Open the PR through the controller once a commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it does not read the plan or title the PR from the wave heading. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Repair` heading.

### Scope guard

This branch owns `docs/sprints/2026-W44-delivery-loop.md` only. No other open branch in this plan touches sprint files — all four prior waves (Membership rule, Approve and deliver, Writer, Gate) are merged, and this is the plan's last slice. The plan's own `### Seams` note names overlaps with `every-plan-reference-shows-its-issue` in `.github/workflows/ci.yml` and `schema.ts`, but those are other plans' branches, already merged independently, and do not intersect this slice's one-file scope.

If you find something the plan did not anticipate — e.g. a fourth plan now drifted, or the sprint file's current state disagrees with what the plan describes — report it rather than improvising outside scope.
