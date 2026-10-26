# Implement leaves its brief and plan edits uncommitted in the main checkout

> `/api/implement` commits the brief and the Started record to `origin/main`, and also leaves the same two files uncommitted in the main checkout, which blocks the fast-forward that would make the brief visible to fleetd.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2725
- **Rounds:** 1
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/api/implement` leaves the main checkout clean or fast-forwarded, so fleetd reads the new brief on its next tick without an operator step.

<!-- Board impact: none expected. The board reads briefs from the main checkout through fleetd; no change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

Observed three times on 2026-10-26:

- `d315381c6` (brief for `pr-reader-lock-elects-one-writer`): the main checkout kept a modified plan file and an untracked `.plot/briefs/pr-reader-lock-elects-one-writer.md`. A later `git pull` autostash conflicted on the plan's `Started:` lines.
- `cc5c7a1d5` (brief for `nothing-done-asks-pr-state-only-where-it-decides`): the main checkout stayed 21 commits behind `origin/main` with an untracked brief. fleetd's tick read `no-brief=1 handed=0` for the briefed slice until an operator fast-forwarded the checkout by hand.
- `8a714dee7` (brief for `fleet-start-probes-worker-writes`): the modified plan and the untracked brief were byte-identical to `origin/main`, and `git merge --ff-only origin/main` refused until they were removed.

The implement agent's log states the cause: the controller gate blocks git writes in the main checkout while `PLOT_UNATTENDED=1`. The agent commits from a temporary worktree, pushes, and copies the two files into the main checkout. No step then updates the main checkout, and the copies block the only update that would.

## Design

### Approach

The fix targets the end state: after `/api/implement` finishes, the main checkout is either fast-forwarded to the commit that holds the brief, or untouched and clean so a fast-forward succeeds.

Candidate designs, to be settled in the Open Questions:

1. **Stop copying.** The agent commits and pushes from the temporary worktree and writes nothing into the main checkout. fleetd then needs the main checkout to advance by another route (option 2) or to read briefs from the ref.
2. **Fast-forward after the push.** A step after the push runs `git merge --ff-only origin/main` in the main checkout through a controller the gate allows, and refuses by name when the checkout is dirty or diverged.
3. **Read the ref.** fleetd reads briefs from `origin/main` instead of the checkout, as `the-board-reads-the-ref-not-the-checkout` does for the board.

Per CLAUDE.md, the step belongs in a controller the domain owns, not in skill prose: the gate that blocks the agent's git writes is the reason the copy exists, so the repair must not route around it.

### Open Questions

- [ ] Which of the three designs does the repo want? Option 3 removes the dependency on checkout state, but changes how fleetd finds briefs.
- [ ] Where does the fast-forward run if the main checkout holds unrelated uncommitted work — refuse and name the files, or skip silently?
- [ ] Does `fleet-start` or the fleetd tick already fast-forward the checkout anywhere, so that one existing step could be reused?

## Slices

### Implement leaves the main checkout clean

- `feature/implement-leaves-its-brief-and-plan` — after `/api/implement` finishes, the main checkout is fast-forwarded or untouched, and fleetd reads the brief on its next tick

## Notes

Source: https://github.com/plot-pm/plot/issues/2725. The issue is the problem statement; the plan's `Issue:` field is the only link back to it.
