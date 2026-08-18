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
