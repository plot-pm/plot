## Implementation brief — an-scp-style-remote-with-a

- **Plan (canonical):** `docs/plans/2026-10-18-an-scp-style-remote-with-a.md` on main
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2064 merged
- **Branch:** `bug/an-scp-style-remote-with-a` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh commit-status` on Bitbucket derives the `<workspace>/<repo>` slug from `remote.origin.url` with a sed pipeline at `plot-host.sh:5369`. Its port strip, `s#(bitbucket\.org):[0-9]+/#\1/#`, cannot tell a port from an scp-style path. For `git@bitbucket.org:12345/repo.git` it deletes the numeric workspace, the slug becomes empty, and the op exits 4 (`unsupported`). Issue #2055.

Replace the pipeline with one domain rule, `packages/domain/src/rules/`, that maps a remote URL to a slug. Ship it as a bundle under `skills/plot/scripts/board/`, and call it from `plot-host.sh` in place of the pipeline. The rule separates the two forms by the scheme:

- With a scheme (`https://`, `ssh://`): a `:<digits>` after the host is a port. Strip it.
- Scp-style (`[user@]host:path`): the colon starts the path. The first segment is the workspace, even when it is all digits.

### Decisions the plan settles — do not re-derive them

**A bundle, not more sed.** `CLAUDE.md` › *A Shell Script Asks The Domain*: `commit-status` runs once per operator command, so it asks the domain. `node -e ''` starts in 34 ms and a shipped bundle answers in 39 ms. Do not duplicate the rule in shell: a duplicate needs a corpus test, and this one needs none because there is no second implementation.

**A new bundle is a new entry point plus a `build.mjs` block** (`docs/shell-and-domain.md` §2). Model it on `merge-subject`: entry at `packages/board/src/server/entry/<name>.ts`, a block in `packages/board/build.mjs` beside `mergeSubjectArtifact` (~line 1294), and a `-merge` line in `.gitattributes` beside line 75. Import the rule through the narrow path (`@plot-pm/domain/rules/<name>`), as `merge-subject.ts` does, so the root import does not bundle every rule. **Commit no built bundle**: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds its own. Run `pnpm build:board` only to test locally, then restore the generated paths.

**Do not extend `ownerOfRemote`.** `rules/remote-owner.ts` answers a different question (the LAST segment before the repo, lowercased, `null` for a local path). The slug keeps the case and the whole `<workspace>/<repo>` pair. Reuse its scheme/scp split if it helps, but a new rule in a new file is the plan's open question 2, and the answer is a new file because the two return types differ.

**Open question 1, answered at dispatch: no other Bitbucket parser needs this change.** `grep 'bitbucket\.org' skills/plot/scripts/plot-host.sh` finds `:5369` as the only slug parse. `packages/fleet/src/shared/fleet-scan.ts:199` (`branchUrlBase`) has its own regex, but it reads the scheme'd and scp forms separately and keeps the path, so it does not drop a numeric workspace. Leave it alone; read it once to confirm before you start.

### Rules carried over unchanged

- **Empty is an answer.** A remote that is not Bitbucket (or is a local path) yields an empty slug, and `plot-bitbucket-commit-status.mjs` reads an empty slug as `unsupported` (exit 4). The rule returns `null`/empty for it; it never throws and never guesses.
- **Absent is not false.** A missing `remote.origin.url` is the same empty slug, not an error in the shell.
- **`.git` and a trailing `/` are stripped before capture**, not inside an optional trailing group (the comment at `plot-host.sh:5365` records why: a greedy match absorbs `.git` into the slug).
- **Every host the existing test names must keep working:** `ssh.bitbucket.org` and `altssh.bitbucket.org` (port 443). `test/reconcile/host-commit-status.test.mjs:390` holds three of those forms. Run it.

### Done when

The plan's slice line is the specification: the domain rule with one unit test per remote form, the bundle, and `plot-host.sh` calling it in place of the sed pipeline. The five forms in the plan's table are the unit cases. Lift these two because a naive fix passes without them:

- **`git@bitbucket.org:12345/repo.git` → `12345/repo` through `plot-host.sh commit-status`, not only through the unit test.** A rule that is right while the shell still passes the old pipeline's output proves nothing. Add a case to `test/reconcile/host-commit-status.test.mjs` beside the SSH-forms test, so the exit-4 reproduction fails before the change and passes after.
- **`ssh://git@bitbucket.org:22/acme/repo.git` → `acme/repo`.** A fix that only special-cases digits after the colon passes the scp case and breaks this one.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. The change replaces one line with one line, so the count must not grow. If your call needs more lines, remove shell elsewhere in the same change. The gate stores no number and has no override.

Add a changeset (`.changeset/`), description first and `bumps:` block last, with `plan: docs/plans/2026-10-18-an-scp-style-remote-with-a.md`. The plan's Changelog line is the description. `./scripts/check-changeset-packages.sh` checks it. Document the new bundle in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh` is the gate), and keep new functions arrows.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/<new slug rule>.ts` and its test, one entry in `packages/board/src/server/entry/`, a block in `packages/board/build.mjs`, a `.gitattributes` line, the `plot-host.sh` call at `:5369` (and the comment above it), a case in `test/reconcile/host-commit-status.test.mjs`, the README row and a changeset.

In flight at dispatch: `bug/a-merge-refuses-when-the-head`, `bug/bitbucket-jenkins-pr-list-binds-a` and others touch `plot-host.sh` and `build.mjs` in other places. Expect a rebase conflict in `.gitattributes` or `build.mjs` at worst; resolve it by keeping both blocks. A generated bundle conflicts by restoring it from the merge base, never by committing a rebuild.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
