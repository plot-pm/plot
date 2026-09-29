Position: amend
Evidence: executed

# The refusal the plan proposes shipped on 2026-09-06 and is under test

The plan's two halves are *the PATH gap* and *the refusal*. It calls the second **"the part that matters more"** and makes it the first `Done when` bullet. **It exists already, on `main`, with a passing test.** The plan proposes building it a second time, and its prose about the current behaviour is factually wrong in three places.

## 1. The chain: every hop verified, and the premise survives it

Asked first because a broken hop would move everything. It does not break.

| hop | evidence |
|---|---|
| launchd → supervisor | `units/com.plot-pm.registryd.plist:45-54` — `EnvironmentVariables` sets `PATH`; no `EnvironmentFile`, no login shell |
| supervisor → dispatch | `run-script.ts:70` — `env: options.env ? { ...process.env, ...options.env } : process.env`. **Inherits, never replaces.** `performer-shell.ts:93-97` adds only `PLOT_START_ONE`/`PLOT_START_DESK` |
| dispatch → worker | `plot-dis*patch.sh:1450` — `nohup sh -c '…'`. A **plain `sh -c`**, not `sh -lc`, not `bash -l`. No profile is read |
| loop → prompt | `plot-worker-loop.sh:1675` — `bash -c '. "$1"' _ "$prompt_file"`. Non-interactive, non-login. No profile |
| prompt → harness | `templates/worker-prompt.sh:136` — `harness="${PLOT_HARNESS:-claude}"`, invoked at `:169` |

**Nothing re-reads a profile and nothing resets PATH.** The plan's premise about the chain holds. I record it because a wrong answer here would have made everything else moot — and because the brief suspected it hardest.

## 2. "No transcript, no marker, no message naming the binary" — refuted on all three

`plot-worker-loop.sh:1719` keeps the prompt child's exit code in `_prompt_status`. Line 2008 branches on it:

```
2008  if [ "$_prompt_status" -ne 0 ]; then
2009    _start_attempts=$(manifest_attempts "${PLOT_MANIFEST_FILE:-}")
2010    if [ "$_start_attempts" -lt "$START_ATTEMPT_BUDGET" ]; then
2012      echo "plot-worker-loop: the prompt failed to run on … exited $_prompt_status …; retrying (N of 3)." >&2
2013      continue
2015    echo "plot-worker-loop: the prompt never started on … exited $_prompt_status on each of 3 attempts …" >&2
2016    write_ending … unstarted agent … "the worker prompt exited $_prompt_status without running, on 3 attempts"
2018    write_blocked_marker … "PLOT-BLOCKED: the worker prompt for \`…\` exited $_prompt_status without running, 3 times. …"
2021    exit 1
```

Against the plan's sentence — *"There is no transcript, no `PLOT-BLOCKED`, no message naming the binary — and the loop retries, so the operator sees three of them"*:

- **`PLOT-BLOCKED`** — written, `:2018`.
- **Exit record** — `.plot-worker.ending.json` with `reason: unstarted`, `actor: agent`, `:2016`.
- **Exit code** — 1, so `plot-worker-state.sh` answers `failed`, not `none`.
- **Three retries** — `START_ATTEMPT_BUDGET=3` (`:359`). **The plan reports the budget as the symptom and it is the designed behaviour**, deliberately bounded and stated in the log line each time.

**Landed `85eaa80c` "A second slice needs its own session (#715)", 2026-09-06** — three weeks before the 2026-09-29 report.

**Under test, and I ran it:**

```
$ node --test --test-name-pattern "a prompt that never runs" test/reconcile/second-slice.test.mjs
plot-worker-loop: the prompt failed to run on feature/seam — … retrying (2 of 2).
plot-worker-loop: the prompt never started on feature/seam — … ending worker.
✔ second slice: a prompt that never runs fails loudly and keeps its slice (2855.845083ms)
ℹ pass 1  ℹ fail 0
```

`test/reconcile/second-slice.test.mjs:353-391` asserts the marker, `reason: unstarted`, `actor: agent`, exit 1, and the kept claim.

### And the binary IS named

```
$ PATH=/usr/bin:/bin bash -c '. "$1"' _ .plot/worker-prompt.sh
.plot/worker-prompt.sh: line 2: claude: command not found
exit=127
```

`$harness` is the command word, so **bash's own diagnostic names it** and it lands in `.plot-worker.log` — which `:2018`'s marker text tells the operator to read. The plan wants `templates/worker-prompt.sh` to name `$harness`; the shell already does.

**So three of the four `Done when` bullets are already satisfied**, and the plan explicitly told the implementer not to rediscover this: *"Three exits at 127 is the current behaviour and the refusal replaces it."* The refusal did not need replacing.

## 3. The PATH premise is false on the machine it cites

The plan: *"`command -v claude` → `/Users/jwloka/.local/bin/claude`, which neither unit's PATH contains."* True as written and **the wrong question** — what matters is whether the unit's PATH resolves `claude`, not whether it contains that path.

```
$ env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin sh -c 'command -v claude'
/opt/homebrew/bin/claude
exit=0
```

**It resolves.** Two installs exist here:

```
/opt/homebrew/bin/claude -> …/claude-code/2.1.231/claude    2.1.231   (on the unit PATH)
~/.local/bin/claude      -> …/versions/2.1.282              2.1.282   (the shell's)
```

Two consequences:

- **A supervisor-started worker on this machine does not exit 127.** It runs a **51-version-stale** binary, silently. That is the real defect this estate has, it is *not* what the plan describes, and the plan's fix (prepend `~/.local/bin`) happens to fix it — for an unstated reason, so nothing records why the ordering matters.
- **The plan's one measurement does not support its claim.** The issue says honestly *"Not reproduced here … nobody has watched a launchd worker fail this way on this machine."* The plan drops that caveat and presents the reading as if it did.

## 4. `~/.local/bin` is a guess, and the probe precedent exists

The plan declines probing: *"`plot-board-probe.sh` is the precedent for probing, and it answers a question with several right answers; this one has a name the template already holds."*

**That reads the precedent backwards.** `plot-board-probe.sh:288` is `cli_installed() { command -v "$1" >/dev/null 2>&1 …}` — it probes precisely because a binary's *location* has several right answers while its *name* has one. The plan's own machine proves the several: two installs, two versions, and the answer depends on order.

The issue asked the sharper question the plan did not carry forward: *"Whether to search or to declare. … A `command -v` probe at install time and a declared value beat a guessed list at run time."* `plot-fleetctl.sh:744` already bakes `__NODE__` from an absolute resolution at install time — the identical shape, in the identical file, for the identical reason.

## 5. Different gaps, not "both units share it"

- **launchd** (`:53`) — `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew is present, so it resolves a cask install and misses `~/.local/bin`.
- **systemd** (`:39`) — `/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin`. **No Homebrew prefix at all**, and Linux `claude` installs to `~/.local/bin`. It has no fallback the plist has.

Neither inherits a profile — `grep` for `EnvironmentFile|PAMName` in the service returns nothing. So the *mechanism* is shared and the *exposure* is not: the plist is a version-skew hazard, the service is a hard 127. The plan asserts one gap and would write one changeset sentence for two failures.

## 6. The fix does not reach the reporter, and the plan does not say so

```
$ bash skills/plot/scripts/plot-install-prompt.sh --check
current — …/.plot/worker-prompt.sh interpolates PLOT_SESSION_FLAG
```

`plot-install-prompt.sh:8-10,67` never overwrites. The reporter has their own `.plot/worker-prompt.sh` carrying their workaround. **A template change reaches no existing adopter** — only a fresh `/plot-init`. The plan's Notes observe the file is never overwritten and then draw the opposite conclusion (*"their fleet works and every other adopting project hits the same wall"*), missing that the same fact makes the template half of its own fix undeliverable to anyone who has already adopted.

The unit half *is* deliverable — `--stop` then `--start`, which the plan does state. So the plan's caveat is attached to the half that has one and absent from the half that needs it more.

## What an amendment should say

1. **Delete the refusal work.** Cite `plot-worker-loop.sh:2008-2021` and `test/reconcile/second-slice.test.mjs:320`. If a gap remains it is narrow — the bullet *"asserted with a stub PATH that omits it"* is a fixture variation on a test that exists.
2. **Restate the PATH defect as measured**: on macOS the unit resolves a stale Homebrew `claude`; on Linux it resolves nothing. Two symptoms.
3. **Probe at install time.** `plot-fleetctl.sh --start` already resolves and bakes `__NODE__`; resolve `claude` the same way, with `PLOT_HARNESS` honoured. This is what the issue asked and what `plot-board-probe.sh` is precedent for.
4. **State that the template half reaches no existing adopter**, and that the reporter's own fleet is fixed only by their local file.
5. Keep the `--stop`/`--start` changeset note.

## Against my own position

**The strongest case for `proceed`:** the units genuinely have a PATH gap, both of them, and the fix is one line each. Everything I refute is the plan's *prose about the refusal* — the slice could land the PATH change and simply not build the refusal, and the estate would be better off. I am rejecting a description, not an outcome.

**The strongest case for `reject`:** when a plan's stated primary deliverable already exists, is tested, and the plan instructs the implementer not to rediscover it, the plan has not been checked against the code. The pattern the brief names — *told the implementer not to rediscover a consequence stated backwards* — is exactly what `:2008` is.

I land on **amend** because the residue is real and small: the PATH is wrong in both units, `~/.local/bin` is the right value for the reporter, and the probe is a better answer that the estate already has machinery for. A rewrite around points 1–4 is a short plan, not a new one.

**Where I could be wrong:** I did not reproduce a launchd-started worker failing, and I was instructed not to touch a job. My exit-127 reproduction sources the prompt file the same way `plot-worker-loop.sh:1675` does, but under a synthetic PATH rather than under launchd. If launchd differs in some way I have not read, the refusal path might not be reached — though nothing in the five hops suggests it, and `_prompt_status` is captured from `wait` at `:1719` regardless of who the parent is.

**Host calls made: 1** (`gh issue view 1068`).
