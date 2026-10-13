## Implementation brief — the-fleet-verifies-what-it-delivered (wave: the issues)

- **Plan (canonical):** [docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md](../../docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/a-refuted-claim-opens-an-issue` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (`Review: pr`)

Both branches this slice sits downstream of have merged: `feature/the-fleet-verifies-a-delivered-plan` (PR #1635, "The run and the tracker write") and `feature/a-tracker-opens-an-issue` (PR #1656). `issueOpen` already exists on the `Tracker` port (`packages/domain/src/ports/tracker.ts:85-104`, `:241`), wired through every implementation on `origin/main`: `trackerGitHost` and `trackerNone` both answer `unaskable` with their own reason already (`tracker-resolve.ts:103-105`), and real connectors answer `opened`/`failed` through `plot-host.sh issue-open` (`:4934-4948`, jira and github-issues). `trackerForIssues` resolves the right implementation from `issueSource`. None of that is this slice's work — it's all shipped. Run `plot-fleet-scan.sh --next the-fleet-verifies-what-it-delivered` yourself before starting to confirm this is still the eligible branch; state can move between this brief being written and read.

### What to build

The verify workflow (`plot-verify.mjs record`, `packages/board/src/server/entry/verify.ts:511-580`) already folds jurors into one verdict per claim and books a `Verified:` record with a `## Verification` section — but `verificationBody` (`packages/domain/src/rules/verification.ts:125-134`) renders a refuted claim's line with no issue reference at all, just `<lenses> refuted`. This slice is the one gap left in D11: wire `record` to call `issueOpen` once per refuted claim with no issue number yet, and make the line say so — `#1712` when one was opened, `no issue: <reason>` when the port answered `unaskable`.

1. **Resolve the tracker port for the issue write.** `record` needs `trackerForIssues(declared, gitHost, context)` (already imported by nothing yet in `verify.ts` — you're the first caller in this file) to get the `Tracker` implementation, then call `.issueOpen({ title, body, labels: ['ai-generated'] })` for each claim the fold marked `refuted` that has no recorded issue number. **Every repo-created-by-plot issue carries `ai-generated`** — that's a standing rule (`CLAUDE.md` "Quatico — shared agent preferences"), not new scope here, but it means the label is non-negotiable in the write, not a default you can drop.

2. **Idempotency lives in a new state file, `.plot/state/verify/<slug>.json`.** This path doesn't exist yet anywhere in the codebase — you're creating the convention, not following one. The plan's shape (*Issues for refuted claims*): write each opened issue's number to this file **before** the record's commit+push, keyed by claim text (not claim number — `--at` can read a Changelog whose order changed, so matching by number would silently reattach the wrong issue to a renumbered claim). On a re-run, a claim whose text already has a number in the file opens nothing again — this is what makes the whole operation safe to retry. `issueOpen` itself is **not** idempotent (the port doc says so explicitly: "the same call twice opens two issues — the port does not look for a duplicate. The caller records what it opened") — the state file is the only thing standing between a retried push and a pile of duplicate issues.

3. **A push that fails is retried from the state file, not from re-opening.** If `record`'s `commitAndPush` rejects (the existing `'rejected' in pushed` branch at `verify.ts:567-572`), the next run of `record` for this slug must read the state file, see which claims already have numbers, and open nothing for them — only the push is retried. Opening happens once per claim, ever, until the claim's text changes.

4. **The order matters and is already decided by the plan, don't re-derive it:** fold → open one issue per refuted claim with no number yet → write each number to the state file as it returns → *then* commit and push the record carrying those numbers. Opening before the state write would lose the number on a crash between the two; writing the record before the state file would lose the retry safety net.

5. **`verificationBody`'s refuted-line rendering changes.** Currently (`verification.ts:125-134`) a refuted line is `- Claim-N refuted — <claim> — <lenses> refuted[; <lenses> supported]`. It needs the issue reference appended: `#<number>` when `issueOpen` succeeded (or a prior run already recorded one), `no issue: <reason>` when the port's write answered `unaskable` or `failed`. The `<reason>` is the port's own `lastRefusal()` text, verbatim — not a paraphrase, not "no tracker configured" written by hand. This repository itself declares no `Tracker` key, so its own runs will open zero issues and every refuted line here will read `no issue: no Tracker declared; the git host's issues are read-only to Plot` (the `trackerGitHost` reason) or whatever `trackerNone`'s `issueSource`-stated reason is — confirm which one applies by checking this repo's `## Plot Config` for a `Tracker` key (there isn't one) and reading `issue-source.ts:51-63` for the exact sentence `trackerNone` gives.

6. **A `failed` issueOpen with `lastRefusal` prefixed `the issue may exist: ` is not a `no issue:` case to treat casually.** The port's doc is explicit: that prefix means the call may have reached the tracker and the caller doesn't know. Render it with the full reason text (so the prefix shows), and do **not** treat `failed` as safe to silently retry by opening again next run — the state file only prevents a retry once a number is known; a `failed` write with no number recorded will be retried, and that's a known, named risk the plan accepts rather than solves (there's no dedup-by-search mechanism here, by design — "the port does not look for a duplicate").

### Done when

The plan's `## Changelog` entry for this slice is the spec: *"the verify workflow opens one `ai-generated` issue per refuted claim with no number; the numbers in `.plot/state/verify/<slug>.json` before the push; the retried push; issue numbers carried by claim text on a re-verification; the `no issue: <reason>` line."* Each clause there is a test:

- A refuted claim with no prior number gets exactly one `issueOpen` call, labelled `ai-generated`, and its number lands in the state file before the commit.
- A re-run (same claim text, number already in the state file) opens nothing and reuses the number.
- A re-run after a rejected push re-pushes without re-opening any claim that already has a number.
- A claim whose text changed between runs (simulating a `--at` reread with reordered Changelog) is treated as a new claim — it opens its own issue rather than inheriting the old one's number by position.
- `trackerGitHost`/`trackerNone`'s `unaskable` answer renders `no issue: <reason>` verbatim, not a rewritten sentence.
- A `failed` outcome (including the `the issue may exist: ` prefix case) renders with the full reason and is not falsely recorded as having a number.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` (resolved from this skill's own directory) before each push and run what it prints — it names the tests and typecheck for whatever you touch in `packages/domain` and `packages/board`. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest coverage run, `test/reconcile/*.test.mjs`) run in CI on the PR; do not run them locally as a matter of course (see `CLAUDE.md` Testing — `test:e2e` is CI's gate, not a local one). Add a changeset (`bumps: plot: patch` at minimum — check whether `verificationBody`'s signature or `verify.ts`'s CLI surface changed enough to warrant `minor`).

Name the shell gate too: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is mostly TypeScript (`verification.ts`, `verify.ts`) — if you touch no `.sh` file, this gate is a non-issue; if you do, growth must be paid for by removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads this plan, names the branch's wave heading ("The issues") as the PR title, and refuses a branch no plan names or one a PR already carries. Push your first real commit as soon as it exists — don't wait for the whole slice before the branch shows activity.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under "### The issues":

```
- `feature/a-refuted-claim-opens-an-issue` — ... <!-- builds: one issue per refuted claim --> → #<number>
```

No project board is configured in this repo's `## Plot Config`, so skip the "Ready" status step.

### Scope guard

This branch owns: `packages/domain/src/rules/verification.ts` (the refuted-line rendering), `packages/board/src/server/entry/verify.ts` (the `record` function's issue-opening and state-file logic), and the new `.plot/state/verify/<slug>.json` convention (add it to `.gitignore` beside `.plot/state/` if not already covered — check first, `.plot/state/` as a whole is already ignored per `.gitignore:30`, so this file likely needs no new entry).

This is the last branch of the plan's final wave ("The issues", standalone — no sibling in this wave) and the plan's last wave is "The checklist" (`feature/the-fleet-keeps-the-release-checklist`), which touches `docs/releases/vnext-checklist.md` and `skills/plot-release/SKILL.md` — no file overlap with this slice. No other branch of this plan is in flight concurrently as of this writing (confirm with `/plot-pulse` before you start, since that can change).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
