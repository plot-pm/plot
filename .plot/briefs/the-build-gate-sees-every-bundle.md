# Implementation brief — the-build-gate-sees-every-bundle

- **Plan (canonical):** `docs/plans/2026-09-14-the-build-gate-sees-every-bundle.md` on `main`
- **Approved:** 2026-09-14, jwloka, in-session
- **Branch:** `bug/the-build-gate-sees-every-bundle` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer

One slice, one branch, two independent edits in two files. Nothing waits on this and it waits on nothing.

## What to build

Two defects the fleet found delivering `a-merge-commit-carried-work`. The plan is canonical; this is orientation.

### 1. `.github/workflows/ci.yml` — the freshness gate

The step **"Board build + artifact freshness"** runs `pnpm run build:board`, then at **`:857`** diffs exactly one path:

```bash
if ! git diff --quiet -- skills/plot/scripts/board/board-server.mjs; then
  echo "::error::skills/plot/scripts/board/board-server.mjs is stale — run 'pnpm build:board' and commit the result."
  git --no-pager diff --stat -- skills/plot/scripts/board/board-server.mjs
  exit 1
fi
```

`skills/plot/scripts/board/` holds **24** bundles. Widen the diff to the directory and print the files actually found stale — `git diff --name-only -- skills/plot/scripts/board/` — instead of the hardcoded name. Keep the `::error::` prefix so GitHub still annotates, and keep the `exit 1`.

**Do not widen beyond that directory.** Measured: with one bundle dirtied, `pnpm run build:board` writes only inside `skills/plot/scripts/board/`, and on a clean checkout it rewrites nothing. A wider path would pull in unrelated dirt.

### 2. `skills/plot/scripts/plot-open-pr.sh` — the plan link

`:88` makes `plan_dir` absolute so the glob on `:99` works from any directory. **That line stays.** The consequence is that `plan_file` is absolute, and `:191` passes it as `PLOT_FILE` into the PR body — which inside a worker's desk renders the desk path and is a dead link on the host.

Strip the repo-root prefix **where it is used**, not where it is globbed:

```bash
PLOT_FILE="${plan_file#$repo_root/}"
```

`plan_file` has exactly two consumers: `basename` on `:121` (indifferent — verified, the slug is unchanged) and `PLOT_FILE` on `:191`. A path that does not start with `$repo_root/` is left absolute by a prefix strip, which is the right answer for a plan outside the repository.

## Decisions the plan settles — do not re-derive them

- **The rule is not at fault.** `rules/slice-pr.ts:161` renders `planFile` verbatim, deliberately: a rule that rewrote a caller's path would invent a repository root it cannot see. Do not touch the domain.
- **This is a gate defect, not a message defect.** Mutation-proved: appending a line to `plot-ask.mjs` PASSES the current check. Fixing only the error string would leave a stale bundle able to reach main.
- **Two files, no refactor.** Do not restructure the CI step, do not rewrite `plot-open-pr.sh`'s path handling generally.

## Verify before the PR

```bash
nvm use                        # Node 24; pnpm crashes on 26
corepack pnpm install

# The gate, both directions — this is the acceptance test:
printf '\n// probe\n' >> skills/plot/scripts/board/plot-ask.mjs
#   the widened check must FAIL and must name plot-ask.mjs
git checkout -- skills/plot/scripts/board/
#   a clean checkout must PASS

corepack pnpm run test:contracts
```

Also confirm `plan_slug` is unchanged by the strip: `basename docs/plans/2026-09-14-x.md .md | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//'`.

Do NOT run `pnpm run test:e2e` — that is CI's gate, not a local one.

Add a changeset, description FIRST:

```markdown
---
'plot': patch
---

The board artifact freshness check fails on any stale bundle rather than only board-server.mjs, and a slice PR links the plan by its repository path.

<!--
plan: docs/plans/2026-09-14-the-build-gate-sees-every-bundle.md
-->
```

**Expect this branch to restale the bundles** if you touch anything the board includes — you should not need to here, since neither file is board source. If `git status` shows bundles after a build, commit **every** one it rewrote.

## Done when

Appending a line to `plot-ask.mjs` makes the freshness step fail and the error names `plot-ask.mjs`; a clean checkout still passes it; the glob on `plot-open-pr.sh:99` still resolves and `plan_slug` is unchanged; `PLOT_FILE` carries `docs/plans/…` rather than an absolute path; `pnpm run test:contracts` passes.
