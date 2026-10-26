## Implementation brief — one-pr-reader-per-machine-and (wave: Reader lock)

- **Plan (canonical):** `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Branch:** `feature/pr-reader-lock-elects-one-writer` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

This is the second of three named slices. The first, `feature/one-pr-reader-per-machine-and`
(PR #2436), is **deferred** — closed unmerged because it wrote the real PR
index from the board, which `one-pr-index-writer.test.ts` refuses. Its 4
commits hold the lock/election code this slice carries forward, with two
named defects fixed. A third slice, `feature/pr-reader-process-writes-the-index`,
builds the reader process and the fleetd/board callers on top of what this
slice produces — **this branch adds no caller**. Nothing reads or calls
`reader-election.ts` or `reader-lock.ts` yet; that is the next slice's job,
not this one's.

### What to build

Carry forward three files from the deferred PR #2436
(`origin/feature/one-pr-reader-per-machine-and`) into this branch, fixing two
defects along the way:

- `packages/domain/src/rules/reader-election.ts` — the pure election rule
  (`electReader`, `readerIsStale`, the `ReaderClaim`/`ReaderVerdict` types,
  `READER_STALE_MS`). This file is already correct in #2436 — port it
  unchanged.
- `packages/domain/src/ports/reader-lock.ts` — the `ReaderLock` port
  (`holder`, `elect`, `release`). Also unchanged.
- `packages/domain/src/adapters/reader-lock/reader-lock-file.ts` — the file
  adapter. **This is where both defects live** — fix them here, not by
  changing the port or the rule.

Also carry forward their tests (`reader-election.test.ts`,
`reader-lock-file.test.ts`, `reader-lock-fixture.test.ts` and the fixture
adapter `reader-lock-fixture.ts`), extended to cover the two fixes below.

### The two defects — fix these, they are the reason this slice exists

**1. The takeover race.** In `reader-lock-file.ts`'s `elect`, the stale path
currently reads:

```ts
try {
  await unlink(join(dir, OWNER_FILE));
} catch (error) {
  if (!isMissing(error)) return failed<'elected' | 'held'>();
}
const retry = await publish(dir, claim);
```

The unlink is unconditional — it removes whatever is at `OWNER_FILE` without
checking it is still the claim just judged stale. Two processes that both
read the same stale holder and both decide to reclaim can both pass this
unlink (the second sees `isMissing` and treats that as fine) and both then
`publish`. One wins the `link()` race in `publish`, which is correct — but if
a *third*, faster process claims the lock in the gap between this process's
read and its unlink, that fresh claim is destroyed by an unlink that has no
idea the file changed underneath it. The plan names the fix: **rename the
owner file to a unique scratch name, compare the moved claim against the one
judged stale, and restore it if they differ** — the same compare-after-move
discipline `publish` already uses for the write side (write to scratch, then
`link()` atomically). Do not just add a second read-before-unlink; a read and
an unlink are still two syscalls with a gap between them. A rename is one
syscall, so the content you compare is guaranteed to be the content you just
moved.

**2. `startedAt: null` on the retry path.** Same `elect` method, same stale
branch:

```ts
const stale = holder === null || readerIsStale(holder, isAlive, null, now());
```

The third argument to `readerIsStale` is the *live* process's actual start
time, used to catch a reused pid (`readerIsStale` compares `claim.startedAt`
against this value and calls it stale when they differ — see
`reader-election.ts`'s `readerIsStale`). Passing `null` here means that
branch of the comparison never fires: `claim.startedAt !== null && startedAt
!== null` requires both non-null, so a reused pid within `READER_STALE_MS` (10
minutes) is read as the *same* live process that made the claim, and the
stale check falls through to the age check alone — which a freshly-started
reused-pid process has not yet aged past. Fix: read the live process's actual
start time (the adapter already has `alive(pid)` returning `boolean | null`;
it needs a second probe for start time, or `alive` needs to return it
alongside liveness — follow whichever shape `pidAlive`'s existing seam
(`options.isAlive`) makes least disruptive to the test fixture) and pass that
real value instead of `null`.

### The decisions already settled — do not re-derive them

**The lock key's `repo` segment is the common git dir, not
`path.basename(repoRoot)`.** #2436 used the directory's base name, which
gives two differently-located checkouts that happen to share a directory name
(e.g. two `plot` clones) one lock. The plan is explicit this is a defect to
fix in this port, and other adapters in this repo already resolve the common
git dir for exactly this reason — `packages/domain/src/adapters/refs/refs-git.ts`,
`packages/domain/src/adapters/pr-index/pr-index-file.ts` and five others under
`adapters/` all do it. `readerLockKey`'s `repo` argument should be given that
resolved value by its caller — the key-building function itself takes a
string and does not need to change; what changes is what gets passed to it
when the next slice wires a caller. For this slice, the relevant fix is
making sure `readerLockKey`'s existing sanitization (`clean()`) is exercised
by a test that passes a full common-git-dir-shaped path, not just a bare repo
name, so the next slice's caller is not the first thing to notice a `/`
character on a path doesn't fit the identity.

**The lock directory is `$PLOT_BUDGET_HOME` (or `~/.plot/state`), not a new
env var.** `reader-lock-file.ts` already reuses `READER_LOCK_HOME_ENV =
'PLOT_BUDGET_HOME'` — the same variable `slots-file.ts` and the budget record
use. Keep this. A third override here would let a test move one of three
places a machine-wide concern lives and not the other two — the file's own
docstring makes this argument; do not add a fourth.

**`link()`, not `mkdir`, publishes the claim atomically.** The adapter writes
to a scratch file, then `link()`s it into place — a name and its content
arrive together, the same discipline `slots-file.ts` already uses and that
`slots-file.ts`'s own history found necessary (a separate `mkdir` + write lets
two processes both see an empty claim and both take the slot). Do not
simplify this to `mkdir` or `open(path, 'wx')` while porting; that reintroduces
the exact gap the existing shape was built to close.

**`Host.account()` refuses by design on Bitbucket (`unaskable`), so the
account segment of the lock key cannot come from it.** The plan names
`spend-rate`'s `budget_account` reading instead — on the shell side this is
`plot-host.sh`'s `budget_account()` function (confirmed at
`packages/board/plot-host.sh:2941` and its GitHub/Bitbucket call sites); on
the TS side the equivalent is whatever `Host.account()`'s Bitbucket caller
currently falls back to for budget bucketing (`pr-refresh.ts:773`'s comment
names the same resolved value). This slice's port and rule do not resolve an
account themselves — they take whatever string the caller passes as the
`account` segment of the key. Nothing in this slice needs to call
`budget_account`; just don't build `reader-lock.ts` or `reader-election.ts`
to assume `Host.account()` is always answerable, since the next slice's
caller will be passing it a value that already handled the Bitbucket case.

**This is not a fourth connector, and not a port that reaches the world
directly.** The lock is a machine-local file, not a remote service — no
account, no credentials, no rate limit, no transport choice (CLAUDE.md's
connector test). `ReaderLock` is a plain port with one file adapter, parallel
to `ports/pr-index.ts` / `adapters/pr-index/pr-index-file.ts`. Domain code
(`reader-election.ts`) imports nothing from `adapters/`; the adapter imports
the rule (`readerIsStale`) to interpret what it reads, which is the normal
inward-pointing direction (`adapters → domain`, never the reverse).

### Done when

The plan has no `## Done when` list of its own for this slice, so lift the
assertions a naive port (copy the files, skip the two fixes) would pass
without:

- A test proves the takeover race is closed: two processes that both read
  the same stale claim must not both successfully unlink a claim a third,
  faster process just published. Mutate the adapter back to the
  unconditional `unlink` and confirm this new test fails — a test that
  passes against both the fixed and the buggy code is not testing the fix.
- A test proves a reused pid within `READER_STALE_MS` is read as stale, not
  as the same live reader — i.e. `readerIsStale` is exercised through the
  adapter's `elect` with a real (non-null) `startedAt` for the live process,
  and a claim whose stored `startedAt` differs from it.
- `readerLockKey`'s sanitization test covers a `repo` segment shaped like an
  absolute common-git-dir path (contains `/`), not only a bare name — so the
  function is proven ready for what the next slice will pass it.
- `reader-election.test.ts`, `reader-lock-file.test.ts` and
  `reader-lock-fixture.test.ts` all pass, ported with the two fixes folded
  in rather than left as the original #2436 versions.
- No caller exists anywhere in `packages/board` or `packages/fleet` — this
  slice is the lock and the rule alone. If you find yourself wiring
  `fleet.ts` or a new entry point to call `electReader`, stop: that is the
  third slice's scope, named `feature/pr-reader-process-writes-the-index` in
  the plan's `## Slices` section.

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

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` is longer than at its merge base. This slice is pure TypeScript
under `packages/domain` — it should not touch any `.sh` file. If it turns out
to need one, that growth is paid for in the same change per *A Shell Script
Asks The Domain* in CLAUDE.md.

### Bookkeeping

Open the PR through the controller, never `gh pr create` directly:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads which plan names the branch and opens the PR with the plan and this
brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section, under the `### Reader lock` heading.

### Scope guard

This branch owns exactly: `packages/domain/src/rules/reader-election.ts`,
`packages/domain/src/ports/reader-lock.ts`,
`packages/domain/src/adapters/reader-lock/reader-lock-file.ts` (and its
`reader-lock-fixture.ts` test double), and their tests. It does not touch
`packages/board/src/server/fleet.ts`, `packages/fleet/src/shared/pr-refresh.ts`,
or add any new entry point under `packages/fleet/src/server/entry/` — those
belong to `feature/pr-reader-process-writes-the-index`, the third slice, not
yet started as of this brief.

The first slice's branch, `feature/one-pr-reader-per-machine-and`, still
holds its ref (deferred, not deleted) — its commits are the source this
brief ports from, but that branch itself is not this branch's base and
should not be merged or rebased onto.

If the two named defects turn out to need a different fix shape than
described above once you're reading the real file, that's an implementation
detail to use judgment on — the invariant to hold is what each test above
asserts, not the exact code shown here. If you find a third defect beyond the
two named, report it rather than silently fixing it without a note in the PR.
