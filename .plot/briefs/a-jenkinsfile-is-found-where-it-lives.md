## Implementation brief — a-jenkinsfile-is-found-where-it-lives (wave: A Jenkinsfile is found where a repository keeps it)

- **Plan (canonical):** `docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/a-jenkinsfile-is-found-where-it-lives` (base: `main`)
- **Ends as:** one PR to `main`

**Second of two slices.** The first — `bug/the-auth-reading-matches-the-cli` —
merged as **#937** and is on `main`. Both touch `plot-board-probe.sh`; rebase
on `main` before you start.

### What to build

`plot-board-probe.sh:130` tests exactly one path:

```sh
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
```

A repository that keeps its pipelines in a directory reads as having **no CI at
all**. The reporting repository keeps three:

```
.build/pipelines/website/continuous-build/Jenkinsfile
.build/pipelines/website/continuous-deploy/Jenkinsfile
.build/pipelines/website/release/Jenkinsfile
```

`proposeCi` then answers `silent`, setup writes no `CI:` key, and the Jenkins
instance question is never asked.

### The bound is DECIDED — take it, do not re-derive it

`find -maxdepth 5` from the repository root, excluding `node_modules`, `.git`,
and the configured `Worktree root`.

**Five, and it is measured rather than counted.** `-maxdepth` counts path
components from the start point, not directories:

```
-maxdepth 3 -> 0 hit(s)
-maxdepth 4 -> 0 hit(s)
-maxdepth 5 -> 1 hit(s)
```

An earlier draft of the plan said four, reasoning the file sits four directories
down. It does, and `-maxdepth 4` finds nothing — **the off-by-one is the defect
this slice fixes, made once in its own Design.** Do not repeat it.

### One exclusion was tried and WITHDRAWN

The plan once demanded that a Jenkinsfile in a "test fixture directory" not
count. A round-2 implementer tried and no naming rule survived: `fixtures`,
`test` and `__fixtures__` are each plausible and each wrong somewhere, and a
repository genuinely keeping a pipeline under `test/` would be told it has no
CI. **The depth bound limits the rest.** Exclude `node_modules` and nothing else
by name.

### Measure the cost and state it IN the script

`plot-deliverable-search.sh` is the precedent — its header records that an
unbounded search was tried and abandoned. Do the same: run it on this
repository, and write the number into the script rather than into a commit
message.

### Gates

A root `Jenkinsfile` still reads `true`, unchanged. A repository keeping
`.build/pipelines/website/continuous-build/Jenkinsfile` — that exact depth, not
a shallower stand-in — reads `true`. A repository with none reads `false`. One
inside `node_modules` does **not** make it `true`, pinned by a fixture that
contains one.

`gh_workflows` (`:132`) is untouched.

### Repo gates

`pnpm run test:contracts`.
