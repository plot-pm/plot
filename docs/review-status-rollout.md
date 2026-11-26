# Rolling out the `plot/review` required check

A PR merges only when a passing `plot/review` commit status sits on its
current head. `docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md` designs
the gate; this page is the one-time human setup — creating the App, storing
its key, and switching the branch rule on — for a repository adopting it and
for this repository's own rollout. The section [The `plot/main` check](#the-plotmain-check) covers the `plot/main` status, which holds merges into a red default branch once the ruleset requires it.

## What writes the status today

Three call sites write `plot/review` once a PR's head is ready to merge:

| PR kind | Writer | State |
|---|---|---|
| A PR reviewed by `plot-review` | `skills/plot/scripts/board/plot-review.mjs` | `success` (no HIGH finding) or `failure` (one or more), `target_url` always the PR; findings of any severity go into one marked PR comment, never a follow-up issue |
| The plan-PR merge (`/plot-approve`) | `packages/board/src/server/entry/approve.ts` | `success`, description `approved by <who>` |
| A ladder bookkeeping micro-PR (`/plot-approve`, `/plot-deliver`) | `packages/board/src/server/entry/ladder.ts`'s `commitAndPush` | `success`, description `bookkeeping: <rung>` |

**Gap, reported rather than closed in this wave:** the release step
(`/plot-release`) has no instrumentable call site that writes `plot/review` on
its own PR before merge — it was out of scope for this wave to build one.
Until it does, a release PR merged under the required check depends on a
`review-bypass:` comment (see below) or on a writer added in a follow-up.

Generated bundle commits are never PRs (`main` builds its own bundles after
every merge, and `check-no-bundle-diff.sh` refuses one in a PR), so nothing
writes a status for them and nothing needs to.

## One-time setup, for a repository adopting the gate

1. **Create a narrow GitHub App.** Not `plot-board-builder` — that App's key
   lives in CI secrets and sits on `main`'s ruleset bypass list; reusing it
   would put a bypass-capable key on a workstation. Create a second App
   (for example `plot-review`) with exactly:
   - *Commit statuses:* write
   - *Pull requests:* read
   - *Contents:* read
   - No webhook, no event subscriptions.

   Install it on the repository only (not the whole org, unless every repo in
   it adopts the gate).

2. **Store the key outside the repository.** Generate a private key for the
   App and save it somewhere the repository's `.gitignore` does not need to
   protect — for example `~/.config/plot/plot-review.<app-id>.private-key.pem`,
   mode `600`. The key must never be committed.

3. **Record the App in `## Plot Config`:**

   ```
   - **Review app:** <app id>
   ```

   The key path is optional. The resolver reads the key from the first of
   these that applies: `PLOT_REVIEW_APP_KEY` (`PLOT_WRITER_APP_KEY` and
   `PLOT_MERGER_APP_KEY` for the other two roles); the path on the config
   line, where the line still names one (absolute, or relative to the
   repository root; `~` is not expanded, #1706); then
   `${XDG_CONFIG_HOME:-$HOME/.config}/plot/plot-<role>.<app id>.private-key.pem`,
   with `<role>` `review`, `writer` or `merger`. The file name carries no
   date: a rotated key replaces the file and needs no config change. An
   unreadable key exits 4 and names the path of the step that applied.

   `plot-host.sh commit-status` and `plot-commit-status.mjs` read this key to
   mint a short-lived installation token per write; neither credential reaches
   a child process's argv or a log line.

4. **Prove the write before gating anything.** Run `plot-review` (or
   `plot-host.sh commit-status`) against a scratch PR and confirm the status
   appears on its head, authored by the App's bot identity
   (`<app-slug>[bot]`), before touching branch protection. A missing or
   unreadable key refuses with exit 4 naming what is missing — that refusal
   is the proof the write path is wired, not yet that the gate is safe to flip.

5. **Confirm every PR kind in the table above has a writer running in this
   repository**, including any repository-specific review step beyond
   `plot-review`. A required check with no writer for some PR kind blocks
   every merge of that kind, forever, until a human disables the rule again.

6. **Only then, add the ruleset rule:** on the repository's branch protection
   for the default branch, add `plot/review` as a required status check,
   pinned to the App's integration ID so a status written by any other
   identity (including the signed-in maintainer) does not satisfy it. This is
   the switch that makes the rule a gate — flip it last, after step 5 is true,
   or it blocks merges it was meant to admit.

   **Open question, not yet resolved:** whether the ruleset UI/API exposes
   pinning a required status check to a specific App's integration ID, or
   only to a context name any writer can satisfy. Confirm this against the
   live ruleset before relying on the pin — if it cannot pin, the required
   check still raises the bar (a context must exist and be green) but does
   not yet exclude a status written by hand.

7. **Decide the break-glass convention.** A maintainer may merge past a stuck
   or wrong review as a repository admin, and records why on the PR as a
   comment starting `review-bypass:`. Nothing enforces the comment's
   presence — `/plot-reconcile`'s "20a. Review bypass" section (below) is the
   detection, not a gate.

## `/plot-reconcile`'s bypass-detection report

Section **"20a. Review bypass"** in `plot-reconcile-scan.sh` reports — and
never gates — a PR merged after the `Review required since` date with no
passing `plot/review` status and no `review-bypass:` comment. The section
holds no rule: it prints the answer of `board/plot-review-bypass.mjs`, which
lists the merged PRs, reads each one through the Host port, and asks the
domain rule `reviewBypasses`.

**The cutoff is a config key.** `Review required since: <ISO date>` in the
`## Plot Config` section names the date from which a merge is held to the
rule. With no key the report states `(not evaluated — no Review required
since key is set …)`, asks the host nothing and counts nothing. Set the key to
the date the ruleset rule goes live, never earlier: a PR merged before the
rule existed was not required to carry a status.

**The read is per context.** `plot-host.sh pr-review <number>` returns the
PR's head SHA, the newest `plot/review` commit status on that head (`absent`
when none exists) and whether a comment starts with `review-bypass:`. CI is
never read. A PR with green CI and no `plot/review` is reported, which is the
shape of #1687.

**A failed read is a finding.** A PR whose read fails is listed as
`unread PR #<n>`, is not counted as a bypass, and the report never prints
`(none` while any read failed. A merged-PR list that cannot be read at all
prints that the section was not evaluated.

Direct pushes to the default branch are not PRs and are not examined.

**The writer is checked.** `pr-review` also returns every `plot/review` status on the head with its `writer`, the login that created it. Merge, release approval, the review run and the PR index treat a `success` as a pass only when the newest status was written by `<slug>[bot]`, the Review app's bot. `plot-review-writer.mjs` resolves the slug through `GET /app` and reads `Review app` from `origin/<default>:CLAUDE.md` (then `AGENTS.md`), never from the working tree, so a PR head cannot choose the login its own status is judged against. A foreign status newer than the trusted one refuses `review-foreign-writer`. A writer that cannot be resolved refuses `review-writer-unread`, and an index row not yet judged holds `review-writer-unchecked`. With no `Review app` key the reading is unchecked and the status state passes through. Bitbucket statuses carry no writer (`writer: ''`), so Bitbucket stays unchecked.
`pr-review` reads the `plot/review` commit status on both hosts. On Bitbucket the status words SUCCESSFUL, FAILED, INPROGRESS and STOPPED map to `success`, `failure`, `pending` and `error`.

## For this repository

The App exists (`plot-review` on `plot-pm`, installed on `plot-pm/plot` only)
and the `Review app` key is recorded in the `## Plot Config` section of
`CLAUDE.md`. Steps 1–3 above are done. Step 6 — the ruleset rule requiring
`plot/review` — is deliberately **not yet added**: this plan's own sequencing
requires it last, after the writers above (this wave) are merged and proven
in production, not merely written. Flipping it earlier would hold every PR
merge the moment any one PR kind's writer has a bug this wave's tests did not
catch.

## Setting up the Writer App and the Merger App

Two more GitHub Apps close #1730 — a PR merged four seconds after it opened
with no `validate` run and no `plot/review` status, because the merge ran as
the maintainer's account, which holds `bypass_mode: always` on the ruleset. A
pinned merge by a bypass-capable identity still bypasses every required
check; only changing WHO merges closes it. `skills/plot/scripts/plot-github-app.mjs`
holds the JWT-to-installation-token exchange both Apps share with the
`Review app` above — three identities, one exchange, extracted once.

**Each key switches its identity on.** Each App is opt-in, and each `## Plot Config` key works independently of the other:

| `## Plot Config` | Lifecycle push (`plot-push-main.sh`) | `pr-merge` on GitHub (`plot-host.sh`) | fleetd's own merge arm (`auto-merge.ts`) |
|---|---|---|---|
| Key absent | Plain `git push origin <branch>:<default>` as the ambient git identity, plus one stderr line: `plot-push-main: Writer app not configured — pushing as the ambient git identity` | Plain `gh pr merge … --match-head-commit <sha>` as the signed-in `gh` identity, plus one stderr line: `plot-host: pr-merge — Merger app not configured — merging as the signed-in gh identity` | Holds every row: `merger-app-missing`, recorded once per (PR, head) as a `merge-hold` line |
| Key declared and readable | Push as the Writer App installation | Merge as the Merger App installation | Attempts the merge, recorded as a `merge` line with outcome `merged as app` |
| Key malformed or key file unreadable | Refused by name with exit 4 from `plot-push-writer-app.mjs`, no push attempted | Refused by name with exit 4, no merge attempted | Holds every row: `merger-app-invalid`, recorded once per (PR, head) as a `merge-hold` line |
| `Writer app` and `Merger app` name the same App id | — | Refused by name with exit 4, no merge attempted | Holds every row: `merger-app-invalid`, recorded once per (PR, head) as a `merge-hold` line |

Without the keys, the ruleset does not apply to an identity that holds `bypass_mode: always` — the #1730 behaviour. Declare `Merger app` to close it. A repository that is not on GitHub never reads either key.

**Writer App** — authenticates `plot-push-main.sh`'s lifecycle pushes to the
default branch (called from `/plot-approve`, `/plot-deliver`, and the ladder's
bookkeeping push). It is the one App of the three that legitimately bypasses
branch protection, because a lifecycle push IS the bypass case Plot relies on.

1. Create a GitHub App (for example `plot-writer`) with exactly:
   - *Contents:* write
   - No webhook, no event subscriptions.

   Install it on the repository only.

2. **Add it to the branch-protection bypass list for the default branch.**
   This is the one App in this section that belongs there — it never merges
   a PR, only pushes bookkeeping commits directly.

3. Generate a private key, save it outside the repository (mode `600`), and
   record it in `## Plot Config`:

   ```
   - **Writer app:** <app id>
   ```

   The key is found as for the Review App (`PLOT_WRITER_APP_KEY`, an optional path on the line, then `plot-writer.<app id>.private-key.pem` in the config folder).

4. Prove the write before relying on it: run a lifecycle action that pushes to the default branch (`/plot-approve` is the simplest), then run `git log -1 --format='%an <%ae>'` on the new commit and confirm it names the App's bot identity (for example `plot-writer[bot] <...>`), not your own `git config user.name` — and that stderr carries no `Writer app not configured` line. A declared key that is malformed or unreadable refuses with exit 4 naming `Writer app`, and `plot-push-main.sh` attempts no push.

**Merger App** — authenticates every `plot-host.sh pr-merge` call on GitHub.
It is NOT on the bypass list, anywhere, ever: a merge by it passes only when
`validate` and `plot/review` are green on the pinned head, which is the whole
point.

1. Create a third GitHub App (for example `plot-merger`) with exactly:
   - *Contents:* write
   - *Pull requests:* write
   - No webhook, no event subscriptions.

   Install it on the repository only.

2. **Do not add it to the branch-protection bypass list.** A bypass-listed
   merger recreates #1730 under a different name. If a later change proposes
   adding it, that change is the regression this section exists to prevent.

3. Generate a private key — a different key from the Writer App's, naming a
   different App id — save it outside the repository (mode `600`), and record
   it in `## Plot Config`:

   ```
   - **Merger app:** <app id>
   ```

   The key is found as for the Review App (`PLOT_MERGER_APP_KEY`, an optional path on the line, then `plot-merger.<app id>.private-key.pem` in the config folder).

   `plot-merger-token.mjs` refuses with exit 4, naming both keys, if `Merger
   app` and `Writer app` ever name the same App id: one credential holding
   both jobs would carry the writer's bypass-list membership into a merge.

4. Prove the write before relying on it: merge a scratch PR through
   `/plot-approve`'s or `/plot-dispatch`'s normal path and confirm the merge
   commit (or the PR's merged-by field) shows the App's bot identity
   (`<app-slug>[bot]`), not the maintainer's account. A declared key that is malformed or unreadable refuses with exit 4 naming `Merger app` before any `gh pr merge` call. `plot-host.sh` asks `gh repo view` first to learn the repo name, and attempts no merge if the token mint fails. The same proof holds for fleetd's own merge arm: a slice PR with green CI and `plot/review` success that fleetd merges with no `plot-ask.mjs merge` call and no person, evidenced by a `merge` record with outcome `merged as app` whose PR and head match the `gh pr view` read above.

A declared key follows the same refusal discipline as `Review app`: a key that cannot be used refuses by name and never falls back. An absent key falls back to the ambient identity and says so on stderr. Neither installation token leaves its minting process except through a request header, `GH_TOKEN`, or (for the Writer App's push) a `GIT_ASKPASS` helper reading a mode-600 temp file — never a child's argv, a file committed anywhere, or a log line.

Bitbucket is untouched by either App: `pr-merge` there keeps its own `bb`
path and its existing exit-4 refusal on an unpinned merge, and a `Merger app`
or `Writer app` key is a GitHub-only concern.

## The `plot/main` check

On 2026-11-23 a person merged #3682 on GitHub while `main` read settled red on `17a7fc438`, because the ruleset required no check that carried that reading. fleetd now writes the reading as a `plot/main` commit status on every open PR into the default branch. The status holds nothing until the ruleset requires it, and only a person with admin rights can make that setting.

### What writes it

fleetd's `plot/main` pass (`packages/fleet/src/shared/auto-main-status.ts`, run from `auto-writes.ts` on every fleetd pass) writes one commit status per open PR into the default branch, through `Host.commitStatus`. On GitHub it writes as the `Review app` identity, so the status is authored by `<app-slug>[bot]`. The domain rule `mainHoldStatus` (`packages/domain/src/rules/main-hold-status.ts`) decides each status:

| Reading | State | Description |
|---|---|---|
| The default branch is not red | `success` | `<branch> is not red` |
| The default branch is red, and the PR is the repair PR the record admits | `success` | `repair PR for <9 hex>` |
| The default branch is red, every other PR | `failure` | `<branch> is red on <9 hex>; merge the repair PR first` |

`<branch>` is the default branch's name, `main` in this repository. `<9 hex>` is the first 9 hex characters of the settled red commit. A PR into another base, such as `sprint/*`, gets no `plot/main` status.

**Absent is not red.** A missing, unparseable or other-version `.plot/state/default-branch.json` reads `success`, so a fleetd with no reading writes no `failure`. A reading older than `Checks wait` also reads `success`. The writer re-asks the head at least once per half `Checks wait`, so a red main that stays red keeps its reading fresh. A `success` on a red main can therefore mean "no fresh reading".

**The status is a mirror, and the reading is the answer.** Plot's own merge paths, `plot-ask.mjs merge` and fleetd's merge arm, read `.plot/state/default-branch.json` and never read `plot/main`. The required check holds the merges that go past Plot, such as a merge button on GitHub. `A Decision Reads The Index` in `CLAUDE.md` describes the reading.

### When it writes

The pass writes on change only: a new head, a changed wanted status, or a new repair PR. It keeps the last status it wrote per PR in `.plot/state/main-status.json`, so a restarted fleetd writes only what changed. A failed write is written again one hour later (`MAIN_STATUS_RETRY_MS`), or on the next pass where the head or the wanted status changed. When main settles green, fleetd writes `success` on every open PR in one pass.

The pass costs one host request per open PR per change. PRs that share a head and a wanted status cost one write per pass, because a commit status belongs to the commit. No rate for the `Review app` installation is measured here.

### Rollout order

1. **Prove the writer.** Run fleetd with the `plot/main` pass, open a scratch PR into main, and confirm a `plot/main` status on its head authored by `<app-slug>[bot]`.

2. **Confirm every open PR into main carries one.** A PR that has no `plot/main` status yet cannot merge once the check is required.

3. **Only then, add the required check.** A required check with no writer blocks every merge of that PR kind until a person removes the rule again, as step 5 above says for `plot/review`. Flip this setting last.

### The ruleset setting

Add `plot/main` to the required status checks of ruleset `main` (id `24412719`), beside `validate` and `plot/review`. Pin it to the `Review app`'s integration id, as `plot/review` is pinned, so a status that another identity writes does not satisfy it. In this repository that id is `5317669`. On 2026-11-26 the live ruleset (`gh api repos/plot-pm/plot/rulesets/24412719`) required `validate` (integration `15368`) and `plot/review` (integration `5317669`), with `strict_required_status_checks_policy: false`.

For another repository, read the Review app's id from the `Review app` key in its `## Plot Config`, or from the App's settings page on GitHub. That App id is the integration id the ruleset pins.

A PR opened or pushed while main is red shows no `plot/main` until the next fleetd pass, and GitHub refuses its merge until the status appears. This repository observes that behaviour for the absent `plot/review` status under the same ruleset. Nobody has observed it for `plot/main` yet.

### The bypass list

The ruleset's bypass list holds the admin role (`actor_id` 5, `RepositoryRole`), integration `5173644` and the `Writer app` (`5656981`), each with `bypass_mode: always`. An administrator's merge on GitHub still lands while main is red, and GitHub asks the administrator to confirm the bypass. The `Merger app` is not on the list, so the hold binds it. The hold binds every actor outside the list, and it shows on the merge button for the actors on it. Whether to remove the admin bypass is a decision for the repository, and this page does not make it.

### A failing `plot/main`

The description names the red commit. Merge the repair PR that `.plot/state/repair-record.json` names, or wait until main settles green. The repair PR's head branch has the shape `bug/main-repair-<12 hex of lastGreenSha>`, and a revert PR has the shape `bug/revert-<reverted PR number>`. The admitted repair PR carries `success` with the description `repair PR for <9 hex>`.

A failing `plot/main` is not a CI failure on the PR. Plot leaves `plot/main` out of a PR's `checks` and `failing_checks`, so a red main makes no open PR read `failing`, and a fix agent has nothing to fix there.

### A stopped fleetd

A commit status does not expire. If fleetd stops while main is red, every open PR keeps its failing `plot/main`, and GitHub refuses every merge outside the bypass list. This is the known cost of the hold. There are two ways out:

- Start fleetd again with `/plot-fleet --start` (`skills/plot/scripts/plot-fleetctl.sh --start`), or reload a running one with `/plot-fleet --restart`. Its next pass writes the current reading.
- A person on the bypass list reads the description and merges past the hold.

### Removing the check

Delete `plot/main` from the required status checks of ruleset `main`. The statuses stay on the heads and gate nothing. The code has no config key that turns the `plot/main` pass off, so removing the required check is the whole undo.

### Bitbucket

The same pass writes on Bitbucket: `plot-host.sh commit-status` sends a non-GitHub write to `plot-bitbucket-commit-status.mjs`, which writes a build status keyed `plot/main` as the account that `BITBUCKET_REVIEW_USER` and `BITBUCKET_REVIEW_APP_PASSWORD` name, not as the `Review app`. To hold merges there, a Bitbucket merge check such as "minimum successful builds" would need to require that build status; this setting is untested, and nobody has proved it on a Bitbucket repository.
