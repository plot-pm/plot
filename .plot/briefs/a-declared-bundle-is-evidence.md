## Implementation brief — the-shell-sheds-its-decisions (wave 2: A declared bundle is evidence)

- **Plan (canonical):** `docs/plans/2026-10-09-the-shell-sheds-its-decisions.md` on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-declared-bundle-is-evidence` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention
- **Ordering:** this slice follows `feature/the-gate-counts-decisions` (#1405, merged as `03d0f9e26`). `feature/the-gate-counts-every-script` waits on it, because both edit `has_evidence` and `counted` in the same script. `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` wait on it too: their conversion PRs are the first callers of the rule this slice changes.

### What to build

Let `scripts/check-decision-count.sh` accept a bundle that `packages/board/build.mjs` declares, with its entry source present in `HEAD`, as evidence for a row that moves to *launcher* or *readings*.

The failure it closes: a conversion PR cannot flip its own row. The shipped gate reads evidence with `git cat-file -e HEAD:skills/plot/scripts/<bundle>.mjs`, and the bundle is generated output. `scripts/check-no-bundle-diff.sh` refuses a PR whose diff carries a generated path, and `main` builds the bundle after the merge (`build-bundles.yml`). So a PR that adds `entry/reap.ts`, declares `plot-reap.mjs` in `build.mjs` and turns the `plot-reap.sh` row to *launcher* fails `check-decision-count.sh` with `kind changed without evidence`, because `plot-reap.mjs` is not in the PR's tree. The row can flip only in a second PR after the merge, which is the order the plan's slices 4 and 5 cannot afford: each must lower the count in its own change. Measured on `main` at `0e05b5cfb`, 2026-10-09: `build.mjs` holds 39 `shipped*` bindings, and the 39 paths in `BOARD_ARTIFACT_PATHS` are the files the gate would have to find.

The evidence becomes: the bundle path in *Replaced by* is either present in the HEAD tree (as today) or declared in `packages/board/build.mjs` at HEAD and paired there with an entry source that exists in the HEAD tree. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Declared means a `shipped<Name>` binding in `build.mjs`, read the way the two existing readers read it.** `build.mjs` derives its own bundle set with `shipped[A-Za-z]* = path.join([^)]*'\.\.\/\.\.\/([^']*)')`, and `scripts/check-no-bundle-diff.sh` and `scripts/check-bundle-attributes.sh` use the same pattern. Reuse that pattern. A fourth spelling of "what `build.mjs` declares" is the drift those gates were written against (9, then 10, then 11 entries in one evening). Do not read `bundles.generated.ts` instead: it is generated, and a PR that adds a bundle must conflict-free pass without it being rebuilt first.

**The entry source is found through the build block, not through the file name.** The name convention fails on three of the 39 bindings: `plot-ask.mjs` is built from `entry/main.ts`, `plot-registryd.mjs` from `entry/registryd-main.ts`, and `board-server.mjs` from `src/server/index.ts`. The pair that holds for all of them is the `shipped<Name>` binding and the `entryPoints: [path.join(here, '<src>')]` of the esbuild call that writes `outfile: <name>Artifact`/`shipped<Name>`. Pair them from `build.mjs`, and check the source path exists with `git cat-file -e HEAD:packages/board/<src>`. A name-prefix rule (`plot-X.mjs` ← `entry/X.ts`) passes the fixture you write and rejects `plot-ask.mjs`.

**A declared bundle with no entry source is not evidence.** Catches a PR that adds a `shipped` line to `build.mjs` and nothing behind it, which would flip a row for free. Equally, an entry source with no declaration is not evidence: the bundle would never be built.

**The rule stays "at least one named bundle, and every named path must qualify".** `named_paths_exist` already requires every named path to exist and at least one to be named. Keep that shape: each `.mjs` named in *Replaced by* must be either present in HEAD or declared-with-source. Do not accept a row because one of three names qualifies.

**The gate reads `build.mjs` at HEAD and not at the base.** The conversion PR is the one that adds the declaration. Reading the base would refuse the case this slice exists for.

**Unchanged from #1405, and not reopened here.** Modes `pr` and `push <before>`, the base read from git, no override, no allowance literal, no environment variable, no stored number. The gate reads the README and `build.mjs` and never opens a `.sh` file. The *Kind* cell is read from the end of the row. Absent is not zero: a missing `build.mjs` at HEAD is an error to name, not a reason to fall back to the present-in-tree rule silently. *paired* keeps its own evidence (a `rules/*.ts` export and a `*.corpus.test.ts` file) and this slice does not touch it.

**Evidence guards a label, and one label guards nothing.** *readings* does not lower the count, so requiring evidence for it guards no number today. The plan answered this on 2026-10-09 (jwloka: enforce), so the rule stays and this slice widens it for both kinds. Report in the PR that *readings* evidence guards nothing under the present count. `feature/the-gate-counts-every-script` makes it matter, and the report is a finding for that wave rather than an edit here.

### Done when

The plan's `## Slices` entry is the specification: the decision gate accepts a bundle that `packages/board/build.mjs` declares, with its entry source present, as evidence for *launcher* and *readings*, so a conversion PR can flip its row in the same change that adds the bundle. Assertions that exist because a naive implementation would pass without them:

- **A launcher row naming a bundle that `build.mjs` declares, with its entry source present and the `.mjs` absent from HEAD, passes.** The case the slice exists for. Catches a gate that still requires the generated file.
- **The same row with the `shipped` line present and no entry source in HEAD fails.** Catches a gate that trusts the declaration alone.
- **The same row with the entry source present and no `shipped` line fails.** Catches a gate that trusts the source alone.
- **A row naming a bundle whose entry is `entry/main.ts`-shaped (the file name does not match the bundle name) passes when declared.** Catches the name-prefix shortcut. Use a fixture `build.mjs` with the same block shape as the real one (`const shippedX = path.join(here, '../../skills/plot/scripts/board/plot-x.mjs')` followed by an esbuild call with `entryPoints: [path.join(here, 'src/server/entry/other.ts')]`).
- **A row naming two bundles, one declared and one named nowhere, fails.** Catches "any one name qualifies".
- **A `build.mjs` absent at HEAD fails with a message that names it.** Catches a fallback that reads absence as "nothing declared, use the old rule".
- **A *readings* flip with a declared bundle passes, and a *paired* flip is unchanged.** *paired* keeps both of its tests as they are.
- **The #1405 fixture tests keep passing**, including `the same flip naming a bundle passes` (a bundle present in the tree still qualifies), `a launcher naming a bundle absent from HEAD fails` (adjust its fixture only if it now declares the bundle; the absent-and-undeclared case must still fail), and the pipe-in-Purpose, missing `origin/main`, no-README-at-base and gap-in-table tests.
- **The real tree still passes**: `./scripts/check-decision-count.sh pr` on this branch with no README change prints the same counts as on `main` (20 and 20 at `0e05b5cfb`). A count in the output is what lets a reader tell a working gate from a skipped one.
- **Mutation-test it before trusting the tests:** commit first, break one arm (let a declaration without a source pass), confirm the matching test fails, restore from git and not from your own copy.

Plus:

- **Fixture test:** extend `test/reconcile/decision-count.test.mjs` in its throwaway git repo with a bare remote, so the merge-base logic stays the thing under test. The fixture needs a `packages/board/build.mjs` and entry sources it commits itself; do not read the real `build.mjs`.
- **Docs:** update the gate's header comment (the `THE EVIDENCE RULE` paragraph) and the Kind paragraph at line 5 of `skills/plot/scripts/README.md` so both state the declared-bundle rule. A header that still says "a `.mjs` bundle, read as skills/plot/scripts/<bundle>" is a gate whose documentation lies. Do not edit any row's Kind.
- **Plot Config.** `scripts/check-decision-count.sh pr` is already on the `**` local-checks line in `CLAUDE.md`. If you edit `CLAUDE.md` for any reason, run `./scripts/check-agents-md.sh --write`, because CI refuses an `AGENTS.md` mirror that differs.
- **Changeset** per `CLAUDE.md` *Versioning*: description first, `bumps:` block last, package `plot`, and a `plan:` line after the description. Do not edit versions by hand.
- **Checks.** Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `pnpm run test:e2e` locally.
- **Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `scripts/check-decision-count.sh`, which is outside `skills/`, so the gate has nothing to count. If you touch a `.sh` file under `skills/`, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
- **Style.** Any function you write in `.mjs` or `.ts` is an arrow. Prose in markdown is one paragraph per line.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`: three slice PRs opened that way on 2026-09-08 each took the last commit subject as their title. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `has_evidence` and `named_paths_exist` in `scripts/check-decision-count.sh`, plus any helper that reads `build.mjs`, and the header paragraph that describes the evidence rule;
- its fixture test `test/reconcile/decision-count.test.mjs`;
- the Kind paragraph at the top of `skills/plot/scripts/README.md`;
- one changeset.

Do not edit `counted` or the report text: `feature/the-gate-counts-every-script` owns the widened count, and it starts from this slice's merge. Do not convert any script to a launcher and do not change a row's Kind. Do not edit `packages/board/build.mjs`, `scripts/check-no-bundle-diff.sh` or `scripts/check-bundle-attributes.sh`: this slice reads the declaration and does not change it. Do not edit `plot-reap.sh` or `plot-approve.sh`: `feature/the-reaper-becomes-a-command` and `feature/approval-becomes-a-command` own those. Do not edit generated bundles under `skills/plot/scripts/board/` (`scripts/check-no-bundle-diff.sh` refuses them). Other plans' branches in flight may touch `skills/plot/scripts/README.md` rows; this slice edits only the paragraph above the table, so a rebase conflict there is unlikely.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
