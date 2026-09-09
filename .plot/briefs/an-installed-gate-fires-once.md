## Implementation brief — an-adopting-repo-installs-its-gates (wave 2: Proving)

- **Plan (canonical):** `docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #865 merged
- **Sprint:** the-jenkins-team-sees-its-builds
- **Branch:** `feature/an-installed-gate-fires-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

This branch **waits on `feature/an-adopting-repo-installs-its-gates`** (wave 1: Installing), which builds `plot-install-hooks.sh` and the `/plot-init` step that offers it. Wave 2 becomes eligible only when that PR merges, so by the time you read this the installer exists — **read what it actually shipped before building against this brief's assumptions.** Wave 1 was licensed to stop and report if the settings-hook route did not fire; if it did stop, that finding is your input and this slice's premise is gone. Check first.

Nothing waits on this branch.

### What to build

Wave 1 installs the gates. This slice makes the install **prove itself** — by triggering a guarded condition and requiring the refusal.

The failure it prevents is measured and specific. `plot-state-gate.sh` shipped 2026-09-09 registering into `hooks/hooks.json`, and **no plugin release has ever carried it**: 2.15.0, 2.14.0 and 2.10.0 each register `plot-phase-gate.sh` alone. So the gate documented in `CLAUDE.md` as the thing that closes four measured hand edits has never enforced anything on any machine, including the one that wrote it. Nobody noticed, because a missing gate does not error — it permits. Five lifecycle actions routed past their controller in one session on exactly such a machine.

An installer that writes a file and reports success reproduces that state exactly: a repository believing it is gated, discovering otherwise when a guarded write lands unguarded. **The written file is not the evidence. The block is.**

The plan is canonical; this is orientation.

### The measurement that shapes this slice: exit 0 is ambiguous

**Measured 2026-09-09, before dispatch, by running `plot-state-gate.sh` directly.** Three distinct outcomes collapse into two exit codes:

| what happened | exit | stderr |
|---|---|---|
| the gate was never invoked | 0 | *(nothing)* |
| invoked, fail-open — no git, no `jq`, unreadable HEAD | 0 | *(nothing)* |
| invoked, saw a transition, refused | 2 | the refusal, naming the owning command |

The first two are **byte-identical**. `plot-state-gate.sh:56` is `trap 'exit 0' ERR` and its header states the intent — *"an unreadable HEAD, a missing `git`, unparseable hook JSON: the gate cannot see a diff, so it allows and says nothing was checked."* That is correct behaviour for a gate and fatal for a naive verification.

**So a verification that asks "did my commit succeed?" cannot distinguish an installed gate from an absent one** — both permit. It would report green on the precise repository this plan exists to fix. Only the refusal is positive evidence, and it must be read from stderr and exit 2, not inferred from an absence.

**This kills the obvious design.** Do not verify by making an innocuous commit and checking it worked; do not verify by grepping the settings file for the entry (wave 1 already knows it wrote it — that is the claim, not the proof). Construct a condition the gate **cannot fail open on**: a real git repo, a real `HEAD` version of a plan file, a real staged `State:` change, `git` and `jq` present. Anything short of that returns 0 and proves nothing.

The refusal text to key on, measured verbatim:

```
plot state gate: a lifecycle field has one writer, and this commit is not it.
```

Prefer exit 2 plus a stderr match over a match alone — the wording is the gate's to change, and a test pinning prose that a gate legitimately rewords is a test that fails for the wrong reason. Exit 2 is the contract; the string is corroboration.

### The decisions the plan settles — do not re-derive them

**The proof is a refusal that must happen, and its absence is not silence.** The plan's shape: *"construct the guarded condition, invoke it, and require the block. A hook that does not fire prints its own absence rather than a green tick."* Three outcomes, three words, and the third is the one that matters:

- the gate refused → **verified**
- the gate permitted, or could not be reached → **unverified**, naming what was not proved
- the verification itself could not run → **unverified**, for the same reason

**`unverified` is never `installed`.** This is `plot-phase-gate.sh`'s own precedent, which allows a commit when it cannot read `origin/<main>` and *says the phase went unverified* — failing open, not failing silently. It is also the failure the supervisor plan measured: a unit file on disk that launchd was never told about. `plot-board-probe.sh` draws the same line, `ok`/`failed`/`unknown`, where its header states an unrecognised output reads as *cannot verify*, never as authenticated.

**Verification writes nothing that survives it — and `trap`, not prose, is what guarantees that.** `plot-board-verify.sh` is the precedent and its header is the argument, verbatim:

> THE TEARDOWN IS WHY THIS IS A SCRIPT. The sequence is short enough to write into a skill as prose, and CLAUDE.md's `Gates Over Rules` explains why that would be wrong: "always stop the server" is a rule an agent can believe it followed. `trap cleanup EXIT` is a gate — the shell reaps the process on every exit path, including the assertion failures that prose forgets.

Same rule here. `trap cleanup EXIT INT TERM` over the scratch directory, so every exit path cleans up — including the assertion failure that is this slice's *expected* outcome on an unverified install. **Do not construct the condition in the operator's own repository.** A scratch repo under `mktemp -d` cannot dirty a tree, cannot stage a real plan file, and cannot leave a `State:` line half-written if the verification dies mid-run. A proof that dirties a tree is one people skip, and the operator's tree here holds live plans.

**The gate under test is read from the installed set, never hardcoded.** Wave 1's brief settles this and the reason still applies: `feature/a-controller-action-leaves-a-receipt` adds a third entry to `hooks/hooks.json` (measured 2026-09-09 — a 4-line addition registering `plot-controller-gate.sh`, Approved, no PR yet). A verification naming `plot-state-gate.sh` literally will report a two-gate install as complete on the day a third ships. Read what is registered, verify what you read, and report per gate.

**Not every gate can be proved the same way, and that is a fact to report rather than paper over.** `plot-state-gate.sh` is the one with a cheap, self-contained guarded condition — a staged `State:` change in a scratch repo, no host, no network, no receipt. `plot-phase-gate.sh` reads the plan from `origin/<main>` (never the working tree — an approval nobody else can see is not one), so proving it needs a remote a scratch repo does not have. **Proving one gate fires is the deliverable**; it establishes the route, which is what has never been established. A gate you cannot construct a condition for reports `unverified` with the reason, and that is an honest answer, not a gap in the slice. Do not invent a weaker proof to get a green tick on the second gate — that is the disease.

**A failed verification does not fail adoption.** `/plot-init`'s guardrail: *"Never fail the whole adoption on one blocked step."* Report `unverified`, name what was not proved, continue. A repository with unproved gates works; being told is the deliverable. This is the same rule wave 1 applied to a blocked settings file.

**The harness already exists — read it before inventing one.** `test/reconcile/state-gate.test.mjs` builds throwaway git repos and drives the gate over stdin: `spawnSync('bash', [gate], { cwd: dir, input: JSON.stringify({ tool_input: { command } }) })`, with a `repo()` helper that inits, commits a baseline, and stages the change. `gate.test.mjs` does the same for the phase gate. Note what driving the script directly proves and what it does not: it proves the **script** refuses, and says nothing about whether **Claude Code** invoked it. Wave 1 owns the route question and measured it; this slice owns whether an install of that route can be shown to work. Do not re-open the route question — read wave 1's answer.

**Where the verification is reached from.** Wave 1 built `plot-install-hooks.sh` with the `written`/`current`/`present` contract and `--check`. The natural seam is a `--verify` mode on that script, and it composes with the existing vocabulary: `--check` writes nothing and reports what *is*; `--verify` writes nothing and reports whether it *works*. Confirm against what wave 1 actually shipped — if it already carries a verification stub, extend it rather than adding a second entry point. `/plot-init` calls it after the install, in the step wave 1 added at `skills/plot-init/SKILL.md` step 4.

### Done when

The plan's `## Slices` → `### Proving` assertion list is the specification:

- **the verification REFUSES and the refusal is read** — a written file is not the evidence, the block is
- **a gate that does not fire is reported UNVERIFIED, never installed** — the honest word, and the one the supervisor's written-but-unloaded plist needed
- **verification writes nothing that survives it** — it constructs its condition and leaves the repository as it found it

Three assertions exist **because a naive implementation would pass without them**:

- **`unverified` is distinguishable from `verified`.** An implementation keying on the commit's success reports green against a repository with no gates at all — measured above, exit 0 means both. Assert directly on the uninstalled case: no hook registered, verification run, result is `unverified`. Without this test the slice ships the bug it exists to fix, and it is the single most important assertion here.
- **The scratch tree is gone on the failure path.** Cleanup on the happy path is what everyone writes. Force the verification to fail (or kill it mid-run) and assert the temp directory is removed and the operator's repo is untouched — `git status --porcelain` unchanged. `trap ... EXIT` gets this right and a trailing `rm -rf` does not.
- **A failed verification still returns adoption to success.** The happy path never reaches it. Assert `/plot-init`'s step reports the block and continues.

Plus the repo's gates: `nvm use` (Node 24 — **pnpm crashes on 26**), `pnpm test`, `pnpm run test:reconcile` for the plan-format and skill contracts, and a changeset with the description **FIRST** and the `bumps:` block **LAST** (`plot` and/or `plot-init` per what you touch; a `plan:` line naming this plan is optional and welcome). If you add a question to a skill, it needs a `PLOT-UNASKED` line — `test/reconcile/unattended.test.mjs` sweeps every skill for one.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repos, and an agent running it locally starves the machine — measured 53 concurrent `node --test` processes and a board that could not answer in 25 seconds.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading rather than the last commit subject — measured 2026-09-08, three slice PRs opened by hand each took their title from a commit subject like `plot: build the board artifact`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

**This branch owns:** the verification step (a `--verify` mode on `skills/plot/scripts/plot-install-hooks.sh`, or whatever seam wave 1 left), the `/plot-init` call site that runs it after installing, and a test file under `test/reconcile/`. Plus one changeset.

**Do not rebuild** the installer, the `written`/`current`/`present` contract, or the `/plot-init` offer — wave 1 shipped those. If wave 1's install path looks wrong, report it rather than fixing it here: a slice that rewrites its predecessor's merged work is a re-litigation, not an implementation.

**Do not touch `hooks/hooks.json`.** `feature/a-controller-action-leaves-a-receipt` appends the third gate to it and is the one real collision on this file.

**Rebase onto `main` before starting.** This branch is cut after wave 1 merges, so its work is your baseline — but siblings land continuously here, and a branch cut from an older main reads its predecessor's files as missing. Verify the rebase before pushing: it reports success while dropping work.

**Other branches in flight at the time this brief was written (2026-09-09):** `feature/a-controller-action-leaves-a-receipt`, `bug/a-fleet-start-records-that-it-finished`, `feature/adoption-proposes-the-ticket-prefixes` (**touches `/plot-init` — expect a `skills/plot-init/SKILL.md` collision and keep your edit surgical**), `feature/an-issue-key-is-a-string`, `feature/the-jira-jql-scopes-by-project`. Re-check what is live when you start; this list is a dispatch-time reading, not a promise.

If you find something the plan did not anticipate — in particular if wave 1 reported the settings-hook route does not fire — report it rather than improvising outside scope.
