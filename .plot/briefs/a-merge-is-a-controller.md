## Implementation brief — the-fleet-reports-what-changed-on-the-host (wave 8: A merge is a controller)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1451 merged
- **Branch:** `feature/a-merge-is-a-controller` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Last wave of the plan. Its wait, `feature/the-controllers-are-commands`, merged as #1457 on 2026-10-10, and the readings it consumes have merged too (`defaultBranchRed` in `rules/default-branch.ts`; `headSha` and `checksSha` on `PrIndexRowSchema`). Nothing waits on this branch.

### What to build

**The failure it fixes.** On 2026-10-09 six merges went through `merge-on-green.sh`, a script in the job's temp directory. Its merge rule was never in a diff, never tested and never seen by a reviewer, and the #1444 watcher aborted twice because the head moved between the check and the merge. A master agent merges today through `gh pr merge` or `plot-host.sh pr-merge`, and nothing re-asks the host first. This slice makes the merge a controller (CLAUDE.md, *The Master Agent Uses The Controllers*).

The behaviour, from plan step 8:

1. `node skills/plot/scripts/board/plot-ask.mjs merge <pr> <sha>` asks a domain workflow. The workflow does not read the PR index: the index decides only whether to *try*, and a merge cannot be undone.
2. The workflow re-asks the host through `pr-state` and refuses unless **all four** hold: the head equals `<sha>`; the check rollup is green *for that head*; the PR is not a draft; `defaultBranchRed` is not `red`. Each refusal names its reason and the reading it saw.
3. On a pass it merges through `ctx.scripts.host(['pr-merge', …])`, the path `entry/approve.ts` uses. `PrMergeWrite` (`workflows/decision.ts`) gains an optional `sha`; the plan-approval merge in `approve.ts` passes its head, and the ladder merge in `ladder.ts` passes none and behaves as today.
4. `plot-host.sh pr-merge` takes `--match-head <sha>` and passes `--match-head-commit <sha>` to `gh`, so a push between the check and the merge fails at the host and not here.

`release-claim` in `entry/main.ts` is the precedent for a **write** verb on `plot-ask.mjs`: it is not a `Question` (`ask.ts:46`), it dispatches on `argv[0]` before `questionFrom`, and it prints one JSON line. Follow that shape and update the usage strings. Do not add `merge` to `Question`: the three questions read and this one writes.

### The decisions the plan settles — do not re-derive them

**The host decides, not the index.** The index can supply `MERGED` and nothing else (CLAUDE.md, *A Decision Reads The Index*: "the index never says no"). A merge is irreversible, so a stored `checks: green` and a stored `headSha` are never the licence. The workflow reads `pr-state` fresh and compares its head to the caller's `<sha>`. Rejected: reading `headSha` and `checksSha` from the PR index, because they are the fold's answer at one instant and the whole point of the slice is that the head moved between a reading and a merge.

**One fold, and it stays in the shell.** `pr-state` gains the head commit (`headRefOid`) and the folded check word, computed by the *same* jq fold `pr-list` uses for the rollup (`plot-host.sh`, the `statusCheckRollup` fold around `:4217`; the plan cites `:3496`, which has drifted, so find it by the `statusCheckRollup` name). A second fold in TypeScript would be a second implementation free to disagree about what `green` means; the plan chose one fold in the shell. The rollup belongs to the head commit, so `checksSha = headSha` on this arm. `pr-state` has three GitHub paths (the `gh pr view` path, and the REST number and branch paths through `rest_pr_to_state`); all three must carry the new fields, and a path that cannot supply the rollup answers `unknown` and never `green`.

**Refusals, each with a name and one test.** The plan's Done-when requires one test per refusal, "including `checks-unbound` and `unaskable`". The set:

| Refusal | Holds when | Why it exists |
|---|---|---|
| head moved | `pr-state` head ≠ `<sha>` | the check the caller read is for another commit |
| checks not green | the rollup for that head is `failing`, `pending` or `none` | a green-looking PR with pending checks was the 2026-10-09 near-miss |
| `checks-unbound` | the check source carries no commit (Jenkins: job colours per branch) | a green that names no commit cannot be bound to `<sha>` |
| draft | the PR is a draft | `gh pr merge` would fail late, after the reads |
| default branch red | `defaultBranchRed(reading)` is true | merging onto a red `main` stacks a second change on an unproven base |
| `unaskable` | the host did not answer, or the host is Bitbucket | absent is not green; Bitbucket has no `--match-head-commit`, so the pin cannot be given |

Refusals are the end of the action (CLAUDE.md: "what the controller refuses does not happen"). The workflow's output names the reason; nothing falls through to a retry with the pin dropped.

**Bitbucket answers `unaskable` and merges nothing.** The Bitbucket `pr-merge` arm (the `else` branch of `pr-merge`, near `plot-host.sh:3895`; the plan cites `:3827-3832`, drifted) refuses `--match-head` and does not ignore it. Rejected: merging on Bitbucket without the pin, because that is the exact race the slice closes, reported as success.

**`--match-head-commit` is the pin, and the fixture must prove it is passed.** A unit test that asserts the workflow *decided to merge* proves nothing about the host call. The plan's Done-when asks for "a host fixture proves `--match-head-commit` is passed": drive `plot-host.sh pr-merge <n> --match-head <sha>` against a `gh` stub in `test/reconcile/host.test.mjs`'s fixture style and assert the argv contains `--match-head-commit <sha>`. Read the memory notes before extending that file: `host.test.mjs` cannot complete under load, so run the names you touched and not the whole file; and a test `run()` must clear `PLOT_UNATTENDED`.

**Rules carried over unchanged:**

- **Absent is not green.** A missing rollup, an unparseable `pr-state`, a missing head and a missing default-branch reading each refuse. `defaultBranchRed(null)` is `false` by its own rule (no reading holds nothing), so the workflow must treat *no reading* as a fact it reports, not as permission: when the reading is absent, say so in the output and let the other three checks decide.
- **Read the exit code, not the emptiness.** `pr-merge` failing is a refusal from the host, not a merge that "probably" happened. Report `host refused`, with its message.
- **The `State:` gate is not involved.** This slice writes no plan `State:` line.

### Done when

The plan's slice line is the specification: *the workflow has one test per refusal, including `checks-unbound` and `unaskable`, and a host fixture proves `--match-head-commit` is passed.* The assertions that exist because a naive implementation passes without them:

- **A head that moves between `pr-state` and `pr-merge` fails at the host.** Catches a workflow that checks the head and then merges without the pin. The fixture host returns the old head to `pr-state`, then rejects `pr-merge` unless `--match-head-commit` equals it.
- **A pass merges with exactly the caller's `<sha>`, not the head that `pr-state` read.** Make the two equal in the happy path and different in a second test (a refusal), so a workflow that pins the wrong value is caught.
- **`ladder.ts` still passes no sha, and `approve.ts` passes its head.** Catches an optional field made required, or the existing callers silently unpinned.
- **A rollup that is `green` for another commit refuses.** On the GitHub arm `checksSha = headSha`, so build the row where they differ (a stale rollup) and expect `checks-unbound` or a head refusal, not a merge.
- **A Bitbucket host merges nothing and says why.** Assert the `bb` stub received no `pr merge` call.
- **Argv shapes.** `plot-ask.mjs merge` with a missing `<pr>` or `<sha>` exits 2 with the usage line, and a non-numeric `<pr>` exits 2.

Plus: add the changeset (package `plot`, description first and the `bumps:` block last, with a `plan:` line inside it). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, no `test:e2e`, and no board tests while the operator's board is open.

**Shell gate.** This slice touches `plot-host.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, so the lines `pr-state` and `pr-merge` gain are paid for in the same change: remove shell elsewhere, or write a rule in the domain and ask it through a bundle. The gate stores no number and has no override. The plan's *Shell changes* table says the same for slice 8. Also run `./scripts/check-host-cli-callers.sh`, since the change sits in the one script allowed to call the host CLI.

**Bundle.** `plot-ask.mjs` is a generated bundle. Test locally with `pnpm build:board`, then restore every generated path before you push: a PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`), and `main` builds its own.

A function you write is an arrow, in the domain and in the board alike. A TSDoc block states behaviour (what it returns and how it fails), not history; the reasoning goes in the commit message.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `### A merge is a controller` in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- If you touch `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`. The plan does not require a CLAUDE.md change here; the *Master Agent Uses The Controllers* section lists the controller endpoints, and if the PR adds `merge` to that list, make that edit in the same PR.

### Scope guard

This branch owns: the merge workflow under `packages/domain/src/workflows/` with its tests, `PrMergeWrite` in `workflows/decision.ts`, the `merge` verb in `packages/board/src/server/entry/main.ts` (and the entry file it calls), the one-line `sha` pass in `entry/approve.ts`, `pr-state` and `pr-merge` in `skills/plot/scripts/plot-host.sh` with the `test/reconcile/host.test.mjs` cases for them, the changeset, and the `→ #N` annotation.

It does not touch: the PR index schema or `pr-refresh.ts` (slice 1 owns them), `rules/default-branch.ts` (slice 2; call `defaultBranchRed`, do not edit it), the channel and the `IndexMonitor` (slices 3 and 4), the board app (`packages/board/src/app/**`), or the mod folder (slice 7).

In flight on origin as of 2026-10-10: only `feature/a-merged-pending-check-is-asked-again`, which holds the PR refresh and shares no file with this branch. No collision is known. `feature/the-controllers-are-commands` is merged (#1457) and its JS entries (`plot-dispatch-command.mjs`, `plot-continue-command.mjs`) are the model for an entry that runs with no board.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
