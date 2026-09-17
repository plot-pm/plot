# A probe reading is not a guess

> The board probe reported `jen auth: failed` against an authenticated CLI and `jenkinsfile: false` against three Jenkinsfiles, so adoption proposed from two readings the tools themselves contradict.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #929
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-board-probe.sh` reads an authenticated Jenkins as authenticated, and finds a Jenkinsfile that lives in a subdirectory. Both readings were false on a real repository, and each one sends `/plot-board-setup` to a wrong proposal.

<!-- Board impact: adoption reads this probe. No plan format, no template,
     no layout. -->

## Design

**Two readings, one run, both contradicted by the tool that owns the answer.**
Reported 2026-09-17 on a Bitbucket repository tracking in Jira:

```json
"jen": {"installed": true, "auth": "failed",
        "instance": "jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build"},
"ci_signals": {"jenkinsfile": false, "gh_workflows": false}
```

### 1 — the auth regex names a word the CLI does not print

`plot-board-probe.sh:266` tests the success case as
`'jenkins auth:[[:space:]]*reachable'`. The CLI prints:

```
Jenkins auth:  OK — jan.wloka@quatico.com
```

**`OK`, not `reachable`.** So the match fails and `classify` falls through to
`failed` or `unknown` — the report says `failed`.

**The surrounding reasoning is right and is what makes this narrow.** The
comment at `:229` records that `jen … auth status` exits 0 for a slug that does
not exist, so only the `Jenkins auth:` line carries the answer; `:264` tests
`not reachable` *before* `reachable` because one contains the other. Both hold.
**What is wrong is one word in one regex**, and the fix must not widen the line
it reads.

**The consequence is a repair for nothing.** `/plot-board-setup` step 4a names
`jen … auth login` for a `failed` reading, so an adopter holding a valid
keychain token is sent to replace it. The skill's stated rule is that `unknown`
must never round up to authenticated; **this is the same rule failing the other
way**, and the reverse direction costs trust rather than safety.

### 2 — the Jenkinsfile test reads one path

`plot-board-probe.sh:130`:

```sh
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
```

The reporting repository keeps three:

```
.build/pipelines/website/continuous-build/Jenkinsfile
.build/pipelines/website/continuous-deploy/Jenkinsfile
.build/pipelines/website/release/Jenkinsfile
```

**A repository that keeps its pipelines in a directory reads as having no CI.**
`proposeCi` then answers `silent`, setup writes no `CI:` key, and
`plot-host.sh:677` exits 3 at the first build lookup — the outcome the setup
skill exists to prevent.

### The search must be bounded, and the bound is the finding

**A bare `find` over a repository is the wrong fix.** `node_modules` alone makes
it slow, and a vendored fixture Jenkinsfile would be a false positive in the
other direction.

**The probe already owns this problem elsewhere**: `plot-deliverable-search.sh`
searches four named corpora rather than the tree, for exactly this reason, and
its header records that an unbounded search was tried and abandoned.

So: a bounded search, with the depth and the exclusions stated in the script and
measured rather than assumed. **`gh_workflows` is the model that already
works** — it tests a known directory, not a path.

### What this does not do

**It does not change what `unknown` means.** A probe that cannot reach the CLI
still answers `unknown`, and `unknown` still never reads as authenticated. This
fixes a false `failed`, not the refusal that sits beside it.

**It does not make the probe decide.** `plot-board-probe.sh`'s header says *"It
DECIDES NOTHING"*, and the thresholds live in `proposeStack`. A corrected
reading reaches the same rule.

**It does not add a Jenkinsfile parser.** Whether a file is a valid pipeline is
Jenkins' question; the probe answers *does one exist*.

## Slices

### The auth reading matches what the CLI prints (Branch: bug/the-auth-reading-matches-the-cli, PR: TBD)

- `bug/the-auth-reading-matches-the-cli` — match the `Jenkins auth:` line's actual success wording, keeping the `not reachable`-before-`reachable` order and the exit-code fallthrough

**Done when** a captured `Jenkins auth:  OK — <user>` line reads `ok`, pinned by
a fixture holding the CLI's real output; `Jenkins auth: NOT reachable` still
reads `failed` and is tested **before** the success arm, pinned by a fixture
that contains both words; an unrecognised line still reads `unknown` and never
`ok`; a `jen` that is absent, or an instance that is unset, reads exactly as
today; and `pnpm run test:contracts` passes.

### A Jenkinsfile is found where a repository keeps it (Branch: bug/a-jenkinsfile-is-found-where-it-lives, PR: TBD)

- `bug/a-jenkinsfile-is-found-where-it-lives` — find a Jenkinsfile below the repository root within a stated, measured bound, excluding the directories that would make it slow or wrong

**Done when** a repository with `Jenkinsfile` at its root still reads `true`,
unchanged; one keeping `.build/pipelines/*/Jenkinsfile` reads `true`; a
repository with none reads `false`; a Jenkinsfile inside `node_modules` or a
test fixture directory does **not** make it `true`, pinned by a fixture that
contains one; the search's cost on this repository is **measured and stated in
the script**, not assumed; and `pnpm run test:contracts` passes.

## Notes

**Reported 2026-09-17 with both contradictions shown side by side** — the
probe's JSON beside the CLI's own output and a `find` listing three files.

**Two slices because the two halves share nothing**: one is a regex over a
captured line, the other is a filesystem search with a cost argument. They land
in the same file and in the same report, which is not a reason to make them one
change.

**The setup skill's own rule is what both defects break** — *prove, don't
assert*. The probe starts no Jenkins and reads no pipeline; it asserts two facts
and both were wrong in one run.
