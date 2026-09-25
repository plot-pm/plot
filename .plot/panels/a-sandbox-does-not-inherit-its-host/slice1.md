# Slice 1 — `bug/a-sandboxed-test-scrubs-the-hosts-root`

Position: amend
Evidence: executed

## 1. The mechanism is right this time — and the live machine proves it

I tried to refute the premise and could not. Every link in the chain holds.

**`plot-config.sh:167` does prefer the env var.** Verbatim:

```
167: if [ -n "${PLOT_REPO_ROOT:-}" ] && [ -d "$PLOT_REPO_ROOT" ]; then
168:   root="$PLOT_REPO_ROOT"
169: else
170:   root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
```

The fallback is `git rev-parse`, then literal `"."`. The only guard is `-d` — a directory test, which the host root passes.

**Reproduced the leak directly** in a throwaway sandbox declaring a relative `Agent registry`:

```
$ env -u PLOT_REPO_ROOT bash plot-config.sh get "Agent registry" ".plot/agents"
.plot/agents                                              ← sandboxed, correct
$ PLOT_REPO_ROOT=<host> bash plot-config.sh get "Agent registry" ".plot/agents"
/Users/jwloka/Quatico/Agentic-Tools/plot/.plot/agents      ← the host, absolute
```

**Does a dispatched worker export it?** This was named the single most important check, and the answer is subtle in a way that strengthens the plan rather than weakening it. **No Plot script exports it** — `grep PLOT_REPO_ROOT` returns nothing in `plot-dispatch.sh`, `plot-worker-loop.sh`, `.plot/worker-prompt.sh`, or `templates/worker-prompt.sh`. It arrives by **plain inheritance**, and I measured it on the live fleet:

```
$ ps -Eww -p 1506 | tr ' ' '\n' | grep PLOT_REPO_ROOT
PLOT_REPO_ROOT=/Users/jwloka/Quatico/Agentic-Tools/plot

  1506 <- 1190 : bash skills/plot/scripts/plot-worker-loop.sh
  1190 <- 1187 : sh -c printf "%s" "$$" > "$PLOT_WRAPPER_PID_FILE"; …
  1187 <-    1 : bash …/plot-dispatch.sh --start 1
```

Both live worker loops (pids 1506 and 2949) carry the host root. The source is the **launchd supervisor**: pid 5167, `plot-registryd.mjs --start-agents`, whose plist sets it explicitly —
`skills/plot/units/com.plot-pm.registryd.plist:44-45` `<key>PLOT_REPO_ROOT</key><string>__REPO_ROOT__</string>`, and `ps -Eww -p 5167` confirms the interpolated value. `dispatch.ts:362-363` spreads `...process.env` into what it spawns, and `start_worker`'s `nohup sh -c` scrubs nothing. So the variable travels supervisor → dispatcher → wrapper → worker loop → any suite that worker runs.

**The plan understates its own case in one place worth fixing.** It says the host's "absolute `Agent registry`" comes back. That is true *here* and is not a general property — I confirmed this repo's key resolves to `/Users/jwloka/.../plot/.plot/agents`. A repo whose key is relative would leak via `plot-dispatch.sh:1125` resolving against the host `$repo_root` instead. Same defect, one hop later. The plan's "the relative-path arm never fires" is correct for this estate and reads as universal.

**The cited test says what the plan quotes.** `approve-record-outside-comments.test.mjs:117-123` is verbatim, including *"The env must not decide it."*, with `delete env.PLOT_REPO_ROOT` at `:125`.

**The `2 of 93` count is exact.** `ls test/reconcile/*.test.mjs | wc -l` → 93; `grep -l PLOT_REPO_ROOT` → exactly two files, both scrubbers.

## 2. The fix — one site does not match its description (the amendment)

**The four cited line numbers are `mkdtempSync` calls, not `env` constructions.** Verified by reading all four. The plan's design section says *"One line beside the `env` it already constructs"*, and at three of the four sites there is no adjacent `env` object at all. Where the `env` actually lives:

| cited site | what is at that line | where `delete` must go |
|---|---|---|
| `dispatch.test.mjs:1420` (`plot-realworker-`) | `mkdtempSync` | `:299`, the shared `dispatch:` helper |
| `dispatch.test.mjs:1565` (`plot-wrappid-`) | `mkdtempSync` | `:299`, same helper |
| `dispatch.test.mjs:2944` (`plot-sessenv-`) | `mkdtempSync` | `:299` or `runDetached` `:3336` |
| `restart.test.mjs:52` (`plot-restart-`) | `mkdtempSync` in `makeRepo` | `run()` at `:118`, `const env = { ...process.env }` |

This is good news for the fix and bad news for the plan's arithmetic: **`dispatch.test.mjs` has two env choke points, not three** — `:299` `env: { ...process.env, PLOT_PLUGIN_ROOT: plugins.root, ...(opts.env ?? {}) }` and `:3336` `env: { ...process.env, ...env }`. `restart.test.mjs` has one, at `:118`. **So it is three edits at two files, not four at four**, and each sits at a helper every test in the file routes through — which is strictly better, because a new test added next month inherits the scrub for free at the two dispatch sites.

The plan's own "Done when" says *"The four sites scrub"*. Taken literally that instructs an implementer to put `delete` beside four `mkdtempSync` calls, where it would do nothing. **Amend the slice to name the env choke points rather than the tempdir lines.**

Every one of these does construct a fresh object over `...process.env`, so `delete` on the copy is effective — the reviewer's worry about implicit inheritance does not bite at any of the three. But `:299` spreads `...(opts.env ?? {})` **after**, so the `delete` must come after that spread or a caller passing `env` could reintroduce it.

## 3. The regression test can be made safe, and the plan has not said how

The question posed — *is it testable without polluting the real registry when it fails?* — has a clean answer the plan should state, because the naive version is genuinely dangerous.

**A test that exports `PLOT_REPO_ROOT=<host>` and asserts nothing lands in the host registry writes into the host registry when it fails.** That is the bug reproducing itself in CI and on every developer machine.

The fix is to make the assertion's subject a **third** directory: export `PLOT_REPO_ROOT=<a second temp repo>` rather than the real host. The mechanism is identical — an inherited root that is not the sandbox — and a failure writes into a temp dir the test then removes. The assertion becomes *"the decoy root's registry is empty"*, which is positive evidence rather than an absence measured on shared state. **The plan should require the decoy and forbid naming the real repo.** As written, *"asserted with the variable deliberately set"* reads most naturally as setting it to the real thing.

## 4. The gate cannot be "the host registry is unchanged" — agents run during test runs

This is the part I would reject outright if it were not fixable. **"the suite fails if it leaves the host registry changed"** is not implementable as stated on this machine, and I measured why:

```
$ ls .plot/agents/
7601a3b1-….json    pid 1506   branch ""   free-8afc0160
95ef874e-….json    pid 2949   branch ""   free-c3f8bd30
```

Both are **live agents that started during this session**, pids matching the worker loops I traced. A snapshot-and-compare gate around a suite would have flagged both as suite pollution. It cannot distinguish a manifest the suite wrote from one the supervisor wrote concurrently — and `plot-registryd.mjs --start-agents` is loaded under launchd with `KeepAlive: true`, so it writes manifests on its own schedule, forever.

**The discriminating fact is available and is not "did the directory change".** A leaked manifest's `worktree` field points under `os.tmpdir()` — `/private/var/folders/.../plot-restart-*`, per the plan's own measurement. A real one points under the repo's `Worktree root`. So the gate should be: **no manifest in the host registry names a worktree under the system temp directory.** That is a property of each manifest rather than of the directory's mtime, it is immune to concurrent honest writes, and it catches a forgetful future test regardless of which of the 45 dispatch-spawning files it lives in.

Two further reasons to prefer it: it needs no before/after snapshot (so no ordering assumption between the gate and a concurrently starting agent), and it is the same reading slice 2's sweep gate takes, so the two slices share one notion of "this manifest is a fixture".

**Amend the slice to specify the discriminator.** As written, the gate would be built, would fail on honest concurrent agents, and would be turned off — CLAUDE.md's own *"the shape people turn off"*.

## 5. Scope: keeping the precedence is right, and narrowing it would not work

I pressed on the suggested narrowing — *honour the var only when it names the same repo git would find* — and it defeats the optimisation entirely. The whole point of `config-takes-the-callers-root` is to **avoid spawning `git rev-parse`**; a check that the var agrees with git must spawn `git rev-parse` to compare, restoring all 21 spawns per board build. The changeset's measurement (42 → 18 git processes) would be undone by the validation.

It is also wrong on the merits: the board legitimately sets the var for a repo that is not the cwd's. Making cwd the arbiter would break the caller the feature was built for.

**Keeping the precedence is right, and the plan's reasoning is sound.** One caveat the plan should record rather than act on: `-d` is a weak guard, and the failure mode is silent — a stale-but-existing path answers from the wrong repository with no warning. The plan says as much by quoting the comment; it need not do more in this slice.

## What must change (the amendment)

1. **Replace the four `mkdtempSync` line numbers with the three env choke points**: `dispatch.test.mjs:299`, `dispatch.test.mjs:3336`, `restart.test.mjs:118`. At `:299` the `delete` must follow the `...(opts.env ?? {})` spread.
2. **Require the regression test to use a decoy temp root**, never the real repository, so a failing test cannot write into the host registry it is defending.
3. **Specify the gate's discriminator**: no manifest in the host registry names a worktree under the system temp directory. Not "the registry is unchanged" — concurrent live agents make that unimplementable, and I measured two of them.
4. **Soften "the host's absolute `Agent registry`"** to note that a repo with a relative key leaks one hop later, via `plot-dispatch.sh:1125` resolving against the host `$repo_root`.

None of these touches the premise, which is sound and now reproduced. The slice is right; three of its four instructions point at the wrong lines, and its gate as specified cannot be built.
