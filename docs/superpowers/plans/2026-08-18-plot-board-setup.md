# plot-board-setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/plot-board-setup` spoke that brings a project from "has Plot" to "has a working board" — probing prerequisites, writing git-host and CI config keys, and proving the board serves rather than asserting it.

**Architecture:** One new read-only bash probe (`plot-board-probe.sh`) that emits JSON and decides nothing, plus one new skill (`skills/plot-board-setup/`) that interprets that JSON, writes config, and runs a verification gate. This follows Manifesto Principle 3 — scripts collect and report, skills interpret and adapt. No existing board source or helper is modified, so no artifact rebuild is needed.

**Tech Stack:** bash (probe), markdown (skill), `node --test` with the existing `test/reconcile/` harness (tests), changesets (versioning).

**Design spec:** `docs/superpowers/specs/2026-08-18-plot-board-setup-design.md`

---

## Background an implementer needs

**Plot is a skill system, not an application.** Skills are markdown files with
YAML frontmatter under `skills/<name>/`. Each needs `SKILL.md` (agent-facing
instructions) and `README.md` (developer notes explaining *why* it looks that
way). `pnpm test` validates every skill parses.

**Config lives in markdown.** An adopting project describes its conventions in a
`## Plot Config` section of its root `CLAUDE.md` or `AGENTS.md`. Only
`skills/plot/scripts/plot-config.sh` knows this — every other consumer calls it
with `plot-config.sh get <key> [default]`. That script's header comment lists
every known key, so adding keys means editing that comment too.

**Never edit version numbers by hand.** Declare bumps in a changeset; the
release process applies them.

**Use `trash`, not `rm`,** per the user's global instructions.

**Tests use sandbox repos.** `test/reconcile/*.test.mjs` are unit-style contract
tests over a single script, built with `fs.mkdtempSync` + `git init`. They stub
external CLIs by prepending a temp dir to `PATH` — see `stubHost()` in
`test/e2e/helpers.mjs` for the established pattern. This plan reuses that
technique for `gh` / `bb` / `jen`.

**Two measured facts drive the design.** Both were verified on 2026-08-18 and
are the reason the probe looks the way it does:

1. A plan file written with a bare `**Phase:** Draft` line (rather than the
   list item `- **Phase:** Draft` under `## Status`) parses as `format: "none"`.
   The board then boots, serves valid JSON, and renders **zero cards** — visually
   identical to a broken board.
2. `jen -I <slug> auth status` prints `Keycloak: signed in` and a plausible
   instance URL **even for a slug that does not exist**, because the slug expands
   into a URL pattern without ever being reached. Only the trailing
   `Jenkins auth:  reachable` / `NOT reachable` line distinguishes the two.
   Exit code is 0 in both cases. (`jen auth status` with no instance at all
   exits 1.)

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/plot/scripts/plot-board-probe.sh` | **New.** Read-only. Emits one JSON object describing board prerequisites, artifact location, config presence, and CLI auth states. Decides nothing. |
| `skills/plot/scripts/plot-board-verify.sh` | **New.** Starts the board on an OS-assigned port, fetches `/api/board`, prints the payload, and reaps the server via `trap`. The teardown is the reason this is a script rather than skill prose. |
| `test/reconcile/boardprobe.test.mjs` | **New.** Contract tests for the probe: JSON shape, three-state auth, artifact resolution order, read-only guarantee. |
| `test/reconcile/boardverify.test.mjs` | **New.** Contract tests for the verify script: serves a payload, reaps the server on both success and failure. |
| `skills/plot-board-setup/SKILL.md` | **New.** The five interpretation steps: probe → propose → write config → verify → summarise. |
| `skills/plot-board-setup/README.md` | **New.** Developer notes: the script/skill split, why the verify gate asserts cards rather than HTTP 200, why the Jenkins keys are not inert. |
| `skills/plot/scripts/plot-config.sh` | **Modify.** Header comment only — document the two new keys. No logic change. |
| `skills/plot-init/SKILL.md` | **Modify.** One row in the step-4 extensions table. |
| `CLAUDE.md` | **Modify.** Architecture table (new Command row) + Helper Scripts table (new script row). |
| `README.md` | **Modify.** Root skills table row. |
| `.changeset/20260818-plot-board-setup.md` | **New.** With a `bumps:` block naming the new and touched skills. |

Task order is dependency-ordered: the probe and its tests come first because
the skill's step 1 consumes the probe's output, and the docs come last because
they describe what the earlier tasks built.

---

## Task 1: Probe skeleton — JSON shape and read-only guarantee

**Files:**
- Create: `skills/plot/scripts/plot-board-probe.sh`
- Create: `test/reconcile/boardprobe.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/reconcile/boardprobe.test.mjs`:

```javascript
// Contract test for skills/plot/scripts/plot-board-probe.sh — the board
// adoption probe. It answers "can the board run here, and what is already
// configured?" so /plot-board-setup can PROPOSE rather than interview.
//
// Strictly READ-ONLY: it is run in a stranger's repo before anything is
// agreed to, so it must not create, modify, or delete anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const probeScript = path.join(
  here, '..', '..', 'skills', 'plot', 'scripts', 'plot-board-probe.sh',
);

let tmp;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

/** Run the probe in `cwd`, optionally with a stub dir prepended to PATH. */
function probe(cwd, { stubDir, env = {} } = {}) {
  const out = execFileSync('bash', [probeScript], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      ...(stubDir ? { PATH: `${stubDir}:${process.env.PATH}` } : {}),
      ...env,
    },
  });
  return JSON.parse(out);
}

/** A git repo containing `files`, committed. */
function repoWith(files = {}, { config } = {}) {
  const r = fs.mkdtempSync(path.join(tmp, 'repo-'));
  git(r, 'init', '-q', '-b', 'main');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  if (config !== undefined) {
    files['CLAUDE.md'] = `# Sandbox\n\n## Plot Config\n\n${config}\n`;
  }
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(r, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(r, p), content);
  }
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'init');
  return r;
}

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-boardprobe-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('probe: emits the documented top-level fields', () => {
  const r = repoWith({ 'a.txt': 'x' }, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r);
  for (const key of [
    'node', 'node_ok', 'bash', 'git_root', 'cwd_is_root',
    'artifact', 'artifact_source', 'has_plot_config', 'plan_dir',
    'plan_files', 'git_host', 'gh', 'bb', 'jen', 'ci_signals',
  ]) {
    assert.ok(key in p, `missing field: ${key}`);
  }
});

test('probe: reports has_plot_config false when no hub doc carries the section', () => {
  const r = repoWith({ 'a.txt': 'x' });
  assert.equal(probe(r).has_plot_config, false);
});

test('probe: reports has_plot_config true and reads the plan directory', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r);
  assert.equal(p.has_plot_config, true);
  assert.equal(p.plan_dir, 'docs/plans/');
});

test('probe: is strictly read-only', () => {
  const r = repoWith({ 'a.txt': 'x' }, { config: '- **Plan directory:** docs/plans/\n' });
  const before = git(r, 'status', '--porcelain');
  const listing = fs.readdirSync(r).sort().join(',');
  probe(r);
  assert.equal(git(r, 'status', '--porcelain'), before);
  assert.equal(fs.readdirSync(r).sort().join(','), listing);
});

test('probe: reports not-a-git-repository as an error object, exit 1', () => {
  const bare = fs.mkdtempSync(path.join(tmp, 'nogit-'));
  let status = 0;
  let out = '';
  try {
    out = execFileSync('bash', [probeScript], { encoding: 'utf8', cwd: bare });
  } catch (e) {
    status = e.status;
    out = e.stdout;
  }
  assert.equal(status, 1);
  assert.equal(JSON.parse(out).error, 'not a git repository');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: FAIL — every test errors, because `plot-board-probe.sh` does not
exist yet (bash reports "No such file or directory").

- [ ] **Step 3: Write the minimal probe**

Create `skills/plot/scripts/plot-board-probe.sh`:

```bash
#!/usr/bin/env bash
# Plot helper: board adoption probe — can the board run here, and what is
# already configured?
# Usage: plot-board-probe.sh
# Output: one JSON object, for /plot-board-setup to PROPOSE from rather than
#         interviewing the user about facts already visible.
#
# STRICTLY READ-ONLY. This runs in a stranger's repo before anything has been
# agreed to, so it must not create, modify, or delete anything — not even a
# directory, and never a server it forgets to stop. Starting the board is the
# SKILL's job (step 4), where the user has consented.
#
# It DECIDES NOTHING. Every field is a fact; which artifact to recommend,
# whether Jenkins keys are warranted, and what an empty board means are all
# judgments left to the skill (Manifesto Principle 3).
#
# Fields:
#   node            `node --version` output, or "" when node is absent
#   node_ok         true when node's major version is >= 20 (the artifact's
#                   esbuild target, and what its shipped README requires)
#   bash            always true if this ran, but reported for completeness
#   git_root        `git rev-parse --show-toplevel`
#   cwd_is_root     true when CWD *is* the repo root. The board requires
#                   equality, not containment: board.ts compares realpaths and
#                   silently drops branch-staged plans when they differ.
#   artifact        absolute path to a runnable board-server.mjs, or ""
#   artifact_source plugin | npm | checkout | none  (resolved in that order)
#   has_plot_config true when a hub doc carries a `## Plot Config`
#   plan_dir        the configured plan directory (default docs/plans/)
#   plan_files      count of *.md under plan_dir (0 when it does not exist)
#   git_host        the configured `Git host` key, or ""
#   gh|bb|jen       {"installed":bool,"auth":"ok|failed|unknown"}
#                   jen additionally carries "instance"
#   ci_signals      {"jenkinsfile":bool,"gh_workflows":bool}
#
# `auth` IS A THREE-STATE ENUM, NEVER A BOOLEAN. "unknown" is what an
# unrecognised output produces, and it must read as *cannot verify*, never as
# *authenticated*. This is the failure direction plot-host.sh adopted after the
# 2026-08-17 GitHub 503 afternoon, when every branch read as having no PR:
# being wrong in the reassuring direction is the worst way to be wrong,
# because nobody investigates a green light.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo '{"error":"not a git repository"}'; exit 1;
}

# --- runtime ------------------------------------------------------------
node_ver=""
node_ok=false
if command -v node >/dev/null 2>&1; then
  node_ver=$(node --version 2>/dev/null || true)
  major=${node_ver#v}
  major=${major%%.*}
  case "$major" in
    ''|*[!0-9]*) node_ok=false ;;
    *) [ "$major" -ge 20 ] && node_ok=true ;;
  esac
fi

# --- repo shape ---------------------------------------------------------
git_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
cwd_is_root=false
if [ -n "$git_root" ]; then
  # realpath both sides: the board compares resolved paths, so a symlinked
  # checkout must not read as a mismatch here when the board accepts it.
  a=$(cd "$git_root" 2>/dev/null && pwd -P)
  b=$(pwd -P)
  [ "$a" = "$b" ] && cwd_is_root=true
fi

# --- plot config --------------------------------------------------------
has_config=false
for f in "$git_root/CLAUDE.md" "$git_root/AGENTS.md"; do
  [ -f "$f" ] && grep -qi "^##[[:space:]]*plot config" "$f" 2>/dev/null && {
    has_config=true; break;
  }
done

plan_dir=$(bash "$here/plot-config.sh" get "Plan directory" "docs/plans/" 2>/dev/null || echo "docs/plans/")
git_host=$(bash "$here/plot-config.sh" get "Git host" "" 2>/dev/null || echo "")

plan_files=0
if [ -n "$git_root" ] && [ -d "$git_root/$plan_dir" ]; then
  plan_files=$(find "$git_root/$plan_dir" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
fi

# --- ci signals ---------------------------------------------------------
jenkinsfile=false
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
gh_workflows=false
[ -n "$git_root" ] && [ -d "$git_root/.github/workflows" ] && gh_workflows=true

cat <<JSON
{
  "node": "$(j "$node_ver")",
  "node_ok": $node_ok,
  "bash": true,
  "git_root": "$(j "$git_root")",
  "cwd_is_root": $cwd_is_root,
  "artifact": "",
  "artifact_source": "none",
  "has_plot_config": $has_config,
  "plan_dir": "$(j "$plan_dir")",
  "plan_files": $plan_files,
  "git_host": "$(j "$git_host")",
  "gh":  {"installed": false, "auth": "unknown"},
  "bb":  {"installed": false, "auth": "unknown"},
  "jen": {"installed": false, "auth": "unknown", "instance": ""},
  "ci_signals": {"jenkinsfile": $jenkinsfile, "gh_workflows": $gh_workflows}
}
JSON
```

Then make it executable:

```bash
chmod +x skills/plot/scripts/plot-board-probe.sh
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: PASS — 5 tests passing. (`artifact`, `gh`, `bb`, `jen` are
placeholders filled in by Tasks 2 and 3; the shape test only asserts the keys
exist.)

- [ ] **Step 5: Commit**

```bash
git add skills/plot/scripts/plot-board-probe.sh test/reconcile/boardprobe.test.mjs
git commit -m "plot: add board adoption probe skeleton

Read-only JSON probe reporting board prerequisites: node version, repo
shape, Plot Config presence, plan count, and CI signals. Decides nothing —
every field is a fact for /plot-board-setup to interpret.

cwd_is_root compares realpaths because board.ts does: a CWD that merely
sits inside the repo silently drops branch-staged plans."
```

---

## Task 2: Artifact resolution

The board artifact can come from three places. The probe reports which, in a
fixed precedence order, so the skill can recommend a start command.

**Files:**
- Modify: `skills/plot/scripts/plot-board-probe.sh`
- Modify: `test/reconcile/boardprobe.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/reconcile/boardprobe.test.mjs`:

```javascript
/**
 * A fake plugin tree containing a board artifact, and the env var that points
 * the probe at it. The real location is under ~/.claude/plugins/, which a test
 * must never depend on — so the probe accepts PLOT_PLUGIN_ROOT as an override.
 */
function fakePlugin({ withArtifact = true, cacheVersions = [] } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'plugins-'));
  const dir = path.join(root, 'marketplaces', 'plot-marketplace',
    'skills', 'plot', 'scripts', 'board');
  if (withArtifact) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'board-server.mjs'), '// live artifact\n');
  }
  // Historical cache copies, as a real machine accumulates them. Measured
  // 2026-08-18: three artifacts coexisted, one of them two weeks stale.
  for (const v of cacheVersions) {
    const c = path.join(root, 'cache', 'plot-marketplace', 'plot', v,
      'skills', 'plot', 'scripts', 'board');
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(path.join(c, 'board-server.mjs'), `// cached ${v}\n`);
  }
  return root;
}

test('probe: finds the plugin artifact and names its source', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin();
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
  assert.ok(p.artifact.endsWith('board/board-server.mjs'));
  assert.ok(fs.existsSync(p.artifact));
});

test('probe: falls back to a checkout artifact when no plugin is present', () => {
  // A repo that IS a plot checkout: the artifact sits at its canonical path.
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const empty = fakePlugin({ withArtifact: false });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: empty } });
  assert.equal(p.artifact_source, 'checkout');
  assert.ok(p.artifact.endsWith('skills/plot/scripts/board/board-server.mjs'));
});

test('probe: reports none when no artifact exists anywhere', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const empty = fakePlugin({ withArtifact: false });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: empty, PLOT_NPM_BIN: '/nonexistent' } });
  assert.equal(p.artifact_source, 'none');
  assert.equal(p.artifact, '');
});

test('probe: prefers the plugin artifact over a checkout one', () => {
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin();
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
});

test('probe: picks the live marketplaces copy over stale cached versions', () => {
  // The regression this test exists for. MEASURED 2026-08-18: a normal machine
  // carried three artifacts — the live marketplaces copy plus 2.0.0 and 2.5.0
  // cache copies. The first implementation used `sort | tail -1`, which picks
  // the lexically-last PATH; it returned the right file only because
  // "marketplaces" sorts after "cache", and would have returned a stale build
  // under any layout where it did not.
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin({ cacheVersions: ['2.0.0', '2.5.0'] });
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(p.artifact_source, 'plugin');
  assert.match(p.artifact, /marketplaces/);
  assert.equal(fs.readFileSync(p.artifact, 'utf8').trim(), '// live artifact');
});

test('probe: version directories are not compared lexically', () => {
  // `2.10.0` < `2.5.0` as strings. With no marketplaces copy present the
  // fallback is newest-mtime, so the NEWER 2.10.0 build must win regardless of
  // how the two version strings sort.
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const plugins = fakePlugin({ withArtifact: false, cacheVersions: ['2.5.0', '2.10.0'] });
  const newer = path.join(plugins, 'cache', 'plot-marketplace', 'plot', '2.10.0',
    'skills', 'plot', 'scripts', 'board', 'board-server.mjs');
  const older = path.join(plugins, 'cache', 'plot-marketplace', 'plot', '2.5.0',
    'skills', 'plot', 'scripts', 'board', 'board-server.mjs');
  // Stamp mtimes explicitly — creation order must not be what the test relies on.
  fs.utimesSync(older, new Date('2026-08-01'), new Date('2026-08-01'));
  fs.utimesSync(newer, new Date('2026-08-18'), new Date('2026-08-18'));
  const p = probe(r, { env: { PLOT_PLUGIN_ROOT: plugins } });
  assert.equal(fs.readFileSync(p.artifact, 'utf8').trim(), '// cached 2.10.0');
});

test('probe: a host without a plugin directory falls through to checkout', () => {
  // Cursor has no ~/.claude/plugins. No host detection — the search finds
  // nothing and precedence carries on, which is why there is no branch to rot.
  const r = repoWith({
    'skills/plot/scripts/board/board-server.mjs': '// checkout artifact\n',
  }, { config: '- **Plan directory:** docs/plans/\n' });
  const p = probe(r, {
    env: { PLOT_PLUGIN_ROOT: path.join(tmp, 'does-not-exist'), PLOT_NPM_BIN: '/nonexistent' },
  });
  assert.equal(p.artifact_source, 'checkout');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: FAIL — the four new tests fail with
`Expected values to be strictly equal: 'none' !== 'plugin'`, because the probe
still hardcodes `"artifact_source": "none"`.

- [ ] **Step 3: Implement artifact resolution**

In `skills/plot/scripts/plot-board-probe.sh`, insert this block after the
`--- ci signals ---` section and before the final `cat <<JSON`:

```bash
# --- board artifact -----------------------------------------------------
# Precedence: plugin, then npm, then this checkout. The plugin wins because it
# tracks the installed plot version; npm 'latest' has lagged behind it.
# PLOT_PLUGIN_ROOT / PLOT_NPM_BIN exist so tests need not depend on $HOME.
#
# The plugin layout is Claude Code's. Cursor has no such directory, so the
# search simply finds nothing there and precedence falls through to npm —
# no host detection needed, and no branch that could rot.
artifact=""
artifact_source="none"

# mtime, portably: BSD/macOS `stat -f %m`, GNU/Linux `stat -c %Y`. Plot's CI
# runs on Linux, where `-f` is a DIFFERENT flag rather than an error, so the
# BSD form must be tried first and its failure used as the signal.
mtime() { stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null; }

plugin_root="${PLOT_PLUGIN_ROOT:-$HOME/.claude/plugins}"

# MEASURED 2026-08-18: this glob matched THREE artifacts on a normal machine —
# the live `marketplaces/` copy and two historical `cache/<version>/` copies,
# one of them a 2.0.0 build two weeks stale. `sort | tail -1` was the first
# attempt and it is wrong twice over: it picks the lexically-last PATH (right
# there only because `marketplaces` > `cache`), and version directories sort
# lexically, so `2.10.0` < `2.5.0`. It returned the correct file for reasons
# unrelated to what it claimed to check.
#
# So: `marketplaces/` explicitly, because that IS the installed copy and
# `cache/<version>/` is history. Newest mtime only as a fallback for layouts
# without it.
cand=$(find "$plugin_root/marketplaces" -type f -name 'board-server.mjs' -path '*/board/*' 2>/dev/null | head -1)
if [ -z "$cand" ]; then
  best=""; best_m=-1
  while IFS= read -r f; do
    m=$(mtime "$f"); [ -n "$m" ] || continue
    if [ "$m" -gt "$best_m" ]; then best_m="$m"; best="$f"; fi
  done < <(find "$plugin_root" -type f -name 'board-server.mjs' -path '*/board/*' 2>/dev/null)
  cand="$best"
fi
if [ -n "$cand" ] && [ -f "$cand" ]; then
  artifact="$cand"; artifact_source="plugin"
fi

if [ -z "$artifact" ]; then
  npm_bin="${PLOT_NPM_BIN:-}"
  if [ -z "$npm_bin" ] && command -v plot-board >/dev/null 2>&1; then
    npm_bin=$(command -v plot-board)
  fi
  if [ -n "$npm_bin" ] && [ -x "$npm_bin" ]; then
    artifact="$npm_bin"; artifact_source="npm"
  fi
fi

if [ -z "$artifact" ] && [ -n "$git_root" ] &&
   [ -f "$git_root/skills/plot/scripts/board/board-server.mjs" ]; then
  artifact="$git_root/skills/plot/scripts/board/board-server.mjs"
  artifact_source="checkout"
fi
```

Then replace the two placeholder lines in the JSON block:

```bash
  "artifact": "$(j "$artifact")",
  "artifact_source": "$artifact_source",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add skills/plot/scripts/plot-board-probe.sh test/reconcile/boardprobe.test.mjs
git commit -m "plot: resolve the board artifact in the probe

Precedence plugin > npm > checkout. The plugin wins because it tracks the
installed plot version, while npm 'latest' (0.3.0) currently lags the
plugin's shipped build.

PLOT_PLUGIN_ROOT and PLOT_NPM_BIN keep the tests off \$HOME."
```

---

## Task 3: Three-state CLI auth detection

The core of the probe, and the part that must not lie. See the two measured
facts in the Background section.

**Files:**
- Modify: `skills/plot/scripts/plot-board-probe.sh`
- Modify: `test/reconcile/boardprobe.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/reconcile/boardprobe.test.mjs`:

```javascript
/**
 * PATH-stub the three CLIs. `specs` maps a CLI name to {stdout, exit}; a name
 * that is omitted is simply absent from PATH, which is how the probe learns
 * `installed: false`. Mirrors stubHost() in test/e2e/helpers.mjs.
 */
function stubClis(specs) {
  const dir = fs.mkdtempSync(path.join(tmp, 'stub-'));
  for (const [name, { stdout = '', exit = 0 }] of Object.entries(specs)) {
    fs.writeFileSync(
      path.join(dir, name),
      `#!/usr/bin/env bash\ncat <<'STUBEOF'\n${stdout}\nSTUBEOF\nexit ${exit}\n`,
    );
    fs.chmodSync(path.join(dir, name), 0o755);
  }
  return dir;
}

/** PATH with ONLY the stub dir plus coreutils, so real CLIs cannot leak in. */
function isolatedPath(stubDir) {
  return { PATH: `${stubDir}:/usr/bin:/bin` };
}

test('probe: reports gh auth ok on the documented success output', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({
    gh: { stdout: 'github.com\n  ✓ Logged in to github.com account jwloka (keyring)' },
  });
  const p = probe(r, { env: isolatedPath(stub) });
  assert.equal(p.gh.installed, true);
  assert.equal(p.gh.auth, 'ok');
});

test('probe: reports gh auth failed on a nonzero exit', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({
    gh: { stdout: 'You are not logged into any GitHub hosts.', exit: 1 },
  });
  assert.equal(probe(r, { env: isolatedPath(stub) }).gh.auth, 'failed');
});

test('probe: reports bb auth ok on the documented success output', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({ bb: { stdout: 'Logged in as: Jan Wloka (jwloka)' } });
  const p = probe(r, { env: isolatedPath(stub) });
  assert.equal(p.bb.installed, true);
  assert.equal(p.bb.auth, 'ok');
});

test('probe: reports installed:false for a CLI absent from PATH', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({});
  const p = probe(r, { env: isolatedPath(stub) });
  assert.equal(p.gh.installed, false);
  assert.equal(p.bb.installed, false);
  assert.equal(p.jen.installed, false);
});

test('probe: reports unknown for output it does not recognise', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({ gh: { stdout: 'some future output nobody planned for' } });
  assert.equal(probe(r, { env: isolatedPath(stub) }).gh.auth, 'unknown');
});

// --- the jen cases, which are the reason auth is an enum ------------------

test('probe: jen reachable reads as ok', () => {
  const r = repoWith({}, {
    config: '- **Plan directory:** docs/plans/\n- **Jenkins instance:** apps\n',
  });
  const stub = stubClis({
    jen: {
      stdout: [
        'Keycloak:      signed in',
        'Instance:      apps (https://example.invalid)',
        'Jenkins token: present',
        'Jenkins auth:  reachable',
      ].join('\n'),
    },
  });
  const p = probe(r, { env: isolatedPath(stub) });
  assert.equal(p.jen.installed, true);
  assert.equal(p.jen.instance, 'apps');
  assert.equal(p.jen.auth, 'ok');
});

test('probe: jen NOT reachable reads as failed even though it exits 0', () => {
  // MEASURED 2026-08-18: `jen -I <slug> auth status` exits 0 and prints
  // "Keycloak: signed in" for a slug that does not exist. Only the last line
  // distinguishes reachable from not — the exit code cannot.
  const r = repoWith({}, {
    config: '- **Plan directory:** docs/plans/\n- **Jenkins instance:** apps\n',
  });
  const stub = stubClis({
    jen: {
      stdout: [
        'Keycloak:      signed in',
        'Instance:      apps (https://example.invalid)',
        'Jenkins token: none',
        'Jenkins auth:  NOT reachable',
      ].join('\n'),
      exit: 0,
    },
  });
  assert.equal(probe(r, { env: isolatedPath(stub) }).jen.auth, 'failed');
});

test('probe: jen without a configured instance is unknown, never ok', () => {
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({
    jen: { stdout: 'error: no Jenkins instance — pass -I <slug|url>', exit: 1 },
  });
  const p = probe(r, { env: isolatedPath(stub) });
  assert.equal(p.jen.installed, true);
  assert.equal(p.jen.instance, '');
  assert.equal(p.jen.auth, 'unknown');
});

test('probe: "signed in" alone never reads as ok', () => {
  // The guard against the measured trap: Keycloak sign-in is a DIFFERENT
  // question from Jenkins reachability, and only the latter is the answer.
  const r = repoWith({}, {
    config: '- **Plan directory:** docs/plans/\n- **Jenkins instance:** apps\n',
  });
  const stub = stubClis({ jen: { stdout: 'Keycloak:      signed in' } });
  assert.notEqual(probe(r, { env: isolatedPath(stub) }).jen.auth, 'ok');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: FAIL — the nine new tests fail, because the probe still hardcodes
`{"installed": false, "auth": "unknown"}` for all three CLIs.

- [ ] **Step 3: Implement auth detection**

In `skills/plot/scripts/plot-board-probe.sh`, insert after the
`--- board artifact ---` block:

```bash
# --- CLI auth -----------------------------------------------------------
# THREE STATES, NOT TWO. An unrecognised output is "unknown" — *cannot
# verify* — and never "ok". A blocklist of known-bad phrasings would go stale
# into silence; an allowlist of known-good ones goes stale into noise, and
# noise is the direction that gets investigated.
#
# The regexes below match UNDOCUMENTED CLI output, MEASURED 2026-08-18 against
# gh 2.x, bb, and jen. Upstream may reword any of them without notice; when
# that happens the state degrades to "unknown" (cannot verify) rather than to
# "ok", so drift surfaces as a visible question rather than a false green.
# Re-measure and update the date if you touch these.
#
# The exit code alone decides nothing for jen: measured 2026-08-18,
# `jen -I <slug> auth status` exits 0 and prints "Keycloak: signed in" for a
# slug that does not exist, because the slug expands into a URL pattern
# without being reached. Only the `Jenkins auth:` line carries the answer.

cli_installed() { command -v "$1" >/dev/null 2>&1 && echo true || echo false; }

# $1 = command output, $2 = exit status, $3 = success regex
classify() {
  local out="$1" status="$2" ok_re="$3"
  if printf '%s' "$out" | grep -qiE "$ok_re"; then echo ok
  elif [ "$status" -ne 0 ]; then echo failed
  else echo unknown
  fi
}

gh_installed=$(cli_installed gh); gh_auth="unknown"
if [ "$gh_installed" = true ]; then
  out=$(gh auth status 2>&1); st=$?
  gh_auth=$(classify "$out" "$st" 'logged in to')
fi

bb_installed=$(cli_installed bb); bb_auth="unknown"
if [ "$bb_installed" = true ]; then
  out=$(bb auth status 2>&1); st=$?
  bb_auth=$(classify "$out" "$st" 'logged in as')
fi

jen_installed=$(cli_installed jen); jen_auth="unknown"
jen_instance=$(bash "$here/plot-config.sh" get "Jenkins instance" "" 2>/dev/null || echo "")
[ -n "$jen_instance" ] || jen_instance="${JENKINS_INSTANCE:-}"
if [ "$jen_installed" = true ]; then
  if [ -n "$jen_instance" ]; then
    out=$(jen -I "$jen_instance" auth status 2>&1); st=$?
    # `NOT reachable` must be tested BEFORE `reachable`, since it contains it.
    if printf '%s' "$out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
      jen_auth="failed"
    else
      jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
    fi
  else
    # No instance means the only runnable form is the one that verifies
    # nothing. Report that we cannot tell, never that it is fine.
    jen_auth="unknown"
  fi
fi
```

Then replace the three placeholder lines in the JSON block:

```bash
  "gh":  {"installed": $gh_installed, "auth": "$gh_auth"},
  "bb":  {"installed": $bb_installed, "auth": "$bb_auth"},
  "jen": {"installed": $jen_installed, "auth": "$jen_auth", "instance": "$(j "$jen_instance")"},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/reconcile/boardprobe.test.mjs`

Expected: PASS — 18 tests passing.

- [ ] **Step 5: Run the whole reconcile suite for regressions**

Run: `pnpm run test:reconcile`

Expected: PASS — every existing test still green. This probe adds a file and
touches no existing script, so any failure here is a real regression.

- [ ] **Step 6: Commit**

```bash
git add skills/plot/scripts/plot-board-probe.sh test/reconcile/boardprobe.test.mjs
git commit -m "plot: three-state CLI auth detection in the board probe

ok | failed | unknown, never a boolean. Unrecognised output reads as
'cannot verify', never as authenticated — the failure direction
plot-host.sh adopted after the 2026-08-17 503 afternoon.

The exit code cannot decide jen: measured 2026-08-18, 'jen -I <slug> auth
status' exits 0 and prints 'Keycloak: signed in' for a slug that does not
exist, because the slug expands into a URL pattern without being reached.
Only the 'Jenkins auth:' line answers, and NOT reachable is matched before
reachable because it contains it."
```

---

## Task 4: The verify script — a trap, not a promise

Step 4b starts a real server. "Always stop it, including when an assertion
fails" is a prose MUST in a SKILL.md, and `CLAUDE.md`'s *Gates Over Rules*
section is explicit that such instructions eventually get violated. The test —
*can you answer "did I complete this?" without doing the work?* — says this is a
rule. `trap cleanup EXIT` makes it a gate: the shell reaps the process no matter
how the script exits.

**Files:**
- Create: `skills/plot/scripts/plot-board-verify.sh`
- Create: `test/reconcile/boardverify.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/reconcile/boardverify.test.mjs`:

```javascript
// Contract test for skills/plot/scripts/plot-board-verify.sh — the evidence
// half of /plot-board-setup. It starts the board, fetches /api/board, and
// reaps the server.
//
// The RESOURCE GUARANTEE is the point: a verification step that leaks a node
// process on the failure path is worse than no verification, because the leak
// is invisible until the machine runs out of ports or memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const verify = path.join(
  here, '..', '..', 'skills', 'plot', 'scripts', 'plot-board-verify.sh',
);

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-boardverify-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/**
 * A stand-in for the board artifact: a real node HTTP server that prints the
 * same "Plot board: http://localhost:<port>" line the artifact prints, so the
 * script's port discovery is exercised for real rather than stubbed.
 */
function fakeArtifact({ payload = '{"columns":[]}', hang = false } = {}) {
  const f = path.join(tmp, `artifact-${Math.abs(payload.length + (hang ? 1 : 0))}-${fs.mkdtempSync(path.join(tmp, 'a-')).slice(-6)}.mjs`);
  fs.writeFileSync(f, `
import http from 'node:http';
const server = http.createServer((req, res) => {
  ${hang ? '' : `if (req.url === '/api/board') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(${JSON.stringify(payload)});
    return;
  }`}
  res.writeHead(404); res.end('nope');
});
server.listen(Number(process.env.PORT ?? 0), 'localhost', () => {
  console.log('Plot board: http://localhost:' + server.address().port);
});
`);
  return f;
}

function run(artifact, cwd) {
  try {
    return { status: 0, out: execFileSync('bash', [verify, artifact], {
      encoding: 'utf8', cwd, timeout: 30000,
    }) };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

/** Every node process whose command line mentions the given artifact path. */
function survivors(artifact) {
  try {
    return execFileSync('pgrep', ['-f', path.basename(artifact)], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

test('verify: prints the board payload it fetched', () => {
  const a = fakeArtifact({ payload: '{"columns":[{"phase":"Draft","cards":[]}]}' });
  const r = run(a, tmp);
  assert.equal(r.status, 0);
  assert.match(r.out, /"phase":"Draft"/);
});

test('verify: leaves no server behind on success', () => {
  const a = fakeArtifact();
  run(a, tmp);
  assert.deepEqual(survivors(a), []);
});

test('verify: leaves no server behind when the fetch fails', () => {
  // The failure path is the one prose forgets. This artifact serves 404 on
  // /api/board, so the script must exit nonzero AND still reap.
  const a = fakeArtifact({ hang: true });
  const r = run(a, tmp);
  assert.notEqual(r.status, 0);
  assert.deepEqual(survivors(a), []);
});

test('verify: exits nonzero when the artifact path does not exist', () => {
  const r = run(path.join(tmp, 'no-such-artifact.mjs'), tmp);
  assert.notEqual(r.status, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/reconcile/boardverify.test.mjs`

Expected: FAIL — all four tests error, because `plot-board-verify.sh` does not
exist.

- [ ] **Step 3: Write the verify script**

Create `skills/plot/scripts/plot-board-verify.sh`:

```bash
#!/usr/bin/env bash
# Plot helper: start the board, fetch its data, stop it.
# Usage: plot-board-verify.sh <artifact path>
# Output: the /api/board payload on stdout. Exit 0 only if it was fetched.
#
# THE TEARDOWN IS WHY THIS IS A SCRIPT. The sequence is short enough to write
# into a skill as prose, and CLAUDE.md's `Gates Over Rules` explains why that
# would be wrong: "always stop the server" is a rule an agent can believe it
# followed. `trap cleanup EXIT` is a gate — the shell reaps the process on
# every exit path, including the assertion failures that prose forgets.
#
# PORT=0 asks the OS for a free port, so a verification run can never collide
# with a board the user already has open on 7777.
set -uo pipefail

artifact="${1:?Usage: plot-board-verify.sh <artifact path>}"
[ -f "$artifact" ] || { echo "plot-board-verify: no artifact at $artifact" >&2; exit 1; }

pid=""
tmpout=""
cleanup() {
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
  [ -n "${tmpout:-}" ] && rm -f "$tmpout"
  return 0
}
trap cleanup EXIT INT TERM

tmpout=$(mktemp)
PORT=0 node "$artifact" > "$tmpout" 2>&1 &
pid=$!

# The server prints its bound URL once listening. Poll for that line rather
# than sleeping a guessed interval: a fixed sleep is either flaky or slow.
port=""
for _ in $(seq 1 100); do
  port=$(grep -oE 'localhost:[0-9]+' "$tmpout" 2>/dev/null | head -1 | cut -d: -f2)
  [ -n "$port" ] && break
  kill -0 "$pid" 2>/dev/null || { echo "plot-board-verify: server exited early" >&2; cat "$tmpout" >&2; exit 1; }
  sleep 0.1
done
[ -n "$port" ] || { echo "plot-board-verify: server never reported a port" >&2; cat "$tmpout" >&2; exit 1; }

body=$(curl -sf --max-time 10 "http://localhost:${port}/api/board") || {
  echo "plot-board-verify: /api/board did not answer on port ${port}" >&2
  exit 1
}
printf '%s\n' "$body"
```

Make it executable:

```bash
chmod +x skills/plot/scripts/plot-board-verify.sh
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/reconcile/boardverify.test.mjs`

Expected: PASS — 4 tests passing, including both no-leak assertions.

- [ ] **Step 5: Prove the leak guarantee against the real artifact**

```bash
before=$(pgrep -fc board-server.mjs || echo 0)
bash skills/plot/scripts/plot-board-verify.sh skills/plot/scripts/board/board-server.mjs | head -c 200
after=$(pgrep -fc board-server.mjs || echo 0)
echo; echo "board processes before=$before after=$after"
```

Expected: a JSON payload, and `before` equal to `after`.

- [ ] **Step 6: Commit**

```bash
git add skills/plot/scripts/plot-board-verify.sh test/reconcile/boardverify.test.mjs
git commit -m "plot: board verification as a trap-guarded script

Starts the board on an OS-assigned port, fetches /api/board, reaps the
server via trap on EXIT/INT/TERM.

The teardown is why this is a script and not skill prose. 'Always stop the
server' is a rule an agent can believe it followed; the trap is a gate the
shell enforces on every exit path — including the assertion failures that
prose forgets. Tested on both the success and the failure path."
```

---

## Task 5: The skill

**Files:**
- Create: `skills/plot-board-setup/SKILL.md`
- Create: `skills/plot-board-setup/README.md`

- [ ] **Step 1: Write SKILL.md**

Create `skills/plot-board-setup/SKILL.md`:

````markdown
---
name: plot-board-setup
description: >-
  Set the Plot board up in a project that already has Plot: probe the
  prerequisites, record the git-host and CI configuration, then start the
  board and prove it serves. Use on /plot-board-setup.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.1.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git, bash, curl, and Node
  >= 20. Git-host and CI CLIs are optional — the board works without any of
  them. The plugin start route is Claude Code-specific; on Cursor the probe
  finds no plugin directory and falls through to the npm or checkout route.
---

# Plot: Board Setup

The board reads the **current working directory**, not its own location, so it
runs in any repository without installation. What a project actually needs is
the configuration around it, and evidence that it works.

**The guiding rule: prove, don't assert.** A board that boots and serves valid
JSON can still show nothing — a plan in the wrong format parses as
`format: none` and vanishes silently. Checking that the port responds would
pass that case. So this command starts the board, fetches its data, and checks
the cards.

**Input:** `$ARGUMENTS` is optional; `--dry-run` reports what would be written
and changes nothing.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Probe | Small | One script call, JSON out |
| 2. Propose and confirm | Mid | Turning signals into a proposal is judgment |
| 3. Write config | Small | Append known keys to a known section |
| 4. Verify | Small | Run commands, compare to documented output shapes |
| 5. Diagnose an empty board | Mid | Mapping a parse failure to a human cause |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

## Steps

### 1. Probe

```bash
../plot/scripts/plot-board-probe.sh
```

Read-only. It reports the Node version, whether the CWD is the repo root, where
a board artifact lives, whether a `## Plot Config` exists, how many plan files
there are, the configured git host, and the install/auth state of `gh`, `bb`,
and `jen`.

**If `has_plot_config` is false, stop.** Board setup presupposes adoption —
point at `/plot-init` and do not re-implement it here.

**If `artifact_source` is `none`, stop** and report both routes:

- the Plot plugin (nothing to install if Plot is already a plugin), or
- `npx @plot-pm/board`

### 2. Propose, then confirm

Present one block the user corrects rather than composes:

> Detected: Node 24 · git root is the CWD · plugin artifact · `docs/plans/`
> with 7 plans · host `github`, `gh` authenticated · `jen` installed,
> `Jenkinsfile` present, Jenkins token missing.
>
> Proposed: start via the plugin artifact with a `plot-board` alias. Add
> `CI: jenkins` and `Jenkins instance: apps` to Plot Config.

Ask only what the probe could not answer:

- **The Jenkins instance** — when `jen` is installed, `ci_signals.jenkinsfile`
  is true, and no instance resolved from config or `JENKINS_INSTANCE`.
- **Alias or project script** — a shared repo may prefer a `package.json`
  script. **Default when unasked: print an alias and write nothing**, because an
  alias touches no tracked file and so cannot surprise a shared repository.

Do not ask about anything the probe answered confidently. A user asked to
confirm their own git host learns that the tool is not paying attention.

### 3. Write the config

Append only the **missing** keys to the hub doc's `## Plot Config`, never
replacing existing content:

```markdown
- **Git host:** github
- **CI:** jenkins
- **Jenkins instance:** apps
```

`Git host` is read by `plot-host.sh` and may already be set by `/plot-init`;
write it only when absent.

`CI` and `Jenkins instance` are new keys. **Say plainly that the board does not
yet render Jenkins status** — they are recorded and verified, and a board
consumer is separate work. Claiming a rendering that does not exist is the
failure this whole command is built to avoid.

Then hand over the start command:

```bash
alias plot-board='node <artifact path from the probe>'
```

### 4. Verify — the gate

**4a. Auth.** For each installed CLI, report the probe's `auth` value:

| State | Report |
|---|---|
| `ok` | authenticated |
| `failed` | not authenticated — name the exact fix, e.g. `jen -I apps auth login` |
| `unknown` | **cannot verify** — say so; never round it up to authenticated |

**Never run an interactive login.** These are browser-based device flows. Name
the command and let the user run it — in Claude Code, suggest they type it with
a `!` prefix so the output lands in the session.

**Auth failure is never a hard stop.** The board is useful with no host auth at
all: plans come from git, and only PR/CI enrichment degrades.

**4b. The board boots and serves.** One call, which starts the board on an
OS-assigned port, fetches the data, and reaps the server on every exit path:

```bash
../plot/scripts/plot-board-verify.sh <artifact path from the probe>
```

It prints the `/api/board` payload on success and exits nonzero otherwise.
`PORT=0` means a verification run can never collide with a board the user
already has open.

Assert the response parses as JSON and carries a non-empty `columns` array,
each entry having a `phase` and a `cards` array.

**Do not assert specific column names.** They are the board's own display
pipeline, not the plan phases, and they have already changed once: an older
plugin build served `Draft / Approved / Delivered / Released`, while the build
in this checkout serves `Discovery / Design / Development / Endgame /
Released`. A gate naming those strings would fail on a healthy board every
time the pipeline is renamed — reporting a broken board when the board is
fine, which is the exact confusion this command exists to remove.

The script guarantees the teardown, so nothing here has to remember it.

**4c. Cards are non-zero.** If every column is empty while `plan_files > 0`,
the board is serving and seeing nothing. Run the plan-format contract script on
each plan file:

```bash
../plot/scripts/plot-plan-meta.sh <plan file>
```

Report which files came back `"format":"none"` or `"phase":"NONE"`, and why:

> 3 of 7 plans parsed as `format: none`:
> `docs/plans/foo.md`, `docs/plans/bar.md`, `docs/plans/baz.md`
> — expected `- **Phase:** Draft` as a list item under `## Status`.

**Report only. Never rewrite the user's plans** — adoption is additive, and an
unrequested edit to a plan is exactly the kind of write Plot does not do.

### 5. Summarise

State what landed, the start command, and every remediation command still
outstanding. If anything reads `unknown`, say which check could not be
completed rather than presenting a clean bill of health.

## Failure modes

| Condition | Response |
|---|---|
| No `## Plot Config` | Stop; point at `/plot-init` |
| No artifact anywhere | Stop; report the plugin and npm routes |
| Node < 20 | Report the requirement, still write config, skip 4b |
| CWD is not the repo root | Warn prominently — the board compares realpaths, and branch-staged plans silently vanish otherwise |
| A CLI is absent | Skip its check; absence is not failure |
| Auth output unrecognised | Report *cannot verify*; never authenticated |
| `/api/board` is not JSON | Report the raw response; do not retry silently |
| Zero cards, zero plans | Not an error — an empty project |
````

- [ ] **Step 2: Verify the skill parses**

Run: `pnpm test`

Expected: PASS — the skills validator lists `plot-board-setup` among the parsed
skills. A frontmatter error fails here with the offending file named.

- [ ] **Step 3: Write README.md**

Create `skills/plot-board-setup/README.md`:

```markdown
# plot-board-setup — developer notes

Board adoption for a project that already has Plot. `SKILL.md` is the
agent-facing instruction; this file is why it looks the way it does.

Design spec: `docs/superpowers/specs/2026-08-18-plot-board-setup-design.md`

## Split: skill vs script

Per Manifesto Principle 3 — *skills interpret and adapt; scripts collect and
report*:

| Layer | Responsibility |
|-------|----------------|
| `skills/plot/scripts/plot-board-probe.sh` | Facts only. Node version, repo shape, artifact location, config presence, plan count, CLI auth states. Decides nothing. |
| `skills/plot-board-setup/SKILL.md` | Judgment. Which artifact to recommend, whether Jenkins keys are warranted, what an empty board means, what to tell the user. |

## Why the gate asserts cards, not HTTP 200

Measured 2026-08-18: a plan file written with a bare `**Phase:** Draft` line
instead of the list item `- **Phase:** Draft` parses as `format: "none"`. The
board then boots, serves valid JSON, and renders **zero cards**. At the browser
this is indistinguishable from a broken board, and a port-responds check passes
it cleanly.

So step 4b asserts the payload's shape and 4c asserts it is not empty — and
when it is empty, `plot-plan-meta.sh` names the offending files. Manifesto
Principle 12: a gate is satisfied by the artifact that proves it, never by the
claim that it holds.

## Why auth has three states

`ok | failed | unknown`, never a boolean. An unrecognised output means *cannot
verify*, and rounding that up to *authenticated* is the failure `plot-host.sh`
documents from the 2026-08-17 GitHub 503 afternoon, when every branch read as
having no PR. Being wrong in the reassuring direction is the worst way to be
wrong, because nobody investigates a green light.

`jen` forced the issue. Measured 2026-08-18:

    $ jen -I nonexistent-xyz auth status
    Keycloak:      signed in
    Instance:      nonexistent-xyz (https://…)
    Jenkins token: none
    Jenkins auth:  NOT reachable
    $ echo $?
    0

A bogus slug expands into a URL pattern without ever being reached, so the
output looks healthy at a glance and the exit code says nothing. Only the
`Jenkins auth:` line answers the question — and `NOT reachable` must be tested
before `reachable`, since it contains it.

## Why the Jenkins keys are not inert

`CI` and `Jenkins instance` are written before any board consumer reads them,
which normally fails Manifesto question 5 (*would removing it lose something
essential?*). They survive it because **the skill reads them back**:
`Jenkins instance` is the required `-I` argument to the only auth check that
verifies anything. Without the key, the sole runnable form of the check is the
one that exits 1 and proves nothing.

The board does not render Jenkins status, and the skill says so rather than
implying a consumer that does not exist.

## Project-agnostic constraint

Manifesto Principle 5: Plot hardcodes no project names, paths, or hosts. `jen`
is treated as *a* Jenkins CLI the probe may detect, and the config keys describe
*any* Jenkins. A project with a different Jenkins CLI records the same keys; only
the detection of this one is specific, and its absence degrades to
`installed: false`.

## Known gaps

- **Step 4c only fires when the board is entirely empty.** A project where 3 of
  7 plans are malformed shows 4 cards, looks healthy, and is never diagnosed.
  Making the check unconditional would catch partial breakage, at the cost of a
  `plot-plan-meta.sh` call per plan on every run.
- **`CI` is a single key.** A project on GitHub Actions or GitLab CI would want
  the same key with a differently-named companion. Generalising to
  `CI instance:` was considered and deferred until a second CI system exists.
- **npm `latest` lags the plugin.** `@plot-pm/board` publishes 0.3.0 as
  `latest` while the plugin ships a newer build, which is why artifact
  precedence puts the plugin first.
```

- [ ] **Step 4: Verify both files are in place and the suite is green**

Run: `pnpm test && ls skills/plot-board-setup/`

Expected: PASS, and the listing shows `README.md` and `SKILL.md`.

- [ ] **Step 5: Commit**

```bash
git add skills/plot-board-setup/
git commit -m "plot-board-setup: add the board adoption spoke

Five steps: probe, propose, write config, verify, summarise. The verify
step starts the board on an OS-assigned port, fetches /api/board, and
asserts the cards are non-empty — because a plan in the wrong format
yields a board that boots, serves valid JSON, and shows nothing.

Auth is reported as ok/failed/unknown, and unknown is stated as 'cannot
verify' rather than rounded up. Interactive logins are named, never run."
```

---

## Task 6: Documentation and changeset

Plot keeps four indexes in sync by hand. All four are updated here, in one
commit, so a reader never meets a half-registered skill.

**Files:**
- Modify: `skills/plot/scripts/plot-config.sh` (header comment only)
- Modify: `skills/plot-init/SKILL.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Create: `.changeset/20260818-plot-board-setup.md`

- [ ] **Step 1: Document the new keys in plot-config.sh**

In `skills/plot/scripts/plot-config.sh`, find the comment block listing the
Plot 2 posture keys and add two lines directly beneath the `Git host` line:

```bash
#   CI                  jenkins | github-actions | none — which CI system this
#                       project uses. Recorded by /plot-board-setup; not yet
#                       read by the board.
#   Jenkins instance    the slug or URL passed to a Jenkins CLI's -I flag.
#                       Read back by /plot-board-setup to verify auth against
#                       the right instance — without it the only runnable
#                       check verifies nothing.
```

This is a comment-only change. `plot-config.sh` reads arbitrary keys already,
so no logic changes.

- [ ] **Step 2: Verify no behaviour changed**

Run: `pnpm run test:reconcile`

Expected: PASS — `config.test.mjs` still green, confirming the comment edit
altered nothing.

- [ ] **Step 3: Add the plot-init extension row**

In `skills/plot-init/SKILL.md`, in the step-4 table ("Offer extensions — only
what the repo shows it needs"), add this row at the end:

```markdown
| Repo has a plan directory with plans in it | `/plot-board-setup` — a local Kanban view of those plans | The board is first-class and gated in the Definition of Done, but nothing else in adoption mentions it |
```

- [ ] **Step 4: Update the CLAUDE.md tables**

In `CLAUDE.md`, add to the Architecture table after the `plot-init` row:

```markdown
| Command | `plot-board-setup/` | Set the board up in a project that has Plot: probe prerequisites, record git-host and CI config, then start the board and prove it serves |
```

And to the Helper Scripts table, after the `plot-detect-repo.sh` row:

```markdown
| `plot-board-probe.sh` | Read-only board-readiness probe → JSON (node version, repo shape, artifact location, config presence, plan count, `gh`/`bb`/`jen` auth). Auth is `ok`/`failed`/`unknown` — an unrecognised output reads as *cannot verify*, never as authenticated |
| `plot-board-verify.sh` | Starts the board on an OS-assigned port, fetches `/api/board`, prints the payload, and reaps the server via `trap`. A script rather than skill prose *because* of the teardown: "always stop the server" is a rule an agent can believe it followed; the trap is a gate the shell enforces on every exit path |
```

- [ ] **Step 5: Update the root README skills table**

In `README.md`, add after the `plot-init` row:

```markdown
| [plot-board-setup](skills/plot-board-setup/) | Set up the local Kanban board — checks prerequisites, records config, proves it serves |
```

- [ ] **Step 6: Write the changeset**

Create `.changeset/20260818-plot-board-setup.md`:

```markdown
---
"plot": minor
---

plot-board-setup: a board adoption spoke

The board runs in any repository already — it reads the CWD, not its own
location. What was missing was everything around that: no adoption path
(plot-init never mentioned it), no start route for other projects, and no way
to tell a working board from a broken one.

The verify gate asserts the cards, not the port. A plan written with a bare
`**Phase:** Draft` line instead of the list item parses as `format: none`, and
the board then boots, serves valid JSON, and renders nothing — indistinguishable
at the browser from a broken board, and passed cleanly by an HTTP 200 check.
When the board comes back empty, plot-plan-meta.sh names the offending files.

CLI auth is reported as ok/failed/unknown rather than a boolean. `jen -I <slug>
auth status` exits 0 and prints "Keycloak: signed in" for a slug that does not
exist, because the slug expands into a URL pattern without being reached; only
the `Jenkins auth:` line answers, and an unrecognised output reads as *cannot
verify* rather than authenticated.

The board is started by a script rather than by skill prose, because the
teardown must be guaranteed rather than remembered: `trap cleanup EXIT` reaps
the server on the failure paths where an instruction would be forgotten.

Artifact selection prefers the live `marketplaces/` copy and falls back to
newest mtime. A machine carries several artifacts — one measured setup had
three, including a build two weeks stale — and lexical path order picks among
them by accident.

Jenkins is recorded and verified, not rendered — the `CI` and `Jenkins instance`
keys are read back by the skill to check auth against the right instance, and
the skill says plainly that the board does not yet display Jenkins status.

<!--
bumps:
  skills:
    plot-board-setup: minor
    plot-init: patch
    plot: patch
-->
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test && pnpm run test:reconcile && pnpm run test:e2e`

Expected: PASS on all three. The board is untouched by this plan, so
`test:board` is unaffected — but run it too, since the Definition of Done gates
it:

Run: `pnpm run test:board`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/plot/scripts/plot-config.sh skills/plot-init/SKILL.md \
        CLAUDE.md README.md .changeset/20260818-plot-board-setup.md
git commit -m "docs: register plot-board-setup in the four indexes

Architecture and Helper Scripts tables, the root skills table, and
plot-init's extension offers — which never mentioned the board despite it
being gated in the Definition of Done.

plot-config.sh documents the two new keys in its header; it reads
arbitrary keys already, so nothing else changed."
```

---

## Task 7: End-to-end verification

The plan's own Definition of Done. Nothing here is a code change — it is the
evidence that the previous five tasks work together.

**Files:** none modified.

- [ ] **Step 1: Verify the probe runs clean in this repo**

Run: `bash skills/plot/scripts/plot-board-probe.sh | python3 -m json.tool`

Expected: valid JSON. In the plot checkout specifically, expect
`has_plot_config: true`, `cwd_is_root: true`, a non-zero `plan_files`, and an
`artifact_source` of `plugin` or `checkout`.

- [ ] **Step 2: Verify the probe changed nothing**

Run: `git status --porcelain`

Expected: empty output (or only your intended commits' worth of changes).
A probe that dirties the tree fails its own contract.

- [ ] **Step 3: Exercise the verify gate by hand, in a sandbox with a good plan**

```bash
SB=$(mktemp -d)
cd "$SB" && git init -q -b main
git config user.email t@t.invalid && git config user.name t
mkdir -p docs/plans
printf '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' > CLAUDE.md
printf '# Sample plan\n\n## Status\n\n- **Phase:** Draft\n- **Type:** feature\n' \
  > docs/plans/2026-08-18-sample.md
git add -A && git commit -qm init
bash <plot scripts dir>/plot-board-verify.sh <artifact path> | python3 -m json.tool | head -30
```

Expected: exactly one card, carrying `"slug": "sample"`, in whichever column
the build maps a Draft plan to. **Read the column out of the payload rather
than expecting a name** — the checkout build calls it `Discovery`, an older
plugin build called it `Draft`, and both are healthy boards.

Then confirm nothing leaked:

```bash
pgrep -f board-server.mjs || echo "no board processes left"
```

- [ ] **Step 4: Exercise the empty-board diagnosis**

In the same sandbox, break the plan's format — a bare bold line instead of a
list item:

```bash
printf '# Sample plan\n\n## Status\n\n**Phase:** Draft\n' \
  > docs/plans/2026-08-18-sample.md
bash <plot scripts dir>/plot-plan-meta.sh docs/plans/2026-08-18-sample.md
```

Expected: `"format":"none"` and `"phase":"NONE"` in the JSON. This is the
signal step 4c reports, and confirms the diagnosis path has something real to
key on.

Clean up: `trash "$SB"`

- [ ] **Step 5: Confirm the skill is discoverable**

Run: `pnpm test 2>&1 | grep -i board-setup`

Expected: `plot-board-setup` appears in the validated skills list.

- [ ] **Step 6: Final full-suite run**

Run: `pnpm test && pnpm run test:reconcile && pnpm run test:e2e && pnpm run test:board`

Expected: PASS on all four.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "plot-board-setup: a board adoption spoke" --body "$(cat <<'EOF'
## What

Adds `/plot-board-setup`, a spoke that takes a project from "has Plot" to
"has a working board": it probes prerequisites, records the git-host and CI
config, then starts the board and proves it serves.

Design spec: `docs/superpowers/specs/2026-08-18-plot-board-setup-design.md`

## Why the gate asserts cards, not HTTP 200

A plan written with a bare `**Phase:** Draft` line instead of the list item
parses as `format: none`. The board then boots, serves valid JSON, and renders
zero cards — indistinguishable at the browser from a broken board, and passed
cleanly by a port-responds check. When the board comes back empty,
`plot-plan-meta.sh` names the offending files.

## Why auth is a three-state enum

`jen -I <slug> auth status` exits 0 and prints `Keycloak: signed in` for a slug
that does not exist, because the slug expands into a URL pattern without ever
being reached. Only the `Jenkins auth:` line answers. Unrecognised output reads
as *cannot verify*, never as authenticated — the failure direction
`plot-host.sh` adopted after the 2026-08-17 GitHub 503 afternoon.

## Scope

Jenkins is recorded and verified, **not rendered**. Teaching the board to
display Jenkins status would touch `plot-host.sh`, `fleet.ts`, and the board
UI; this PR touches no board source, so no artifact rebuild is involved.

## Testing

- 18 new contract tests in `test/reconcile/boardprobe.test.mjs`
- `pnpm test`, `test:reconcile`, `test:e2e`, `test:board` all green
- Verify gate exercised by hand in a sandbox repo, both good and malformed plans

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: the probe's JSON shape →
Task 1; artifact resolution → Task 2; the measured CLI table and three-state
auth → Task 3; the verify gate's resource guarantee → Task 4; the five skill
steps, error table, and Model Guidance → Task 5; config keys, deliverables
table, and the project-agnostic constraint → Tasks 5 and 6; the testing section
→ Tasks 1–4 and 7.

**Three defects were found by executing this plan's own logic before writing
it down**, each of which read as correct:

1. **`find … | sort | tail -1` picked the lexically-last path, not the newest
   artifact.** A real machine carried three artifacts, one a 2.0.0 build two
   weeks stale. It returned the right file only because `marketplaces` sorts
   after `cache`. Demonstrated: with `2.5.0` and `2.10.0` present, the old
   logic selects the *stale* 2.5.0 (version strings sort lexically) while the
   fix selects 2.10.0.
2. **`stat -f` is BSD-only.** The first fix used it unguarded; on Linux CI
   `-f` is a different flag entirely, so the fallback had to try BSD first and
   use its failure as the signal.
3. **The verify gate asserted the wrong vocabulary.** It named the four *plan*
   phases, but `/api/board` returns the board's five-stage *display* pipeline
   (`Discovery / Design / Development / Endgame / Released`). An older plugin
   build really did serve the four-name form, which is how the mistake got in —
   and is exactly why the gate now asserts the payload's shape rather than its
   labels.

**Deliberate deviation from the spec.** The spec's testing section proposed
sandbox tests in the `test/e2e/` style. This plan puts them in
`test/reconcile/` instead, because they test one script against fixtures —
which is exactly what that directory holds — while `test/e2e/` is reserved for
multi-script choreography. Task 6 covers the end-to-end path manually, which
matches how the repo already treats skill behaviour ("behavioral testing is
manual").

**Two known gaps are recorded rather than closed**, both raised with the user
and deferred: step 4c fires only on a completely empty board (partial breakage
goes undiagnosed), and `CI` is a single key that a second CI system would want
generalised. Both live in the skill's README under "Known gaps" so the next
reader meets them.

---

## Open Questions

Raised during plan interrogation and deliberately left open. Each is recorded
in `skills/plot-board-setup/README.md` under "Known gaps" so the next reader
meets them rather than rediscovering them.

- [ ] [Domain] Should step 4c run unconditionally rather than only on a fully
  empty board? A project where 3 of 7 plans are malformed shows 4 cards, looks
  healthy, and is never diagnosed. Unconditional costs one `plot-plan-meta.sh`
  call per plan per run. — *deferred: revisit once someone hits partial breakage*
- [ ] [Domain] Should `CI` + `Jenkins instance` generalise to `CI` +
  `CI instance` before a second CI system exists? Verified 2026-08-18 that
  `plot-config.sh` parses both spellings and tolerates URL values, so this is a
  naming decision, not a technical constraint. — *deferred: until a
  GitHub-Actions or GitLab-CI project needs it*
- [ ] [Non-functional] Should npm `@plot-pm/board` `latest` be promoted past
  0.3.0? It currently lags the plugin build, which is why artifact precedence
  puts the plugin first. Not this plan's scope — it is a release decision. —
  *deferred: release owner's call*
- [x] [Technical] How should the probe choose among several installed
  artifacts? — *answered: prefer the live `marketplaces/` copy, fall back to
  newest mtime; lexical path order was measurably wrong*
- [x] [Technical] How is the verification server guaranteed to be reaped? —
  *answered: `trap cleanup EXIT INT TERM` in `plot-board-verify.sh`, tested on
  both the success and failure paths*
- [x] [Non-functional] What happens when a CLI reworded its auth output? —
  *answered: degrades to `unknown` = cannot verify, never to `ok`; regexes
  carry their measurement date*
- [x] [Technical] What does the board's `/api/board` actually return? —
  *answered: a five-stage display pipeline, not the four plan phases; the gate
  asserts payload shape, not column names*
