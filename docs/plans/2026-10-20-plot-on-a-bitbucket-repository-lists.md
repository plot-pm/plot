# Tracker: plot on a Bitbucket repository lists no tickets

> A Bitbucket repository with Jira tickets declares `Tracker: plot` so `/plot-sprint` runs, and `issue-list` then refuses because `bb` has no issue command.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #2169
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2171 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/plot-on-a-bitbucket-repository-lists-no-tickets`
- **Started:** 2026-10-20, Jan Wloka, `feature/sprint-ownership-and-issue-source`

## Changelog

- A Bitbucket repository that runs sprints and keeps its tickets in Jira shows those tickets on the board from its `## Plot Config` alone.

Board impact: **to assess.** The board reads open issues through `issueSource` (`packages/domain/src/rules/issue-source.ts`) and shows its *Waiting on you* rows from the issue index, so the change decides whether a Jira-backed repository gets rows or an absence sentence.

## Motivation

Field test on 2026-10-20 of main `45cd9fd71` (after #2161 for #2077) against ewz-kus-portal: Bitbucket host, Jira tickets (`EWZKUS-###`), `Tracker: plot` in `AGENTS.md`.

`plot-host.sh issue-list` exits 4 with `bb 1.0.0 lists no issue command — Quatico bb has none, unlike craftamap/bb — so this repository's issues cannot be read through it; declare the issue tracker with the `Tracker` config key` (`skills/plot/scripts/plot-host.sh:2277`).

#2161 maps `Tracker: plot` to `{ask: 'git-host'}` (`issueSource`, `rules/issue-source.ts`). On GitHub that lists GitHub issues. On Bitbucket the git-host arm refuses, because Quatico `bb` has no issue command. The board shows no tickets.

The repository declares `Tracker: plot` only because `/plot-sprint` declines any external tracker (`skills/plot-sprint/SKILL.md`, tracker gate; ewz-kus-portal `AGENTS.md:86`). Its tickets live in Jira. With `PLOT_TRACKER="jira https://quatico.atlassian.net"` set in the environment, `issue-list` returns EWZKUS-3883..3877.

Two defects follow:

- One config key carries two questions: *who owns sprints* and *where do issues live*. A repository that answers "plot" to the first and "Jira" to the second has no way to say so in config.
- The refusal text advises declaring the `Tracker` key, which the repository already declares.

## Design

### Approach

**Decided: option 2, a second key.** `Tracker` keeps meaning only "where do issues live." A new key, `Sprint owner`, answers "who owns this repository's sprints," independently.

Option 1 — loosening `/plot-sprint`'s gate to accept `Tracker: jira <url>` directly — was rejected because it reopens what #2077 settled on purpose: a declared external tracker meaning "plot is not the sprint owner here" exists specifically to prevent a shadow sprint board drifting from the tracker's own view. Loosening that rule for every repository that declares a non-`plot` `Tracker` needs its own argument for why drift doesn't recur, and the issue gives none — it asks only for ewz-kus-portal's specific combination (plot sprints, Jira issues), not for the gate to open generally. Option 2 grants exactly that combination, opt-in, per repository, with zero behaviour change for every repository that declares only `Tracker` today — which is the entire existing estate.

**`Sprint owner`** takes the value `plot` or is absent. Absent, or any value other than `plot`, changes nothing: `/plot-sprint` follows `Tracker` alone, exactly as before this key existed — `Tracker: plot` (or no declaration) proceeds, any other declared tracker declines. `Sprint owner: plot` is the one declaration that overrides a declared external `Tracker` for sprint ownership specifically, letting a repository say "plot" to the first question while still naming Jira (or another tracker) for the second. A repository that sets only `Tracker: jira <url>` and no `Sprint owner` still declines sprints — the same behaviour as today, unchanged until `Sprint owner: plot` is also set.

This makes "plot owns sprints, an external tracker lists issues" a real, named configuration for the first time — previously it was ewz-kus-portal's bug report, reachable only by setting `Tracker: plot` and losing the issue list (the defect this plan's wave 1 fixed one half of, and this wave's reason for existing). The combination does not reopen the plan's closed Question 3: that question was about `Tracker: plot` alone on a host with no issue-list command, and is unaffected by whether a *second*, independent key also grants plot sprint ownership — `issueSource` still reads only `Tracker`, never `Sprint owner`, so a Bitbucket-and-Jira repository under this new combination resolves exactly as a Bitbucket-and-Jira repository with `Tracker: jira <url>` always has: the tracker arm, not the git-host arm, same as the `Tracker: plot` case that closed Question 3 was never routed through once `Tracker` itself names Jira.

The issue also asks for two behaviours that hold under either option:

- Under `Tracker: plot` on a host with no issue command, `issue-list` answers "nothing to list" and not a refusal.
- The exit-4 text names the `Tracker` key only where the repository has not declared it.

Checks before the slices are written:

- Every reader of the `Tracker` value (`trackerFor`, `tracker-resolve.ts`, the sprint gate, `plot-config.sh get "Tracker" "plot"` callers) is listed, with what each does for `plot`, `jira <url>` and an absent key.
- The `bb_assert_issue_version` refusal (`plot-host.sh:2277`) and the `issue-list` consumers it reaches read the same distinction: a host that cannot list versus a tracker nobody declared.
- A test names `Tracker: plot` on Bitbucket beside `Tracker: plot` on GitHub, so the two cannot drift.

#### Every reader of `Tracker`

Measured 2026-10-20 on `bug/plot-on-a-bitbucket-repository-lists-no-tickets`. The board and shell layers never branch on the string themselves — every site below funnels through the domain's `issueSource`/`trackerFor`/`trackerForIssues`, which are the only places the three-way decision is made.

| Layer | Reader | `plot` / absent | `jira <url>` |
|---|---|---|---|
| Domain | `issueSource` (`rules/issue-source.ts:61`) | `{ ask: 'git-host' }` | `{ ask: 'tracker', scheme: 'jira' }` if a lister is registered for the scheme (it is); `{ ask: 'nobody', reason }` for an unregistered scheme (e.g. `linear`) |
| Domain | `bbIssueCommandMissing` (`rules/issue-source.ts:114`) | appends "declare the issue tracker with the `Tracker` config key" | omits the advice — the repository already declared one |
| Domain | `trackerFor` (`adapters/tracker/tracker-resolve.ts:42`) | `trackerNone()` — every op answers `unaskable` | `trackerJira(context, baseUrl)` |
| Domain | `trackerGitHost` (`tracker-resolve.ts:96`) | the active connector when `issueSource` answered `git-host`; wraps the git host's own issue reads | never constructed — Jira takes the `tracker` branch instead |
| Domain | `trackerForIssues`/`trackerOfSource` (`tracker-resolve.ts:139`) | composes the two above; the one place every board/shell consumer calls rather than re-deciding | same |
| Shell | `tracker_raw`/`tracker_scheme` (`plot-host.sh:2514`, `:2522`) | `""` | `"jira"` (first word, lowercased) — pass-through, not a branch |
| Shell | `issue_source` (`plot-host.sh:2551`) | relays the domain's `git-host` answer | relays `tracker`/`nobody` |
| Shell | `issue-list`/`issue-view` dispatch (`plot-host.sh:4754`, `:4997`) | git-host arm (gh/bb) | Jira REST arm via `jira_require_config`, or exit 4 if `nobody` |
| Shell | `issue-status` op (`plot-host.sh:5106`) | exits 4 — Jira-only write | looks up/POSTs a Jira transition |
| Shell | `bb_assert_issue_version` (`plot-host.sh:2286`) | keeps the `Tracker` advice on exit 4 | drops it |
| Shell | `ask_issue_source` (`plot-reconcile-scan.sh:3026`) | same three-way answer as `issue_source`; advisory only, never gates delivery | same |
| Board | `verify.ts:730`, `plan-state.ts:105`, `review.ts:508`, `fleet.ts:1656` (and `:1773`, `:1941`, `:2105`) | all read `Tracker` and hand it whole to `trackerForIssues` | same — no independent branch |
| Skill (prose) | `/plot-sprint` gate (`skills/plot-sprint/SKILL.md:17`) | sprints proceed (the shell default for a missing key is literally `"plot"`) | the skill declines **unless `Sprint owner: plot` is also declared** — the one reader this plan changes |
| Skill (prose) | `/plot-idea` (`skills/plot-idea/SKILL.md:110`) | reads `Tracker` as a passthrough value for ceremony bounds, never a binary decline — unaffected | same, passthrough |
| Skill (prose) | `story-tracking` (`skills/story-tracking/SKILL.md:70`) | reads `Tracker` to check for an existing umbrella ticket, value passthrough, never a binary decline — unaffected | same, passthrough |
| Domain | `sprintOwner` (`rules/issue-source.ts`, new) | `plot` unless `Sprint owner` names anything but `plot` while `Tracker` names an external tracker | `external` with the scheme, unless `Sprint owner: plot` overrides it |

The absent-key column is folded into `plot` everywhere above: every reader normalizes a missing `Tracker` line to `''`, and `issueSource` treats `''` and `'plot'` identically (`rules/issue-source.ts:64`). No reader treats "absent" as a third case.

### Open Questions

- [x] Option 1 or option 2 above? **Closed 2026-10-20, on `feature/sprint-ownership-and-issue-source`.** Option 2 — see `## Design › Approach` above.
- [x] If option 2: what is the new key's name, and what does a repository with only `Tracker: jira <url>` get for sprints? **Closed 2026-10-20.** The key is `Sprint owner`. A repository declaring only `Tracker: jira <url>` (no `Sprint owner`) still declines sprints — same as today — until it also declares `Sprint owner: plot`.
- [x] Is "nothing to list" a distinct answer from `nobody`, and does the board show it as an empty inbox or as an absence sentence? **Closed 2026-10-20, on `bug/plot-on-a-bitbucket-repository-lists-no-tickets`.** It is not a fourth answer. `bb_assert_issue_version`'s exit 4 already flows into `fleet.ts`/`issue-refresh.ts` as `issueAnswer: 'unsupported'` plus an `issueAbsence` sentence — the board already rendered the absence sentence before this branch started; the only defect was the sentence's wording always naming `Tracker` regardless of whether it was declared. Fixed by reading the declared value once, in the domain (`bbIssueCommandMissing`), and asking it through the existing `plot-issue-source.mjs` bundle rather than a second config read in shell.

## Slices

### Issue list under Tracker plot

- `bug/plot-on-a-bitbucket-repository-lists-no-tickets` — `issue-list` on a host with no issue command answers "nothing to list" under `Tracker: plot`, and the exit-4 text stops advising a key that is already declared. → #2195

### Sprint and issue source

- `feature/sprint-ownership-and-issue-source` — the config shape the reader picks in Open Questions, so a Bitbucket and Jira repository runs sprints and lists its Jira tickets from config alone.

## Notes

- Source: https://github.com/plot-pm/plot/issues/2169
- Related: #2077 (delivered as `plot-reads-as-an-unknown-tracker`), whose option 1 produced the git-host mapping this plan revisits.
