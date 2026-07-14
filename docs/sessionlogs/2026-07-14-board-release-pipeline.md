# Wire @plot-pm/board into the release pipeline + board-only RC flow

**Date:** 2026-07-14
**Scope:** Adapt the changesets release pipeline for the graduated `packages/board` — stable npm publish alongside the release, plus a board-only prerelease (`rc`) channel for pre-merge testing.
**Branch:** `infra/board-release-pipeline` (off `origin/main` @ `87e6804`, the #40 merge)
**PR:** [#44](https://github.com/plot-pm/plot/pull/44) — **design gate; not self-merged** (Max reviews the diff to confirm the RC mechanism)
**Follows:** [`2026-07-13-kanban-board-v1.md`](./2026-07-13-kanban-board-v1.md) — closes its "deferred work: wiring npm publish (add a publish step + token to `release.yml`)".

> **⚠️ Superseded — read the [Amendment (OIDC rework)](#amendment--oidc-trusted-publishing-tokenless) at the bottom first.** The original design below used an `NPM_TOKEN` secret, a changesets `--snapshot` RC (`rc-<datetime>`), and a separate `board-rc.yml`. Max reworked all three: tokenless **OIDC trusted publishing**, **literal `-rc.N`**, and a **single** `release.yml` (two event-gated jobs). Sections 1–5 and the first decisions table are kept for provenance but no longer reflect the diff.

## What

PR #40 graduated `packages/board` to a first-class workspace package but left the release pipeline publishing nothing to npm (the `plot` skills package ships via the plugin marketplace; the custom `publish` step only makes git tags + a GitHub Release). This wires the board in:

1. **Versioning was already free.** The board is a non-ignored workspace package, so a `@plot-pm/board`-targeted changeset makes `changeset version` bump `packages/board/package.json`, and `pnpm run version` already builds the board. `bump-skill-versions.sh` ignores board changesets. **No versioning change was needed** — this PR adds none, so the board debuts at whatever `package.json` holds (currently `0.2.0`) on the next release publish.
2. **Stable publish (the real gap).** Added a board publish to `.dev/scripts/create-release.sh`: `pnpm --filter @plot-pm/board publish`. **Guarded** (no-ops + exits 0 when no npm auth in env) and **idempotent** (skips a version already on the registry, mirroring the existing tag-exists guard). `release.yml` gets `registry-url` on `setup-node` and `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN` on the changesets action.
3. **Board-only RC channel** (`.github/workflows/board-rc.yml`, new). `workflow_dispatch` → `changeset version --snapshot rc` → board-scoped `pnpm publish --tag rc`. Publishes `0.2.1-rc-<datetime>` to the npm `rc` dist-tag, installable via `pnpm add @plot-pm/board@rc`. Never touches `latest`, never commits.
4. **Package hygiene** (`packages/board/package.json`). `npm pack` inspection showed the tarball would ship a redundant `dist/client/index.html` (313 KB, already inlined into the `.mjs`) and raw `.ts`. Narrowed `files` → `["dist/board-server.mjs"]`, added `prepack` build + `publishConfig.access: public`, dropped the `./contract` subpath export for v1 (it pointed at `./src/contract/index.ts` — a plain-JS consumer would get unresolvable TS; no internal consumer). Tarball is now `board-server.mjs` + `package.json` (176 KB).
5. **`.changeset/config.json`** gains `snapshot.useCalculatedVersion: true` so snapshots read `0.2.1-rc-…` (calculated from pending changesets) rather than `0.0.0-rc-…`.

## Non-obvious decisions

| Decision | Choice | Why |
|----------|--------|-----|
| RC versioning: snapshot vs literal `-rc.N` | **snapshot** (`X.Y.Z-rc-<datetime>`) | Max asked for incrementing `-rc.N`. Native changesets gives literal integer `-rc.N` **only** via *pre mode* (`changeset pre enter rc`), which is **repo-global and stateful** — it commits `.changeset/pre.json` for the whole workspace and needs an enter/exit lifecycle, dragging `plot` into `-rc` too. Hostile to "board-only". Snapshot is board-scopable, stateless, and each publish is unique/sortable/`@rc`-installable — fully meets the functional goal. **Flagged as decision #1 in the PR for Max to confirm** (this is the deliverable the task defines: propose the mechanism, PR review is the gate). Consistent with the prior session's rejection of pre mode for the same global-vs-scoped reason. |
| Merge-before-prerequisites safety | Guard makes both publish paths no-op without `NODE_AUTH_TOKEN` | So merging #44 **cannot red** the `on: push:[main]` release workflow before the `NPM_TOKEN` secret exists. Verified locally: ran the exact guard block with `env -u NODE_AUTH_TOKEN -u NPM_TOKEN` → printed the skip line, `exit 0`. This is the load-bearing claim in the PR body. |
| Publish mechanism | Board-scoped `pnpm --filter … publish` (shared by both stable + RC) | One mechanism, board-only. The alternative (root `plot` `private:true` + `changeset publish`) would entangle the skills package. `create-release.sh` (custom publish step) stays the single publish entry point. |
| Changeset in this PR? | **None** (removed per Max's feedback) | Initially carried a `plot: patch` changeset describing the pipeline wiring. Removed per Max: **changesets describe user-facing changes to a released package, not internal release-pipeline/infra wiring**. This whole PR is infra + initial packaging of the not-yet-published board, so it ships no changeset. (Also keeps the board version-neutral, not pre-empting decision #3 — the `0.2.0`-vs-`1.0.0` npm debut is Max's call.) |

## Verification

- `pnpm typecheck`, board tests (9/9), both workflows YAML-valid, `create-release.sh` shellcheck-clean (only pre-existing SC1091 on sourced `lib.sh`).
- Guard no-op proven: guard block with no npm auth → skip line + `exit 0`.
- Snapshot proven locally: with a pending board changeset, `changeset version --snapshot rc` → `@plot-pm/board@0.2.1-rc-20260714064743` (calculated patch + snapshot suffix); tree reverts cleanly.
- **No npm publish and no RC dispatch run from this branch.** `release.yml` stays `on: push:[main]`; the RC workflow is `workflow_dispatch`, not runnable until it's on the default branch.
- CI on #44: `validate` = **pass** (docs-only sessionlog push keeps it green — freshness gate untouched).

## Gotchas caught (not in the diff)

- **The snapshot step needs `GITHUB_TOKEN`.** Local testing surfaced that `changeset version --snapshot rc` fails without it — the `changelog-github` generator runs during *every* `changeset version` (not just publish) and needs the token to fetch commit info. Wired `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into the snapshot step, matching how the main release workflow provides it. Would not have been caught by YAML-lint or typecheck — only by running it.
- **`git reset --hard` during snapshot testing wiped an uncommitted fix.** Committed a base, then made the `GITHUB_TOKEN` edit (uncommitted), then `git reset --hard HEAD` for a clean snapshot test — which reverted the edit. Lesson: commit fixes *before* running reset-based tests on a mixed committed+uncommitted tree.
- **Local snapshot testing is blocked by `changelog-github`** even with `GITHUB_TOKEN=$(gh auth token)` — the plugin errors fetching commit info for an *uncommitted* local changeset. Worked around by temporarily setting `.changeset/config.json` `changelog: false` (via jq) to isolate version computation, confirming `0.2.1-rc-…`, then restoring.

## Next steps

- [ ] **Max reviews PR #44** and confirms the 5 "Decisions to confirm" (esp. #1 snapshot-vs-`rc.N`, #3 board npm debut version).
- [ ] **Do NOT self-merge** — Max's review is the approval gate.
- **Human prerequisites (block the pipeline, not this PR):** an `NPM_TOKEN` secret with publish rights to the `@plot-pm` npm org, and confirmation the `@plot-pm` scope exists. Until then both publish paths guard/no-op.
- **First publish is automatic** once the token lands: the next release cycle publishes `@plot-pm/board` at whatever version `package.json` holds — ties to decision #3.

## Awareness

- **Merging #44 will NOT touch the open release PR** ([#43](https://github.com/plot-pm/plot/pull/43), "release: 1.7.0") — with the changeset removed, this PR carries no version-bumping changeset, so the changesets action has nothing to fold in. (Before the changeset removal it would have folded a `plot: patch` in; no longer.)
- **PR opened on `plot-pm/plot`.** The task said `eins78/plot`; every PR this session (#40, #43) is on `plot-pm/plot`, so this is read as Max's shorthand for the same repo. Confirm if that's wrong.
- **`release.yml`'s "Compute next release version" step** hardcodes `select(.name=="plot")` for the PR *title* only (cosmetic). If the board ever versions in a release with no `plot` bump, the title reads `pending`. Left as-is, out of scope.

## Repository State (original revision)

- Committed: `3d47aab` — infra: wire @plot-pm/board into the release pipeline + board-only RC flow
- Branch: `infra/board-release-pipeline` (pushed; PR #44 open, assigned to Max)
- Board back to `0.2.0`, working tree clean.

---

## Amendment — OIDC Trusted Publishing (tokenless)

Max reviewed the diff and redirected the whole auth model, then refined it twice. The pipeline now publishes **without any npm token**, via GitHub **OIDC trusted publishing** with build **provenance** (ref: [zachleat.com/web/npm-security](https://www.zachleat.com/web/npm-security/)). This supersedes sections 2, 3, 5 and the first decisions table above.

### What changed

1. **No token anywhere.** Removed `NPM_TOKEN`/`NODE_AUTH_TOKEN` from `release.yml` and the token guard from `create-release.sh`. Publishing authenticates via OIDC (`id-token: write` on the publishing jobs; `setup-node` `registry-url`; `npm publish --provenance`).
2. **`npm publish`, not `pnpm publish`.** Verified pnpm does not implement OIDC trusted publishing ([pnpm#9812](https://github.com/pnpm/pnpm/issues/9812) — closed by deferring to the npm CLI; a commenter confirms `pnpm publish` fails trusted publishing where `npm publish` succeeds, same Node/npm). pnpm still does install/build/versioning.
3. **Single workflow file.** npm's Trusted Publisher allows exactly **one workflow filename per package**, so `board-rc.yml` was **deleted** and folded into `release.yml` as a second job. `release.yml` now `on: {push:[main], workflow_dispatch}` with `release` (`if: push`) and `board-rc` (`if: workflow_dispatch`) jobs. One trusted-publisher binding (`release.yml`) covers both stable and RC.
4. **Literal `-rc.N`** (replaces the `--snapshot` timestamp). Changesets can't produce literal `rc.N` board-only (snapshot = timestamp; pre-mode = repo-global + stateful), so the RC job derives the counter from the **npm registry**: base = `packages/board/package.json` version, `N` = highest published `<base>-rc.<n>` + 1 (numeric, else 0). The `changeset --snapshot` step (and its `GITHUB_TOKEN`, and `snapshot.useCalculatedVersion` in `.changeset/config.json`) are gone.
5. **Stable-publish correctness gate.** `create-release.sh` now publishes stable **only** if `packages/board/CHANGELOG.md` has an entry for the current version (whole-line `grep -qxF "## <ver>"`) — a signal only a changeset-driven release produces. Prevents a plain merge from pushing the hand-set `0.2.0` to `latest`. Consequence: **`0.2.0` never auto-publishes**; first auto stable is the first board changeset (**≥ 0.2.1**).
6. **Node 24 + npm 11.12.1** on the publishing jobs (OIDC needs Node ≥ 22.14 and npm ≥ 11.5.1). Pinned npm (not `@latest`) for supply-chain posture; each publish step echoes `node/npm --version` for auth triage.

### Non-obvious decisions (amendment)

| Decision | Choice | Why |
|----------|--------|-----|
| Literal `-rc.N` board-only | **Registry-derived integer counter** | Changesets can't do literal `rc.N` board-only. This is *not* the "fragile version bumper" the original guidance warned against: the base version is `package.json` (changeset/human-managed); only an integer counter is tracked, and its state is the registry (authoritative record of what's published), not local logic. Unit-tested for the numeric-max trap (`rc.10` > `rc.2`) and npm's array-vs-single-string output shapes. |
| Bump publish jobs to Node 24 | **Safe — proved determinism** | `release.yml`'s `pnpm run version` rebuilds the committed board artifact, which CI byte-diffs on **Node 20**. A local Node 24/macOS build is **byte-identical** to the committed artifact (built by CI Node 20/Linux) → Node 24 can't red the freshness gate. CI left on Node 20 (untouched). |
| npm CDN lag on rapid RC re-dispatch | **Accepted** | Two dispatches seconds apart could recompute the same `N` and fail `already published`; rare, self-corrects on retry. Noted in PR. |
| Publish tool version | **Pinned `npm@11.12.1`** (not `@latest`) | Reproducibility + matches the SHA-pinning posture. Confirmed published on the registry. |

### rc-base semantic (flagged to Max)

RCs stay `0.2.0-rc.N` until `package.json`'s board version changes; the eventual stable release increments from `0.2.0` via changesets (→ `0.2.1`), so rc labels won't match the shipped `latest` version. Fine for throwaway test artifacts.

### Bootstrap runbook (in the PR; order matters)

Trusted publishing can't create a package that doesn't exist, so **Max publishes `0.2.0-rc.0` first, manually, locally, with 2FA** (`npm publish --tag rc`, no `--provenance` — local can't generate it; revert the version bump, don't commit) → **then** registers the Trusted Publisher (GitHub Actions · plot-pm/plot · `release.yml` · no environment) → **then** sets "require 2FA, disallow tokens". The manual debut picks the debut version (resolves the old decision #3).

### Verification (amendment)

- `release.yml` valid YAML — 2 event-gated jobs, least-privilege `permissions` (release: contents+PR+id-token write; board-rc: contents read + id-token write), all 7 action uses SHA-pinned.
- rc.N counter unit-tested: `[]`→0, single-string `"…-rc.0"`→1, mixed array numeric-max→11 (not lexical), malformed suffixes ignored, base-isolated.
- Board build byte-identical Node 20↔24 (freshness gate safe).
- `create-release.sh` shellcheck-clean (pre-existing SC1091 only). No `NPM_TOKEN`/`NODE_AUTH_TOKEN` consumed anywhere (explanatory comments only). `board-rc.yml` removed; `snapshot` dropped from changeset config.
- **Nothing published or dispatched from the branch** — `board-rc` job is `workflow_dispatch`-only (not runnable off the default branch).

### Worm-propagation hardening

The `id-token: write` jobs run only install + build + publish — **no test suite**. `ci.yml` (tests) has no `id-token` and is unchanged. Aligns with keeping the OIDC-privileged context away from untrusted test code.

## Amendment 2 — standalone-package runtime fix (vendored helper scripts)

Max's team ran `pnpm dlx @plot-pm/board@rc` (the `0.2.0-rc.0` debut) in another repo: the server started but **crashed at runtime** reading `docs/plans` — `plot-config.sh: No such file or directory` / `plot-plan-meta.sh: No such file or directory` (exit 127).

**Root cause:** `board-server.mjs` shells out (`bash`) to `plot-config.sh` + `plot-plan-meta.sh`, resolved at `scriptsDir = resolve(dirname(artifact), '..')`. Those scripts live in `skills/plot/scripts/` and were never in the board tarball. It worked only from a plot checkout — where the artifact sits at `skills/plot/scripts/board/board-server.mjs`, so `../` *is* `skills/plot/scripts/`. In the npm layout the artifact is `<pkg>/dist/board-server.mjs`, so `../` is the package root, which shipped nothing. The `files: ["dist/board-server.mjs"]` trim didn't cause it (the scripts were always outside `packages/board/`), but the package was never self-contained.

**Fix (option (a) — copy to package root, matches existing resolution → no `index.ts` / artifact change):**
- `build.mjs` vendors `plot-config.sh` + `plot-plan-meta.sh` from `skills/plot/scripts/` (canonical source) into the package root on every build (re-copied each build → can't drift), `chmod 755`.
- `packages/board/package.json` `files` adds the two `.sh`.
- `packages/board/.gitignore` ignores the vendored copies (build output, like `dist/`; shipped via `files` regardless of gitignore).
- **`board-server.mjs` unchanged** → committed skills artifact byte-identical → CI freshness gate stays green. Both scripts are self-contained (no sibling `source`), so copying just the two is sufficient.

**Why not option (b)** (scripts in `dist/`, `scriptsDir = here`): would change `index.ts` (→ artifact churn) *and* break the plot-checkout layout, where the artifact is in `.../board/` but the real scripts are one level up in `.../scripts/`. Option (a) leaves the checkout layout untouched — the fix is npm-only.

**Drift tradeoff (flagged to Max):** the published board now vendors its own copy of plot's parser scripts. Build-time re-copy keeps them in sync with source, but the npm bundle is no longer "just the board".

**End-to-end verified** (the gap that let the bug ship — a 200 on `/` only serves the static HTML shell, never touching the scripts): `npm pack` → extract tarball → run the extracted `dist/board-server.mjs` from a scratch repo with `docs/plans/{alpha(Draft),beta(Approved)}.md` → `curl /api/board` = **200 with real board JSON** (both plans sorted into phase columns), no exit-127. Tarball file list confirmed: `dist/board-server.mjs`, `plot-config.sh`, `plot-plan-meta.sh`, `package.json`. This is the exact shape `npm version 0.2.0-rc.1 && npm publish --tag rc` produces. Max re-publishes `0.2.0-rc.1` manually (`rc.0` on npm is broken).

## Amendment 3 — zero runtime dependencies (private-registry repos)

Max verified Amendment 2 downstream via `pnpm dlx <tgz>` + Playwright in two checkouts: **ewz-leg** works (board renders, `/api/board` 200); **cpq-cds** failed to boot — but not from the scripts bug.

**Root cause:** `packages/board/package.json` declared `dependencies: { "zod": "^4.4.0" }`, yet esbuild **bundles zod into** `dist/board-server.mjs` (`bundle: true` — `ZodError` is inlined). That phantom runtime dep forces `pnpm dlx`/`npx` to resolve+install zod from the **consuming repo's** registry. In cpq-cds the default registry is a private Artifactory proxy (`binaries.quatico.com`) with no auth token in that checkout → `No authorization header was set for the request` → the dlx install aborts → the board never starts. Any repo pointed at an authed/private registry hits this; public-npm checkouts (and Amendment 2's verification) masked it.

**Fix:** moved `zod` from `dependencies` → `devDependencies`. The runtime tarball now declares **zero** `dependencies`, so `pnpm dlx`/`npx` installs only the board tarball and never touches the consumer's registry. zod stays bundled (esbuild unchanged). `pnpm-lock.yaml` regenerated for the move (else CI `--frozen-lockfile` fails).

**Verified:** rebuild → `grep ZodError dist/board-server.mjs` still present (bundled); packed tarball's `package.json` has **no `dependencies`** field (`null`); ran the extracted `dist/board-server.mjs` with **no `node_modules` alongside** → `/api/board` = 200 with real board JSON (proves zod comes from the bundle, not the filesystem). Committed skills artifact byte-unchanged (freshness gate green). Max confirmed downstream: `pnpm dlx` in cpq-cds → `Packages: +1` (board only, no registry hit) → 127 cards, 104 links rendered.

**Ordering:** must land before Max re-publishes `0.2.0-rc.1` — otherwise the rc.1 tarball still carries the zod dep and breaks in private-registry repos.

## Amendment 4 — RC auto-publishes on push, gated + based on the changeset (design approved)

Max approved the design and asked for three chained changes so that _merge to main → Version PR updated → board RC published, but only when the board has pending changes_.

1. **Board changeset added** (`.changeset/board-standalone-package.md`, `"@plot-pm/board": patch`). The two packaging fixes (script-vendoring `a73ec53` + zod→devDeps `a2d6c66`) are **user-facing** (a broken published package made installable), so per the "changesets = user-facing only" rule they warrant a changeset. It bumps the board **0.2.0 → 0.2.1** (first real stable), and makes `changeset status` report a pending board version — the `BASE` the RC reads. The pipeline/CI wiring stays changeset-free (infra).
2. **RC fires on push** (not just dispatch): `if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'`. On push both `release` and `board-rc` run. The `release` job stays `push`-only.
3. **RC base = changeset-predicted version + gate.** The step now reads `BASE` from `npx changeset status` (`.releases[] | select(.name=="@plot-pm/board") | .newVersion`) instead of `packages/board/package.json` (which lags at 0.2.0 until the Version PR merges — would mislabel `0.2.0-rc.N` while shipping 0.2.1 code). If no pending board changeset → `BASE` empty → `exit 0` ("board unchanged"). This gate is what makes firing-on-push safe. The registry-derived rc.N counter is unchanged; it resets when `BASE` bumps.

**Why the chain is safe:** #1 makes the board pending, #3 reads that as the base and self-skips on emptiness, so #2 (fire on push) can't publish spurious RCs for an unchanged board.

**Verified locally:**
- `npx changeset status` on the branch → `@plot-pm/board: 0.2.0 → 0.2.1` and `plot: 1.6.0 → 1.7.0`; the jq selector extracts exactly `0.2.1`.
- Gate simulated in all three states: board pending → publish base `0.2.1`; plot-only pending → skip; nothing pending → skip.
- `release.yml` valid YAML (both `if` correct, actions SHA-pinned); RC publish step shellcheck-clean.

**Flow:** board-changeset merge → `release` updates Version PR (0.2.0→0.2.1) **and** `board-rc` publishes `0.2.1-rc.0`; non-board merge → `board-rc` skips; Version PR merge → changesets consumed, `board-rc` skips, `release` publishes stable `0.2.1` to `latest`.

## Repository State (current)

- Branch: `infra/board-release-pipeline` — PR #44 (design approved; not self-merged).
- `release.yml` (`release` on push; `board-rc` on push+dispatch, changeset-gated, changeset-predicted base), `create-release.sh` (CHANGELOG-gated OIDC stable publish), `.changeset/config.json` (no `snapshot`); `board-rc.yml` deleted.
- `build.mjs` + `packages/board/{package.json,.gitignore}` vendor the two scripts (standalone fix); `zod` in `devDependencies` → zero runtime deps (bundled), `pnpm-lock.yaml` updated.
- **New:** `.changeset/board-standalone-package.md` (`@plot-pm/board` patch → 0.2.1). Committed artifact fresh, tree clean.
