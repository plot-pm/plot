## Implementation brief — a-consistency-pass-checks-the-plan-against-its-sources (wave: Implementation)

- **Plan (canonical):** docs/plans/2026-11-07-a-consistency-pass-checks-the-plan-against-its-sources.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3220 merged
- **Branch:** `feature/a-consistency-pass-in-the-skill` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (`Review: pr`)

This branch waits on `feature/a-consistency-pass-trial`, which merged as #3228. Nothing else waits on this branch. **The trial left no evidence yet: read the first section before you build anything.**

### What to build

The plan's step, written into one existing skill: one agent lists every claim a plan takes from outside itself (spec ids, existing code and config, other plans, the environment), checks each against its source with `git show <commit>:<path>`, and writes each contradiction into the plan's `### Open Questions` with the quoted source line, the plan line that makes the claim, and a severity. It also lists the claims found consistent and marks claims only a live system answers as `live check`. The pass runs nothing and edits no claim.

The skill gains the pass, a Model Guidance row for it, a README section, and the severity scale. The working draft of the scale is `blocks` (a slice cannot be built as written), `misleads` (the plan is wrong but the build would notice), `cosmetic` (a name or path differs). The trial's step document is the text to lift from: `docs/research/2026-11-07-consistency-pass-step.md`. The plan is canonical; this is orientation.

### The trial's result — check this first

The trial merged with a step document and a run record template, and **no run**. `docs/research/2026-11-07-consistency-pass-run-record.md` states that no plan was available to run the pass on. So the evidence is still the single replay in the plan: 24 flags, 5 confirmed by the build, 3 refuted, 16 untested, on one plan. The plan says this slice "waits on the trial's result", and the plan's last open question says the trial's result keeps, changes or drops the step.

Before you write any skill text, re-read the run record on `origin/main`. If it still holds no run, do not build on a result that does not exist. Report it: write `PLOT-BLOCKED.md` naming the empty record, and let a person decide whether to run the pass on the next plan first or to build now on the one replay. Do not count the replay as the trial. If a run exists, read its tally and its notes on where the severity scale fitted badly, and build what it supports.

### Decisions the plan settles — do not re-derive them

- **The pass writes questions, never edits.** It changes no claim and runs nothing. A contradiction is an Open Question until a person answers it.
- **The source is read at a commit, not the working tree.** A moved working tree makes the answer depend on the instant of the run, and no second reader can check it. The pass records the commit it read. For `Review: pr`, that is the head of the plan PR at the run, and a run on a head that later moved is stale.
- **Keep untested flags apart from refuted ones.** 16 of 24 replay flags were untested, and 3 refuted of 8 resolved is a sample, not a false-positive rate. The claims-found-consistent list is what makes a rate computable at all, so the pass must write it.
- **The pass cannot see live behaviour.** The replay missed host reach, build-machine tooling, a missing binary and an unbuilt metric. The skill text must not claim otherwise.
- **It complements `/challenge-the-plan` and `/plot-panel` and replaces neither.** It is the only one of the three that opens a file the plan does not contain.

### Open questions this slice must resolve, or hand back

The plan leaves six questions open. This is the slice where the first four bind, and the plan says to decide them at design time with the manifesto's 9-question checklist (`skills/plot/MANIFESTO.md`).

1. **Which skill runs it.** The plan's recommendation to test is a mode of `/challenge-the-plan`, because it is a design-phase step and needs no new spoke. Measured on `main` today: `skills/challenge-the-plan/SKILL.md` is 635 lines and already carries two engines (interview and panel) behind one surface, and **it has no `## Model Guidance` table**. `skills/plot-panel/SKILL.md:39` has one. So "its Model Guidance row" means adding the table to `challenge-the-plan`, which `CLAUDE.md` requires of every skill anyway, or adding a row to `plot-panel` if that skill is chosen. A new `plot-consistency` spoke is the third option and costs a row in the root README, the skill table in `CLAUDE.md`, and the helper-table gate if it brings a script. Pick one, write the reason in the plan, and check the pick against the manifesto.
2. **The severity words.** Use the run record's notes. If none exist, ship the working draft and say so in the skill.
3. **Opt-in per plan or per repo.** A per-repo key is a new `## Plot Config` key and needs a default (off). Prefer per-plan if the trial gives no reason for more.
4. **The approval commit for `Review: pr`.** Record the commit read in the pass's output.
5. **A `Consistency:` status line is out of scope.** It adds a plan field and touches the board's parser. If you conclude it is needed, report that in the PR and stop; do not add the field here.

Record each answer in the plan's Open Questions as the plan's own author would, in the same PR. If you cannot answer one without a person, write `PLOT-BLOCKED.md` naming the question.

### Done when

The plan has no `## Done when` list. The slice line is the specification: the chosen skill gains the pass, with its Model Guidance row, its README and the severity scale. Concretely:

- The skill's `SKILL.md` describes the four actions, the severity scale, the commit it reads, and what the pass will not do.
- The skill's Model Guidance table has a row for the pass. Listing the claims and judging a contradiction is judgment (Frontier); reading a source line at a commit and writing the entry is mechanical (Small). Say which tier each step needs.
- The skill's README documents the pass for developers. The root `README.md` skills table stays in sync with whatever changed.
- The pass writes nothing outside `### Open Questions` and the plan's own file. A test of this by reading the text: the skill names no write to any other path.
- The skill states the `PLOT_UNATTENDED=1` behaviour, as every skill that asks nothing of a person must. A pass that asks no question needs no question tool, and the text says so.

Plus: a changeset with the description first and the `bumps:` block last, naming the skill you changed (see `## Versioning` in `CLAUDE.md`; do not edit `metadata.version` by hand), then `./scripts/check-changeset-packages.sh`. Run `/writing-skills` before editing a skill. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the one chosen skill directory under `skills/`, the root `README.md` skills row if it changes, one changeset, and this plan's Open Questions and `## Slices` line. It touches no `packages/`, no plan other than this one, and no board code.

Verified at brief time: no other remote branch names `challenge`, `panel` or `consistency`, and the trial branch merged as #3228 with only `docs/research/` files. So no collision is known. `skills/challenge-the-plan/` and `skills/plot-panel/` last changed in `release: 2.29.0`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
