## Implementation brief — plot-on-a-bitbucket-repository-lists (wave 2: Sprint and issue source)

- **Plan (canonical):** `docs/plans/2026-10-20-plot-on-a-bitbucket-repository-lists.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2171 merged
- **Branch:** `feature/sprint-ownership-and-issue-source` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

Wave 2 of 2. Wave 1 (`bug/plot-on-a-bitbucket-repository-lists-no-tickets`, #2195) is merged and closed one of the plan's three Open Questions: "nothing to list" is not a fourth answer distinct from `nobody` — the board already rendered the absence sentence via `issueAnswer: 'unsupported'` before wave 1 started, and the only defect was its wording always naming `Tracker` even when the repository had declared one. See the plan's `## Open Questions`, third item, for the closed reasoning. The other two — which config shape, and (if a new key) its name and the Jira-only-repository sprint behaviour — are still open and are this branch's job.

### What to build

Field test 2026-10-20 against ewz-kus-portal (Bitbucket host, Jira tickets `EWZKUS-###`, `Tracker: plot` in `AGENTS.md`): the repository runs sprints through plot (correct — `Tracker: plot` is required for `/plot-sprint` to operate) but its tickets live in Jira, and `Tracker: plot` also tells `issueSource` to ask the git host, which on Bitbucket cannot list issues. One config key is being asked two questions — *who owns sprints* and *where do issues live* — and a repository that wants "plot" for the first and "Jira" for the second has no way to say so.

The plan leaves the choice between two shapes to you:

1. **`/plot-sprint` accepts an external tracker.** `Tracker: jira <url>` becomes legal for sprint ownership too; the sprint gate (`skills/plot-sprint/SKILL.md:17-29`) stops treating a non-`plot` value as an automatic decline. `issueSource` already answers `tracker` for this case — no domain change needed there.
2. **A second key.** `Tracker` keeps meaning issue source only; a new key (name open) says who owns sprints. `Tracker: plot` keeps its current meaning for every existing repository — zero behaviour change for a repo that hasn't adopted the new key.

Read `issueSource` (`packages/domain/src/rules/issue-source.ts`) and `trackerFor`/`trackerOfSource` (`packages/domain/src/adapters/tracker/tracker-resolve.ts`) before choosing — they already separate "ask tracker" / "ask git-host" / "ask nobody" cleanly; the sprint gate is the one place that currently reads `Tracker` as *also* meaning "who owns sprints," and that conflation is the whole defect. The plan is canonical; this is orientation.

### The decisions still open — resolve them here, in the plan

Nobody has picked an option yet. This is not a case of re-deriving a settled answer; it is the actual judgment call the plan deferred to this branch:

- **Option 1 vs. option 2.** Option 1 touches fewer files (the sprint gate only) but reopens the thing #2077 fixed: a non-`plot` `Tracker` value was defined to mean "plot is not the sprint owner here," and loosening that rule needs its own argument for why a shadow-board drift (the reason #2077 and the sprint gate exist) doesn't recur. Option 2 adds a key but changes nothing for the ~all repositories that today only ever set `Tracker`. Pick one in the plan's `## Design › Approach` section with the reasoning, before writing code against it.
- **If option 2: the new key's name, and what a `Tracker: jira <url>`-only repository gets for sprints.** The plan asks this explicitly and leaves it unanswered — a repository that sets only `Tracker: jira <url>` and no new key must get a defined, stated behavior (most likely: still declines sprints, same as today, until the new key is also set) rather than an implicit one discovered by reading code.

One combination is worth naming before you start: once this branch ships, "plot owns sprints, Jira lists issues" becomes a real, intended state for the first time (today it's the bug report, not a supported configuration). Re-check the plan's closed Question 3 reasoning against that combination specifically — it was closed by reasoning about `Tracker: plot` on Bitbucket in isolation, not about a repository where sprint ownership and issue source are configured independently. If that combination exposes a gap the closed answer didn't anticipate, reopen the question in the plan rather than silently patching around it.

### Every reader of `Tracker` — already compiled in the plan

The plan's `## Design › Approach › Every reader of Tracker` section (added on wave 1) has the authoritative table: every Domain, Shell, Board and Skill(-prose) reader, what each does for `plot`/absent and for `jira <url>`, with line numbers. Read that table rather than re-deriving it. Two things it confirms that matter for the option choice:

- Every reader except one funnels through the domain's `issueSource`/`trackerFor`/`trackerForIssues` and never branches on the raw string itself — so option 1 or 2, implemented in the domain, propagates to the board and to `plot-reconcile-scan.sh`'s `ask_issue_source` with no separate change at those call sites.
- The one reader that is its own, separate branch is the `/plot-sprint` gate (`skills/plot-sprint/SKILL.md:17`) — prose, not domain code, and the only place "declines outright" is decided. That is the conflation the issue names, and it is this branch's one required edit regardless of which option ships.

The plan's table does not cover `skills/plot-idea/SKILL.md:110` or `skills/story-tracking/SKILL.md:70`, which also read `Tracker` (grep hits, not in the compiled table). Check their exact read — binary decline vs. value passthrough — before assuming they are unaffected; if either shares the sprint gate's conflation, add it to the plan's table rather than leaving a second undocumented reader.

### Done when

The plan's `## Done when`-equivalent is its Design section's three behaviours plus checks:

- Option 1 or 2 is chosen and written into the plan's `## Design › Approach` section with the reasoning, replacing the current "the plan leaves the choice to the reader" framing.
- The new key's name (if option 2) and the Jira-only-repository sprint behaviour are both stated in the plan, not just in code.
- A test proves a Bitbucket-and-Jira repository (`Tracker: plot` under option 1, or `Tracker: jira <url>` + the new key under option 2) both runs `/plot-sprint` and lists Jira tickets from config alone — this is the plan's own acceptance test and the field-test scenario that opened the issue.
- A test proves every existing repository that declares only `Tracker: plot` is unaffected — same sprint behaviour, same issue source. This is the regression a config-shape change risks and the reason wave 1's brief called out "a fix that special-cases one path must not silently change the other."
- `test/reconcile/host.test.mjs` and `packages/domain/test/issue-source.test.ts` (or their option-2 equivalents for a new config key) cover the new gate logic.
- Update `skills/plot-sprint/SKILL.md`'s tracker-gate prose to match whichever option ships — the gate's current "Only `Tracker: plot` (or no declaration) proceeds" sentence is the exact text that needs to change either way.

Plus: add a changeset (`plot: minor` — this is new config surface, not a patch-level fix; description first, `bumps:` block last, with a `plan:` line pointing at this plan). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites named in the `CI suites` config key run in CI, not here — a failure there comes back as a correction.

This branch does not touch `skills/plot/scripts/plot-host.sh`'s shell directly (wave 1 already did), but if any edit here touches a `.sh` file under `skills/`, `scripts/check-shell-lines.sh` refuses growth beyond the merge base — remove shell elsewhere in the same change, or move the logic into the domain and reach it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section under `### Sprint and issue source`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the plan's `## Design` and `## Open Questions` sections (closing them with the chosen option), `skills/plot-sprint/SKILL.md`'s tracker gate, the config-shape change in `packages/domain/src/rules/issue-source.ts` and/or `tracker-resolve.ts` if option 1 needs one, any new config key's plumbing through `plot-config.sh`, and the tests listed above. Verify `skills/plot-idea/SKILL.md:110` and `skills/story-tracking/SKILL.md:70`'s exact reads before touching them — they may be in scope only if they share the sprint gate's conflation, which is not yet confirmed. No other branch is in flight on this plan; wave 1 is merged and there is nothing else to collide with.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
