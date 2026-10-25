## Implementation brief — sprint-release-gate-and-sprint-readers (wave 4: Sprint skill)

- **Plan (canonical):** `docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2513 merged
- **Branch:** `bug/plot-sprint-verdict-reports-partial-comparison` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** plot-review on the PR, per `Review required since`

Wave 4 of 4. The other three waves (Release gate #2576, Sprint readers #2596, Story lint #2602) are merged — nothing else of this plan is in flight, and this branch waits on nothing.

### What to build

Three independent fixes in `skills/plot-sprint/SKILL.md` and one in `evals/promptfoo/promptfooconfig.sprint-gate.yaml`, all from issue #2482's follow-up findings:

1. **The verdict table silently drops a finding when two lists are non-empty at once.** `SKILL.md:839-846` prints the Jira Release drift as a ranked if/else chain keyed on a single `verdict` string — one printed line per row. But the actual type (`SprintReleaseDrift` in `packages/domain/src/rules/sprint-release.ts:22-30`, surfaced through `Verdict` in `packages/board/src/server/entry/sprint-release-gate.ts:119-127`) carries `missingFromRelease`, `missingFromSprint` and `notCompared` as three *independent* lists on one `checked: true` object — not three mutually exclusive branches. A sprint can have both `missingFromRelease` and `notCompared` non-empty simultaneously (a Must-have naming a key the Release lacks, alongside a different Must-have naming no key at all), and today's table only tells the reader to print the first row that matches, so the second finding never surfaces. Fix the table (or the prose around it) to report each non-empty list, not the first one.
2. **The skill calls the bundle directly instead of through its shell launcher.** `SKILL.md:26` runs `node ../plot/scripts/board/plot-sprint-release-gate.mjs --stdin` directly. Every other call site in this skill (e.g. `SKILL.md:830`) goes through `../plot/scripts/plot-sprint-release-gate.sh`, which is a pure launcher (`skills/plot/scripts/README.md`'s own entry: "Launcher only. Resolves `board/plot-sprint-release-gate.mjs` and `exec`s it, passing arguments and the exit code through; exits 2 with the missing-bundle message when the bundle is absent"). Line 26 bypasses that — change it to call the `.sh` launcher so a missing/stale bundle fails with the launcher's own message instead of a raw Node stack trace, and so there is one call convention in the file, not two.
3. **The sprint-gate eval is missing two config combinations the domain already tests.** `packages/domain/test/issue-source.test.ts:129-135` covers both: `sprintOwner('plot', 'jira https://...')` → `{ owns: 'plot' }` (the override — `Sprint owner: plot` beside an external `Tracker`), and `sprintOwner('jira', 'jira https://...')` → `{ owns: 'external', scheme: 'jira' }` (a non-`plot` `Sprint owner` value changes nothing; the external `Tracker` still declines). `evals/promptfoo/promptfooconfig.sprint-gate.yaml` only has three cases today (`Tracker: jira` alone → decline, `Tracker: plot` → proceed, no `Tracker` → proceed) and none of them declare a `Sprint owner` key at all. Add two more `tests:` entries mirroring those two domain cases, reading `SKILL.md:30-39`'s prose (`Sprint owner: plot` is the one value that overrides; anything else, or undeclared, changes nothing) rather than re-deriving the rule.

### Settled decisions — do not re-derive

- **This is a prose/config fix, not a domain-rule fix.** The domain rule (`sprintOwner`, `sprintReleaseDrift`) is already correct and already tested at the unit level — see `issue-source.test.ts:129-139` and `sprint-release.test.ts`. What's wrong is the skill's *telling* of the rule (the verdict table drops a finding; the direct bundle call skips the launcher's bundle-missing message) and the eval's *coverage* of the rule (missing two cases the domain itself already proves). Do not touch `packages/domain/src/rules/sprint-release.ts` or `issue-source.ts`.
- **Fix 1 is about the table's shape, not its content.** Each row's printed text (`⚠ <n> Must Have(s) not in Jira...`, etc.) is correct as written — the defect is that the table reads as an if/else chain over one `verdict`, when the underlying data is three independent lists. The fix should let all applicable rows print for one sprint's verdict, not choose a replacement wording for any single row.
- **Fix 3's two new cases reuse the existing test grammar.** Add `tests:` entries in the same shape as the three already there (`vars.config` as the `## Plot Config` snippet, `assert` on the one-line `sprint: <proceed|decline>` output) — do not restructure the eval file or its prompt template.

### Done when

The plan's `## Done when` is implicit in its Changelog bullets for this wave: the verdict table reports a partial comparison when `notCompared` is non-empty alongside another finding; the skill's owner-check call at `SKILL.md:26` goes through the launcher; the sprint-gate eval covers `Sprint owner: plot` with `Tracker: jira`, and `Sprint owner: jira` (alone or beside a tracker) declining the same as an undeclared one.

Plus the repo's standing gates: this slice touches no `.sh` file and should add no shell, so `scripts/check-shell-lines.sh` needs no offset. A `skills/plot-sprint/SKILL.md` change needs a changeset with a `bumps:` block naming `plot-sprint`'s version bump (patch — wording/prose fixes, no new section). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` (`CLAUDE.md`'s `## Plot Config`) run in CI, not locally.

### Bookkeeping

- Open the PR through the controller: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` directly.
- Push the first real commit as soon as it exists.
- When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Sprint skill` heading.

### Scope guard

This branch owns: `skills/plot-sprint/SKILL.md` and `evals/promptfoo/promptfooconfig.sprint-gate.yaml`. No other branch of this plan is in flight — the three prior waves (Release gate, Sprint readers, Story lint) are merged and touched different files (`sprint-release-gate.ts`, `rules/sprint-release.ts`, `sprintGoal`/`boldGoal`, `plot-review-status.sh`, `plot-story-lint.sh`, `plot-plan-meta.sh`). Nothing else claims `SKILL.md` or the eval config.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
