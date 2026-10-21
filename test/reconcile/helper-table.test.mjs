// Contract test for scripts/check-helper-table.sh: every shipped script keeps a
// README row, and the shipped population includes the bundles build.mjs
// declares, because a PR carries no built bundle. Each case runs the script
// against a throwaway git repository passed as its repo-root argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'scripts', 'check-helper-table.sh');
const README = 'skills/plot/scripts/README.md';
const BUILD = 'packages/board/build.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A build that declares one bundle, `plot-new`. */
const BUILD_TEXT = [
  "const newArtifact = path.join(here, 'dist/plot-new.mjs');",
  "const shippedNew = path.join(here, '../../skills/plot/scripts/board/plot-new.mjs');",
  'await esbuild.build({',
  "  entryPoints: [path.join(here, 'src/server/entry/new.ts')],",
  '  outfile: newArtifact,',
  '});',
  'fs.copyFileSync(newArtifact, shippedNew);',
  '',
].join('\n');

const row = (name) => `| \`${name}\` | Does a thing |\n`;
const readme = (...names) => `# Helper Scripts\n\n| Script | Purpose |\n|---|---|\n${names.map(row).join('')}`;

const write = (work, file, text) => {
  mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
  writeFileSync(path.join(work, file), text);
};

/** A repo holding one tracked helper, `a.sh`, and a README with its row. */
const fixture = ({ build = BUILD_TEXT, rows = ['a.sh'] } = {}) => {
  const work = mkdtempSync(path.join(tmpdir(), 'plot-helper-table-'));
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'user.email', 'fixture@example.com');
  write(work, 'CLAUDE.md', '# Plot\n');
  write(work, README, readme(...rows));
  write(work, 'skills/plot/scripts/a.sh', '#!/usr/bin/env bash\n');
  if (build !== null) write(work, BUILD, build);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'initial');
  return work;
};

/** Baseline 0, so any shipped script without a row fails the gate. */
const run = (work) => {
  const r = spawnSync('bash', [script, work], {
    encoding: 'utf8',
    env: { ...process.env, PLOT_HELPER_ROW_BASELINE: '0' },
  });
  return { status: r.status, out: r.stdout + r.stderr };
};

const withFixture = (fn, options) => () => {
  const work = fixture(options);
  try {
    fn(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

test('a declared bundle with no row and no tracked file fails, naming it', withFixture((work) => {
  const r = run(work);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /board\/plot-new\.mjs/);
}));

test('the same declared bundle with its row passes', withFixture((work) => {
  const r = run(work);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 of 2 shipped scripts lack a row/);
}, { rows: ['a.sh', 'board/plot-new.mjs'] }));

test('a bundle both declared and tracked counts once', withFixture((work) => {
  write(work, 'skills/plot/scripts/board/plot-new.mjs', '// built\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'built');
  const r = run(work);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 of 2 shipped scripts lack a row/);
}, { rows: ['a.sh', 'board/plot-new.mjs'] }));

test('a tracked bundle that build.mjs does not declare still counts', withFixture((work) => {
  write(work, 'skills/plot/scripts/board/plot-old.mjs', '// built\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'built');
  const r = run(work);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /board\/plot-old\.mjs/);
}, { rows: ['a.sh', 'board/plot-new.mjs'] }));

test('an absent build.mjs fails', withFixture((work) => {
  const r = run(work);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::.*build\.mjs is absent at HEAD/);
}, { build: null }));

test('a build.mjs that declares nothing parseable fails', withFixture((work) => {
  const r = run(work);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::.*declares no bundle this gate can parse/);
}, { build: 'export default {};\n' }));
