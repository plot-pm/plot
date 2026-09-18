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
    'node', 'node_floor', 'bash', 'git_root', 'cwd_is_root',
    'artifact', 'artifact_source', 'has_plot_config', 'plan_dir',
    'plan_files', 'git_host', 'gh', 'bb', 'jen', 'ci_signals',
  ]) {
    assert.ok(key in p, `missing field: ${key}`);
  }
});

test('probe: reads the Node floor from .nvmrc and decides nothing about it', () => {
  // THE FLOOR IS A READING. `node_ok` hardcoded `>= 20` here, had no reader on
  // the whole estate, and disagreed with `plot-fleetctl.sh`, which reads the
  // same `.nvmrc` and refuses a mismatched major. Whether the node found meets
  // the floor is `proposeNode`'s answer, in packages/domain/test/stack.test.ts.
  const pinned = repoWith({ '.nvmrc': '24\n' }, { config: '- **Plan directory:** docs/plans/\n' });
  assert.equal(probe(pinned).node_floor, 24);

  // `v24.2.0` is a valid pin too, and the major is what a comparison needs.
  const full = repoWith({ '.nvmrc': 'v24.2.0\n' }, { config: '- **Plan directory:** docs/plans/\n' });
  assert.equal(probe(full).node_floor, 24);
});

test('probe: reports no floor where the repository pins none', () => {
  // A repository with no `.nvmrc` has stated no floor, and null is what says
  // so. `proposeNode` answers *cannot verify* for it rather than inventing a
  // number — which is exactly what the literal 20 did.
  const r = repoWith({ 'a.txt': 'x' }, { config: '- **Plan directory:** docs/plans/\n' });
  assert.equal(probe(r).node_floor, null);
});

test('probe: reports no floor for a pin that names no number', () => {
  // `lts/iron` is a valid `.nvmrc`. Resolving the alias would need a table
  // that goes stale, and reporting a wrong major is worse than reporting none.
  const r = repoWith({ '.nvmrc': 'lts/iron\n' }, { config: '- **Plan directory:** docs/plans/\n' });
  assert.equal(probe(r).node_floor, null);
});

test('probe: reports no verdict about the node it found', () => {
  // The field left behind is the second answer this removes.
  const r = repoWith({ '.nvmrc': '24\n' }, { config: '- **Plan directory:** docs/plans/\n' });
  assert.ok(!('node_ok' in probe(r)), 'node_ok is the rule\'s answer, not the probe\'s');
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

const CLIS = ['gh', 'bb', 'jen'];

/** Everything the probe and plot-config.sh shell out to. */
const NEEDED = ['bash', 'git', 'find', 'grep', 'sed', 'awk', 'stat', 'wc',
  'tr', 'head', 'cat', 'node', 'uname', 'dirname', 'basename', 'env'];

/**
 * PATH-stub the three CLIs. `specs` maps a CLI name to {stdout, exit}; a name
 * that is omitted is simply not created, and the returned directory is meant
 * to be the WHOLE of PATH (see isolatedPath), so omission means unfindable.
 * Mirrors stubHost() in test/e2e/helpers.mjs.
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
  // The real tools the probe needs, symlinked in, so this directory can be the
  // entire PATH. Resolved from the CURRENT PATH rather than hardcoded, because
  // their location is not the same on every platform.
  for (const tool of NEEDED) {
    if (CLIS.includes(tool)) continue;
    let real;
    try {
      real = execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    } catch { continue; }
    if (real) fs.symlinkSync(real, path.join(dir, tool));
  }
  return dir;
}

/**
 * PATH containing ONLY the stub dir, so a real gh/bb/jen cannot leak in.
 *
 * MEASURED 2026-08-18: appending `/usr/bin:/bin` — the previous approach — is
 * not isolation. This repo's Linux CI ships a real `gh` at `/usr/bin/gh`,
 * inside the very directory kept for coreutils, so `installed` came back true
 * on CI while passing on macOS, where gh lives in /opt/homebrew/bin. A
 * non-executable shadow file does not work either: bash's `command -v` reports
 * it as found regardless of the executable bit. Hence: one directory, holding
 * exactly what the probe may see.
 */
function isolatedPath(stubDir) {
  return { PATH: stubDir };
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
        'Jenkins auth:  OK — jan.wloka@quatico.com',
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

// --- the JOB PATH, which is a different question from reachability ---------
//
// #913: a `Jenkins instance` carrying the slug alone passed adoption as
// verified, and the board it produced had no build state at all. Measured on
// that instance with `pr-list --rich`: slug only returned NO ROWS, where
// `<slug>/quaweb/continuous-build` returned 4 PRs all `checks: green`.
//
// The reading is a STRING TEST ON A CONFIG VALUE. Asking Jenkins cannot
// distinguish the defect — measured live 2026-09-15, a slug-only value
// resolves a NON-EMPTY job list (four entries, not zero), so the broken
// configuration answers, and answers `ok`.

/**
 * A `jen` stub that RECORDS every invocation, for the no-network gate.
 *
 * `stubClis` writes stubs that answer and forget, which cannot tell "called
 * and ignored" from "never called" — and a call that happens and is discarded
 * still costs what the offline test was chosen to avoid. This appends one line
 * per invocation to a file the test reads.
 */
function countingJen(stubDir, logPath) {
  fs.writeFileSync(
    path.join(stubDir, 'jen'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\nexit 0\n`,
  );
  fs.chmodSync(path.join(stubDir, 'jen'), 0o755);
}

/**
 * Probe a repo whose config declares `instance`, returning the `jen` object.
 *
 * `extraEnv` is the environment DIRECTLY rather than nested under an `env`
 * key: a destructured `{ env = {} } = {}` swallows an unknown key silently, so
 * a caller passing `{ PLOT_JENKINS_JOB: … }` by mistake would have its input
 * dropped and the probe asked a different question than the test names. Caught
 * while writing these gates.
 */
function jenFor(instance, extraEnv = {}) {
  const r = repoWith({}, {
    config: `- **Plan directory:** docs/plans/\n- **Jenkins instance:** ${instance}\n`,
  });
  const stub = stubClis({ jen: { stdout: 'Jenkins auth:  OK — jan.wloka@quatico.com' } });
  return probe(r, { env: { ...isolatedPath(stub), ...extraEnv } }).jen;
}

test('probe: a <slug>/<job path> instance reports its job path — the control', () => {
  const jen = jenFor('apps/quaweb/continuous-build');
  assert.equal(jen.job, 'quaweb/continuous-build');
  assert.equal(jen.job_source, 'instance');
});

test('probe: a slug-only instance reports NO job path — the #913 defect', () => {
  // The value adoption accepted as verified. It names the SERVER and no
  // container, so Plot looks for branch jobs at the Jenkins root.
  const jen = jenFor('apps');
  assert.equal(jen.job, '');
  assert.equal(jen.job_source, 'none');
});

test('probe: https://host/ reports NO job path — the defect wearing a URL', () => {
  // THE CASE THE NAIVE `${value#*/}` ACCEPTS. Measured before the fix, it
  // splits to '/jenkins.example.com/' — non-empty, so accepted, while being
  // exactly the #913 defect. The bare-hostname case above is refused correctly
  // BY ACCIDENT: hostnames have no slash.
  const jen = jenFor('https://jenkins.example.com/');
  assert.equal(jen.job, '');
  assert.equal(jen.job_source, 'none');
});

test('probe: https://host/job/path yields a job path NOT carrying the host', () => {
  // The other direction of the same bug: the naive split yields
  // '/jenkins.example.com/quaweb/cb', gluing the authority onto the job path.
  const jen = jenFor('https://jenkins.example.com/quaweb/continuous-build');
  assert.equal(jen.job, 'quaweb/continuous-build');
  assert.ok(!jen.job.includes('jenkins.example.com'), 'job path carries the host');
});

test('probe: http:// is stripped as well as https://', () => {
  assert.equal(jenFor('http://jenkins.example.com/quaweb/cb').job, 'quaweb/cb');
});

test('probe: a slug-only instance WITH PLOT_JENKINS_JOB is accepted', () => {
  // THE ONE CASE A PURE SHAPE TEST GETS WRONG. `plot-host.sh:3197` honours the
  // override, so a caller holding the job path separately has a working
  // configuration and must not be refused for it.
  const jen = jenFor('apps', { PLOT_JENKINS_JOB: 'quaweb/continuous-build' });
  assert.equal(jen.job, 'quaweb/continuous-build');
  assert.equal(jen.job_source, 'override');
});

test('probe: PLOT_JENKINS_JOB overrides a job path the instance already names', () => {
  const jen = jenFor('apps/from/instance', { PLOT_JENKINS_JOB: 'from/override' });
  assert.equal(jen.job, 'from/override');
  assert.equal(jen.job_source, 'override');
});

test('probe: a repo declaring no Jenkins at all still reads unknown', () => {
  // Setup already refuses a MISSING key correctly, and must keep doing so: the
  // defect is that a PRESENT BUT INCOMPLETE value scored better than an absent
  // one. A refusal that fires on absence would be a new bug.
  const r = repoWith({}, { config: '- **Plan directory:** docs/plans/\n' });
  const stub = stubClis({ jen: { stdout: 'Jenkins auth:  OK — jan.wloka@quatico.com' } });
  const jen = probe(r, { env: isolatedPath(stub) }).jen;
  assert.equal(jen.instance, '');
  assert.equal(jen.job, '');
  assert.equal(jen.job_source, 'none');
  assert.equal(jen.auth, 'unknown');
});

test('probe: the job-path reading answers with jen NOT installed', () => {
  // It is a string test on a config value, so it sits OUTSIDE the
  // `jen_installed` block. A machine holding the value and not the tool must
  // still get the reading.
  const r = repoWith({}, {
    config: '- **Plan directory:** docs/plans/\n- **Jenkins instance:** apps/quaweb/cb\n',
  });
  const stub = stubClis({});
  const jen = probe(r, { env: isolatedPath(stub) }).jen;
  assert.equal(jen.installed, false);
  assert.equal(jen.job, 'quaweb/cb');
});

test('probe: the job-path reading invokes jen ZERO times', () => {
  // THE MECHANISM THE PLAN EXPLICITLY REJECTED. A slug-only value resolves a
  // non-empty job list on the real #913 instance, so a live call cannot make
  // the distinction — and would cost a network round trip in a stranger's repo.
  //
  // The instance is slug-only, so the `jen auth status` call at the top of the
  // block is the ONLY invocation this may produce; asserting on the recorded
  // arguments proves no job lookup joined it.
  const r = repoWith({}, {
    config: '- **Plan directory:** docs/plans/\n- **Jenkins instance:** apps\n',
  });
  const stub = stubClis({});
  const log = path.join(stub, 'jen-calls.log');
  countingJen(stub, log);

  const jen = probe(r, { env: isolatedPath(stub) }).jen;
  assert.equal(jen.job, '');

  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '')
    : [];
  assert.deepEqual(
    calls.filter((c) => /\bjob\b|\bpr-list\b|\bbuild\b/.test(c)),
    [],
    'the job-path reading asked Jenkins',
  );
  assert.equal(calls.length, 1, `expected only the auth call, got: ${calls.join(' | ')}`);
  assert.match(calls[0], /auth status/);
});

test('probe: a job path naming a container with no children is NOT flagged', () => {
  // A fresh multibranch container is legitimate — it NAMES a job path, and the
  // reading stops there. A check that went on to ask about contents would
  // refuse a repo whose pipeline has simply not run yet.
  const jen = jenFor('apps/brand-new-container');
  assert.equal(jen.job, 'brand-new-container');
  assert.equal(jen.job_source, 'instance');
});

test('probe: a trailing slash on a job path does not invent an empty segment', () => {
  assert.equal(jenFor('apps/quaweb/cb/').job, 'quaweb/cb');
});

test('probe: no fixture asserts the success word the CLI never printed', () => {
  // THE GATE, AND IT READS THIS FILE'S OWN TEXT. Until 2026-09-17 the probe
  // matched `Jenkins auth:  reachable` and three fixtures fed it that exact
  // string, so the suite was green over a reading that could never fire: the
  // CLI prints `Jenkins auth:  OK — user@host`, measured live, and a reachable
  // Jenkins scored `unknown`.
  //
  // WIDENING TO `ok|reachable` WOULD HAVE KEPT ALL THREE GREEN and kept the
  // fiction, which is why the word was replaced rather than added. Nothing but
  // a test over the source text can say the dead string is gone — an assertion
  // about behaviour passes whether or not the fixtures still carry it.
  //
  // IT MATCHES A JS STRING LITERAL, NEVER A MENTION. The first draft matched
  // the bare phrase and flagged three lines: the mutant, plus this comment and
  // the message below, both of which only NAME the string. A gate a reader
  // cannot describe without tripping is one they delete.
  //
  // So the anchor is the enclosing quote, and BACKTICKS ARE EXCLUDED
  // deliberately: a fixture is written `'…'` or `"…"`, while prose in this
  // repo quotes a phrase in backticks. Including them put the match back on
  // the two lines above and below. Only `'` and `"` make a fixture.
  //
  // `NOT reachable` is the FAILURE wording and is real, so the match is
  // anchored to the success position: the line, its colon, and whitespace.
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const dead = self
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /(['"])Jenkins auth:[ \t]*reachable\1/i.test(line));
  assert.deepEqual(
    dead.map(([n, line]) => `${n}: ${line.trim()}`),
    [],
    'a fixture asserts `Jenkins auth:  reachable`, which the CLI never emits',
  );
});

// --- the Jenkinsfile reading, which is a SEARCH rather than one path -------

test('probe: a root Jenkinsfile still reads true — unchanged', () => {
  const r = repoWith({ Jenkinsfile: 'pipeline {}\n' });
  assert.equal(probe(r).ci_signals.jenkinsfile, true);
});

test('probe: a repository keeping its pipelines in a directory reads true', () => {
  // THE DEFECT. `[ -f "$git_root/Jenkinsfile" ]` asked about ONE path, so a
  // repository that keeps pipelines in a directory read as having no CI at
  // all — `proposeCi` answers `silent`, setup writes no `CI:` key, and the
  // Jenkins instance question is never asked.
  //
  // THE EXACT DEPTH THE REPORTING REPOSITORY USES, not a shallower stand-in:
  // the file is four directories down and therefore FIVE path components from
  // the start point, and `-maxdepth 4` finds nothing. A fixture one level
  // shallower would pass against the off-by-one this slice exists to fix.
  const r = repoWith({
    '.build/pipelines/website/continuous-build/Jenkinsfile': 'pipeline {}\n',
  });
  assert.equal(probe(r).ci_signals.jenkinsfile, true);
});

test('probe: a repository with no Jenkinsfile anywhere reads false', () => {
  const r = repoWith({ 'src/app.ts': 'export {};\n' });
  assert.equal(probe(r).ci_signals.jenkinsfile, false);
});

test('probe: a Jenkinsfile inside node_modules does NOT make it true', () => {
  // A dependency's own pipeline is not this repository's CI. The fixture
  // CONTAINS one rather than asserting the exclusion abstractly — without a
  // real file the test passes whether or not the exclusion is written.
  const r = repoWith({
    'node_modules/some-dep/Jenkinsfile': 'pipeline {}\n',
    'src/app.ts': 'export {};\n',
  });
  assert.equal(probe(r).ci_signals.jenkinsfile, false);
});

test('probe: a Jenkinsfile under a test path DOES count — the withdrawn rule', () => {
  // NO NAMING EXCLUSION, and this pins the decision rather than an accident.
  // The plan once demanded a Jenkinsfile in a "test fixture directory" not
  // count; a round-2 implementer tried and no rule survived — `fixtures`,
  // `test` and `__fixtures__` are each plausible and each wrong somewhere, and
  // a repository genuinely keeping a pipeline under `test/` would be told it
  // has no CI. The depth bound limits the rest.
  const r = repoWith({ 'test/fixtures/Jenkinsfile': 'pipeline {}\n' });
  assert.equal(probe(r).ci_signals.jenkinsfile, true);
});

test('probe: gh_workflows is unchanged by the Jenkinsfile search', () => {
  // The neighbouring signal, explicitly out of scope: it tests a DIRECTORY at
  // one fixed path and stays a single test.
  const withWf = repoWith({ '.github/workflows/ci.yml': 'on: push\n' });
  assert.equal(probe(withWf).ci_signals.gh_workflows, true);
  const deep = repoWith({ 'a/b/c/.github/workflows/ci.yml': 'on: push\n' });
  assert.equal(probe(deep).ci_signals.gh_workflows, false);
});
