# plot-reap --yes deletes a different set than its --dry-run showed

> `plot-reap --yes` re-decides every local branch instead of acting on the set `--dry-run` showed, so the operator approves one set and the run deletes another. The reaper also keeps no record of a deleted tip, prints a host that could not answer as "no merged PR", and deletes commits added after a merge.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2825
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2828 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/plot-reap-pins-every-tip-it-deletes`

## Changelog

- `plot-reap --yes` pins every local branch it deletes under `refs/plot/reaped/<branch>/<sha>`, which `git gc` keeps, and prints a restore command on each `deleted` row. A branch whose pin cannot be written is kept. A later run removes reaped refs older than 30 days.
- A branch whose merge state the host could not answer, or answered while rate-limited, prints as its own `keep` reason instead of "unlanded work — no merged PR". This covers an `unknown` answer, a failed call, a failed call with no message, and a failure whose message says only "not found".
- `plot-reap` keeps a local branch that carries commits added after its merged pull request, and deletes a branch as "merged into <default>" only when the branch had commits of its own.
- `plot-reap --yes` deletes only what the recorded `--dry-run` showed and a fresh local check still allows, and asks the host again for each row recorded as "PR merged". It refuses a record from another checkout or an old record, and the dry run shows a branch that this run frees by removing its desk.
- `plot-reap --yes --plan-slug <slug>` reaps only that plan's desks and branches, in one run and with no record. Automatic delivery and the `/plot-reconcile` repair for a refused-empty desk run it.
- `plot-reap --sweep-temp --yes` runs as before, with no record.

<!-- Board impact: none expected. The board does not parse reap rows. The record is a new file under the common git dir; the plan format, the template and the docs/plans layout stay unchanged. -->

## Motivation

Issue #2825 reports one run on ewz-kus-portal (Plot 2.29.0, Bitbucket, account rate-limited, see #2815). `plot-reap.sh --dry-run` listed the branches it would delete, and the operator bundled exactly that set before approving. `plot-reap.sh --yes` then deleted a different set:

| branch | dry run | `--yes` run |
|---|---|---|
| `migration-abw-rechnungsempfaenger` | keep — unlanded work, no merged PR | deleted — PR merged (squash) |
| `feature/EWZREL-9391`, `feature/EWZREL-9832-adds-http-headers` | not listed | deleted — merged into develop |
| 6 branches (e.g. `marc/magellan-integration`, `slice/EWZREL-9386`) | would — PR merged (squash) | kept |

Panel round 1 ran the shipped bundle against sandboxes and reproduced every row. `git diff v2.29.0 HEAD` on `reap.ts` and `sweepable.ts` is empty, so the citations below hold for the operator's version. `--dry-run` and `--yes` share `runBranchKind` (`packages/board/src/server/entry/reap.ts:980`) and split only at `:1043`, so each run decides every branch again. Four causes make two runs disagree or lose work.

**1. A host that cannot answer prints as "no merged PR".** Under a rate limit the host never invents `merged`: GitHub prints `merged` only from an answered list with a `mergedAt` (`skills/plot/scripts/plot-host.sh:4238`), Bitbucket only from an answered row with `state == "MERGED"` (`:4257`), and a failed call goes to `miss_or_unknown` (`:658`), which answers `not-merged` or `unknown`. The port maps exit 3 to `MergedAnswer 'unknown'` (`packages/domain/src/adapters/host/host-shell.ts:309-315`, `packages/domain/src/ports/host.ts:33`) and keeps the refusal kind, including `throttled`, in `lastRefusal()` (`host.ts:87-88`). `runBranchKind` reads only `merged` as true (`reap.ts:1005-1009`), and `firstBranchRefusal` takes a boolean `hasMergedPr` (`packages/domain/src/rules/sweepable.ts:38,73,99`), so `unknown` prints as "unlanded work — no merged PR" (`reap.ts:1022-1023`). The `migration-abw` dry-run `keep` was a degraded answer and the `--yes` `PR merged` the true one; the 6 `would → kept` rows are the same mechanism in reverse. Both outcomes keep the branch, but the operator cannot tell a degraded answer from a real one.

**2. The worktree kind frees branches for the branch kind in the same run.** `runReap` runs the worktree kind first (`reap.ts:1268-1269`). Under `--yes` it removes a landed desk (`:902`) and keeps its branch unless the desk was given up (`:910-912`). The branch kind then lists checkouts again (`:989-992`), finds the branch free and deletes it. Under `--dry-run` nothing is removed, so the same branch prints `keep — checked out in a worktree`. No host answer is involved; three jurors reproduced it, and it matches the `feature/EWZREL-*` rows.

**3. Each run fetches the default branch.** `runReap` calls `ctx.fetch(defaultBranch)` (`reap.ts:1245`), so `origin/<default>` can move between the dry run and `--yes`, and `refs.contains` (`:1000`) turns `yes` for a branch that landed in between.

**4. A commit added after the merge is lost.** The branch kind deletes on "a PR on this branch name merged" and never compares the local tip with the merged PR's head. The worktree kind does compare them (`unpushedCommits`, `prMergedHeads`, `reap.ts:435-462`). A sandbox branch with one commit after its merged head printed `would` and was deleted, and the commit exists on no remote. Containment has a second false case: a branch with no commits of its own reads as contained (`merge-base --is-ancestor` exits 0) and is deleted as "merged into develop". The ancestry marker at `packages/domain/src/adapters/refs/refs-git.ts:763-765` licenses a caller that sends a `yes` on to the host, but reap decides deletion from it (`reap.ts:784,1001`), and `scripts/check-ancestry-decisions.sh` cannot see `Refs.contains` consumers.

**No deletion is recorded.** `deleteBranch` runs `git branch -D` (`packages/domain/src/adapters/trees/trees-git.ts:486-487`) and discards the tip it prints. The reaper deletes local branches at three sites: the worktree kind's given-up arm (`reap.ts:911`), the branch kind (`:1048`) and the claim kind (`:1171`). The operator recovered the tips only by pinning every dangling commit by hand, and the issue cannot rule out cause 4 for `migration-abw`. `skills/plot/scripts/README.md:49` still says "Branches and refs are untouched".

**The summary counters are correct as designed, and they read wrongly.** `branches_deleted` increments only beside a `deleted` row (`reap.ts:1049-1051`). `branches=` counts swept branches (would, deleted and FAILED), so a FAILED row counts in both `branches=` and `branches_kept=` (`:1042,1054`). The worktree kind's given-up delete (`:911`) is reported inside a worktree row and never reaches `branches_deleted`, and the claim kind prints its own `deleted` rows (`:1173`). The issue's totals add up (38 + 18 = 37 + 19 = 56), so no delete failed in that run.

## Design

### Approach

The decision stays in the domain, per *The Layering Rule* in `CLAUDE.md`: the reap entry passes readings as values, and pure rules in `packages/domain/src/rules/sweepable.ts` answer whether a branch, or a recorded row, may go. Record I/O lives in the entry or an adapter, never in `rules/`.

**Slice 1 — every deleted tip is pinned.** Before each local delete, at all three sites (`reap.ts:911,1048,1171`), the reaper writes the tip to `refs/plot/reaped/<branch>/<sha>` and appends one row (ref, SHA, UTC write time) to `.plot/state/reaped.tsv` under the common git dir. No pin, no delete: when the ref write or the row append fails, the reaper keeps the branch with the reason `keep — could not pin the tip`. The `<sha>` leaf means no pin ref ends at a branch name, so `refs/plot/reaped/feature/<sha>` and `refs/plot/reaped/feature/x/<sha>` coexist, while `refs/plot/reaped/feature` and `refs/plot/reaped/feature/x` would clash as file and directory. The leaf also keeps both tips when the same branch name is reaped twice; a second pin at the same tip writes the same ref and counts as pinned. One clash remains: a branch whose last name component is a full 40-hex SHA that another reaped branch used as its leaf. Its pin write fails, and the branch stays. `git gc` keeps objects that a ref reaches, and the default refspec does not push `refs/plot/*`. Each `deleted` row prints its restore command, for example `restore: git branch <branch> refs/plot/reaped/<branch>/<sha>`. The next run deletes each reaped ref whose TSV row is older than 30 days, and removes that row. A reaped ref with no row has no known age, and the prune keeps it. The age comes from the TSV and not from a reflog or the commit: git keeps no reflog for `refs/plot/*` under `core.logAllRefUpdates=true`; `git update-ref --create-reflog` adds one, but `gc.reflogExpire` and `git reflog expire` remove its entries on a schedule the repository owner sets, not Plot; and the `<sha>` commit's date is when the commit was made, not when it was pinned. The delete itself stays `git branch -D`, which refuses a checked-out branch; `git update-ref -d <ref> <old>` deletes a branch checked out in a worktree (exit 0, measured), so pinning the tip never replaces the checked-out refusal. `listBranches` does not read `refs/plot/reaped/*`. The slice corrects `skills/plot/scripts/README.md:49` ("Branches and refs are untouched"), which the branch and claim kinds already make false and the new reaped refs contradict further.

**Slice 2 — a host that did not answer is its own reason.** `LocalBranchReadings` carries the host answer as `MergedAnswer` (`merged | not-merged | unknown`) plus a refusal kind, instead of a boolean. `branchSweepProblems` returns `host-unknown` or `host-throttled` for every reading in which the host did not answer, and the row reads `keep — the host could not answer` (`keep — the host could not answer, rate-limited` for `host-throttled`), never "unlanded work — no merged PR". The branch is still kept. Four cases reach these reasons:

- **An `unknown` answer.** `pr-merged` prints `unknown` or exits 3, and the port answers `MergedAnswer 'unknown'` (`host-shell.ts:309-323`). Both paths clear `lastRefusal()` (`:314`, `:242-243`), so this reading carries no refusal kind and gives `host-unknown`.
- **A failed port result.** `!hostMerged.ok` (read at `reap.ts:1005-1006`) is not a `MergedAnswer`. The entry reads `lastRefusal().kind` (`host.ts:87-88`), which `record` sets for every other non-zero exit (`host-shell.ts:244-247`): `throttled` and `secondary` give `host-throttled`, and `failed` gives `host-unknown`.
- **A failed call with empty stderr.** `miss_or_unknown` (`plot-host.sh:658`) answers `not-merged` today. The slice changes it to answer `unknown`, so the port answers `unknown` and the row gives `host-unknown`.
- **A failure whose stderr matches only the bare `not found`.** `miss_or_unknown` calls `is_lookup_miss` (`plot-host.sh:2293-2296`), whose bare `not found` alternative matches "repository not found" and "404 Not Found", and answers `not-merged`. The slice gives `miss_or_unknown` a narrower miss test: only the two pull-request phrases (`no pull requests found|match`, `could not find … pull request`) count as a miss, and every other failure answers `unknown`. This is safe on both backends, because `pr-merged` reports an absent PR as a successful empty list, not as a failed call (`plot-host.sh:4238` on GitHub, `:4257` on Bitbucket). `is_lookup_miss` itself stays unchanged, because `miss_or_exit3` (`:654`) and `:2348,4367,4379` read it for other questions. `miss_or_unknown` has two callers, both in `pr-merged` (`:4241,4260`).

Both `plot-host.sh` changes only turn a `not-merged` into an `unknown`, which every `pr-merged` caller reads as "do not remove".

**Slice 3 — commits after the merge stay.** The branch kind reuses the worktree kind's guard (`prMergedHeads`, `unpushedPatches`, `reap.ts:435-462`): a branch whose local tip is past every merged PR head, with patches not on `origin/<default>`, is kept with its own reason. `hasMergedPr` splits into a host answer and a containment answer. Containment deletes a local ref only when the branch had commits of its own; a branch with none is kept. The slice amends *One Answer To "Did This Land"* (`CLAUDE.md:578`), which says a destructive decision reads the host's `mergedAt` and nothing else, to name this exception: containment may delete a **local ref**, because slice 1 pins its tip, and never a remote ref, a desk or a phase. It also corrects the `refs-git.ts:763-765` marker so it names reap's use, or adds a reap-side declaration.

The branch kind and the claim kind (`reap.ts:1141`) read "no work of its own" the same way after slice 3, and no branch is acted on by both:

- **Commits past `origin/<default>` that are all empty claim markers.** `isWhollyEmptyClaim` (`reap.ts:420-424`) answers true, and the claim kind decides through `firstClaimRefusal`. The branch kind counts commits of its own through `realCommits` (`packages/domain/src/rules/empty-claim.ts`), so markers are not commits of its own; it keeps the branch with `keep — an empty claim; the claim kind decides`.
- **A contained branch with no commits of its own** (an empty `origin/<default>..<branch>` range and no commit of its own on the default branch's history). The branch kind keeps it after slice 3. `isWhollyEmptyClaim` answers false on an empty range (`reap.ts:422`), so the claim kind skips it too, and the branch stays for a person.
- **Any commit of its own that is not an empty marker.** `isWhollyEmptyClaim` answers false, and only the branch kind decides.

**Slice 4 — `--yes` acts on the recorded dry run.** `--dry-run` writes a record under the common git dir: the repository identity (the realpath of `git rev-parse --git-common-dir`), the default branch and the `origin/<default>` SHA it read, a timestamp, and one row per worktree, branch and claim it would act on, each with its tip and reason. `--yes` deletes the intersection of the record's rows and a fresh check of each row:

- **A branch or claim row** passes when the tip is unchanged, the branch is not checked out now (read live, never from the record), and it is not the default branch.
- **A worktree row** is checked out by definition, so it runs the worktree kind's full live gate, as an unrecorded `--yes` does today: a live worker pid (`reap.ts:728`), a dirty tree (`:731`), unpushed commits (`unpushedCommits`, `:435-462`, read at `:806`) and the rest of `firstReapRefusal` (`:808`), plus the given-up arm's fetch and recount (`:895-899`). The record's limit applies on top: the desk must be a recorded row, at its recorded HEAD. An agent that starts work in a desk after the dry run makes the live gate refuse, and the desk stays.
- **A row recorded as "PR merged"** is asked again with `prMerged` before the delete. Any answer but `merged` keeps the branch with slice 2's reason: `not-merged`, `unknown`, or a failed result such as `throttled`.

A host flip or a removed row can only remove deletions, and a hand-added row cannot delete on the record alone. `--yes` refuses a record from another checkout and a record older than a bound. A bare `--yes` with no record prints the `--dry-run` command and acts on nothing. The dry run projects the cascade of cause 2: a branch held only by a desk this run removes prints `would — merged into <default>, held only by a desk this run reaps`, and the record carries it. The CLI gains no per-branch `--only` flag: removing rows from the record narrows a run, and adding rows cannot widen it. A pure domain function answers whether a recorded row is still actionable: `(recorded row, live readings, fresh host answer) → delete | keep(reason)`.

**Two unattended forms need no record.** `--yes --plan-slug <slug>` reaps only the branches that plan's `## Slices` names and the desks checked out on them. It decides and acts in one run with every live gate of slices 1 to 3 and of the worktree kind, and stores no record. A record makes an operator's approval bind the run; an unattended caller approves nothing, and the plan scope bounds the run to one delivered plan. `--sweep-temp --yes` removes temp paths only and runs as before.

**Every caller that runs `plot-reap` with `--yes`**, found on 2026-10-28 by `git grep` over `packages/`, `skills/`, `scripts/`, `test/` and `docs/stories/`:

| caller | today | after slice 4 |
|---|---|---|
| `packages/fleet/src/shared/auto-deliver.ts:342` | `plot-reap.sh --yes`, after every automatic delivery. Its `onExit` runs `plot-release-refs.sh --yes <slug>` (`:383`), which refuses while a desk remains (`:339-341`). | `plot-reap.sh --yes --plan-slug <slug>` |
| `packages/domain/src/workflows/reconcile.ts:427` | prints `skills/plot/scripts/plot-reap.sh --yes` as the `copy-then-reap` repair | prints `--yes --plan-slug <slug>` when the desk's manifest names a plan, and the `--dry-run` then `--yes` pair when it names none |
| `packages/domain/src/adapters/temp-sweep/temp-sweep-shell.ts:40` | `--sweep-temp --yes`, at most hourly from fleetd (`skills/plot/units/com.plot-pm.fleetd.plist:36`, `skills/plot/units/plot-fleetd.service:58`) | unchanged |
| `skills/plot/scripts/plot-reconcile-scan.sh:3343` | prints `plot-reap.sh --sweep-temp --yes` | unchanged |
| `packages/board/src/server/entry/reap.ts:153-155` | help text: `plot-reap.sh --yes`, `--yes --max 5` | names the dry-run pair and `--plan-slug` |
| `docs/stories/the-master-agent-holds-the-fleet/DESIGN-worktree.md:255` | names `plot-reap.sh --yes` as the reap action | names the dry-run pair and `--plan-slug` |
| `packages/board/test/unit/registryd-units.test.ts:156` | a comment says no script runs `plot-reap.sh --yes` | corrected: `auto-deliver.ts:342` runs it |
| `packages/fleet/test/unit/auto-deliver.test.ts:430` | expects `reap --yes` | expects `reap --yes --plan-slug <slug>` |
| `test/reconcile/` reap suites | `--yes` 71 times outside `reap-sweep-temp.test.mjs`: `sweep` 21, `reap-log` 17, `reap-manifest` 14, `reap-agent-liveness` 10, `reap-failed-readings` 4, `reap-launcher` 2, `reap-merged-pr` 2, `desk-lifecycle` 1 | each runs `--dry-run` first, or passes `--plan-slug` where the fixture has a plan |
| `reap-sweep-temp.test.mjs` (3), `packages/board/test/unit/reap-sweep-temp.test.ts` (3) | `--sweep-temp` with `--yes` | unchanged |

`packages/domain/test/scripts-shell.test.ts:236` starts a stub named `plot-reap.sh` and reaches no reaper. The bundled copies under `skills/plot/scripts/board/` are build output and follow their sources.

### Tests

- **Slice 1.** Board unit: export `runBranchKind` as `runWorktreeKind` already is (`reap.ts:670`), drive it with a fake `Context` (pattern: `packages/board/test/unit/reap-given-up-desk.test.ts`), and assert that the reaped-ref write precedes `trees.deleteBranch` and carries the pre-delete SHA. A fake whose pin write fails never reaches `trees.deleteBranch`, and the row reads `keep — could not pin the tip`; the same holds when the `.plot/state/reaped.tsv` append fails. Contract: in `test/reconcile/sweep.test.mjs`, after `--yes`, `git rev-parse refs/plot/reaped/<branch>/<sha>` equals the old tip and still resolves after `git gc --prune=now`; one test per delete site (`reap.ts:911,1048,1171`). The printed restore command recreates the branch at that SHA. Branches `feature` and `feature/x` reaped in one run both get a pin. The same branch name reaped twice at two tips keeps two pins. A reaped ref whose TSV row is 31 days old is gone after the next run with its row; one at 29 days stays; a reaped ref with no row stays.
- **Slice 2.** Domain unit (`packages/domain/test/sweepable.test.ts`): `branchSweepProblems` with an `unknown` host answer returns `host-unknown`, not `no-merged-pr`, and with a failed reading of kind `throttled` or `secondary` returns `host-throttled`. Board unit: a fake host whose `prMerged` returns `!ok` with `lastRefusal()` of kind `throttled` gives a `rate-limited` row, and of kind `failed` gives `host-unknown`. Contract (`test/reconcile/host.test.mjs`): `pr-merged` answers `unknown` for a `gh` stub that fails with empty stderr and for one that fails with `repository not found`, and still answers `not-merged` for `no pull requests found`. Contract (reap): a `gh` stub that answers 429 for one branch; its row reads `keep — the host could not answer` and does not match `/unlanded work/`; the same for a stub that fails with empty stderr. `test/reconcile/reap-failed-readings.test.mjs:128` (a stub answering `[]`, so `not-merged`) and `sweep.test.mjs:217` ("an unreachable host deletes nothing") stay green.
- **Slice 3.** Domain unit: a merged answer with a tip past every merged head and patches not on default gives a keep reason; containment with no commits of the branch's own gives a keep reason. Contract: a scratch repo with a squash-merged branch plus one later commit; `--yes` keeps it and the commit stays reachable from `refs/heads/<branch>`. Claim overlap, beside `an abandoned claim ref is swept` (`test/reconcile/sweep.test.mjs:277`): `a claim-only branch is kept by the branch kind and decided by the claim kind` asserts one `keep — an empty claim; the claim kind decides` row in the branch section and the claim section's row for the same branch; `a contained branch with no commits of its own is kept by both kinds` asserts a branch kind `keep` row and no claim row.
- **Slice 4.** Domain unit: the record-row rule refuses a moved tip, a branch checked out now, the default branch, a foreign repository identity and an old record. Contract: the panel's reproduction as a test — `--dry-run`, flip the `gh` stub, push one branch to `origin/main`, `--yes`, and assert that the deleted set is a subset of the dry run's `would` rows; a branch committed to after the record is refused by name; a branch checked out in a new worktree after the record survives; a hand-removed row is kept; a hand-added `PR merged` row is kept when the `gh` stub answers `not-merged`, and kept as `rate-limited` when it answers 429. A recorded worktree row whose desk gains an uncommitted file, a live worker pid, or an unpushed commit after the dry run is kept with the worktree kind's reason. `--yes --plan-slug <slug>` with no record removes that plan's landed desk and its branch and leaves another plan's landed desk. A bare `--yes` with no record removes nothing and prints the `--dry-run` command. Board unit: a landed clean desk on a merged branch; the dry run's branch row names the cascade, and `--yes` deletes exactly that row. Fleet unit (`auto-deliver.test.ts:430`): the reap runs `--yes --plan-slug <slug>`. Domain unit: the `copy-then-reap` repair in `reconcile.ts` names `--plan-slug` when the desk's manifest names a plan. Characterisation (passes today, keep it): `branches_deleted` equals the count of `deleted` rows in the branch section. `--sweep-temp --yes` with no record still runs.
- No browser tier: the board renders no reap rows.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-plot-reap-yes-deletes-a-different/panel.md`):

- [x] The plan carries four slices, in this order: recoverability, the unknown host answer, commits after the merge, the recorded dry run.
- [x] Recoverability ships first: `refs/plot/reaped/<branch>/<sha>` at all three delete sites (`reap.ts:911,1048,1171`), a restore command per `deleted` row, and a 30-day prune on the next run. The checked-out refusal stays, because `git update-ref -d <ref> <old>` deletes a checked-out branch.
- [x] Reaped tips go to a ref, not a log: a ref keeps the objects through `git gc`, and a log does not.
- [x] A host answer of `unknown` or `throttled` is its own reading and reason (`reap.ts:1022`, `sweepable.ts:73`). This replaces the earlier slice that downgraded a merged verdict made under a rate limit: the panel showed that a rate limit never produces `merged` (`plot-host.sh:658,4238,4257`).
- [x] The host port already reports a degraded `prMerged` answer, as `MergedAnswer 'unknown'` (`host.ts:33`) and `lastRefusal().kind` (`host.ts:87-88`). The reap entry ignores both today. Slice 2 changes no port; it narrows `miss_or_unknown` in `plot-host.sh` (decided below).
- [x] The branch kind refuses a tip past the merged PR's head, reusing `prMergedHeads` and `unpushedPatches` (`reap.ts:435-462`). Containment deletes a local ref only for a branch with commits of its own. `hasMergedPr` splits into a host answer and a containment answer, and slice 3 amends `CLAUDE.md`'s *One Answer To "Did This Land"* to name the local-ref exception.
- [x] A recorded dry run, not a confirmation in place. `--yes` acts on the record intersected with a fresh local check (tip unchanged, not checked out, not the default branch). The record carries the repository identity, the default-branch SHA and a timestamp, and covers worktrees, branches and claims; a record from another checkout or too old is refused.
- [x] The worktree and claim kinds share the divergence: the worktree kind re-asks `prMerged` (`reap.ts:783-791`) and frees branches for the branch kind (cause 2); the claim kind re-reads refs after the fetch (`reap.ts:1135-1144`) and deletes at `:1171`. The record covers all three kinds, and the dry run shows the cascade.
- [x] A bare `--yes` with no record acts on nothing. `--sweep-temp --yes` and `--yes --plan-slug <slug>` need no record (decided below). No per-branch `--only` flag.
- [x] The counter theory is dropped: `branches_deleted` already equals the branch section's `deleted` rows.

Decided 2026-10-28 by Jan Wloka after plot-review #2837 on plan PR #2828:

- [x] 2026-10-28 — `plot-reap.sh --yes --plan-slug <slug>` reaps only that plan's desks and branches. It decides and acts in one run with the live gates and stores no record. `packages/fleet/src/shared/auto-deliver.ts:342` and the `copy-then-reap` repair text at `packages/domain/src/workflows/reconcile.ts:427` run it. A bare `--yes` still needs the recorded dry run. The earlier statement that `--sweep-temp --yes` is the only unattended `--yes` caller was wrong: `auto-deliver.ts:342` runs a bare `--yes` after every automatic delivery. Slice 4 names every caller.
- [x] 2026-10-28 — `--yes` asks the host again for every record row whose reason is "PR merged" before it deletes. An `unknown` or `throttled` answer keeps the branch. This closes the question about a hand-added row.
- [x] 2026-10-28 — A recorded worktree row runs the worktree kind's full live gate (dirty tree, live worker pid, unpushed commits; `reap.ts:435-462,728,731,806-808,895-899`) plus the record's limit.
- [x] 2026-10-28 — No pin, no delete: a failed pin write or TSV append keeps the branch. The reaped ref is `refs/plot/reaped/<branch>/<sha>`, so a later `<branch>/x` cannot clash with it and a second reap of one name keeps both tips.
- [x] 2026-10-28 — Slice 2 covers every case in which the host did not answer, and each reaches its own keep reason: an `unknown` answer, a failed port result (`!hostMerged.ok`, by `lastRefusal().kind`), a failed call with empty stderr (`plot-host.sh:658`), and a failure that matches only the bare `not found` of `is_lookup_miss` (`:2295`).
- [x] 2026-10-28 — The 30-day prune reads its age from `.plot/state/reaped.tsv` under the common git dir, one row per pin. Not a reflog, because `core.logAllRefUpdates=true` keeps none for `refs/plot/*` and `gc.reflogExpire` belongs to the repository owner. Not the commit date, which is when the commit was made. A reaped ref with no row is kept.
- [x] 2026-10-28 — A branch whose commits past `origin/<default>` are all empty claim markers is `isWhollyEmptyClaim`'s case (`reap.ts:1141`). After slice 3 the branch kind keeps it and the claim kind decides, and the two readings agree because the branch kind counts commits of its own through `realCommits`. Test: `a claim-only branch is kept by the branch kind and decided by the claim kind` in `test/reconcile/sweep.test.mjs`.

### Open Questions

- [ ] Read `MERGED` rows from the PR index before asking the host (*A Decision Reads The Index*)? It would make the dry run itself stable under a rate limit and save one host call per branch, and it needs its own paragraph in `CLAUDE.md`. Not chosen now; measure first whether ewz-kus-portal's Bitbucket index carries MERGED rows.
- [ ] Another reaper between the dry run and `--yes` (fleetd's hourly `--sweep-temp --yes`, or a second operator) is a case no juror considered. The fresh local check covers a moved or deleted branch; what the record does when another run already deleted, pinned or pruned its rows is unspecified.
- [x] A hand-added `PR merged` row at a branch's current tip passes the local check. Closed 2026-10-28: `--yes` asks the host again for every "PR merged" row (Decisions).
- [ ] Which bound makes a record too old: `Checks wait`, or a new key?
- [ ] Which reading says a contained branch "had commits of its own"? The proposed reading is a tip off the first-parent line of `origin/<default>`; a repository that merges by fast-forward then keeps every contained branch, which is the safe direction.
- [x] Reaping the same branch name twice would overwrite `refs/plot/reaped/<branch>`. Closed 2026-10-28: the ref name carries the SHA, `refs/plot/reaped/<branch>/<sha>` (Decisions).
- [ ] Does `--max N` apply to the record's rows, or refuse with a record? Does a FAILED row stop counting in `branches=`?

## Slices

### Recoverable deletes

- `bug/plot-reap-pins-every-tip-it-deletes` — write `refs/plot/reaped/<branch>/<sha>` and a `.plot/state/reaped.tsv` row before each local delete at `reap.ts:911,1048,1171`; no pin, no delete; print a restore command per `deleted` row; prune reaped refs whose row is older than 30 days; keep the checked-out refusal; correct `skills/plot/scripts/README.md:49` <!-- builds: refs/plot/reaped/<branch>/<sha>, .plot/state/reaped.tsv and the 30-day prune -->

### Unknown host answers

- `bug/plot-reap-names-an-unknown-host-answer` — `LocalBranchReadings` carries `MergedAnswer` and the refusal kind; an `unknown` answer, a failed port result, a failed call with empty stderr and a bare `not found` failure each print their own `keep` reason instead of "unlanded work — no merged PR"; narrow `miss_or_unknown` (`plot-host.sh:658`)

### Commits after merge

- `bug/plot-reap-keeps-commits-after-the-merge` — the branch kind refuses a tip past every merged PR head (`prMergedHeads`, `unpushedPatches`); containment deletes only a branch with commits of its own; split `hasMergedPr`; amend *One Answer To "Did This Land"* and the `refs-git.ts:763` marker

### Recorded dry run

- `bug/plot-reap-yes-acts-on-the-recorded-run` — `--dry-run` writes a record of worktrees, branches and claims with repository identity, default-branch SHA and timestamp; `--yes` deletes the record intersected with a fresh local check; a recorded worktree row runs the worktree kind's full live gate; "PR merged" rows are asked again; the dry run shows the worktree-then-branch cascade; `--yes --plan-slug <slug>` acts in one run with no record, and `auto-deliver.ts:342` and `reconcile.ts:427` use it; `--sweep-temp --yes` needs no record <!-- builds: the reap record under the common git dir -->

## Notes

- Related: #2807, #2815, #2730.
- Source: tracker issue #2825. The plan writes nothing to the tracker.
- The four slices are four waves and gate in merge order. Slices 2, 3 and 4 all change `runBranchKind` and `sweepable.ts`, and the wave order keeps them from running at the same time.
- Amended 2026-10-28 after panel round 1.
- Amended 2026-10-28 after plot-review #2837 on plan PR #2828.
