# Blast-radius lens — a-test-must-not-stop-the-fleet

Position: amend

The defect is real and the diagnosis is correct. The fix is scoped to the wrong
boundary twice: it guards one VERB where three reach the machine, and it puts
the guard inside the FILE where no other suite can inherit it.

## 1. Does the stated problem exist, verified in code?

**Yes. Every count in the plan reproduces.**

| the plan's claim | measured |
|---|---|
| `run(ctl, …)` call sites | 22 ✓ (21 calls + the definition at `:105`) |
| … passing `PLOT_FLEET_LABEL` | 7 ✓ (`:493 :512 :530 :567 :646 :664 :679 :709 :725` = 9 sites, 7 distinct tests) |
| `--stop` call sites | 3 ✓ (`:136 :224 :247`) |
| … passing a label | 0 ✓ |

The mechanism is exactly as described:

- `test/reconcile/fleetctl.test.mjs:105` — `function run(ctl, args, cwd, env = {})`, spreading `{ ...process.env, ...env }`
- `skills/plot/scripts/plot-fleetctl.sh:84` — `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"`
- `:135-139` — `supervisor_loaded()` → `launchctl print "gui/$(id -u)/$LABEL"`, machine-global
- `:670-673` — `if supervisor_loaded; then … launchctl bootout "gui/$(id -u)/$LABEL"`

**And the target is live right now.** `launchctl print gui/$(id -u)/com.plot-pm.registryd` answers LOADED on this machine as I write. The suite is one `pnpm run test:contracts` away from booting it out.

**One correction to the plan's arithmetic.** Of the three `--stop` sites, only TWO reach `bootout`. `:136` is `['--stop', '--wait', 'soon']`, and `plot-fleetctl.sh` refuses on the bad `--wait` argument before any launchd call. The live pair is `:224` (`stopempty`) and `:247` (`stoporder`). This does not weaken the plan — two is enough, and the plan's own evidence table is about the outcome rather than the count — but a plan that leads with measurements should have the right one.

## 2. Is this the smallest change that fixes it? **No — it is smaller than the defect.**

The plan names `--stop` as the defect's surface. It is not the only one, and I can show three more from the same file.

### `--start` reaches the same global label, and the plan leaves it unguarded

`plot-fleetctl.sh:461-462`:

```sh
if supervisor_loaded; then
  echo "plot-fleetctl: '$LABEL' is already loaded" >&2
```

Refusal 4 — *a unit with that label is already loaded* — asks the SAME machine-global question. Four `--start`/`--once` runs pass no label:

| site | args | env |
|---|---|---|
| `:145` | `--start` | none |
| `:153` | `--once` | none |
| `:163` | `--start` | none |
| `:172` | `--start --dry-run` | none |
| `:181` | `--start` | `HOME` only — **no label** |

These are saved today only by *ordering*: refusals 1 and 2 (no artifact / wrong node) fire before the label check. That is a reprieve, not a guard. The file's own header calls the node refusal the one that "fails silently later", and the whole point of testing refusals is that somebody will reorder them. `:181` is the sharpest case — its author already knew isolation was needed, overrode `HOME`, and still missed the label, because `HOME` is the isolation `launchctl` explicitly does not honour. That is precisely the mistake a per-verb guard does not catch.

### `--status` already leaked, and the file records it

`plot-fleetctl.sh:204` and `:407-408` call `supervisor_loaded`. Two unlabelled `--status` runs remain at `:207` and `:216`. The file's own header, lines 20-23, documents the consequence measured previously:

> `--status` reported `running` where the test had installed nothing, and `--start` refused with *already loaded* about a unit no test wrote.

So the read-side leak was found, diagnosed, and fixed for SEVEN sites — and the fix was applied case-by-case instead of at `run()`. This plan proposes the same shape of fix a second time, for a different verb. **That is the finding: the method is what failed, not the verb.**

### The plan's own words argue for the wider scope

> `run()`'s `env` default is the defect: an omitted label is not a choice, it is an oversight that reaches the machine.

Agreed entirely. But the slice then narrows to *"a guard refuses a run whose `PLOT_FLEET_LABEL` is unset"* while the design section frames it as a `--stop` guard. If `run()` takes the label as a required argument — which the slice does say — the `--start` and `--status` sites are covered for free. **Make the required-argument half the whole fix and drop the `--stop` framing**, which is what invites an implementer to write `if (args.includes('--stop'))`.

## 3. What I could not verify

- **The three deaths and the 11:40:46 / 11:42:31 timestamps.** The logs are machine-local and I did not read them; I also did not check `a-loaded-label-is-not-a-running-daemon.md`'s claim about a sandbox holding the production label.
- **"2822 leaked `plot-fleetctl-*` directories, from 103 two hours earlier."** `ls -d /tmp/plot-fleetctl-*` returns **zero** now, as does `plot-boardctl-*`. Not a contradiction — `$TMPDIR` on macOS is the per-user `/var/folders/…` path, not `/tmp` — but the plan's headline number is unverifiable from the repo, and it is the number a reader will quote. It is also explicitly out of scope, so nothing rests on it.
- **That `bootout` is the only thing that unloads a label.** Plausible and I did not falsify it; `launchctl remove` and a `RunAtLoad` reinstall are alternatives the plan does not rule out. The reasoning does not depend on exclusivity — `bootout` is demonstrably called with the real label, which is sufficient.
- **That the fix is sufficient.** No test can assert "the operator's supervisor survived", because a suite that asserts on a live machine-global label is the failure mode being fixed. The guard is checkable; its effect is not.

## 4. What breaks if this ships as written

**Nothing regresses.** Making `run()` require a label is mechanical, the sandbox already mints one, and the assertions are on stdout, which does not change. The three "what must not break" items are correctly identified and genuinely safe.

**But two things stay broken, and the plan will read as having fixed them.**

1. The unlabelled `--start`/`--once`/`--status` sites, if the guard is written as a `--stop` special case.
2. Every other suite. See below.

**And one real risk in the slice as worded:** *"a guard refuses a run whose `PLOT_FLEET_LABEL` is unset"* — if implemented as a throw inside `run()` checking `process.env`, it fires on an operator who legitimately has the variable exported. Make the guard read the EXPLICIT argument, never the inherited environment. An inherited label is the same oversight wearing a different hat.

## 5. Existing mechanism, or a nearer one the plan ignored

### The guard belongs in a gate, not in the file — and the repo has the pattern

**`test:contracts` is a bare glob.** `package.json`: `node --test … test/reconcile/*.test.mjs`. There is no `globalSetup`, no shared harness, no common helper. **A guard inside `fleetctl.test.mjs` protects `fleetctl.test.mjs` and nothing else** — every one of the 408 test files in this estate is free to spawn a controller with a production default tomorrow, and nothing will say so.

This is CLAUDE.md's own *Gates Over Rules* test applied to the plan. "Every run passes a label" was a rule, written in the file's header, and it was false for the file's whole life. The plan converts it to a gate **for one file**. The repo already has the right shape for the general case: `scripts/check-host-cli-callers.sh`, wired at `ci.yml:452`, whose header says it best —

> That is a rule failing exactly as CLAUDE.md predicts a rule will, so it is now a gate.

It is a path check with a named exception list. A `check-machine-global-in-tests.sh` is the same shape: grep the test estate for invocations of `plot-fleetctl.sh` / `plot-boardctl.sh` and refuse one that passes no isolating env. Five sibling gates already grep `test/`.

**One honest caveat against my own recommendation:** CI is `ubuntu-latest` only (`ci.yml:47,83`; the file's own header says the launchd arm "cannot run there at all"). A CI gate therefore cannot catch the *failure*, only the *shape*. That is still worth having — the shape is the thing a reviewer misses — but it means the gate is a lint, not a proof, and the plan should say so rather than let a reader infer CI now protects them.

### The other suites — what I found, and what each reaches

I swept the estate for `launchctl`, `systemctl`, `pkill`, `kill`, `git worktree remove`, `~/Library/LaunchAgents`, and the three controller scripts.

| suite | reaches | override | every site passes it? | default reaches |
|---|---|---|---|---|
| `test/reconcile/fleetctl.test.mjs` | `launchctl bootout` / `print` | `PLOT_FLEET_LABEL` | **NO — 7 of 22** | **the operator's live supervisor** |
| `test/reconcile/boardctl.test.mjs` | `kill -TERM` / `kill -KILL` | `--port` | **yes, all 6 `--stop` sites** | `DEFAULT_PORT=7777` — the operator's board |
| `test/reconcile/workerloop.test.mjs:250` | `pkill -KILL -f "sleep <secs>"` | unique per-test duration | yes, by construction | a `sleep 47` a person started |
| `test/e2e/*` | `plot-dispatch.sh` | sandbox repo root | n/a — no launchctl at all | nothing global |
| `packages/domain/test/supervisor-reading.test.ts` | `plot-fleetctl.sh` | refuses at *not a git repository* | n/a | nothing — refuses first |
| `packages/board/test/unit/registryd-units.test.ts` | — | — | — | string assertion on README only |

**`boardctl.test.mjs` is the near miss, and it is the strongest argument in this verdict.**

It is the SAME AUTHOR, the SAME SHAPE — a `sandbox()`, a `run(ctl, args, cwd, env = {})` with the identical `{ ...process.env, ...env }` spread — and `plot-boardctl.sh:78` carries `DEFAULT_PORT=7777`, the operator's real board. Its header makes the same promise fleetctl's did:

> NO TEST LEAVES A SERVER RUNNING, and none goes near port 7777.

Today it keeps that promise: all six `--stop` sites pass `--port`. **But the reason it is safe is not the discipline — it is that `plot-boardctl.sh`'s state is REPO-SCOPED.** `state_dir="$repo_root/.plot/state"`, so the pidfile lives in the sandbox, and the two-fact rule at `:465-471` refuses with *"this repository recorded no board"* before any `kill`. An unlabelled boardctl `--stop` is caught by the SCRIPT. An unlabelled fleetctl `--stop` is not, because `launchctl` keys by label and honours no `HOME`.

**That is the real dividing line, and it is the one a gate should encode**: a controller whose state is repo-scoped is sandboxed by construction; one that asks a machine-global registry is not. `plot-fleetctl.sh` is the only controller of the second kind in this estate. So **the plan is right that `fleetctl.test.mjs` is today's only offender** — I looked hard and found no second file that unloads anything. It is wrong that the file is the right place to fix it, because the property that makes fleetctl dangerous belongs to the SCRIPT, and any future test of that script inherits the danger with nothing to stop it.

`boardctl.test.mjs` passes `--port` at all six sites today on discipline alone. Discipline at 22 sites is exactly what failed in the file this plan is about.

## What I would amend

1. **Drop the `--stop` framing.** Make `run()`'s required-label argument the whole fix, so `--start`, `--once` and `--status` are covered by construction rather than by refusal ordering.
2. **Read the explicit argument, never `process.env`,** so an operator with `PLOT_FLEET_LABEL` exported does not silently defeat the guard.
3. **Add a second slice: a `scripts/check-machine-global-in-tests.sh` gate** on the `check-host-cli-callers.sh` pattern, wired into `ci.yml` beside its five siblings, refusing a test-estate invocation of `plot-fleetctl.sh` or `plot-boardctl.sh` that passes no isolating env. State plainly that CI is ubuntu-only, so the gate checks shape and not outcome.
4. **Correct the `--stop` count to two live sites,** naming `--wait soon` as refusing earlier.
5. **Record why `boardctl` is safe** — repo-scoped pidfile, not discipline — in the gate's header. That sentence is what stops the next author concluding a `DEFAULT_PORT` is as harmless as a `--port`.

None of these contradicts the plan's diagnosis. All five are about the boundary the fix is drawn at.
