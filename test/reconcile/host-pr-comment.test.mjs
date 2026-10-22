// `plot-host.sh pr-comment <number> <body>` — one comment on a PR's
// timeline through the signed-in `gh` identity on GitHub, exit 4 on Bitbucket.
// The `gh` and `bb` on PATH are stubs that log their argv; nothing reaches a
// real host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

/** A scratch repo whose `gh` and `bb` log their argv to `calls` and run `ghTail`/`bbTail`. */
const sandbox = ({ ghTail = 'exit 0', bbTail = 'exit 0' } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-host-pr-comment-'));
  made.push(root);
  execFileSync('git', ['init', '-q', root]);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'calls');
  const stub = (name, tail) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${tail}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('gh', ghTail);
  stub('bb', bbTail);
  return { root, bin, calls };
};

const prComment = (box, backend, args) =>
  new Promise((resolve) => {
    const child = spawn('bash', [adapter, 'pr-comment', ...args], {
      cwd: box.root,
      env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, PLOT_HOST: backend },
    });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => resolve({ code, err }));
  });

const callLog = (box) => (fs.existsSync(box.calls) ? fs.readFileSync(box.calls, 'utf8') : '');

test('pr-comment: GitHub posts the body through gh pr comment and exits 0', async () => {
  const box = sandbox();
  const got = await prComment(box, 'github', ['7', 'HIGH 1, MEDIUM 0, LOW 0']);
  assert.equal(got.code, 0, got.err);
  assert.match(callLog(box), /^gh pr comment 7 --body HIGH 1, MEDIUM 0, LOW 0$/m);
});

test('pr-comment: a gh call that fails exits 3 with gh’s own words', async () => {
  const box = sandbox({ ghTail: 'echo "HTTP 403: Resource not accessible" >&2; exit 1' });
  const got = await prComment(box, 'github', ['7', 'b']);
  assert.equal(got.code, 3);
  assert.match(got.err, /HTTP 403: Resource not accessible/);
});

test('pr-comment: Bitbucket exits 4, names the backend, and calls neither CLI', async () => {
  const box = sandbox();
  const got = await prComment(box, 'bitbucket', ['7', 'b']);
  assert.equal(got.code, 4);
  assert.match(got.err, /pr-comment: bitbucket has no verified pr-comment write/);
  assert.doesNotMatch(callLog(box), /^(gh|bb) pr comment/m);
});
