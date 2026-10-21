## Implementation brief — a-sprint-cannot-be-read-as (wave 2: Sprint source)

- **Plan (canonical):** `docs/plans/2026-10-21-a-sprint-cannot-be-read-as.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2217 merged
- **Branch:** `feature/sprint-reads-jira-release` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1, `feature/jira-version-read`, is merged (`a4ce2be35`, PR #2236): `Tracker.versionRead(name, limit)` exists on every adapter. This branch is the only remaining wave — nothing waits on it.

### What to build

`/plot-sprint` status and `/plot-release` cannot check a sprint's Must-haves against the Jira Release today: `sprintOwner()` in `packages/domain/src/rules/issue-source.ts:131` has zero real callers (only `issue-source.test.ts` calls it — confirmed by grep on 2026-10-21), and no script reads `Tracker.versionRead`, which wave 1 just added. The plan is canonical; this brief orients.

- **Call the read.** Where `sprintOwner(declaredSprintOwner, declaredTracker)` answers `{ owns: 'plot' }` *and* the declared tracker is Jira, call `Tracker.versionRead(releaseField, limit)` with the sprint file's existing `Release:` value — already read by `plot-sprint-release.sh:14` and `:203`, which reports release `""` when the field is absent. An `external` answer stays the decline `plot-sprint/SKILL.md:37-40` already states, but **make it a controller refusal** rather than prose the agent might skip: the gate must stop the command, not advise it.
- **Compare both directions.** A Must-have whose linked issue key is not among `VersionRead.issues`, and an issue in `VersionRead.issues` that no sprint item names. Report drift; write nothing to Jira or the sprint file.
- **Wire two call sites:** `/plot-sprint` status (reads the comparison when it reports) and `/plot-release` step 0 (the gate that already reads `plot-sprint-release.sh`'s `release` field to decide whether an open Must-have blocks — `skills/plot-release/SKILL.md:492` is the `Release:` note-writing step; the comparison belongs beside the existing release-blocking read, not there specifically).

### Settled decisions — do not re-derive them

- **The read signature is fixed, from wave 1:** `versionRead(name: string, limit: number): Promise<PortResult<VersionRead>>`, where `VersionRead` is `{ name, released, releaseDate, issues, complete, pages }` (`packages/domain/src/ports/tracker.ts:170-183`). Three outcomes stay apart — version unknown is `unaskable` with a reason starting `version-not-found:`; unreachable tracker is `failed`; no version concept/no tracker declared is `unaskable` otherwise. An empty `issues` array with `released` answered is a fourth, valid outcome: the version exists and names no issue. Do not collapse any of these into "no drift."
- **No sprint-to-version name matching.** This was decided in wave 1 and still holds: the sprint name and the Jira version name are never matched against each other. The sprint file's `Release:` field is the only source of the version name, verbatim.
- **`sprintOwner()`'s own rule is unchanged** (`issue-source.ts:131-136`, pinned by `issue-source.test.ts:114` and `:123`). This branch gives it its first real caller — do not edit the rule itself, and do not add a new `Sprint owner` value. Any value other than `plot` still changes nothing per the existing contract.
- **Two open questions the plan left unresolved are explicitly NOT yours to settle silently:** (1) how a sprint item names its Jira issue — the plan's `Issue:` field, or a key in the item text; (2) which Jira statuses count as done for a Must-have. Pick a narrow, stated interpretation (e.g. "match by the plan's `Issue:` field only; a sprint item with no `Issue:` field is reported as unmatched rather than guessed") and say so in the PR description — do not silently resolve these as if the plan had decided them. If the interpretation changes behavior materially, flag it rather than merge quietly.
- **Does the read write to the issue index?** No — plan's open question answered by omission: `issues.json` has one writer (`refreshIssueIndex`) and no lifecycle decision reads it (CLAUDE.md, *A Decision Reads The Index*). This read stays a direct call, like `versionRead` itself.
- **Layering:** controller → domain → port ← adapter. The comparison (Must-haves vs. Release issues) is a domain rule, not shell: write it under `packages/domain/src/rules/`, call it from the two skills' scripts through a bundle, exactly as `plot-sprint-release.sh` already calls `plot-config.sh` and the shell stays thin. No second Jira caller — `scripts/check-host-cli-callers.sh` still allows exactly one.

### Done when

The plan has no `## Done when` list; the slice line is the specification: *`/plot-sprint` status and `/plot-release` read the Jira Release that the sprint's `Release:` field names when `sprintOwner()` answers `plot` under a Jira tracker, and report drift both ways; `sprintOwner()` gains its caller and the external answer becomes a controller refusal.* Concretely:

- `sprintOwner()` is called from the real `/plot-sprint` and `/plot-release` paths, not only from a test — confirm by grep after the change; today's grep returns zero non-test callers.
- An `external` answer refuses the action (stops the command) rather than printing advice the agent can walk past — this is the "prose gate → controller refusal" conversion the plan names as its own goal, and the thing most likely to silently regress into prose again if written as a conditional print instead of a hard stop.
- A Must-have whose issue is not in the Release's `issues`, and a Release issue no sprint item names, are each asserted as distinct, separately-testable cases — not folded into one "mismatch" bucket, since the plan's Changelog names them as two separate reports.
- A sprint or plan with no `Release:` field behaves exactly as before (release `""`, no comparison attempted, no error) — pin this with a test, since it is the regression a careless early-return would most easily break.
- A `versionRead` outcome of `unaskable` (version-not-found) versus `failed` (tracker unreachable) produce different, named messages — not one generic "could not check" string.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base — if this branch touches `plot-sprint-release.sh` or adds a new script, pay for the growth in the same change (remove shell elsewhere, or push the rule into the domain and call it through a bundle). The gate stores no number and has no override. Add a changeset for `plot` (description first, `bumps:` block last) and mention the Design-pass board-impact note the plan already flags (Changelog: "to be assessed in the Design pass").

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot-sprint/SKILL.md`, `skills/plot-release/SKILL.md`, `skills/plot/scripts/plot-sprint-release.sh`, `packages/domain/src/rules/issue-source.ts` (adding `sprintOwner`'s caller wiring, not its rule body), and a new domain rule module for the Must-have/Release comparison plus its tests. It does not touch `packages/domain/src/ports/tracker.ts` or `packages/domain/src/adapters/tracker/*` — wave 1 owns those and they are merged; call `versionRead`, do not modify it. No other branch is currently in flight over `plot-sprint-release.sh`, `plot-sprint/SKILL.md` or `plot-release/SKILL.md` (checked against `origin` branches on 2026-10-21) — the file set is clear.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
