## Implementation brief — plot-reads-as-an-unknown-tracker (wave 1: Tracker plot reads as the git host)

- **Plan (canonical):** docs/plans/2026-10-20-plot-reads-as-an-unknown-tracker.md on main
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2151 merged
- **Branch:** `bug/plot-reads-as-an-unknown-tracker` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`plot-review` app, required on `main`)

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

`issueSource` (`packages/domain/src/rules/issue-source.ts:57`) answers `nobody` for `Tracker: plot`, because `plot` is in no connector's lister list. `plot-host.sh issue-list` then exits 4 with ``no connector lists issues from the declared tracker `plot` ``. Measured 2026-10-19 on ewz-kus-portal, which declares `Tracker: plot` because `/plot-sprint` proceeds only under `Tracker: plot` or no declaration (`skills/plot-sprint/SKILL.md:17-28`). That repository gets an empty inbox and a refusal.

The change: in `issueSource`, after the empty check, `plot` answers `{ ask: 'git-host' }`, the same as an empty declaration. Put the `plot` word in a named constant beside the rule, not inline in the `if`. The plan's Slices line states this as the slice (option 1); the plan's Open Questions leave the option to the reader, and this brief settles it as option 1 for the reasons below.

### Settled decisions — do not re-derive them

**Option 1, not option 2.** The sprint gate already reads `plot` as "no external tracker" and the `Setup` block lists `Tracker: plot | jira <url> | github-issues | linear <url>` with `plot` as the default. Option 2 changes a value that repositories already declare. Only the rule changes under option 1.

**This reverses a decision a test records. Change that test, do not work around it.** Two tests assert the refusal for `plot`:

- `packages/domain/test/issue-source.test.ts:46`: `expect(issueSource({ declared: 'plot', gitHost: 'github', listers }).ask).toBe('nobody')`, inside *never falls back to the git host for a tracker no connector lists*. Move the `plot` line out of that test into its own: `plot` and an empty declaration both answer `git-host`, on `github` and on `bitbucket`. Keep `linear` as the unknown scheme in the refusal test.
- `test/reconcile/host.test.mjs:7787`, *issue-list refuses Tracker: plot on github, the rule's own decision*. Its comment says `plot` means no tracker and the git host is not asked, and that the repository loses its list. That is the reading this plan reverses. Rewrite it as: `PLOT_TRACKER=plot` on github runs the `gh` list call and exits 0. Update its comment, which would otherwise state the opposite of the code.

**The rule is mirrored in a shipped bundle.** `skills/plot/scripts/board/plot-issue-source.mjs` is the esbuild output of this rule; `plot-host.sh:2526` pipes `tracker_raw` through it. The host test above runs through it. Run `pnpm build:board` to test locally, then restore every generated path from the merge base before the push. A PR diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`), and `main` rebuilds it after the merge.

**Other readers of the value (measured by reading, 2026-10-20).** The plan asks that each treat `plot` the same way. Confirm each one, and change one only where it disagrees:

- `trackerFor` (`packages/domain/src/adapters/tracker/tracker-resolve.ts:48`): `plot` falls to `default` and gets `trackerNone`, which answers `unaskable` on every operation including the write. That is the correct tracker for a repository tracking in its own plans, and it is the write path. Leave it. `trackerGitHost` is for the `git-host` arm of reads and is not what `trackerFor` returns.
- `tracker_scheme` in `plot-host.sh:2495` lowercases the first word. `:5049` tests it for `jira` only. `plot` reaches neither. No change expected.
- `fleet.ts`, `entry/issue-source.ts` and `shared/issue-refresh.ts` call `issueSource`, so they change behaviour through the rule alone. Check `tracker-resolve.ts` where it maps an `issueSource` answer to a connector: a `git-host` answer for `declared: 'plot'` must reach `trackerGitHost`, not a path that assumes an empty declaration. Run the existing `tracker-issues.test.ts` case *resolves every issueSource arm* with a `plot` declaration added.

Report any reader that disagrees; do not widen the slice to fix it silently.

**Carried-over invariants.** A declared tracker that no connector lists still answers `nobody`; the git host is never asked in its place for `linear` or an unknown word. The change adds exactly one word to the `git-host` arm. Do not add `plot` to `TRACKER_LISTERS`: it is not a connector, and a lister entry would make `ask: 'tracker'` return a scheme nothing serves.

### Done when

The plan's slice line is the specification: `issueSource` answers `git-host` for `Tracker: plot`, with a test covering `plot`, an empty declaration, and an unknown scheme. The assertions that exist because a naive change passes without them:

- `plot` mixed-case and with trailing words (`Plot`, `plot extra`) answers `git-host`. The scheme is the lowercased first word, and a string-equality check on `declared` would miss both.
- `plotter` or `plot-x` answers `nobody`. A prefix or substring check would pass `plot` and wrongly pass these.
- The host test asserts the `gh` stub was called. An exit-0 assertion alone passes if `issue-list` printed nothing.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Add a changeset for `plot` (patch), description first and the `bumps:` block last, with the `plan:` line inside the block. `scripts/check-shell-lines.sh` applies; this slice touches no `.sh` file, so no shell grows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Files this branch owns: `packages/domain/src/rules/issue-source.ts`, `packages/domain/test/issue-source.test.ts`, `packages/domain/test/tracker-issues.test.ts` if the resolve case needs a `plot` row, `test/reconcile/host.test.mjs` (the one test above), and one changeset. Other branches in flight on these files: none known at dispatch. If you find something the plan did not anticipate, report it rather than improvising outside scope.
