# Panel moderation — adoption-notices-a-stale-default-branch

**Reconciliation: `unanimous amend` — estate, adoption.**

The diagnosis is right and the fix is placed correctly. The adoption juror traced the reporter's three commands and found the plan promises more than its slices deliver.

## The sharpest finding: a fourth reader was already right

**`/plot-idea` asks the host.** `skills/plot-idea/SKILL.md:252` runs `plot-host.sh default-branch` — verified by the moderator.

So the reporter's three plans were cut from `develop`, **correctly**, while the board read `origin/main`. **Two readings, live in one session, in one repository, minutes apart, and nothing compared them.**

The draft's motivation table listed three readers and stopped short of noticing that one of them is already the host-asking half. It framed a probe gap; this is also a live inconsistency inside a single workflow, and that is the better statement of the defect.

## A scope error the Done-when would have shipped

The plan promises *"`/plot-init` and `/plot-board-setup` propose the key."* **Board setup runs `plot-board-probe.sh` (`SKILL.md:83`), not the adoption probe slice 1 changes** — verified. Neither slice names that work, so the Done-when could not have been met.

## Where the fix lands, honestly

| Command the reporter ran | Would the fix have caught it? |
|---|---|
| `/plot-init` | **Yes** — the one moment they are already reading a proposal block |
| `/plot-board-setup` | **No**, as written — wrong probe |
| `/plot-idea` ×3 | No — and it was already correct |

**The fix arrives before the moment the reporter actually noticed.** They reported after the board looked wrong, not at adoption. That makes this a prevention for the next repository rather than a catch for this class late — acceptable, and worth stating rather than implying.

## The disposition

**Amend before building.** The diagnosis, the placement and the probe-reports-nothing-decides split all stand. What changes: the fourth reader is named, the board-setup gap is named in the slice that must close it, and the Done-when stops promising a path no slice touches.
