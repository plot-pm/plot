## Implementation brief — fleetd-s-fixer-and-main-repair (wave: Role command)

- **Plan (canonical):** docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3029 merged
- **Branch:** `bug/the-role-command-passes-agents-json` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (`plot-review` GitHub App required on main)

This branch waits on `bug/fleetd-s-fixer-runs-bounded` (slice "Fixer bounds",
tracked as PR #3031). It waits because this change switches the fixer and
main-repair roles ON — they have never started successfully before — and
slice 1 is what bounds them (run-time cap, one-at-a-time concurrency, a push
gate) before that happens. It shares no file with slice 1, so merge order is
blocking but conflict risk is zero.

### What to build

`roleCommand` (`packages/domain/src/rules/role-command.ts:55-75`) currently
emits `--agents '<path to agents.json>'` — the JSON file's path, single-quoted.
The Claude Code CLI fleetd actually runs, 2.1.231 (resolved via fleetd's `PATH`
through the cmux shim to `/opt/homebrew/bin/claude`), reads `--agents` as JSON
**text only**, not a path. Every fixer and main-repair start today ends
immediately with `--agent 'fixer' not found. Available agents: claude, ...`
(or `'main-repair'`). Measured 2026-11-01: 19 of 19 fixer logs in
`.plot/state/fixer/` end this way; `.plot/state/main-repair/run.log` too, in
2.2 seconds.

The fix: change the `--agents` argument from the path form to
`--agents "$(cat -- '<path>')"`, so the shell fragment substitutes the file's
contents (JSON text) at run time rather than passing the path. `agentsFile`
stays the one carrier — both production callers (`auto-fixer.ts:383` for the
fixer, `repair-role.ts:133` for main-repair) keep writing JSON to that file
unchanged; only how `roleCommand` references it changes. The SDK adapter
(`agent-run-sdk.ts:312`) reads `RoleAgentRef.agentsFile` directly as a file
path and is unaffected — this branch touches only the `command` runner's
fragment string.

### Decisions the plan settles — do not re-derive them

**Why `$(cat -- '<path>')` and not inlining the JSON directly.** The caller
already writes JSON to a file (`auto-fixer.ts:425-426`,
`repair-role.ts:113-115`) because the SDK adapter needs that same file as a
path. Keeping one file as the carrier and only changing how the `command`
fragment dereferences it means the callers' write logic is untouched. An
inlined `"$(singleQuote(json))"` fragment (no file read) is named in the plan
as a fallback "if a reviewer wants a fragment with no file read" — not the
primary approach, and not something to switch to unprompted.

**Why the fragment needs a bash runner, and why that's already proven.**
`agentRunCommand` (`packages/domain/src/adapters/agent-run/agent-run-command.ts:17`,
asserted at `agent-run-command.test.ts:58`) runs the configured fragment as
`env -u PLOT_REPO_ROOT bash -c '<fragment> "$@"' _ <prompt>`. Command
substitution (`$(...)`) inside the fragment is evaluated by that `bash -c`,
which is exactly what makes `"$(cat -- '<file>')"` work — this was an open
question in the plan and is answered there (`role-command.ts:5-7`, `:27`,
`:39-49` doc comments need to state this new shape plus the fact that the
fragment needs a bash runner).

**Why `role-command.test.ts:21` must stop pinning an exact string.** The
current test asserts the built command as one literal string
(`packages/domain/test/role-command.test.ts:17-23`). Once the fragment
contains a `$(...)` substitution, a literal-string assertion is still valid
Vitest syntax but defeats the purpose of the red test below — assert the
**parsed argument vector** instead (split respecting quoting, or assert
`command` contains the right pieces), so the test proves shape rather than
one exact byte sequence.

**The red test is a fake CLI, not a real one — and this is deliberate.** CI
has no `claude` binary, and real CLIs at 2.1.312+ already accept the path
form, so a real-CLI test would only prove the new form *also* works, not that
the old form was broken. The fake: a small Node script in a `mkdtempSync` bin
directory that models 2.1.231 exactly — prints
`--agent '<role>' not found. Available agents: claude` and exits 1 unless
`--agents` parses as a JSON object with a key equal to `--agent`'s value,
otherwise prints a fixed success line and exits 0. Put that bin directory
first on `PATH` and run every `ROLE_NAMES` fragment (`reviewer`, `fixer`,
`unblocker`, `main-repair`) through the **real** `agentRunCommand` and the
**real** `boundedRunProcess` — not the test's own `sh -c` — so the actual
`bash -c '<fragment> "$@"'` expansion and quoting are what's under test. Only
`fixer` and `main-repair` are live callers today, but the plan asks for the
rule proven over every role name.

**Quoting must survive both the file path and the JSON content.** Test with
an `agentsFile` path containing a quote and a space, and with JSON containing
a `'` — the live fixer and main-repair JSON payloads already contain one
(1257 bytes and 1191 bytes respectively, both far below `ARG_MAX`, per the
plan's answered open question). Both must still produce exit 0 from the fake.

**A missing agents file must fail the same way a wrong CLI would.** If
`agentsFile` doesn't exist, `cat` fails and `$(...)` substitutes empty text,
which the fake should read as the refusal line (exit 1) — add this as its own
test case rather than assuming it falls out of the quoting tests.

### Done when

The plan's `## Done when` table, rows tagged "2" (lines 117–121 of the plan):

| Claim | Test |
|---|---|
| The 2.1.231 fake refuses a path and accepts JSON | `role-command-cli.test.ts` |
| Each role starts through the real runner (every `ROLE_NAMES` fragment) | `role-command-cli.test.ts` |
| Quoting survives (path with quote+space; JSON with a `'`) | `role-command-cli.test.ts` |
| A missing agents file fails | `role-command-cli.test.ts` |
| The argument vector, not a string | `role-command.test.ts` |

**Mutation check** (from the plan): revert `roleCommand` back to
`singleQuote(role.agentsFile)` and confirm the real-runner row in
`role-command-cli.test.ts` fails. If it doesn't fail, the test isn't actually
exercising the new form.

Plus the repo's standing gates: `node skills/plot/scripts/board/plot-local-checks.mjs`
run before each push, and whatever it prints — don't run a full suite by
name. A changeset for package `plot` describing this change (see repo
`CLAUDE.md` § Versioning — description first, `bumps:` block last; this is a
**patch** per semver guidance, a bug fix with no new surface). TSDoc on
`roleCommand` and `role-command.ts:5-7`/`:27`/`:39-49` states the new
behaviour (shell fragment needs a bash runner, `--agents` now carries JSON
text via command substitution) — not the history of why it changed; that
belongs in the plan and the commit message.

`scripts/check-shell-lines.sh`: this slice touches no `.sh` file, so the
shell-growth gate doesn't apply here.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the
controller once ready:

```bash
skills/plot/scripts/plot-open-pr.sh          # on this branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR is created, append `→ #<number>`
to this branch's line under the plan's `## Slices` → `### Role command`
heading.

### Scope guard

This branch owns:
- `packages/domain/src/rules/role-command.ts` (the `roleCommand` function and its doc comments)
- `packages/domain/test/role-command.test.ts` (the argument-vector assertion)
- A new `role-command-cli.test.ts` (or equivalent name) under `packages/domain/test/` for the fake-CLI rows

It does **not** touch `auto-fixer.ts`, `repair-role.ts`, `role-gate.ts`, or
anything under `.plot/state/fixer-attempts/` — those belong to the sibling
branches `bug/fleetset-s-fixer-runs-bounded` (merges first) and
`bug/a-failed-role-start-spends-no-attempt` (also waits on the same
prerequisite, independent of this one). If you find yourself editing
`auto-fixer.ts` or `repair-role.ts`, stop — that's out of scope for this
slice.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
