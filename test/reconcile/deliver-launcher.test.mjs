// Contract test for the delivery launcher: it resolves its bundle and execs it,
// and when the bundle is absent it exits 2 with one message that names the
// missing file and both remedies (update the plugin, or `pnpm build:board` in
// the plot repository) — the message the controller gate gives for its own
// missing bundle.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');

const made = [];
after(() => {
  for (const p of made) fs.rmSync(p, { recursive: true, force: true });
});

/** A copy of the launcher in a directory of its own, with or without a bundle beside it. */
const launcherCopy = (bundleBody) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-launcher-'));
  made.push(dir);
  fs.copyFileSync(launcher, path.join(dir, 'plot-deliver.sh'));
  if (bundleBody !== undefined) {
    fs.mkdirSync(path.join(dir, 'board'));
    fs.writeFileSync(path.join(dir, 'board', 'plot-deliver.mjs'), bundleBody);
  }
  return dir;
};

test('a missing bundle exits 2, naming the file and both remedies', () => {
  const dir = launcherCopy(undefined);
  const r = spawnSync('bash', [path.join(dir, 'plot-deliver.sh'), 'some-slug'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, `must refuse (stderr: ${r.stderr})`);
  assert.match(r.stderr, /board\/plot-deliver\.mjs/, 'names the missing file');
  assert.match(r.stderr, /update the plot plugin/i, 'names the plugin-update remedy');
  assert.match(r.stderr, /pnpm build:board/, 'names the local-build remedy');
  assert.equal(r.stdout, '', 'prints nothing on stdout');
});

test('a present bundle receives the arguments and its exit code passes through', () => {
  const dir = launcherCopy(
    "process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n",
  );
  const r = spawnSync('bash', [path.join(dir, 'plot-deliver.sh'), '--release', '1.2.3', 'some-slug'], {
    cwd: dir, encoding: 'utf8',
  });
  assert.equal(r.status, 7, `exit code passes through (stderr: ${r.stderr})`);
  assert.deepEqual(JSON.parse(r.stdout), ['--release', '1.2.3', 'some-slug']);
});
