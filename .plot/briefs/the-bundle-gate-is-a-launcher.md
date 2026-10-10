## Implementation brief — the-gates-are-launchers (wave 2: The bundle gate)

- **Plan (canonical):** docs/plans/2026-10-10-the-gates-are-launchers.md on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1494 merged
- **Branch:** `feature/the-bundle-gate-is-a-launcher` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per plan's `Review: pr`)

Wave 1 (`feature/one-entry-reads-the-hook`, PR #1507, merged) built
`packages/board/src/server/entry/gate.ts` / `board/plot-gate.mjs` with an
**empty** `GATES` table and `plot-gates.sh` as the one launcher
`hooks/hooks.json` will eventually register. This is the first of five
gate slices that fill that table — smallest gate first, per the plan's
stated order (`the bundle gate proves the entry with no receipt and no
remote`). Nothing here waits on another gate slice; the controller, state,
brief-name and phase gates come after.

### What to build

`plot-bundle-commit-gate.sh` (111 raw / 59 code lines today) decides,
in shell, whether a `git commit` stages a generated board bundle. Move
that decision into `packages/domain/src/rules/` as a pure function —
readings in, a refusal string or `null` out — and turn the `.sh` file
into a launcher of the shape `plot-gates.sh` already is: resolve
`board/plot-gate.mjs` beside it, `exec node` over it with `bundle-commit`
(or whatever single name you register — match the row key you add to
`GATES`), pass the hook JSON on stdin, pass the exit code through. A
missing bundle allows and says `UNVERIFIED` on stderr, the same shape
wave 1 and the other four shell gates use — never refuse on a missing
bundle (see wave 1's brief and the plan's Open Questions: a hook that
exits 2 on every Bash call when its own bundle is absent leaves the agent
no Bash call left to repair the install).

Register the gate in `gate.ts`'s `GATES` array: `wants(command)` is a pure
string test for `"git commit"` (matching the shell gate's own
`case "$CMD" in *"git commit"*)`), and `ask(command)` is where the
adapters get imported lazily — the staged-index read and the `Refs` call
for the merge base and blob existence checks, none of which should load
for a Bash call that isn't a commit.

### Decisions already settled — do not re-derive them

**The generated set comes from `BOARD_ARTIFACT_PATHS`, not from
re-deriving it by grep over `build.mjs`.** The shell gate (and
`main-bundles.sh`, `check-bundle-attributes.sh`, `check-no-bundle-diff.sh`)
all run `grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)"` against
`packages/board/build.mjs` because none of them had a TypeScript-side
source of truth to read instead. The domain rule does — the committed,
already-generated `BOARD_ARTIFACT_PATHS` array in
`packages/board/src/contract/bundles.generated.ts` is exactly this set,
freshness-asserted against `build.mjs` by
`test/reconcile/bundle-attribute-gate.test.mjs` as a SET comparison. The
new rule imports that array directly. Don't write a second grep/sed
derivation in TypeScript: that would be a fourth place this set could be
listed, which is precisely the defect `check-bundle-attributes.sh`'s own
header describes killing the first time (`a fourth list can never name a
different set` only holds if nothing adds a fifth).

**`bundles.generated.ts` and `.gitattributes` are never refused**, for
the reason `check-no-bundle-diff.sh`'s header gives: two branches that
each add a bundle still conflict there, and reading that conflict is the
correct resolution. The rule excludes both paths from its "staged
generated path" test even if a future bundle happened to collide with
one of those two names.

**The staged-index operation is new on `Refs`, and it is not
`workingChanges`.** `Refs.workingChanges()` lists modified + staged +
untracked paths together with no status code
(`git status --porcelain --untracked-files=all`, see
`refs-git.ts:292`), which loses exactly what this gate needs: the
distinction between an ADD/MODIFY (refuse) and a DELETE (never refused —
"removing a generated path is never the defect this gate exists for",
per the shell gate's own comment), and the rename-to/rename-from split
(`R100\told\tnew` — only `new` matters). The shell gate reads
`git diff --cached --name-status -M`. Add a port operation for that
exact reading rather than trying to make `workingChanges` serve two
different questions — name it for what it answers (a staged add/modify/
rename listing), follow `TreeBlob`'s pattern of carrying the status
alongside the path rather than filtering early, and give it its own
fixture and git-adapter implementation the way `commitFiles` and
`listBlobs` have theirs.

**The merge-base restore-or-rm choice is a `Refs` read, not a shell-out
from the rule.** The shell gate's repair line depends on whether the
merge base holds the path at all
(`git cat-file -e "$merge_base:$path"` → `git restore --staged
--worktree --source=$merge_base` if yes, `git rm --cached` if no) and
falls back to naming the bare paths with no command when
`git merge-base HEAD origin/main` fails (no remote, scratch fixture).
Read the merge base's sha via `Refs.resolve`, probe path existence via
whatever `Refs` operation can answer it cheaply (don't add blob reads you
don't need — `listBlobs`/`readBlobs` exist for batched content reads, not
existence checks; a `git cat-file -e` style per-path existence probe may
be a smaller new operation, or `commitFiles`/`listBlobs` plus a Set
membership test may already answer it without a new op — check before
adding one), and have the rule emit the repair command text for each
touched path exactly like the shell gate does today. **Fail open on the
merge-base lookup failing** (no remote) — print the touched paths with no
command, per the shell gate's `else` branch — never throw.

**Fail-open on its own machinery is the same split every shipped gate
makes**, and it is the `onError: 'allow'` row in `Gate`, not special
logic inside `ask`. No `Refs` answer (unreadable build, no git), no
generated set found — allow. A staged generated path the rule CAN read is
a refusal, because that is the case it exists for.

**This is the first gate slice, so `hooks/hooks.json` changes shape, not
just content.** The plan's per-slice table says this slice both adds the
gate's row to `plot-gate.mjs` AND is the slice where `hooks.json` first
registers `plot-gates.sh` and drops a per-gate line — in this case,
`plot-bundle-commit-gate.sh`'s entry. Today `hooks.json` still lists all
five original `.sh` entries (no gate slice has landed yet). After this
slice, `hooks.json` holds `plot-gates.sh` plus the four NOT-yet-converted
gates' original entries (`plot-phase-gate.sh`, `plot-state-gate.sh`,
`plot-brief-name-gate.sh`, `plot-controller-gate.sh`) — those four keep
running as their own separate PreToolUse hooks exactly as today, since
their shell files are untouched; only the bundle gate's line is replaced
by the one `plot-gates.sh` entry, which at this point runs exactly one
gate (`bundle-commit`) through `plot-gate.mjs`. Don't wait for the other
four gates to convert before registering `plot-gates.sh` — the plan
answered this in its Open Questions ("one registered hook runs
`plot-gate.mjs` for all five gates, as the plan states") and the
per-slice table's dependency order starts the registration here, at the
smallest gate, deliberately.

**`plot-install-hooks.sh` already expands the one-hook form** (wave 1
taught it to read `plot-gate.mjs --list` when `hooks.json` names
`plot-gates.sh`). You should not need to touch its expansion logic — only
confirm `probe_bundle_commit_gate` still runs, now routed through
`plot-gates.sh` → `plot-gate.mjs bundle-commit` instead of directly
through the old `.sh` file. `--verify`'s existing scratch-repo prober
(`plot-install-hooks.sh:329-341`) should still pass unmodified if the
rule's wiring is correct; if it needs a change, that is a signal
something in the launcher's exit-code passthrough is wrong, not a cue to
edit the prober's fixture.

### Done when

The plan's `## Done when` is implicit in its Slices and Design sections
(this plan carries no explicit `## Done when` heading — read the slice
line and the Design section's acceptance language as the specification):

- `plot-bundle-commit-gate.sh` is a launcher (the `plot-gates.sh`/
  `plot-reap.sh` shape): resolves the bundle, `exec node`s it, no decision
  logic left in the `.sh` file.
- `bundleCommitRefusal` (or your chosen name) lives in
  `packages/domain/src/rules/` with unit tests covering: a staged
  add/modify of a path in `BOARD_ARTIFACT_PATHS` (refuse, with the restore
  command), a staged delete of one (allow), a staged rename INTO one
  (refuse, naming the new path), `bundles.generated.ts` or
  `.gitattributes` staged (allow, even though both are plausible-looking
  paths), no merge base reachable (refuse, paths named with no command),
  and a missing/unreadable build declaration (allow — the derivation is
  blind, not refusing).
- The new staged-index `Refs` operation has a fixture implementation and
  the git-adapter implementation (`refs-git.ts`), with its own test.
- `gate.ts`'s `GATES` array carries one row for this gate; `wants` is pure
  and cheap (string test only); `ask` imports adapters lazily.
- `hooks/hooks.json` holds `plot-gates.sh` in place of
  `plot-bundle-commit-gate.sh`'s old entry; the other four gates' entries
  are untouched.
- `skills/plot/scripts/README.md`'s `plot-bundle-commit-gate.sh` row
  changes `Kind` from `decision` to `launcher` and sets `Replaced by` to
  `board/plot-gate.mjs` (`scripts/check-decision-count.sh` enforces the
  table changing the right way — it fails if the count doesn't drop).
  `scripts/check-decision-count.sh`'s count goes from 52 to 51.
- `scripts/measure-gates.mjs` (built in wave 1) re-run and the PR records
  the figure: a non-commit Bash call through `plot-gates.sh` must cost no
  more CPU than the five shell gates cost at the same load today — not a
  fixed millisecond number, because load varies machine to machine and
  run to run (the plan's own figures were taken at load average 18.0 on
  16 cores).
- `test/reconcile/bundle-commit-gate.test.mjs` continues to pass,
  unmodified in its assertions, now driving the gate through the launcher
  path — if its drive-path needs edits because the launcher's exit-code
  passthrough changed something observable (not because the test was
  wrong), say so in the PR.

Plus the repo's standing gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — the suites named under `CI suites` in this
repo's `## Plot Config` run in CI, not locally; a failure there comes
back as a correction, so don't run them as a matter of course. Name the
shell-lines gate in the same breath: `scripts/check-shell-lines.sh`
refuses a PR whose shell under `skills/` is longer than at its merge
base. This slice should net REDUCE shell (111→~7 launcher lines), so
you are not expected to pay anywhere else — but if the launcher ends up
longer than the `plot-reap.sh`/`plot-gates.sh` shape warrants, trim it
rather than letting the ratchet catch it. Also run
`scripts/check-helper-table.sh` if you add any new helper script (you
shouldn't need to — this slice converts an existing one).

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan, titles the PR from this wave's heading, and refuses a
branch no plan names. Push the first real commit as soon as it exists so
the PR can open early. When it exists, append `→ #<number>` to this
branch's line under the plan's `## Slices` → `### The bundle gate`
subheading, on `main`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-bundle-commit-gate.sh` (becomes a launcher)
- `packages/board/src/server/entry/gate.ts` (adds the one gate row —
  everyone's row lands in this same file across the five gate slices;
  expect your diff here to be small and additive, never touching another
  gate's row)
- A new rule file under `packages/domain/src/rules/` (e.g.
  `bundle-commit.ts`) and its test
- A new `Refs` port operation (staged add/modify/rename listing) plus its
  fixture and git-adapter implementations and test
- `hooks/hooks.json` (registers `plot-gates.sh`, drops the bundle gate's
  own line only)
- `skills/plot/scripts/README.md`'s `plot-bundle-commit-gate.sh` row

It does **not** own: `plot-phase-gate.sh`, `plot-state-gate.sh`,
`plot-brief-name-gate.sh`, `plot-controller-gate.sh`, or
`plot-install-hooks.sh`'s core expansion logic (wave 1 built that; this
slice should only need it to keep working, not to change). Other
branches in this plan's wave sequence touch those files later
(`feature/the-brief-name-gate-is-a-launcher`,
`feature/the-state-gate-is-a-launcher`,
`feature/the-controller-gate-is-a-launcher`,
`feature/the-phase-gate-is-a-launcher`) — none are claimed yet as of this
writing, so there is no live collision to check against, but `gate.ts`'s
`GATES` array is the one file every later wave also edits: keep your
addition to one row, and expect the merge order to matter there.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
