## Implementation brief — fleetd-merges-no-slice-pr-while

- **Plan (canonical):** [docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md](../../docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md) on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3068 merged
- **Branch:** `feature/fleetd-merges-as-the-merger-app` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `plot-open-pr.sh`, `plot/review` success required

This is the plan's only slice and only wave — no branch to wait on and none waits on this one.

### What to build

Every slice PR with a green head and clean `plot/review` is currently stuck waiting for a person, because `auto-merge.ts:183` sets `mergerAppMissing` whenever the host is GitHub and `## Plot Config` names no `Merger app`, and `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:346`) holds every such PR on `merger-app-missing`. This repo declares no `Merger app` today, so fleetd holds everything and a person merges by hand through `plot-ask.mjs merge`.

Build the mechanism that lets fleetd merge as a narrow GitHub App (the `Merger app`) instead of the signed-in identity — without ever putting that App on the ruleset's bypass list. The App merges only because the ruleset requires 0 approvals and two status checks (`validate`, `plot/review`), so GitHub itself still enforces both on every fleet merge. No App is installed yet (that's a person-step, out of scope for this slice); the code must build and test green with none installed.

### The decisions the plan settles — do not re-derive them

**The merger App is deliberately NOT on the ruleset's bypass list.** The first draft of this plan proposed a bypass entry; jwloka rejected it 2026-11-03 because a bypass-listed merger recreates issue #1730 under the App's name instead of the admin's. The App's merge authority comes entirely from satisfying the two required checks — never from a bypass grant. Do not add the App to `docs/review-status-rollout.md:181-196`'s bypass list as a "simplification."

**`resolveApp` (`skills/plot/scripts/plot-github-app.mjs:45-62`) already does the validity checks — the new `--check` mode reuses it, it does not reimplement it.** `resolveApp('Merger app', here)` already distinguishes absent, malformed, unreadable-key-file, and same-App-id-as-`Writer app` (verified by reading `plot-merger-token.mjs:1-50`, which calls exactly this and refuses with codes 5/4/4/4 respectively). Add a `--check` argument to `plot-merger-token.mjs` that runs the same `resolveApp` call and the same `Writer app` equality check, but mints no token and prints nothing on stdout: exit 0 for usable, 4 with the reason on stderr for invalid (malformed, unreadable key, same App id as `Writer app`), 5 for absent. Any other exit code or a failed process start is the adapter's `unread` case — not a fourth exit code to invent here.

**One pure domain rule decides the identity — `mergeArm` must stop encoding "declared = non-empty string."** Today `auto-merge.ts:183` reads "declared" as `readConfig(opts, MERGER_APP_KEY, '') !== ''`, which is wrong: a malformed key reads as declared, so fleetd tries the merge, the host refuses it, and `mergeTick` records only `host-refused` — no named reason reaches the hold (measured in the plan's Motivation: this is today's actual failure mode, not a hypothetical). Build `mergeIdentity` in `packages/domain/src/rules/merge-identity.ts` as a pure function over `{ backend, mergerApp }` answering `app` | `host` | a hold (`merger-app-missing` | `merger-app-invalid` | `merger-app-unread`) per the plan's Approach table. `SlicePrNextReadings` drops `mergerAppMissing` (boolean) and gains `backend` and `mergerApp` (the reading); `mergeArm` calls `mergeIdentity` at the current `:346` call site instead of checking the boolean directly.

**A failed read must hold, never merge.** `config-reader.ts`'s `readConfig` collapses "key absent" and "read failed" into the same fallback — that ambiguity is exactly what let a malformed key slip through today. The new adapter does NOT go through `readConfig`; it shells to `plot-merger-token.mjs --check` and maps exit codes directly, so a crashed `plot-config.sh` (which `resolveApp` already reports as not-absent, exiting 4) holds `merger-app-invalid`, and a start failure or unrecognized exit code holds `merger-app-unread`. No path may read "the check didn't run" as "no key declared, merge as host."

**Repair and revert PRs go through the identical merger check — this slice does not special-case them.** `repairMergeVerdict`'s admission (`slice-pr-next.ts:331-346`) happens before the merger-identity check runs, so a repair/revert PR that the repair rule admits on a red default branch still holds on `merger-app-missing`/`invalid`/`unread` with the same semantics as any other PR, or merges as the App when the key is usable. Don't route these PRs around `mergeIdentity`.

**Merge attempts and merger holds get action-log records — this slice adds the append, nothing upstream changes.** `runAutoMergePass`'s result is discarded today (`auto-writes.ts:92` calls it but nothing logs). Follow the exact shape `auto-review.ts:240-260`'s `logReviewStart` already uses for review starts: one `merge` record per merge attempt (PR, head, outcome — `merged as app` / `merged as host` / `failed: <reason>`), and one `merge-hold` record the first time a (PR, head, reason) combination holds on a merger reason, deduplicated the same way `logged` dedupes review-start failures (a `Set` keyed on `${pr}:${head}:${reason}`) so a second pass with the same hold appends nothing.

**`release-pr` stays refused for fleetd regardless of identity — this slice does not touch that.** `mergeTick` already calls `mergeAt` with `viaReleaseApprove: false` (`auto-merge.ts:115`); `plot-ask.mjs merge` and the person-driven `release-approve` path are unchanged by this plan.

**Bitbucket is untouched.** `mergeIdentity` answers `host` for any non-GitHub backend without even reading the `Merger app` key — fleetd keeps merging there as the `bb` identity, exactly as today. The plan explicitly argues nothing about whether that identity bypasses Bitbucket merge checks; don't extend scope into that question.

**`#3072` (pr-review taking the newest `plot/review` status from any writer) is NOT a precondition.** Under the App, the ruleset still binds the `plot/review` check to integration 5317669 specifically, so a status written by a different writer still fails the ruleset's requirement regardless of what the merge controller's own review re-read does. Leave `#3072` open; it matters for `plot-ask.mjs merge` and Bitbucket, not this slice.

### Done when

The plan carries no separate `## Done when` heading — treat the Design section, the Decision's three points, and the `### Tests` section as the specification together:

- `packages/domain/test/merge-identity.test.ts` (new) passes: `github`+`usable`→`app`; `github`+`absent`→hold `merger-app-missing`; `github`+`invalid`→hold `merger-app-invalid`; `github`+`unread`→hold `merger-app-unread`; `bitbucket` with every reading→`host`.
- `packages/domain/test/slice-pr-next.test.ts:405-408` (rewritten) and the repair-arm addition pass per the plan's `### Tests` section — each fails today because `mergeArm` currently reads only the boolean `mergerAppMissing`.
- `packages/fleet/test/unit/auto-merge.test.ts` passes for both the identity seam (`runAutoMergePass` takes an injectable `Merger app` reader, defaulting to the real adapter, the same way it already takes `alive`) and the merge-record appends (one `merge` + dedup'd `merge-hold` per pass).
- `test/reconcile/github-app-absent.test.mjs` (or a sibling) passes for `plot-merger-token.mjs --check`'s five exit-code cases (5 absent, 4 malformed, 4 unreadable key file, 4 same App id as `Writer app`, 0 usable-with-no-network-call).
- The docs/comments listed in the plan's `### Docs and comments` section are updated in this same branch: `repair-record.ts:18-20`'s stale `exhausted` reason, `DESIGN-delivery-loop.md:37`/`:175`, `docs/review-status-rollout.md:146-151` and `:205-210`, and `skills/plot-init/SKILL.md` + `skills/plot-board-setup/SKILL.md` naming the `Merger app` key (with their Model Guidance tables and changeset bumps updated accordingly). `CLAUDE.md`'s `## Plot Config` line is a person-step — do not add it here.

Plus: the repo's gates — no committed `board-server.mjs` diff, a changeset naming `plot` or `@plot-pm/board`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps the changed `packages/domain/**` and `packages/fleet/**` paths (and the shell gates below) to the right suites. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds a `--check` mode to `plot-merger-token.mjs` (a `.sh`-adjacent `.mjs`, but the gate counts shell under `skills/` broadly — confirm against the gate's own scope) — if it grows tracked shell line count, pay for it in the same change: remove shell elsewhere, or push logic into the domain and call it through a bundle. The gate counts commands, not lines; joining statements with `;`/`&&` or folding `fi`/`done` onto the previous line is not a payment.

`scripts/check-host-cli-callers.sh` gates the one place that may talk to the host CLI — this slice's new adapter must shell only to `plot-merger-token.mjs`/`plot-github-app.mjs`, never to `gh` directly.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch shows activity.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/fleetd-merges-as-the-merger-app` under `### Merge as the Merger app`).

### Scope guard

This branch owns everything in the plan: `mergeIdentity` in the domain, the `plot-merger-token.mjs --check` mode and its new adapter, the `SlicePrNextReadings` change (`backend`/`mergerApp` replacing `mergerAppMissing`), the `merge`/`merge-hold` action-log records, the docs/comments listed in `### Docs and comments`, and the `skills/plot-init` / `skills/plot-board-setup` updates naming the `Merger app` key.

It does not own: creating or installing the GitHub App itself, or writing the `Merger app` key into this repo's `CLAUDE.md` — both are person-steps in the plan, done after this slice merges. It does not own `#3072` (pr-review's any-writer read) or any change to `plot-ask.mjs merge`, `mergeAt`'s existing review re-read, or the Bitbucket merge path — all explicitly unchanged by this plan.

This plan has no sibling branch in flight — it is the plan's only slice and only wave.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
