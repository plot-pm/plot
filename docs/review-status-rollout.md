# Rolling out the `plot/review` required check

A PR merges only when a passing `plot/review` commit status sits on its
current head. `docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md` designs
the gate; this page is the one-time human setup — creating the App, storing
its key, and switching the branch rule on — for a repository adopting it and
for this repository's own rollout.

## What writes the status today

Three call sites write `plot/review` once a PR's head is ready to merge:

| PR kind | Writer | State |
|---|---|---|
| A PR reviewed by `plot-review` | `skills/plot/scripts/board/plot-review.mjs` | `success` (no HIGH finding) or `failure` (one or more, with the follow-up issue as `target_url`) |
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
   - **Review app:** <app id> <key path>
   ```

   Write the key path as an absolute path. The resolver does not expand `~`,
   so `~/.config/plot/…` is refused with exit 4 (#1706).

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
`pr-review` is GitHub only; on Bitbucket it exits 4 and every PR reads as
unread.

## For this repository

The App exists (`plot-review` on `plot-pm`, installed on `plot-pm/plot` only)
and the `Review app` key is recorded in the `## Plot Config` section of
`CLAUDE.md`. Steps 1–3 above are done. Step 6 — the ruleset rule requiring
`plot/review` — is deliberately **not yet added**: this plan's own sequencing
requires it last, after the writers above (this wave) are merged and proven
in production, not merely written. Flipping it earlier would hold every PR
merge the moment any one PR kind's writer has a bug this wave's tests did not
catch.
