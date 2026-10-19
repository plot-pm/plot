## Implementation brief — jenkins-checks-never-bind-to-the (slice: Binding repair)

- **Plan (canonical):** `docs/plans/2026-10-19-jenkins-checks-never-bind-to-the.md` on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2099 merged
- **Branch:** `bug/jenkins-checks-bind-to-the-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, plot-review required since 2026-10-15

### What to build

On a real Bitbucket + Jenkins repository (`ewz-kus-portal`), `pr-list --open --rich`
returns `checksSha: ""` for all 10 open rows — the sha-binding path added by
`2026-10-18-bitbucket-jenkins-pr-list-binds-a.md` never actually binds on this
repository, and says nothing about why. Three causes sit in `skills/plot/scripts/plot-host.sh`,
in the order a call meets them — current line numbers (`main` at `76c690b6c`; the plan cites
the numbers as of `fb05579d6`, now shifted by ~4 lines):

1. **`jenkins_sha_runs` (`plot-host.sh:1727-1728`) still uses the slug as a literal host.**
   `host="${instance%%/*}"` for a `Jenkins instance` of `ewz/kus-portal/continuous-build-multi`
   gives `host=ewz`. That literal goes straight into `jenkins_rest_credential(host)` (keychain
   lookup) and `curl https://$host$path/...`. Both fail: the real host is
   `jenkins-ci-ewz.internal.quatico.dev`, which `jen -I ewz` already resolves correctly.
2. **The jq filter picks the first `lastBuiltRevision`, not a matching one.** Line ~1755:
   `sha: ([ .actions[]? | select(.lastBuiltRevision) | .lastBuiltRevision.SHA1 ] | first // "")`
   takes the first action's sha unconditionally. On this Jenkins, every build carries two
   `lastBuiltRevision` actions — `develop` first, the branch head second — so the filter reads
   the wrong sha and a real build that matches the asked sha is reported as no match.
3. **`jenkins_bind_rows` (`plot-host.sh:1780`) discards the failure silently.**
   `_r=$(jenkins_sha_runs ... 2>/dev/null </dev/null) || break` redirects stderr to
   `/dev/null`, so causes 1 and 2 above produce no diagnostic anywhere — the row just stays
   `unknown`/unbound and a reader cannot tell "no build matched" from "the lookup was refused".

### Decisions the plan already settled — do not re-derive them

**The host-resolution mechanism is reuse, not reinvention.** `plot-board-probe.sh:417`
already derives a bare slug from a `Jenkins instance` value (scheme-stripped, then
`${_ji%%/*}`) and feeds it to `jen -I <slug> auth status` to probe reachability. The slice
reuses `jen`'s own resolution of that slug to a host — it does not invent a second splitter
or a hardcoded slug→host table. Where `jen` is not installed, the op fails by name (same
shape as the existing `jenkins_no_instance` / no-credential refusals), not silently.
**This machine has no `jen` installed** (confirmed during brief-writing) — do not assume you
can interactively verify the resolution locally; read `jen`'s own source/docs or test against
a machine that has it.

**The revision match is "any", not "first" — and `runs` keeps its existing branch filter.**
The fix is in the `sha:` extraction only: match the asked sha against ANY
`lastBuiltRevision.SHA1` in `.actions[]`, not just the first. The unfiltered `runs` path
(no `$sha` given) already filters by branch via the `br` field two lines below — that logic
is untouched; this slice only fixes the sha-matching arm.

**The silent discard is the specific `2>/dev/null || break` in `jenkins_bind_rows`.**
Fix: let the failure reason reach stderr (drop the `2>/dev/null` on the inner call, or
capture and re-emit it) and mark the row so a reader can distinguish "unknown, lookup
refused" from "unknown, no build found". The pass still stops at the first refusal — every
later lookup in the same pass hits the same cause, so there's no value in retrying each row.

**Three open points the plan left for the implementer to decide, not invent:**
- How `jen` maps a slug (`ewz`) to its real host — name the source (a `jen` subcommand, a
  config file it reads, or a documented convention) before relying on it, because the
  keychain credential is keyed by the *resolved* host, not the slug.
- Whether Bitbucket's own `GET /commit/{hash}/statuses` (which already answers Jenkins'
  `SUCCESSFUL` for the 12-character hash with **no Jenkins credential**, per the issue) should
  replace, back up, or stay out of scope of the Jenkins REST lookup. This plan explicitly
  does not decide it — raise it to a person (comment on the PR or ask) rather than picking
  silently, since it adds a second source that can disagree with Jenkins.
- How a refused lookup is marked on the row: a new field, or `checks: unknown` plus a reason
  string. Check how the board currently reads `pr-list` rows (`packages/board/src/**`) before
  adding a field — a new field is a board-reading change too.

**Real-shaped test fixtures, not placeholders.** Existing host tests already use shapes like
`actions: [{ lastBuiltRevision: { SHA1: sha } }]` (single-action) — this slice's new/changed
tests need a build with **two** `lastBuiltRevision` actions (`develop` first, branch head
second), a slug-form `Jenkins instance` (not a bare host), a 12-character Bitbucket short hash,
and a 40-character Jenkins SHA1, matching the real repro shape from the field test. See
`test/reconcile/host.test.mjs` around lines 2954 (`the Jenkins arm splits the instance into an
-I slug and a job path`) and 3332-3416 (the sha-matching tests) for the existing convention to
extend.

### Done when

The plan's `## Done when` is implicit in its Changelog: `pr-list --rich`, `run-for-sha` and
`runs` resolve a slug-form instance to the host `jen -I <slug>` uses, match a build by any of
its `lastBuiltRevision` actions, and report a failed sha lookup on stderr and in the row.
Concretely:
- A host test with a slug-form instance and a credential keyed by the *resolved* host (not
  the slug) succeeds where today it would fail with "no Jenkins API credential for '\<slug\>'".
- A host test with two `lastBuiltRevision` actions (develop first) matches the branch-head sha
  correctly, where today `| first` would pick the wrong one.
- A host test asserts a failed sha lookup is visible — on stderr and/or in the row — rather
  than silently leaving the branch colour in place.
- No change to the unfiltered `runs` branch-filter behavior (existing tests around line 3332
  keep passing unmodified).

Plus repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — it resolves the tests that name your changed files, related package
tests, and the gate scripts (`check-shell-lines.sh` among them). The suites under `CI suites`
in `## Plot Config` run in CI only; do not run them locally as a matter of course (see
`CLAUDE.md` Testing section — `test:e2e` especially is CI's gate, not a local one).

**`scripts/check-shell-lines.sh` applies directly here**: this slice touches `plot-host.sh`,
and the gate refuses a PR whose shipped shell under `skills/` grew past its merge base. Any
added lines (the host-resolution call, the any-revision match, the visible-failure plumbing)
need an equal-or-greater removal elsewhere in `plot-host.sh` or another shipped `.sh` file in
the same change — there is no stored allowance and no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never
`gh pr create` directly:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, or
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan's `## Slices` section for the title and body; it refuses a branch no plan
names. When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Slices` section (`docs/plans/2026-10-19-jenkins-checks-never-bind-to-the.md`).

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (the three functions named above) and
whatever host tests cover them (`test/reconcile/host*.test.mjs`). It is the plan's only
branch — no sibling slice to collide with. If the board-reading question (how a refused
lookup is marked) turns out to need a `packages/board/src/**` change, that is still in scope
for this branch (the plan names one slice for the whole repair) — but confirm the board's
current reading of `pr-list` rows before adding a field, per the open point above.

If you find something the plan did not anticipate — in particular, if the current line
numbers or function shapes have drifted further from what's described here — report it rather
than improvising outside scope.
