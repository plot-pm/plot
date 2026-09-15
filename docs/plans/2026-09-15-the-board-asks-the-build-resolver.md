# The board asks the build resolver

> A repository declaring `CI: jenkins` gets the shell arm anyway, because the board's build port skips the resolver that knows which connector to build.

## Status

- **State:** Rejected
- **Type:** bug
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-15, jwloka, in-session
- **Rejected:** 2026-09-15, jwloka, premise disproved before implementation

## Changelog

- A board in a repository that declares `CI: jenkins` now shows its Jenkins builds. The connector shipped and nothing asked for it.

<!-- Board impact: this IS a board change — one line in its build port factory.
     No plan format, no template, no layout. -->

## Design

**`board.ts:232` is the whole defect:**

```ts
export const buildPortFor = async (opts: BuildBoardOptions): Promise<BuildPort> =>
  opts.buildAdapter ?? buildShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir })
```

It constructs `buildShell` **directly**. The resolver that reads the `CI` config
key and returns the matching connector is `buildFor`, in
`adapters/build/build-resolve.ts` — and measured 2026-09-15, **`buildFor` is
exported from `adapters/index.ts` and has no caller anywhere on the estate.**

**So a repository declaring `CI: jenkins` gets the shell arm**, and its builds
never appear. Third instance of this defect class in one week, and the third
time the fix is to call something that already exists.

### The Jenkins side is not the gap

`build-jenkins.ts` shipped 2026-09-10 with
[`the-build-pipeline-is-its-own-connector`](2026-09-07-the-build-pipeline-is-its-own-connector.md),
now `released`. It is 65 lines because it delegates: `buildReads({ context,
system }, { PLOT_CI: 'jenkins' })`, and the Jenkins knowledge lives in
`plot-host.sh`, which handles a multibranch job thoroughly — all branches in one
call, a documented colour table (`blue`→passing, `yellow`→**failing**
deliberately, `*_anime`→pending), and URL-encoded branch names, *measured: 27 of
45 names in a production instance*.

**None of that is reached.** The adapter, the resolver and the shell are all
built; one factory points past them.

### Why this is one line and still wants a plan

**The blast radius is every board.** `buildPortFor` serves both call sites —
`fleet.ts:2111` and `:2442` — so a repository declaring no `CI`, or
`github-actions`, must keep behaving exactly as today. `buildFor` resolving to
the shell arm for those is the property to prove, not assume.

**And it cannot be fully verified here.** This repository declares
`CI: github-actions`. A Jenkins instance is the only place the end-to-end path
can be observed, so the Done-when splits: what is checkable in this repository,
and what is checkable only on an instance that declares `CI: jenkins`.

## Slices

### The board asks the build resolver (Branch: bug/the-board-asks-the-build-resolver)

- `bug/the-board-asks-the-build-resolver` — have `buildPortFor` call `buildFor` with the repository's `CI` config rather than constructing `buildShell` directly, and pin that an unset or `github-actions` config resolves exactly as today

**Done when** `buildPortFor` resolves through `buildFor`; a repository declaring
no `CI` key and one declaring `github-actions` both produce the same port they
produce today, pinned by a test; a repository declaring `CI: jenkins` produces
the Jenkins arm, pinned by a test against the resolver rather than a live
instance; `buildFor` has a caller; and `pnpm run test:contracts` and the board
suite pass.

**Verified separately on an instance declaring `CI: jenkins`**: a branch with a
multibranch build shows its state on the board. That cannot be checked in this
repository and is not in the slice's gates.

## Notes

**Found 2026-09-15 while tracing why Jenkins builds never appear on the board.**
The operator reported them missing; the cause is not the connector, which is
complete, but a factory that never asks for it.

**`limit: 60` is Jenkins' declared budget** in `plot-host.sh:3760`, the tightest
of the three connectors. Once builds are actually fetched, that budget starts
being spent — which is why
[`a-connector-declares-its-ceiling`](2026-09-15-a-connector-declares-its-ceiling.md)
matters more after this lands than before.

## Why this was rejected

**The premise was false, and the brief writer caught it before any code was
written.** Measured on main 2026-09-15, after the plan was approved:

- **`buildShell` does not bypass the resolver — it IS the resolver's caller.**
  `build-resolve.ts:64` reads the `CI` key through `plot-config.sh` and returns
  `buildFor(said.stdout, context)`.
- **`buildFor` has a caller**, contrary to this plan's central measurement.
- **The Jenkins arm already resolves**: `case 'jenkins': return buildJenkins(context)`.

So the chain the plan proposed to connect is already connected, and its
`Done when` list was largely satisfied before it was written.

**Two errors produced it.** `buildShell` is defined in `build-resolve.ts`, not in
`build-shell.ts` — its name says *shell* and its behaviour is *resolver*. And the
grep that reported *"`buildFor` has no caller"* excluded `adapters/build/`, the
one directory holding the line that disproves it.

**The operator's report is unexplained and still open.** Jenkins builds genuinely
do not appear on their board; the cause is not this. The cheapest next reading is
`plot-config.sh get CI ''` in the repository whose board is blank — an empty
answer sends `buildFor` to `buildNone` and no build is ever fetched.

**Nothing was implemented.** No branch, no PR, no `Started:` record — the brief
gate refused to hand the slice to an agent without a spec, and that refusal is
what stopped a worker building a fix to a non-problem.
