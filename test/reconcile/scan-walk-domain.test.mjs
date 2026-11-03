// Contract test for `plot-fleet-scan.sh`, a launcher over `plot-scan-walk.mjs`:
// every mode answers from the walk on a sandbox repository.
//
// The runs use `--offline`, with no host token, no `PLOT_PR_LISTING` and no
// `PLOT_TERMINAL_CACHE`.
//
// `--offline --next` STILL ASKS THE HOST: a stub `gh` records every call.
//
// The bundle is a build product. `pnpm build:board` writes it; a run without it
// fails with that instruction.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
const MASKED = new Set(['changed_ago_seconds', 'changed_at']);
const normalise = (value) => {
  if (Array.isArray(value)) return value.map(normalise);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !MASKED.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, normalise(v)]));
};

let repo;
let ghLog;
let binDir;

const env = () => {
  const e = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  for (const k of ['PLOT_REPO_ROOT', 'PLOT_UNATTENDED', 'PLOT_PR_LISTING', 'PLOT_TERMINAL_CACHE', 'GH_TOKEN', 'GITHUB_TOKEN']) delete e[k];
  return e;
};
const run = (...args) => spawnSync('bash', [scan, ...args], { encoding: 'utf8', cwd: repo, env: env() });

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
  write('plans/2026-01-08-no-branches.md', `# No branches\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n## Branches\n`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-qb', 'bug/already-claimed');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim bug/already-claimed');
  git(repo, 'push', '-q', '-u', 'origin', 'bug/already-claimed');
  git(repo, 'checkout', '-q', 'main');
});

test('scan-walk: --json answers the fixture plans', () => {
  const r = run('--offline', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).plans.length >= 3, 'the scan saw the fixture plans');
});

test('scan-walk: --slice-names names the fixture branches', () => {
  const r = run('--offline', '--slice-names');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean).includes('feature/first-slice'), true);
});

for (const flag of ['--next', '--list-eligible', '--why-nothing']) {
  test(`scan-walk: ${flag} answers with status 0 or 1 and no listing lines on stdout`, () => {
    const r = run('--offline', flag);
    assert.ok(r.status === 0 || r.status === 1, r.stderr);
    assert.ok(!r.stdout.includes('listing:'), r.stdout);
  });
}

test('scan-walk: a slug scopes the json document to that plan', () => {
  const r = run('--offline', '--json', 'taken');
  assert.equal(r.status, 0, r.stderr);
  const plans = JSON.parse(r.stdout).plans;
  assert.equal(plans.length, 1);
  assert.ok(plans[0].file.includes('taken'));
});

test('scan-walk: a bare slug answers the prose report scoped to that plan', () => {
  const bare = run('--offline', 'taken');
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /^summary: /m, 'the prose report ends in its summary footer');
  assert.doesNotMatch(bare.stdout, /^\{/, 'prose, not the json document');
});

test('scan-walk: --loose --json answers the fixture plans', () => {
  const r = run('--offline', '--loose', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).plans.length >= 3);
});

test('scan-walk: --loose --next answers with status 0 or 1', () => {
  const r = run('--offline', '--loose', '--next');
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
});

const planLines = (stdout) => stdout.split('\n').filter((l) => l.startsWith('{"kind":"plan"')).map((l) => normalise(JSON.parse(l).plan));
const readingLine = (stdout) => stdout.split('\n').filter((l) => l.startsWith('{"kind":"reading"')).map((l) => normalise(JSON.parse(l).reading));

test('scan-walk: --stream prints a line per plan and one terminal reading', () => {
  const r = spawnSync('bash', [scan, '--offline', '--stream'], { encoding: 'utf8', cwd: repo, env: { ...env(), PLOT_SCAN_RECORD: '0' } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(planLines(r.stdout).length >= 3, 'the stream carried the fixture plans');
  assert.equal(readingLine(r.stdout).length, 1);
  const kinds = r.stdout.trim().split('\n').map((l) => JSON.parse(l).kind);
  assert.equal(kinds.at(-1), 'reading');
  assert.equal(kinds.filter((k) => k === 'reading').length, 1);
});

test('scan-walk: --stream writes the bridge before it prints the reading', () => {
  const bridge = path.join(repo, '.plot', 'state', 'last-pulse.json');
  fs.rmSync(bridge, { force: true });
  const r = run('--offline', '--stream');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(bridge), 'the bridge exists');
  assert.deepEqual(JSON.parse(fs.readFileSync(bridge, 'utf8')).pulse, JSON.parse(r.stdout.trim().split('\n').at(-1)).reading);
});

test('scan-walk: --stream prints the first plan before the walk has read the later plans', async () => {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gateDir = tmpDir('scangate');
  const gate = path.join(gateDir, 'release');
  const held = path.join(gateDir, 'held');
  const gitBin = path.join(gateDir, 'bin');
  fs.mkdirSync(gitBin);
  // The walk reads a branch's commits as `git log <main oid>..<tip oid>`; the
  // later plan's branch read blocks until the gate file exists.
  const tip = execFileSync(realGit, ['rev-parse', 'origin/bug/already-claimed'], { encoding: 'utf8', cwd: repo }).trim();
  fs.writeFileSync(
    path.join(gitBin, 'git'),
    `#!/usr/bin/env bash\ncase " $* " in *" log "*"..${tip}"*) : > ${JSON.stringify(held)}; for _ in $(seq 1 600); do [ -e ${JSON.stringify(gate)} ] && break; sleep 0.1; done ;; esac\nexec ${JSON.stringify(realGit)} "$@"\n`,
    { mode: 0o755 },
  );
  const child = spawn('bash', [scan, '--offline', '--stream'], {
    cwd: repo,
    env: { ...env(), PLOT_SCAN_RECORD: '0', PATH: `${gitBin}${path.delimiter}${binDir}${path.delimiter}${process.env.PATH}` },
  });
  let out = '';
  let printedWhileBlocked = false;
  const done = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  child.stdout.on('data', (chunk) => { out += chunk; });
  // The gate opens only once a plan line is on stdout AND the later plan's read is blocked on it.
  const poll = setInterval(() => {
    if (fs.existsSync(gate) || !fs.existsSync(held) || !out.includes('{"kind":"plan"')) return;
    printedWhileBlocked = !out.includes('"kind":"reading"');
    fs.writeFileSync(gate, '');
  }, 20);
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  const code = await done;
  clearTimeout(timer);
  clearInterval(poll);
  assert.equal(code, 0);
  assert.ok(printedWhileBlocked, 'a plan line printed while a later plan\'s branch read was still blocked');
  const kinds = out.trim().split('\n').map((l) => JSON.parse(l).kind);
  assert.deepEqual(kinds, ['plan', 'plan', 'plan', 'reading']);
});

test('scan-walk: --stream prints no reading line when the walk fails', () => {
  const broken = tmpDir('scanbroken');
  const shim = path.join(broken, 'bin');
  fs.mkdirSync(shim);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  // The walk reads a branch's commits by oid, `git log <main oid>..<tip oid>`.
  const tip = execFileSync(realGit, ['rev-parse', 'origin/bug/already-claimed'], { encoding: 'utf8', cwd: repo }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash\ncase " $* " in *" log "*"..${tip}"*) exit 128 ;; esac\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  const r = spawnSync('bash', [scan, '--offline', '--stream'], { encoding: 'utf8', cwd: repo, env: { ...env(), PLOT_SCAN_RECORD: '0', PATH: `${shim}${path.delimiter}${binDir}${path.delimiter}${process.env.PATH}` } });
  assert.notEqual(r.status, 0);
  assert.ok(!r.stdout.includes('"kind":"reading"'), r.stdout);
});

const freshBridge = () => fs.rmSync(path.join(repo, '.plot', 'state', 'last-pulse.json'), { force: true });

for (const extra of [[], ['--loose']]) {
  test(`scan-walk: plain ${['--log-pulse', ...extra].join(' ')} prints the wave report, footer and completion line`, () => {
    freshBridge();
    const r = run('--offline', '--log-pulse', ...extra);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== .* ==\n {2}\S.* — (eligible|blocked|complete)/);
    assert.match(r.stdout, /Pulse complete\. This report is derived — nothing was changed\.\nsummary: plans=\d+ /);
  });
}

test('scan-walk: --offline --next still asks the host', () => {
  fs.rmSync(ghLog, { force: true });
  const r = run('--offline', '--next');
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  assert.ok(fs.existsSync(ghLog) && fs.readFileSync(ghLog, 'utf8').trim() !== '', 'gh was called');
});

test('scan-walk: --offline --json asks the host nothing', () => {
  fs.rmSync(ghLog, { force: true });
  const r = run('--offline', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(ghLog), 'gh was not called');
});

// NO MASK HERE: the conflict readings and `merge_detect` are compared as they
// are printed. A branch that edits the line main also edited conflicts on it.
const conflictRepo = () => {
  const tmp = tmpDir('scanclash');
  const origin = path.join(tmp, 'origin.git');
  const dir = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, dir);
  for (const [k, v] of [['user.email', 'test@example.invalid'], ['user.name', 'Plot Test'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('CLAUDE.md', `# Fixture\n\n## Plot Config\n\n- **Git host:** github\n- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Delivered index:** plans/delivered/\n`);
  write('plans/2026-01-09-clash.md', `# Clash\n\n## Status\n\n- **Phase:** Approved\n- **Type:** feature\n\n## Branches\n\n### Clash\n- \`feature/clash\` — edits the shared line\n`);
  write('shared.txt', 'base\n');
  fs.mkdirSync(path.join(dir, 'plans', 'active'), { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'plans');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'checkout', '-qb', 'feature/clash');
  write('shared.txt', 'branch\n');
  git(dir, 'commit', '-qam', 'the branch edits the shared line');
  git(dir, 'push', '-q', '-u', 'origin', 'feature/clash');
  git(dir, 'checkout', '-q', 'main');
  write('shared.txt', 'main\n');
  git(dir, 'commit', '-qam', 'main edits the shared line');
  git(dir, 'push', '-q', 'origin', 'main');
  return dir;
};

test('scan-walk: --stream reports a conflicting branch\'s conflicts', () => {
  const dir = conflictRepo();
  const ran = spawnSync('bash', [scan, '--offline', '--stream'], { encoding: 'utf8', cwd: dir, env: { ...env(), PLOT_SCAN_RECORD: '0' } });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.trim().split('\n').map((l) => JSON.parse(l));
  const rowOf = (out) => out.find((l) => l.kind === 'plan').plan.waves.flatMap((w) => w.branches).find((b) => b.branch === 'feature/clash');
  const pick = (row) => ({ state: row.state, conflicts_known: row.conflicts_known, conflicts: row.conflicts, changed_paths: row.changed_paths });
  assert.deepEqual(pick(rowOf(lines)), { state: 'wip', conflicts_known: true, conflicts: ['shared.txt'], changed_paths: ['shared.txt'] });
  const reading = lines.find((l) => l.kind === 'reading').reading;
  const readRow = reading.plans[0].waves.flatMap((w) => w.branches).find((b) => b.branch === 'feature/clash');
  assert.deepEqual(pick(readRow), pick(rowOf(lines)));
});

after(() => {});
