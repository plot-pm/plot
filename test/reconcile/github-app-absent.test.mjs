// `resolveApp`'s `absent` flag — #1824/#1827: a crashed `plot-config.sh` read
// and a genuinely undeclared key both produced an empty `declared` string, so
// both read as `absent: true`. The callers (`plot-commit-status.mjs`'s
// `reviewApp()`, `plot-merger-token.mjs`) use `absent` to choose between
// refusing by name and falling back to the ambient `gh`/host identity — a
// crashed read must refuse, never fall back as if nobody had configured the
// key at all.
//
// `resolveApp` resolves `plot-config.sh` next to itself (`here`), not via
// PATH, so each test copies the real module beside a stub `plot-config.sh` in
// a scratch directory rather than shadowing anything on PATH.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-github-app.mjs');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A scratch directory holding `plot-github-app.mjs` beside a `plot-config.sh` that prints `output` and exits `exitCode`. */
const sandbox = ({ exitCode, output }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-github-app-absent-'));
  made.push(dir);
  fs.copyFileSync(source, path.join(dir, 'plot-github-app.mjs'));
  fs.writeFileSync(
    path.join(dir, 'plot-config.sh'),
    `#!/usr/bin/env bash\n${output ? `echo "${output}"\n` : ''}exit ${exitCode}\n`,
  );
  fs.chmodSync(path.join(dir, 'plot-config.sh'), 0o755);
  return dir;
};

test('resolveApp: a plot-config.sh that exits non-zero is not absent', async () => {
  // CATCHES the bug exactly: `absent: !declared` cannot tell a crash from
  // silence, so a crash fell back to the ambient identity instead of
  // refusing by name.
  const dir = sandbox({ exitCode: 7, output: '' });
  const { resolveApp } = await import(path.join(dir, 'plot-github-app.mjs'));
  const result = resolveApp('Review app', dir);
  assert.equal(result.app, null);
  assert.equal(result.absent, false, 'a crashed config read must refuse by name, not fall back');
});

test('resolveApp: a plot-config.sh that exits non-zero but still prints something is not absent', async () => {
  const dir = sandbox({ exitCode: 1, output: 'garbage' });
  const { resolveApp } = await import(path.join(dir, 'plot-github-app.mjs'));
  const result = resolveApp('Review app', dir);
  assert.equal(result.app, null);
  assert.equal(result.absent, false);
});

test('resolveApp: a plot-config.sh that exits 0 with no output is genuinely absent', async () => {
  // The no-regression half: a key `## Plot Config` simply does not declare
  // must still fall back for the Writer/Merger identities.
  const dir = sandbox({ exitCode: 0, output: '' });
  const { resolveApp } = await import(path.join(dir, 'plot-github-app.mjs'));
  const result = resolveApp('Review app', dir);
  assert.equal(result.app, null);
  assert.equal(result.absent, true);
});
