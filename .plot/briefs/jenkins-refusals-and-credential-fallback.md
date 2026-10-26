## Implementation brief — jenkins-sha-lookups-in-plot-host (wave: Refusals and credentials)

- **Plan (canonical):** `docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2497 merged
- **Branch:** `bug/jenkins-refusals-and-credential-fallback` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

This branch waits on `bug/jenkins-sha-runs-bind-by-action` (Sha binding wave).
Both touch `plot-host.sh` and the one test file, so they run in sequence —
confirm that branch is merged to main before starting, not just opened.
`bug/jenkins-sha-tests-run-in-a-private-home` waits on this one in turn.

### What to build

Three fixes in `skills/plot/scripts/plot-host.sh`, all in the refusal and
credential paths `jenkins_sha_runs` depends on — none in the sha-binding
logic itself, which is the sibling wave's scope.

**1. `jenkins_resolve_host` (line 1842) returns exit 0 with empty output
when the `Instance:` line has no parenthesized host**, instead of exit 1.
Measured:

```
$ line='Instance: foo (no-host-here)'
$ [ -n "$line" ] && sed -nE 's/.*\(https?:\/\/([^)\/]+).*/\1/p' <<<"$line"; echo $?
0
```

The `&&` only tests that `$line` is non-empty; it does not check whether the
`sed` substitution matched. A host-less line passes the left side, `sed`
finds no match and prints nothing, and the whole expression still exits 0
with empty stdout. The caller (line 1934) treats a non-zero exit as "could
not resolve" and prints a `jen -I <slug> auth status` hint; exit 0 with an
empty string instead falls through into `jenkins_rest_credential "$host"`
with `host=""`, which the plan's Motivation (line 34) describes as surfacing
a confusing credential error instead of the real cause. Fix: capture the
`sed` output and test it explicitly, so a non-match returns 1.

**2. `plot_env_file` (line 2924) answers on file readability, not on
whether the file holds the Jenkins credential pair.** It returns the first
`.env` candidate that exists and is readable — worktree first, then the
main checkout's — with no awareness of which variables the caller needs.
`jenkins_rest_credential` (line 1811-1817) calls it once, takes whichever
file it returns, and reads `JENKINS_USER`/`JENKINS_API_TOKEN` from that one
file only. A worktree `.env` that exists but holds unrelated variables (or
only one of the pair) is accepted as the source and the main checkout's
`.env` — which may hold the real pair — is never consulted. The plan's
Motivation (line 35) names this directly: *"a worktree `.env` without a
credential pair blocks the main checkout's `.env`."* Fix: the credential
loader must try each candidate in order and take the first one that holds
**both** `JENKINS_USER` and `JENKINS_API_TOKEN`, falling through to the next
candidate otherwise — the same both-or-neither rule `jira_load_env_file`
already follows (comment at line 1801 says as much; the code does not yet
do it for Jenkins). Whether this is reshaping `plot_env_file` itself or
building the pair-check as a wrapper around it is this slice's call — but a
generic helper used elsewhere must not become Jenkins-specific as a side
effect of this fix.

**3. `plot_env_file`'s `--git-common-dir` call (line 2927) is not resolved
to an absolute path.** `git rev-parse --git-common-dir` prints a path
relative to the current working directory in the common case (a `.git`
subdirectory), so `dirname` on it, run from a worktree whose cwd is not the
repo root, can compose a path that does not point at the main checkout.
Fix: add `--path-format=absolute`, the flag the plan names explicitly
(Design, line 49). Verify by calling `plot_env_file` from a `cd`-ed-into
subdirectory of a worktree, not just from the worktree root — the relative
path only misbehaves once cwd and the git dir diverge.

### The decisions the plan settles — do not re-derive them

**The two open questions below are now closed by the Sha binding wave's
PR #2548 — read its resolution, do not re-ask them:**

- *Is a host-less `Instance:` line a refusal at `jenkins_resolve_host` or at
  its callers?* Resolve it **at `jenkins_resolve_host`** (fix #1 above): the
  function already has the exit-code contract ("prints nothing (exit 1)...
  the caller decides what an unresolved host means" — line 1839-1841); the
  defect is that the contract is violated for one input shape, not that the
  contract is wrong. Fixing it at the caller would mean every caller
  re-detects an empty string on top of a false exit 0, duplicating the
  check `jenkins_resolve_host` already promises to make.
- *Does fleetd have a hold reason for a missing-multibranch-branch refusal,
  or does one need adding?* Out of scope for `plot-host.sh` itself — if the
  answer is "needs adding," that is fleetd's change, not this script's.
  This slice's job is only to make `plot-host.sh` refuse by name (see next
  paragraph); whether fleetd's hold-reason vocabulary already covers that
  refusal text is a separate question for whoever reads the refusal.

**"Refuse a missing multibranch branch... by name"** (Slices section,
line 72) means the refusal text must say which branch was not found, not
just that Jenkins didn't answer. Current code's catch-all (`body` stays
empty → "Jenkins did not answer for '$host'", line 1955-1957) is correct
for an unreachable host or bad credential, but a request that reached
Jenkins and got a real "no such branch" answer should not read the same as
a dead connection. Distinguish the two before reusing the generic message.

**Reading an absent answer as false is the standing trap this estate keeps
re-hitting** (memory: "absent is not false"). The three fixes above are
three instances of the same shape — exit 0 read as success, a readable file
read as the right file, a relative path read as the intended one — and the
review should check each against that pattern rather than only the literal
line cited.

### Done when

The plan's `## Done when` is not written as a separate section in this
plan — its Changelog **is** the spec:

- `plot-host.sh` Jenkins host resolution refuses (non-zero exit, no silent
  empty-string fallthrough) when the `Instance:` line names no host.
- A missing multibranch branch refuses by name; a host-less `Instance:`
  line refuses by name — both exit non-zero with a message naming the
  cause, never a bare "Jenkins did not answer."
- The `.env` credential fallback reads a full credential pair before
  accepting a candidate file, and falls through to the next candidate
  when one file is readable but incomplete.
- `plot_env_file`'s main-checkout path is absolute regardless of cwd.
- Loader doc comments and the Jira hint (plan Design, "Comments" — line
  55) describe this behaviour as current, not as a narrated fix.

Add tests in `test/reconcile/host.test.mjs` for each of the three fixes —
the sibling wave's PR #2548 is the template for how a `lastBuiltRevision`
fixture is shaped; the existing credential tests near line 1811's callers
are the template for the `.env`-pair tests. Run the file sourced in a
private `HOME`/cwd per the `owned-run.sh` contract (the next wave,
`bug/jenkins-sha-tests-run-in-a-private-home`, generalizes this across the
whole file — don't block on it, but don't regress it either: if a test you
add leaks into the ambient `HOME`, that's this slice's bug to fix, not a
reason to defer to the next wave).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints. The suites in `## Plot Config`'s `CI suites` key
run in CI on every PR — do not run them locally as a matter of course.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is
longer than at its merge base. This slice touches `.sh` only
(`plot-host.sh`); any net growth from unpacking the credential fallback's
both-or-neither check must be paid for by removing shell lines elsewhere in
the same change — the gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller once the branch is claimed and has a
first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` — it takes its title from the last commit subject and
is explicitly refused by the Lifecycle rules this repo follows.

When the PR exists, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (the "Refusals and credentials" heading).

### Scope guard

This branch owns the refusal and credential-loading code in
`skills/plot/scripts/plot-host.sh` (`jenkins_resolve_host`,
`jenkins_rest_credential`, `plot_env_file`) and its tests in
`test/reconcile/host.test.mjs`. It does **not** own:

- `jenkins_sha_runs`'s branch/sha pairing, match-key or limit/filter logic
  — that's `bug/jenkins-sha-runs-bind-by-action`, merging first.
- The test file's `HOME`/cwd sourcing harness itself — that's
  `bug/jenkins-sha-tests-run-in-a-private-home`, merging after this one.

Both siblings edit the same two files. Rebase onto main (which will carry
the Sha binding wave's merge) before starting work, and expect the next
wave to rebase onto this one — coordinate through `/plot-pulse` rather than
guessing the other branch's state from memory.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
