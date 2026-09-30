// Contract test for skills/plot/scripts/plot-agent-settings.sh — the ONE
// resolver for the settings file every fleet agent starts with.
//
// Every dispatched agent is a `claude -p` session inheriting every plugin the
// operator installed. Measured 2026-09-30, one plugin's lockless sync ran three
// times at once, the 1-minute load reached 195, and the supervisor did not tick
// for 12 minutes. This resolver is how a project names what its agents start
// without.
//
// WHAT THESE TESTS PIN, and why each is the one that catches a naive resolver:
//
//   - THE DESK CASE. A relative value resolves against the MAIN CHECKOUT, the
//     parent of `--git-common-dir`. Only a test asked from a worktree separates
//     that from `--show-toplevel`, which names the desk — and every agent runs
//     on a desk, so getting this wrong means the whole fleet resolves nothing.
//   - A DESK WHOSE CLAUDE.md CARRIES NO KEY answers nothing, exit 0. That is an
//     old desk starting exactly as today, not a refusal.
//   - EXIT 0 WITH NO OUTPUT against EXIT 3 WITH NO OUTPUT. A caller testing only
//     for an empty string cannot tell "nothing configured" from "configured and
//     refused", and the second is the one that belongs in a log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const resolver = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-agent-settings.sh');

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/**
 * Runs the resolver from `cwd`, which is what decides the tree it asks.
 *
 * `PLOT_REPO_ROOT` IS UNSET FOR THE CHILD. `plot-config.sh` prefers that
 * variable over `git rev-parse --show-toplevel` (`:191`) to save a fork per key,
 * and a dispatched agent's environment carries it — so a test inheriting it reads
 * the REAL repository's CLAUDE.md and every fixture key vanishes. Measured while
 * writing these tests: nine of twelve failed, each because the fixture's key was
 * never seen.
 */
const run = (cwd) =>
  spawnSync('bash', [resolver], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PLOT_REPO_ROOT: '' },
  });

/**
 * A git repository carrying a `## Plot Config` section.
 *
 * The resolver reads its key through `plot-config.sh`, so the fixture writes a
 * real CLAUDE.md rather than stubbing the reader — a stub would prove the
 * resolver calls something, not that it reads the key a project writes.
 */
function repoWith({ key, settings }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-agent-settings-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 'T');
  const lines = [
    '# Fixture',
    '',
    '## Plot Config',
    '',
    '- **Plan directory:** docs/plans/',
  ];
  if (key !== undefined) {
    lines.push(`- **Agent settings:** ${key}`);
  }
  writeFileSync(path.join(dir, 'CLAUDE.md'), `${lines.join('\n')}\n`);
  if (settings !== undefined) {
    mkdirSync(path.join(dir, '.plot'), { recursive: true });
    writeFileSync(path.join(dir, '.plot', 'agent-settings.json'), settings);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  return dir;
}

/** A dispatch desk: a linked worktree of `dir`, which is where every agent runs. */
function deskOf(dir) {
  const desk = path.join(dir, '..', `${path.basename(dir)}-desk`);
  git(dir, 'worktree', 'add', '--detach', '-q', desk, 'HEAD');
  return desk;
}

const SAFE = JSON.stringify({
  enabledPlugins: { 'episodic-memory@superpowers-marketplace': false },
});

test('agent settings: an absent key answers nothing, exit 0', () => {
  const dir = repoWith({});
  try {
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent settings: an empty key answers nothing, exit 0', () => {
  const dir = repoWith({ key: '' });
  try {
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent settings: a relative value answers an absolute path', () => {
  const dir = repoWith({ key: '.plot/agent-settings.json', settings: SAFE });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(path.isAbsolute(r.stdout.trim()), `expected absolute, got ${r.stdout.trim()}`);
    assert.match(r.stdout.trim(), /agent-settings\.json$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// THE TEST THAT SEPARATES --git-common-dir FROM --show-toplevel.
//
// Asked from a DESK, a relative value must resolve to the MAIN CHECKOUT's file.
// `--show-toplevel` inside a worktree names the desk, and a desk holds no
// `.plot/agent-settings.json` of its own — so a resolver using it answers
// "missing file" here while answering correctly from the main checkout, which is
// the one place no agent ever runs.
test('agent settings: asked from a desk, a relative value resolves against the main checkout', () => {
  const dir = repoWith({ key: '.plot/agent-settings.json', settings: SAFE });
  let desk;
  try {
    desk = deskOf(dir);
    // The desk must NOT hold its own copy, or the test could pass either way.
    rmSync(path.join(desk, '.plot', 'agent-settings.json'), { force: true });

    const r = run(desk);
    assert.equal(r.status, 0, `expected the main checkout's file, got: ${r.stderr}`);
    const answered = r.stdout.trim();
    assert.ok(path.isAbsolute(answered));
    // BOTH SIDES REALPATHED. The resolver answers `pwd -P`, deliberately: an
    // agent's `--settings` path must be canonical. On macOS `mkdtempSync` hands
    // back `/var/...` while `pwd -P` gives `/private/var/...`, so comparing the
    // raw strings compares two spellings of one path — the trap `verdicts.ts`
    // records for `import.meta.url`.
    assert.equal(answered, realpathSync(path.join(dir, '.plot', 'agent-settings.json')));
    assert.ok(
      !answered.startsWith(realpathSync(desk)),
      `answered the desk's own path: ${answered}`,
    );
  } finally {
    if (desk) git(dir, 'worktree', 'remove', '--force', desk);
    rmSync(dir, { recursive: true, force: true });
  }
});

// An OLD desk — one cut before the key existed — starts exactly as today. The
// key is read from the ASKING tree, so this is exit 0 and not a refusal.
test('agent settings: a desk whose CLAUDE.md carries no key answers nothing, exit 0', () => {
  const dir = repoWith({});
  let desk;
  try {
    desk = deskOf(dir);
    const r = run(desk);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  } finally {
    if (desk) git(dir, 'worktree', 'remove', '--force', desk);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent settings: an absolute value is taken as given', () => {
  const dir = repoWith({});
  const other = mkdtempSync(path.join(tmpdir(), 'plot-agent-settings-abs-'));
  const file = path.join(other, 'settings.json');
  writeFileSync(file, SAFE);
  try {
    writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      `# Fixture\n\n## Plot Config\n\n- **Agent settings:** ${file}\n`,
    );
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('agent settings: a missing file answers 3 and names the path it looked for', () => {
  const dir = repoWith({ key: '.plot/nope.json' });
  try {
    const r = run(dir);
    assert.equal(r.status, 3);
    assert.equal(r.stdout.trim(), '', 'a refusal prints no path');
    assert.match(r.stderr, /nope\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent settings: an unparseable file answers 3', () => {
  const dir = repoWith({ key: '.plot/agent-settings.json', settings: 'not json at all' });
  try {
    const r = run(dir);
    assert.equal(r.status, 3);
    assert.equal(r.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// THE REFUSAL THROUGH THE BUNDLE. The script must not re-implement the rule, and
// what proves it asks the rule is that each of the rule's three refusals comes
// back as exit 3 with the key named.
for (const [name, settings, key] of [
  ['a disabled plot plugin', { enabledPlugins: { 'plot@plot-marketplace': false } }, 'plot@'],
  ['disableAllHooks', { disableAllHooks: true }, 'disableAllHooks'],
  ['an env key', { env: { PATH: '/nowhere' } }, 'env.PATH'],
]) {
  test(`agent settings: ${name} answers 3 through the bundle, naming the key`, () => {
    const dir = repoWith({
      key: '.plot/agent-settings.json',
      settings: JSON.stringify(settings),
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 3, r.stderr);
      assert.equal(r.stdout.trim(), '', 'a refused file never reaches an agent');
      assert.ok(r.stderr.includes(key), `stderr should name ${key}, got: ${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// THE NEGATIVE CASE, at the resolver's level too. A rule refusing every
// `enabledPlugins` block would pass every refusal test above and make the key
// useless — so the file a project actually writes must come back as a path.
test('agent settings: a file disabling only other plugins answers its path, exit 0', () => {
  const dir = repoWith({
    key: '.plot/agent-settings.json',
    settings: JSON.stringify({
      enabledPlugins: {
        'episodic-memory@superpowers-marketplace': false,
        'oh-my-claudecode@omc': false,
      },
    }),
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim(), /agent-settings\.json$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
