## Implementation brief — one-pr-reader-per-machine-and (wave: Index lock)

- **Plan (canonical):** `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Branch:** `feature/pr-index-lock-beside-the-index` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention (CI green + review)

This is the second named slice. The first, `feature/one-pr-reader-per-machine-and`
(PR #2436), is **deferred** — closed unmerged 2026-10-25 because it wrote the
real PR index from the board, which `one-pr-index-writer.test.ts` refuses. Its
4 commits hold the election/lock code this slice ports forward. A third
slice, `feature/fleetd-holds-the-pr-index-lock`, wires fleetd on top of what
this slice produces; a fourth, `feature/boards-share-one-pr-reader`, wires
the board and the standalone reader process. **This branch adds no caller** —
same rule the superseded brief stated, still true.

**This branch replaces a different, now-superseded brief.** `.plot/briefs/pr-reader-lock-elects-one-writer.md`
described an earlier slice for the same underlying files, written before a
panel review (`.plot/panels/2026-10-23-one-pr-reader-per-machine-and/`, round
1, unanimous "amend") forced a substantial redesign of the lock protocol
itself. Do not read that file as current — its "move owner file aside,
compare, restore" takeover fix, its 3-segment lock key
(`connector--account--repo`), and its `~/.plot/state/pr-reader/` location are
all superseded by what follows. The underlying concern each of those existed
to address is still real; only the mechanism changed.

### What to build

Port `reader-election.ts`, `reader-lock.ts` and `reader-lock-file.ts` forward
from `origin/feature/one-pr-reader-per-machine-and` (commit `f0b1a2fa7`), with
the lock protocol itself redesigned per the panel's required amendments —
this is not a straight carry-and-trim, the panel found the #2436 protocol
lets two processes write one PR index file at once, five separate ways.

**The new shape, concretely:**

- **Lock location:** `<index dir>/<connector>.lock/`, beside the PR index
  file itself (`<common git dir>/.plot/state/index/<connector>.json`), not
  under `PLOT_BUDGET_HOME`/`~/.plot/state/pr-reader/`. "Beside the index" is
  the slice's own name and the fix for the panel's highest-severity finding
  (below).
- **Lock key:** `(realpath(common git dir), connector)` — no `account`
  segment at all. `clean()`-style sanitization may still be needed depending
  on how the directory name is formed, but there is no second identity
  segment to sanitize around.
- **Ownership:** generation-numbered owner files (`owner.<n>`). The holder is
  whichever `owner.<n>` has the highest `n`. A taker that judges `owner.<n>`
  stale links `owner.<n+1>` — one atomic `link`, and `link` returns `EEXIST`
  to every taker but one. **Nothing is ever unlinked on a decision path.**
  Renewal and release route through the same generation mechanism rather than
  mutating a single file in place.
- **Staleness / skew:** compare the claim's `startedAt` against the live
  process's actual start time within `CONTINUE_LOCK_SKEW_MS` (3000ms,
  `packages/domain/src/rules/continue-lock.ts:28-35`'s
  `Math.abs(a - b) < CONTINUE_LOCK_SKEW_MS` form) — not the #2436/old-brief
  `Math.trunc(a) !== Math.trunc(b)` exact-equality form, which the concurrency
  juror ran against a real process and measured failing (self-stamp vs. `ps
  -o lstart=`'s one-second resolution differed by 591ms, so `Math.trunc`
  equality read every live holder as reused-pid-stale). The age bound
  (`READER_STALE_MS`, kept at 10 minutes) still applies on top. A claim whose
  liveness cannot be read (`alive === null`) still holds — never treated as
  stale just because the process table couldn't answer.
- **Fence:** the full fence (re-read ownership immediately before the fold)
  is the *caller's* responsibility in the next slice, not this one — but this
  slice's `elect`/`holder` must return a `held`/`elected` answer precise
  enough to be re-read cheaply on the next slice's hot path, since a fold-time
  fence that has to re-run a full election is not a fence, it's a second
  election.
- **Heartbeat rule:** this slice adds the heartbeat primitive — a holder (or
  a following board/fleetd) writes a presence file (`<lock dir>/board.<pid>`,
  `<lock dir>/fleetd`) on its own cadence, read by whatever later decides "is
  anyone still following this lock" (the next slice's reader-lifetime
  question, open question Q4 in the superseded brief, now answered: tie the
  reader's life to whether a heartbeat younger than two PR ticks exists, not
  to one `--while-pid` board). This slice ships the heartbeat file codec and
  the rule that reads it stale/fresh; it does not ship anything that writes
  one on a schedule — that's the caller's job.
- **Reader state file:** a new codec, `<index dir>/<connector>.reader.json`,
  separate from the lock's owner-claim files. Owner-claim files stay minimal
  (pid, startedAt, at) so the atomic-publish discipline stays cheap; the
  reader state file carries `prError`, `prNextAt`, `prNextIsBackoff`,
  `prFullReadFailedAt`, `at` — the fields a follower needs to render an
  honest board without asking the host. This answers the concurrency juror's
  Q2 (where does a reader publish its last error) and the estate juror's
  finding that `readPrsFromStore` today shows a dead fleet's stale `prError`
  while a reader, not a fleet, is actually live.

### The decisions already settled — do not re-derive them

**Why the move-aside-and-restore takeover fix (the #2436/superseded-brief
design) was rejected, not just alternative-phrased.** The concurrency juror
walked the actual race: P1 and P2 both judge claim S stale and both rename
`owner` aside; P1 links its claim F, P2 finds F (not S) after its own rename,
and in the gap between P2's rename and its restore, a third elector R3 can
publish into the now-empty slot. P2's restore then either fails with `EEXIST`
(F is lost, P1 and R3 both hold) or overwrites R3 by `rename` (P1 and R3 both
believe they hold). This is not a corner case introduced by porting the code
wrong — it is inherent to any scheme that unlinks (even via rename-and-maybe-
restore) on the decision path, because an unlink always opens a window.
Generation-numbered owner files close the window by construction: the
decision ("do I now hold the lock") and the action ("publish my claim") are
the same atomic `link` call, and there is no unlink anywhere in the decision
path for a taker to race against.

**Why the lock key drops `account` entirely, not just computes it
differently.** The PR index file itself is keyed by `(connector, common git
dir)` with no account segment — it is one file per repository. The #2436 key
added `account` (from `spend-rate`'s `budget_account`, which can itself
answer `unknown`). The concurrency juror showed this is reachable, not
theoretical: a process whose account read differs from another process's
(credential switch, `resolveReaderAccount` returning `null`, fleetd under
launchd vs. a board in a shell) gets a *different* lock for the *same* index
file, so both elect and both fold. An exclusion lock must be keyed on exactly
the resource it protects. The account belongs to the budget record
(`plot-budget.sh`'s separate `(connector, account, bucket)` keying), not to
write exclusion over one file.

**Why the lock moved to be "beside the index" rather than staying under
`PLOT_BUDGET_HOME`.** Putting the lock at `<common git dir>/.plot/state/`
next to the file it guards makes "same file" and "same lock" the same
question by construction — no sanitizing function can let two different
physical files share a lock, or one physical file get two locks, because the
lock's path *is derived from* the index's path. The #2436 location
(`~/.plot/state/pr-reader/<cleaned-key>/`) needed `clean()` to collapse an
arbitrary repo path into a filesystem-safe segment, and the concurrency juror
found `clean()` itself collision-prone: it lowercases, so `/A/x` and `/a/x`
collide on a case-sensitive filesystem; it maps every non-`[a-z0-9._-]` byte
to `-`, so `/w/a-b/.git` and `/w/a/b/.git` both become `-w-a-b-.git`; and the
old code resolved the key from `cwd`-relative paths with no `realpath`, so a
board started under a symlink (`/tmp` vs `/private/tmp` on macOS) and fleetd
started under the physical path compute two different keys for one physical
index. None of these are reachable once the lock's location is derived from
the same `realpath`d common-git-dir resolution the index file itself already
uses (`pr-index-file.ts`'s own pattern, shared by five other adapters).

**Why the skew comparison must use `CONTINUE_LOCK_SKEW_MS`'s `Math.abs(...) <
skew` form and not `Math.trunc` equality.** This is not a style preference —
the concurrency juror ran both readings on one live node process and measured
them disagreeing: self-stamped `startedAt` read `1793035271591`; the same
process's start time read back through `ps -o lstart=` (one-second
resolution) read `1793035271000`; the 591ms difference made `Math.trunc`
equality return `false` for a genuinely-live, non-reused-pid holder. Ported
unchanged, the #2436 code's reused-pid defense fires on every live holder,
not just reused pids — it reclassifies "is this really a different process"
into "did sub-second jitter land on a different truncated millisecond", which
is a coin flip. `CONTINUE_LOCK_SKEW_MS = 3000` already exists in this repo
(`packages/domain/src/rules/continue-lock.ts:29`) for exactly this
measurement, over the identical `ps -o lstart=` source.

**This is still not a fourth connector.** The lock is a machine-local file:
no account, no credentials, no rate limit, no transport choice (CLAUDE.md's
connector test). `ReaderLock` stays a plain port with one file adapter,
parallel to `ports/pr-index.ts` / `adapters/pr-index/pr-index-file.ts`.
Domain code (`reader-election.ts`) imports nothing from `adapters/`; the
adapter imports the rule to interpret what it reads — the normal
inward-pointing direction.

**`link()`, not `mkdir` or `open(..., 'wx')`, still publishes each generation
file atomically.** Write to a scratch name, then `link()` into
`owner.<n+1>` — a name and its content arrive together. This discipline
carries forward unchanged from #2436 and from `slots-file.ts`'s precedent; it
is the one piece of the old mechanism that was never the problem.

**Six panel concerns are moot under this design and do not need separate
fixes** (per the plan's own "Moot panel findings" section): account-in-key
issues (no account segment exists to collide), spend-rate-per-tick cost (no
`budget_account` shell call needed to build the key), `--while-pid` without a
start-time check (superseded by the skew-bounded comparison above), 180s
reader churn after fleetd stops (a caller concern for the next slice, not
this one), the move-aside-and-restore takeover race itself (superseded by
generation files), and PR-only fleetd's launchd/channel conflicts (unrelated
to this slice's files). Do not reopen any of these.

### Done when

The plan names this slice's observable directly: **a multi-process race test
in which 8 real `node` processes elect over one stale claim and exactly one
wins, a renewing holder is never read as "no holder", and a superseded
holder's release leaves the new claim.** Lift that as three concrete test
requirements, and note what a naive port would pass without each:

- **8 real processes, one stale claim, exactly one winner.** Spawn real
  `node` child processes (not promises in one event loop — the port
  interface document itself notes the population being elected among is
  processes on a machine, not promises in a process), all racing `elect`
  against one pre-seeded stale claim. Assert exactly one succeeds with
  `elected` and the rest read `held` against the winner's claim. A
  move-aside-style implementation, or a naive "read-then-unlink-then-link"
  implementation with no generation numbering, is expected to fail this
  under real concurrency — the concurrency juror's walk showed the window is
  real, not theoretical, with as few as 3 racing processes.
- **A renewing holder is never read as "no holder".** Concurrently call
  `holder()` while a live holder renews, repeatedly, under load. This catches
  the #2436 defect where `writeFile` truncates before it writes, so a
  concurrent read can observe an empty/undecodable claim and misread it as no
  holder. Generation files side-step the truncation path entirely (renewal
  writes a new generation rather than overwriting one in place), but the test
  must still prove it — an undecodable or missing read during a renewal
  window must answer `unknown`/held-with-the-prior-generation, never
  `null`-as-no-holder.
- **A superseded holder's release leaves the new claim untouched.** After a
  takeover, have the old holder call `release`. Assert the new holder's claim
  survives. This catches the #2436 defect where `release` reads-then-unlinks
  by name with no check that the generation it is releasing is still the
  current one.

Also carry forward and extend the tests the superseded brief already
specified at the rule level (still correct, since `readerIsStale` and
`electReader`'s pure logic are not what the panel found broken):

- A reused pid within `READER_STALE_MS` reads as stale via the skew-bounded
  comparison above (not the `Math.trunc` equality form) — exercised through
  the adapter's real takeover path with a genuine non-null `startedAt` for
  the live process.
- `reader-election.test.ts`, `reader-lock-file.test.ts` and
  `reader-lock-fixture.test.ts` all pass, carrying the redesigned protocol
  rather than the original #2436 shape.
- Any test that spawns a detached/real process for the race test must wait
  on that process's own exit before teardown — `scripts/owned-run.sh` fails a
  run on anything still present in its temp root after the grace window, and
  the concurrency juror flagged this exact risk for a race test built this
  way.

**State inventory.** New paths need rows in whatever this repo's state
inventory gate reads (`scripts/check-state-inventory.mjs`): `*.lock/owner.*`,
`*.lock/.*.tmp`, `*.lock/board.*`, `*.lock/fleetd`, `*.reader.json`,
`*.reader.json.*.tmp` — these six are named directly in the plan's own State
inventory section for this slice. Since the lock now lives under the common
git dir rather than under `PLOT_BUDGET_HOME`, confirm the inventory's
existing coverage note (if any) still accounts for the new base directory —
the estate juror flagged that a relocated lock directory can fall outside
what a leak-detection gate already watches.

**TSDoc.** Carry the #2436 TSDoc in `reader-election.ts` and
`reader-lock-file.ts` forward trimmed to what each export does, per the
plan's "Stale text" note for this slice. Both jurors separately flagged the
#2436 originals as violating this repo's factual-TSDoc rule — narrated
history and cross-package doc links (`SAME SHAPE AS SlotClaim ... AND FOR THE
SAME REASON`, `TEN MINUTES, MIRRORING ...`, a link into
`packages/fleet/src/shared/pr-refresh.js`) rather than parameter/return/error
facts. The reasoning that narration carried belongs in this brief and the
plan, not in the shipped comment.

Plus the repo's gates: build artifacts stay out of the diff
(`scripts/check-no-bundle-diff.sh`), a changeset per `## Versioning` in
CLAUDE.md, and platform constraints (`nvm use` — Node 24, pnpm crashes on
Node 26).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — the tests and typecheck for whatever
package the change touches (this slice is entirely `packages/domain`). The
suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`,
`test:board`, domain coverage, the reconcile test glob) run in CI on every
PR; do not run them locally as a matter of course.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a pull request whose
shell under `skills/` is longer than at its merge base. This slice is pure
TypeScript under `packages/domain` — it should not touch any `.sh` file. If
it turns out to need one, that growth is paid for in the same change per *A
Shell Script Asks The Domain* in CLAUDE.md.

### Bookkeeping

Open the PR through the controller, never `gh pr create` directly:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads which plan names the branch and opens the PR with the plan and this
brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section, under the `### Index lock` heading.

### Scope guard

This branch owns exactly: `packages/domain/src/rules/reader-election.ts`,
`packages/domain/src/ports/reader-lock.ts`,
`packages/domain/src/adapters/reader-lock/reader-lock-file.ts` (and its
`reader-lock-fixture.ts` test double), the new reader-state-file codec, and
their tests. **No caller yet** — it does not touch
`packages/board/src/server/fleet.ts`, `packages/fleet/src/shared/pr-refresh.ts`,
or add any new entry point under `packages/fleet/src/server/entry/`. Those
belong to the two slices that follow this one:
`feature/fleetd-holds-the-pr-index-lock` (fleetd wiring, the fence before
`writePrStore`, the cadence-gate ordering) and
`feature/boards-share-one-pr-reader` (the standalone reader process, the
board's `Detached`-seam spawn, the exit-on-no-heartbeat rule). If you find
yourself wiring either of those files or a new fleet entry point, stop — that
is not this slice's scope.

The first slice's branch, `feature/one-pr-reader-per-machine-and`, still
holds its ref (deferred, not deleted) at `f0b1a2fa7` — its commits are the
source this brief ports from and redesigns, but that branch itself is not
this branch's base and should not be merged or rebased onto.

The previously-started branch `feature/pr-reader-lock-elects-one-writer` (no
ref existed on origin as of 2026-10-26) is superseded by this slice per the
plan's amendment; its brief at `.plot/briefs/pr-reader-lock-elects-one-writer.md`
describes the pre-panel protocol and should not be used as a template beyond
the header fields and the general "no caller yet" scope shape.

If the lock protocol described above turns out to need a different concrete
shape than described once you're reading the real #2436 files — for instance
if generation numbering interacts awkwardly with the heartbeat file's own
naming — that's an implementation detail to use judgment on. The invariant to
hold is what the "Done when" tests assert (one writer, ever, per index file;
no unlink on a decision path; a renewing holder never reads as absent), not
the exact file layout shown here. If you find a defect in the new protocol
beyond what the panel already named, report it in the PR rather than silently
working around it.
