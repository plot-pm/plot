## Implementation brief — a-consistency-pass-checks-the-plan-against-its-sources (wave: Trial)

- **Plan (canonical):** docs/plans/2026-11-07-a-consistency-pass-checks-the-plan-against-its-sources.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3220 merged
- **Branch:** `feature/a-consistency-pass-trial` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (`Review: pr`; the plan PR already merged)

`feature/a-consistency-pass-in-the-skill` waits on this branch. The trial's result decides whether that slice is built, changed or dropped. This branch waits on nothing.

### What to build

A documented, hand-run consistency pass, and a record of what each run found. No skill, no script, no plan field. The step: one agent lists every claim a plan takes from outside itself (spec ids, existing code and config, other plans, the environment), checks each against its source read with `git show <approval-commit>:<path>`, and writes each contradiction into the plan's `### Open Questions` with the quoted source line, the plan line that makes the claim, and a severity. It also lists the claims it found consistent, and marks environment claims that only a live system answers as `live check` without running them.

The trial exists because the only evidence is one replay: 17.5 minutes, 101 tool calls, 24 flags; 5 confirmed by the build, 3 refuted, 16 untested. Nobody has run the pass on a plan whose build is still ahead, and that is the only test of whether it saves anything. The deliverable is therefore two things: (1) the step written down so a person can run it by hand on the next plans before `/plot-approve`, and (2) a run record per plan, holding the flags, the commit read, the wall time, and later what the build confirmed or refuted. The plan is canonical; this is orientation.

Place the documents under `docs/` (for example `docs/research/` next to existing trial records). Do not create or edit anything under `skills/`.

### Decisions the plan settles — do not re-derive them

- **No new plan field.** The slice "writes nothing into the plan format". A `Consistency:` status line is an open question for the next slice, because it adds a plan field and touches the board's parser. Do not add one, and do not make the run record a status line.
- **The pass writes questions, never edits.** It changes no claim in the plan and runs nothing. A contradiction is an Open Question until a person answers it.
- **The source is read at a commit, not the working tree.** A working tree that has moved makes the answer depend on the instant of the run, which no second reader can check. The run record names the commit read. For `Review: pr`, that is the head of the plan PR at the run; a run on a head that later moved is stale.
- **Keep untested flags separate from refuted ones.** The replay's 16 untested flags are neither true nor false, and 3 refuted of 8 resolved is a small sample, not a false-positive rate. The record has a column for the later outcome (confirmed, refuted, untested) so the count stays honest.
- **The pass cannot see live behaviour.** Host reach, build-machine tooling, missing binaries and unbuilt metrics are what it missed. Do not let the step claim otherwise.
- **Not decided here, so not decided by this branch:** which skill runs it, the severity scale's final words, per-plan or per-repo opt-in, and the approval record. Use the plan's proposed scale (`blocks`, `misleads`, `cosmetic`) as a working draft in the trial and note in the run records where it fit badly.

### Done when

The plan states no `## Done when` list. The slice line is the specification: the pass as a documented step, run by hand on the next plans before approval, with a record of each run's flags and what the build later confirmed or refuted, writing nothing into the plan format. Concretely:

- A document describes the step: inputs, the four actions (list claims, check at the commit, write Open Questions, list claims found fine), the draft severity scale, and what the pass will not do.
- A record file or template exists with these fields per run: plan slug, commit read, wall time, tool calls, flags with severity, claims found fine, and the later outcome per flag. Without the claims-found-fine list nobody can compute a false-positive rate; without the outcome column the trial answers nothing.
- The first run is recorded, or the record says plainly that no plan was available to run it on yet. Do not invent a run. If the trial cannot complete before this PR, the record holds the template and the step, and the plan stays open for the runs.
- A diff that touches no file under `skills/`, no `packages/`, and no plan other than this plan's own `## Status` bookkeeping.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice touches no `.sh` file, so it adds none. Add a changeset only if the checks ask for one for a docs-only change; a docs-only change normally needs none.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the new step document and the run record, both under `docs/`, and nothing else. The other slice, `feature/a-consistency-pass-in-the-skill`, owns every change under `skills/` (the Model Guidance row, the README, the severity scale) and is not started; do not anticipate it. If the work shows that the pass needs a plan field, a script or a skill edit, report it in the PR rather than building it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
