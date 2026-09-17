# Premise lens — a credential is read where a repo keeps it

Position: amend

The defect is real and the fix is the right one. Three of the plan's supporting
claims are false as written, and one of them is the parse the Design prescribes:
**the snippet in the plan cannot read the file its own `Done when` requires it to
read.** Amend the Design's parse and drop two unsupported support arguments.

---

## 1. Is the problem real, and stated correctly?

**The core premise holds. Nothing on the estate reads a `.env` file.** I searched
`packages/` as well as `skills/`, which the plan did not.

```
$ grep -rn 'dotenv' --include=package.json . | grep -v node_modules
NO dotenv in any package.json

$ grep -rn -- '--env-file' --include='*.json' --include='*.ts' --include='*.mjs' \
    --include='*.js' --include='*.sh' --include='*.yml' . | grep -v node_modules
NO --env-file anywhere

$ grep -rn '\.env\b' --include='*.ts' --include='*.sh' --include='*.mjs' \
    packages/ skills/ scripts/ | grep -v process\.env | grep -v envelope
packages/board/test/helpers.mjs:75:        ...env,
packages/board/test/port.test.mjs:45:        ...env,
packages/board/test/port.test.mjs:293:  /process\.env\.HOST\s*\?.../
```

Three hits, all spreads of an in-memory object or a `process.env` regex. **No
file read.** Confirmed across the board package, the domain package and the
scripts — a wider corpus than the plan searched, same answer.

**One near-miss worth recording so it is not re-litigated.** `dotenv@8.6.0` IS in
`pnpm-lock.yaml` at three lines, which looks like a refutation and is not:

```
$ sed -n '1808,1814p' pnpm-lock.yaml
  '@changesets/changelog-github@0.6.0':
    dependencies:
      '@changesets/get-github-info': 0.8.0
      '@changesets/types': 6.1.0
      dotenv: 8.6.0
```

A transitive dependency of a release-tooling devDependency. It is never imported
by Plot code and never runs in the board. The premise survives it — but the plan
should say so, because the next person to grep `dotenv` will find it and stop.

**The refusal is quoted accurately and both line numbers are exact.**

```
$ grep -n 'jira_require_config' skills/plot/scripts/plot-host.sh
1698:jira_require_config() {

$ sed -n '1702,1703p' skills/plot/scripts/plot-host.sh
  if [ -z "${JIRA_EMAIL:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
    echo "plot-host: Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment
      — an unauthenticated Jira must not read as an empty inbox" >&2
```

`jira_require_config` at **:1698**, the refusal at **:1703**. Both as claimed.
It is reached from three call sites (:3353, :3532, :3635), so the fix inside the
guard covers every path.

**`.env` is genuinely absent from `.gitignore`**, and from every fallback the
plan did not check:

```
$ grep -n 'env' .gitignore
67:.plot-worker.envelope.json          <-- the only match, unrelated

$ git ls-files | grep -i '\.env'      -> none tracked
$ grep -n 'env' .git/info/exclude     -> no .env
$ cat ~/.gitignore | grep env         -> no .env
```

Confirmed in all four places. This gate is well-founded and is the strongest
item in the plan.

## 2. Is the proposed change the right fix, or a symptom fix?

**The right fix.** The guard at `:1698` is the single chokepoint — all three
`issue-list`/`issue-view`/`issue-status` paths pass through it, so reading the
file there fixes the cause once rather than patching each caller.

The three non-goals are correctly drawn. Confining the read to two named
variables on one refusal path, refusing an upward walk, and leaving the refusal
sentence intact all keep the blast radius at the guard. `plot-config.sh` is
indeed the estate's stated place for settings, so declining a general loader is
consistent rather than arbitrary.

**The "environment wins" table is the right precedence** and matches how the
value is consumed at `:1720` (`--user "${JIRA_EMAIL}:${JIRA_API_TOKEN}"`).

## 3. Does `Done when` contain a gate that plumbing-through cannot satisfy?

**Yes — two, and they are the plan's best feature.**

- *"the output **names `.env` as the source**, pinned by text"* — a value plumbed
  through without being used produces no such text. Cannot be faked.
- *"the token's **value appears in no output stream**, pinned by asserting its
  absence from both stdout and stderr"* — a negative assertion over both streams.
  Passing it requires the value to actually flow and be deliberately withheld.

The byte-identical-when-both-set gate, *"pinned by asserting no file read
occurs"*, is also real: it forces an observable (an strace-like probe, or a
`.env` that would poison the result if read).

**One gap.** No gate asserts the credential read from `.env` actually
**authenticates** — that the value reaches `jira_curl` and the call succeeds. All
three gates test the plumbing and the message; none tests the outcome the plan
exists for. A fixture where the parsed pair produces a 200 against a stub would
close it.

## 4. What the plan claims that I could not verify, or found false

**FALSE — the prescribed parse cannot read an `export `-prefixed line, which its
own `Done when` requires.** This is the finding that moves my position.

The Design prescribes:

```bash
grep -m1 '^JIRA_EMAIL=' "$root/.env" | cut -d= -f2-
```

The `Done when` requires a fixture holding *"unquoted JSON, quotes, `export `
prefixes and blank lines"* parsed correctly. Tested:

```
$ printf 'export JIRA_API_TOKEN=abc123\n' > e1.env
$ grep -m1 '^JIRA_API_TOKEN=' e1.env | cut -d= -f2-
                                        <-- EMPTY
```

The `^` anchor does not match past `export `. **The plan's Design and its
`Done when` contradict each other**, and an implementer following the Design
literally ships a gate-failing parse.

**FALSE — quotes are not stripped.** The same `Done when` names quotes:

```
$ printf 'JIRA_API_TOKEN="abc123"\n' > e2.env
$ grep -m1 '^JIRA_API_TOKEN=' e2.env | cut -d= -f2-
"abc123"                                <-- quotes retained
```

`curl -u` would send the quote characters as part of the token and get a 401 —
reproducing the reported symptom through the fix meant to cure it. The parse
needs anchor `^(export[[:space:]]+)?` and quote-stripping. Both are cheap; the
point is the plan prescribes neither.

**UNVERIFIED — sourcing did not abort on unquoted JSON.** The Design says the
reporter measured `set -a; . ./.env` aborting in zsh on a line holding an
unquoted JSON object. I could not reproduce it in either shell:

```
$ printf 'A=1\nJSON={"k":"v","n":[1,2]}\nJIRA_API_TOKEN=tok\n' > e3.env
$ bash -c 'set -a; . ./e3.env; set +a; echo "token=[$JIRA_API_TOKEN]"'
token=[tok]
$ zsh  -c 'set -a; . ./e3.env; set +a; echo "token=[$JIRA_API_TOKEN]"'
token=[tok]
```

Both sourced cleanly. What *does* break a source is an unquoted **space**:

```
$ printf 'DESC=hello world\nJIRA_API_TOKEN=tok\n' > e4.env
$ bash -c 'set -a; . ./e4.env; ...'
./e4.env: line 1: world: command not found
```

The conclusion (don't source) is right and the second reason given — sourcing
imports every unrelated variable on a credentials path — is sound on its own.
But the *measurement* cited does not reproduce, and the fixture the `Done when`
names is built around a shape that does not actually fail.

**FALSE — `plot-boardctl.sh` does not start the board detached.** The plan says
*"`plot-boardctl.sh` starts it detached"*. The script says the opposite, in a
comment written precisely to forestall this:

```
$ sed -n '392,396p' skills/plot/scripts/plot-boardctl.sh
  # STARTED FROM THE REPO ROOT, because the board reads the CWD and compares
  # realpaths. `setsid`/`nohup` is deliberately NOT used: the tree must stay
  # reachable by ancestry from the pid recorded below, and detaching would not
  # change that but would hide the tree behind an init reparent the moment the
  # starting shell exits.
```

It is a plain `( … ) &` subshell — a child of the starting shell that inherits
its full environment. So does `pnpm board` (`package.json:14`,
`node --watch …board-server.mjs`). **"Export it in your shell" reaches the board
by both documented start paths.**

**MISLEADING — `plot-fleetctl.sh` bakes no credential into the launchd unit.**
The plan cites this as evidence that shell inheritance does not exist. The unit
bakes exactly two variables:

```
$ cat skills/plot/units/com.plot-pm.registryd.plist   (EnvironmentVariables)
  PLOT_REPO_ROOT = __REPO_ROOT__
  PATH           = /opt/homebrew/bin:/usr/local/bin:...
```

A repo root and a PATH — and the PATH comment says it is there because *"launchd
gives a job a minimal PATH"*, a tooling concern, not a credential one. Further,
that unit supervises **`plot-registryd`, not the board**, and registryd never
touches the inbox (`grep issue packages/board/src/registryd-main.ts` → nothing;
the inbox is `fleet.ts:2245`, in the board process). The cited precedent is a
different process that bakes no secret.

## 5. What a premise reader would notice that the plan missed

**The "why this is Plot's and not the adopter's" argument rests on two false
supports, and the conclusion still stands without them.** Both detachment claims
are wrong, so "export it in your shell" *does* reach the board today. The real
argument is the one the plan states first and then buries: every repo adopting
`Tracker: jira` meets this, an operator holding working credentials in the
conventional place is told to create a second token, and a `.env` is where the
ecosystem puts them. That is sufficient. **Delete the two process claims rather
than defend them** — a premise propped on falsifiable supports invites the whole
plan to be rejected when a reader checks them.

**A second, quieter leak path the "value appears in no output" gate does not
cover.** `budget_record_jira` at `:1742` writes `JIRA_EMAIL` into the budget
ledger:

```
$ sed -n '1741,1743p' skills/plot/scripts/plot-host.sh
budget_record_jira() {
  [ -z "${PLOT_BUDGET_OFF:-}" ] || return 0
  budget_append jira "${JIRA_EMAIL:-unknown}" api 1 - - - unknown
```

Today that value comes from an operator's exported environment. After this
change it may come from `.env` — so a file the repo is about to teach itself to
read starts feeding a persisted ledger. The email is the lesser half of the pair
and this is not a token leak, but the gate as written asserts only over stdout
and stderr and would not see it. **Name the ledger explicitly**: either assert
the ledger too, or state that the email reaching it is intended.

**The `.gitignore` entry should land first, not alongside.** The slice bundles
"read the file" and "ignore the file" into one branch. The window between
teaching operators to create a `.env` and ignoring it is exactly when one gets
committed. Ordering the `.gitignore` edit ahead costs nothing and closes it.

**Sibling-plan cross-reference verified.**
`2026-09-17-the-inbox-says-what-it-is-showing.md` exists on disk, and the two
defects are distinct as the plan describes — an inbox narrowed by assignee
versus an inbox that never runs. That paragraph is accurate.

---

## What amending looks like

1. **Fix the Design's parse** to match its own `Done when`: allow an optional
   `export ` prefix and strip surrounding quotes. Without this the plan ships a
   parse that fails its own gate.
2. **Drop or restate the zsh-abort measurement.** It does not reproduce; the
   "sourcing imports everything" reason stands alone and needs no support.
3. **Delete the two detachment claims** (`plot-boardctl.sh` detached,
   `plot-fleetctl.sh` bakes an environment). Both are false; the adopter argument
   is stronger without them.
4. **Add a gate that the parsed credential authenticates**, not merely that it is
   read and announced.
5. **Name `budget_append` at `:1742`** in the no-leak gate's scope, or state that
   the email reaching the ledger is intended.
6. **Note that `dotenv` in the lockfile is a changesets transitive**, so the
   premise is not re-opened by the next grep.
