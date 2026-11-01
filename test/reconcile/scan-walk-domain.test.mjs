// Contract test for `PLOT_SCAN_WALK=domain` in `plot-fleet-scan.sh`: the five
// machine modes answer from `plot-scan-walk.mjs` and must equal the shell's own
// answers on the same sandbox.
//
// THE COMPARISON runs `--offline`, with no host token, no `PLOT_PR_LISTING` and
// no `PLOT_TERMINAL_CACHE`, and normalises both documents with
// `jq -S 'walk(... del(.changed_ago_seconds) ...)'`.
//
// THREE FIELDS ARE MASKED, and each names a reading the domain walk does not
// take yet: `conflicts_known`, `conflicts` and `changed_paths` (the shell
// computes them with `git merge-tree`; no port operation answers them), and
// `summary.merge_detect` (the domain walk reads no merge subjects). The masks
// are stated here so that a field that starts to differ for any other reason
// still fails.
//
// `--offline --next` STILL ASKS THE HOST on the domain path, as on the shell
// path: a stub `gh` records every call.
//
// The bundle is a build product. `pnpm build:board` writes it; a run without it
// fails with that instruction.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-fleet-scan.sh');
const bundle = path.join(scripts, 'board', 'plot-scan-walk.mjs');

const created = [];
process.on('exit', () => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tmpDir = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  created.push(dir);
  return dir;
};

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });
const MASKED = new Set(['conflicts_known', 'conflicts', 'changed_paths', 'changed_ago_seconds', 'changed_at', 'merge_detect']);
const normalise = (value) => {
  if (Array.isArray(value)) return value.map(normalise);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !MASKED.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, normalise(v)]));
};

let repo;
let ghLog;
let binDir;

const env = (walk) => {
  const e = { ...process.env, PLOT_SCAN_WALK: walk, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  for (const k of ['PLOT_REPO_ROOT', 'PLOT_UNATTENDED', 'PLOT_PR_LISTING', 'PLOT_TERMINAL_CACHE', 'GH_TOKEN', 'GITHUB_TOKEN']) delete e[k];
  return e;
};
const run = (walk, ...args) => spawnSync('bash', [scan, ...args], { encoding: 'utf8', cwd: repo, env: env(walk) });

before(() => {
  assert.ok(fs.existsSync(bundle), `${bundle} is missing: run \`pnpm build:board\` first`);
  const tmp = tmpDir('scanwalk');
  binDir = path.join(tmp, 'bin');
  ghLog = path.join(tmp, 'gh.log');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'gh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}\nprintf '[]'\n`, { mode: 0o755 });
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const write = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  write('CLAUDE.md', `# Fixture\n\n## Plot Config\n\n- **Git host:** github\n- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Delivered index:** plans/delivered/\n`);
  write('plans/2026-01-05-two-slices.md', `# Two slices\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n## Branches\n\n### First\n- \`feature/first-slice\` — the first\n\n### Second\n- \`feature/second-slice\` — the second <!-- waits: First -->\n`);
  write('plans/2026-01-06-taken.md', `# Taken\n\n## Status\n\n- **Phase:** Approved\n- **Type:** bug\n\n## Branches\n\n### Taken\n- \`bug/already-claimed\` — somebody has it <!-- claimed: 2026-01-05T09:00Z, session-1 -->\n`);
  write('plans/2026-01-07-needs-first.md', `# Cross-plan wait\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n## Branches\n\n### Later\n- \`feature/later\` — waits on another plan <!-- waits: First -->\n`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-qb', 'bug/already-claimed');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim bug/already-claimed');
  git(repo, 'push', '-q', '-u', 'origin', 'bug/already-claimed');
  git(repo, 'checkout', '-q', 'main');
});

const both = (...args) => ({ shell: run('shell', ...args), domain: run('domain', ...args) });

test('scan-walk: --json equals the shell, apart from the masked readings', () => {
  const { shell, domain } = both('--offline', '--json');
  assert.equal(domain.status, 0, domain.stderr);
  const a = JSON.parse(shell.stdout);
  const b = JSON.parse(domain.stdout);
  assert.ok(a.plans.length >= 3, 'the comparison saw the fixture plans');
  assert.deepEqual(normalise(b), normalise(a));
});

for (const flag of ['--next', '--list-eligible', '--why-nothing', '--slice-names']) {
  test(`scan-walk: ${flag} equals the shell`, () => {
    const { shell, domain } = both('--offline', flag);
    assert.equal(domain.stdout, shell.stdout);
    assert.equal(domain.status, shell.status);
    const note = (r) => r.stderr.split('\n').filter((l) => !l.startsWith('listing: ')).join('\n');
    assert.equal(note(domain), note(shell));
  });
}

test('scan-walk: a slug scopes the json document to that plan', () => {
  const { shell, domain } = both('--offline', '--json', 'taken');
  assert.deepEqual(normalise(JSON.parse(domain.stdout)), normalise(JSON.parse(shell.stdout)));
});

test('scan-walk: a bare slug answers the json document scoped to that plan', () => {
  const bare = run('domain', '--offline', 'taken');
  assert.equal(bare.status, 0, bare.stderr);
  const scoped = run('domain', '--offline', '--json', 'taken');
  assert.deepEqual(normalise(JSON.parse(bare.stdout)), normalise(JSON.parse(scoped.stdout)));
  assert.ok(JSON.parse(bare.stdout).plans.length >= 1, 'the slug named a plan');
});

test('scan-walk: --loose stays on the shell walk', () => {
  const loose = run('domain', '--offline', '--loose', '--json');
  const shell = run('shell', '--offline', '--loose', '--json');
  assert.equal(loose.status, shell.status, loose.stderr);
  assert.deepEqual(normalise(JSON.parse(loose.stdout)), normalise(JSON.parse(shell.stdout)));
});

test('scan-walk: --offline --next still asks the host on the domain path', () => {
  fs.rmSync(ghLog, { force: true });
  const r = run('domain', '--offline', '--next');
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  assert.ok(fs.existsSync(ghLog) && fs.readFileSync(ghLog, 'utf8').trim() !== '', 'gh was called');
});

test('scan-walk: --offline --json asks the host nothing on the domain path', () => {
  fs.rmSync(ghLog, { force: true });
  const r = run('domain', '--offline', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(ghLog), 'gh was not called');
});

after(() => {});
