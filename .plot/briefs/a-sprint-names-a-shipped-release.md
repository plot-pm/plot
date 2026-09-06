## Implementation brief — a-sprint-names-a-shipped-release (slice: A shipped release closes nothing by itself)

- **Plan (canonical):** `docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-sprint-names-a-shipped-release` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slices 1 and 2 merged as **#728** and **#735** — the delivery gate now stops by name, and the scan reports a sprint whose phase and index disagree. Both landed 2026-09-06.

## What this delivers

`plot-reconcile-scan.sh` reports a non-Closed sprint whose `Release:` has been tagged.

## The facts are already collected

`skills/plot/scripts/plot-sprint-release.sh` reads a sprint's declared `Release:` target and every MoSCoW item's state as JSON. **Its own contract says it decides nothing** — *"the facts behind the release gate, and nothing else: /plot-release applies the rule, this decides nothing and never exits non-zero for unfinished work."*

**So the release side is a fact the estate already holds.** This slice reports on it; it does not re-derive it.

## The measured case

`a-half-landed-workflow-says-so` targets **2.13.0**, which shipped. It is `Planned`. It has not moved since **2026-08-29**. **None of its eight items ever became a plan.**

That is a sprint the estate should be able to say something about without a person opening the file.

## Reported, never closed

**Closing is the team's word.** What the scan can say is that the train has left. It reports and gates nothing — the same posture as `index_drift=` and the section #735 just added.

**It belongs BELOW the `== blocking sections end ==` marker.** Sections 1–6 block a delivery; this is advisory. #728 made that gate stop by name rather than by number, so adding a section no longer needs a renumbering — but the placement still decides whether it can stop a delivery, and it must not.

## Done when

- the scan reports a non-Closed sprint whose declared release has shipped
- it names the sprint, its release and the tag
- it closes nothing and gates nothing
- the finding lands below `== blocking sections end ==` and is counted in the machine-countable footer
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not close a sprint**, and do not offer to.
- **Do not build a second reader of sprint releases.** `plot-sprint-release.sh` holds the facts; call it.
- **Do not put it above the blocking marker.** An advisory finding that can stop a delivery is a gate nobody agreed to.
- **Do not fold it into `sprint_drift=`.** That counts **plans** whose `Sprint:` disagrees with the sprint file; this is a fact about the sprint file itself. One number answering two questions is what #735's slice argued against.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
