## Implementation brief — bitbucket-with-tracker-plot-adoption (wave 2: Adoption)

- **Plan (canonical):** `docs/plans/2026-10-21-bitbucket-with-tracker-plot-the-message.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2221 merged
- **Branch:** `bug/bitbucket-with-tracker-plot-adoption` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review); the plan's `Review:` is `pr`

The wave this waited on is done: `bug/bitbucket-with-tracker-plot-the-message` merged as PR #2232. `bbIssueCommandMissing` on main now takes a second `suggested` parameter and already ends in `Tracker: jira <base URL>` with `Sprint owner: plot` for a `declared` of `plot` (`packages/domain/src/rules/issue-source.ts:159`, wired from `SUGGESTED_TRACKER` in `packages/board/src/server/entry/issue-source.ts:61`). This slice is unblocked and shares no file with that one.

### What to build

Issue #2216's fix so far only reaches the **stderr path** — a repository already running `plot-host.sh issue-list` and hitting the exit-4 refusal. `/plot-board-setup` and `/plot-init` are the other way a repository meets this: **proactive adoption**, run once up front. Today both skills propose `Tracker: jira` only when no `Tracker` key exists yet (a fresh-adoption signal: a repeated ticket prefix in commit subjects). Neither skill has a branch for a repository that **already** declares `Tracker: plot` on a Bitbucket remote — the exact shape that produces the exit-4 refusal later. Read against ewz-kus-portal, this is the gap: the repo had `Tracker: plot`, a Bitbucket remote, and `QUACDS`-style keys in branch names, and neither adoption command would have caught it.

Add that branch: when `/plot-board-setup` (step 4, "Turn the merged signals into proposals" → `skills/plot-board-setup/SKILL.md:200-250`) or `/plot-init` (`skills/plot-init/SKILL.md:157-202`, "The tracker") finds a Bitbucket remote whose current config already reads `Tracker: plot` (or no `Tracker` key, which `issueSource` reads the same way — see `sprintOwner`/`issueSource` in `packages/domain/src/rules/issue-source.ts`), and a Jira project key recurs in branch names the way a ticket prefix recurs in commit subjects, propose the move to `Tracker: jira <base URL>` with `Sprint owner: plot` — naming the evidence, the way the existing commit-subject proposal does.

### Settled decisions — do not re-derive them

**Branch names, not commit subjects, are the new signal.** `/plot-board-setup` and `/plot-init` both key their existing `Tracker: jira` proposal off `ticket.prefix`, which `plot-detect-repo.sh` measures from commit subjects. The plan's one-liner says the new case is read from "a Jira project key in branch names" — a different population than commit subjects. Check whether `plot-detect-repo.sh` already reports a branch-name signal before adding a second probe pass; if it does not, that is new probe work, not new proposal wording, and belongs in `plot-detect-repo.sh` (a script collects, per Manifesto Principle 3) rather than inline in either skill.

**This proposes a *move*, not a fresh declaration, and the two read differently.** The existing flow's unattended default writes `Tracker: jira` with the URL unset when nobody is present to confirm (`skills/plot-init/SKILL.md:192-197`, `skills/plot-board-setup/SKILL.md:286-297`). A repository that already has `Tracker: plot` is not undeclared — it has a working configuration that silently drops issue-listing. Decide whether the unattended default for *this* branch should still write the pair outright, or should refuse the same way the stderr sentence does (naming the placeholder `<base URL>` rather than guessing one, per the Message slice's resolution of the plan's first open question). The plan's own open questions were resolved for the stderr sentence as: name the literal placeholder `<base URL>`, and name `Sprint owner: plot` unconditionally since the function/skill cannot see whether the repository runs sprints. Apply the same two resolutions here for consistency, unless the two ceremony questions in `/plot-board-setup`/`/plot-init` already know whether the repo runs sprints — in which case say why the unconditional default no longer applies instead of silently diverging from the stderr wording.

**`Sprint owner` is new vocabulary to both skills.** Neither `skills/plot-board-setup/SKILL.md` nor `skills/plot-init/SKILL.md` currently mentions the `Sprint owner` key at all (confirmed — no match in either file). Introduce it only in the new branch; do not touch the two skills' handling of `Tracker` elsewhere, since `sprintOwner`/`issueSource` in the domain are unchanged by this slice (the plan's "Not changed" line).

**Board impact is "to assess," not "none."** The plan says the board impact of the Message slice is to assess, and names no plan-format change for either slice. If the proposal's wording change surfaces anywhere the board renders (it should not — both skills are prose-only, agent-facing instructions, not board-read config), say so in the PR body rather than silently expanding scope.

### Done when

The plan's `## Slices` line is the specification: `/plot-board-setup` and `/plot-init` propose `Tracker: jira <base URL>` with `Sprint owner: plot` on a Bitbucket remote with a Jira key in branch names. So:

- Both skills gain the new branch, each naming the evidence the way the existing `ticket.prefix` proposal does (`Found QUACDS-* in 6 of 80 commit subjects → propose Tracker: jira`-style phrasing) rather than a bare recommendation.
- Both skills' unattended (`PLOT_UNATTENDED=1`) behavior for the new branch is stated explicitly, following the `PLOT-UNASKED` convention the rest of each skill already uses (see the existing tracker/CI/Jenkins-instance examples in each file) — this catches a change that adds the interactive path and forgets the unattended one, which is half of what either skill is for.
- No test asserts skill prose today (behavioral testing here is manual, per the root `CLAUDE.md` Testing section), so there is no unit test to add for the wording itself. Confirm instead by re-reading the new section against ewz-kus-portal's actual recorded shape (`Tracker: plot`, Bitbucket remote, `QUACDS`/`EWZKUS`-style branch names) and stating in the PR body that the proposal would have fired for it.
- If `plot-detect-repo.sh` needs a new probe field for the branch-name signal, its contract test (`plot-plan-meta.sh`-style fixture, or wherever `plot-detect-repo.sh`'s own output is fixture-tested under `test/reconcile/` or `packages/domain`) gets a case for it in the same commit — a probe field with no fixture is the kind of drift `test:contracts` exists to catch.

Plus: a changeset for `plot` (patch — "new patterns, expanded coverage" per `CLAUDE.md` Versioning) naming both skills in `bumps:` since both `SKILL.md` files change, description first and `bumps:` block last, with a `plan:` line pointing at this plan.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI on every pull request, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice touches only `SKILL.md` prose (and possibly `plot-detect-repo.sh` if the branch-name signal needs a new probe field) — if a `.sh` file's line count grows, remove shell elsewhere in the same change or write the rule in the domain instead.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot-board-setup/SKILL.md`, `skills/plot-init/SKILL.md`, and — only if the branch-name signal requires it — `skills/plot/scripts/plot-detect-repo.sh` plus its fixture/contract test. One changeset.

`bug/bitbucket-with-tracker-plot-the-message` is merged; nothing else is known to be in flight against these two skill files as of 2026-10-21. Check `git diff origin/main --stat -- skills/plot-board-setup/SKILL.md skills/plot-init/SKILL.md` before you push in case another branch landed on them since.

If you find something the plan did not anticipate — in particular, if `plot-detect-repo.sh` has no way to measure a recurring Jira key in branch names today — report it rather than improvising a new probe mechanism outside what this slice's scope implies.
