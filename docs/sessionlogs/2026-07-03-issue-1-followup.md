# Issue #1 follow-up — the 3 remaining points

**Date:** 2026-07-03
**Scope:** Close the still-unaddressed points in [plot-pm/plot#1](https://github.com/plot-pm/plot/issues/1) "Plot workflow improvements"
**Branch:** `worktree-plot-issue-1-followup`
**PR:** [plot-pm/plot#29](https://github.com/plot-pm/plot/pull/29) — open, mergeable
**Plugin version bump:** `1.4.0` → `1.5.0` (queued in changeset)

## What

Issue #1 lists 7 workflow improvements observed while using plot in real projects. Before touching anything, audited each point against `main`. Four were already addressed by prior PRs (points 3, 4, 5, 7); three remained (1, 2, 6). Fixed those three in one PR.

Concrete changes:
- **Point 2** (`skills/plot-approve/SKILL.md`) — `plot-update-board.sh` call now passes `"In Progress"` instead of `"Ready"` when an impl PR is added to the project board.
- **Point 1** (`skills/plot-approve/SKILL.md` + `skills/plot/SKILL.md`) — plot-approve's *printed* Suggested next actions now spells out `gh pr ready <number>`; the dispatcher's `Detect Issues` step splits the old single "stale drafts (>7d)" heuristic into **Completed drafts** (draft with real commits → suggest `gh pr ready`) and **Abandoned drafts** (idle >7d → cleanup).
- **Point 6** (`skills/plot-release/SKILL.md`) — step 4 renamed from "Recommended Next Steps" to **"Hand-off to Project Release Process"**; step 6 summary no longer frames version bump / tag / push as plot's responsibility.

Plus a changeset (`.changeset/plot-issue-1-followup.md`) with a `bumps:` block declaring the per-skill semver deltas.

## Audit table

| # | Point | Verdict | Evidence line |
|---|---|---|---|
| 1 | Mark impl PR ready after work | partial → fixed | plot-deliver:97 caught it late; nothing prompted at completion time |
| 2 | Move PR to "In Progress" on board | unaddressed → fixed | plot-approve:224 said `"Ready"` |
| 3 | plot-idea sets wrong plan type | already done | plot-idea:104-113 always asks the user |
| 4 | plot-approve should not squash-merge | already done | plot-approve:107 uses `--merge`; line 112 documents choice |
| 5 | Archiving plans breaks links | already done | plot-deliver uses symlinks; plan path is stable |
| 6 | plot-release owns the release | partial → fixed | Old step 4 listed mechanics as plot's own workflow |
| 7 | Duplicate/overlap detection | already done | plot-idea:83 + plot-approve:167 + plot:448 |

## Non-obvious decisions

| Decision | Choice | Why |
|----------|--------|-----|
| One PR or dogfood `/plot-idea`? | Direct PR | Three files, ~50 LOC of prose edits. Meta cost of ideating on the plot repo about a plot fix wasn't worth it. |
| Hand-bump SKILL.md versions? | **No** — reverted | Discovered `.dev/scripts/bump-skill-versions.sh` parses the `bumps:` HTML comment in the changeset at release time. Authoring-time bumps would create merge conflicts on every touch. |
| Point 1 guidance placement | Inline in printed **Suggested next actions**, not in an appendix | First draft put "Finishing an impl branch" as a section after step 8. Advisor caught the reach problem: the agent leaves plot-approve's context after fan-out and later reads only what was printed to chat, not appendices. Moved the `gh pr ready` step into the printed action list. |

## Verification

- `pnpm install && pnpm test` → exit 0; all 11 skills parse.
- `git push` to stale `origin` (`eins78/plot.git`) succeeded via GitHub's transfer redirect to `plot-pm/plot`. Passing `--repo plot-pm/plot` to `gh pr create` was still needed because `gh` reads the git remote for target detection.
- Behavioral testing is manual per project CLAUDE.md — checklist deferred to reviewer, listed in PR body.

## Deliberately left alone

Point 7's plot-approve half is narrower than #1 requested (branch-name conflict detection, not semantic plan overlap). The plot-idea pre-flight check and dispatcher flag cover the "caught before it becomes a mess" case that motivated the issue. Not reopening.
