// The server's bootstrap contract: which port it binds, whether it says so,
// what reaches the same-origin check, and what a second board does.
//
// One root cause wears three costumes here — a port chosen at one moment and
// used at another. It cost a CI flake, a failed `pnpm board` start, and a tab
// bookmarked on a dead port, all on one day. These tests hold the three shut.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {
  ARTIFACT,
  REPO_ROOT,
  SCRIPTS_DIR,
  startServer,
  fetchBoard,
  makeRepo,
  makeStubScripts,
  writeImplementCommand,
  request,
  rmTree,
} from './helpers.mjs';

const APPROVED = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/**
 * Start the artifact raw and collect its first stdout line plus exit code.
 * Deliberately NOT `startServer`: these tests are about what the bootstrap
 * prints and whether it stays alive, which the readiness helper hides.
 */
function runServer(cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [ARTIFACT], {
      cwd,
      env: {
        ...process.env,
        PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
        PLOT_REPO_ROOT: cwd,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c.toString()));
    proc.stderr.on('data', (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr, code: null, timedOut: true });
    }, 5000);
    proc.on('error', reject);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });
  });
}

describe('PORT=0 binds zero and reports what the OS gave', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) rmTree(tmp);
  });

  it('reports a real port, not the zero it asked for', () => {
    // The whole point: 0 is a request, never an address. A helper that echoed
    // back what it passed in would pass a weaker version of this test.
    assert.ok(server.port > 0, `expected an assigned port, got ${server.port}`);
    assert.notEqual(server.port, 0);
  });

  it('the reported port is the one that answers', async () => {
    // Asserted against a request that reaches it, not against the number the
    // process intended to use — those were two separate facts before this fix.
    const board = await fetchBoard(server.port);
    assert.ok(board.generatedAt, 'expected a board payload from the reported port');
    assert.equal(board.columns.length, 5);
  });
});

describe('the BOUND port reaches the same-origin check', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    // Configure the Implement command — dispatch now calls /plot-implement first.
    writeImplementCommand(tmp, { bin: stub.implementBin });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('accepts a same-origin browser request under PORT=0', async () => {
    // The assertion that catches the whole class. `const PORT` was read at
    // module load, before listen(); under PORT=0 the allowlist would have read
    // `http://localhost:0` and refused EVERY browser origin — silently
    // disabling Start work, the one endpoint that spawns processes. A dispatch
    // endpoint that fails closed looks like nothing is wrong until someone
    // presses the button.
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: `http://localhost:${server.port}`,
      },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.notEqual(res.status, 403, `refused a same-origin request: ${res.body}`);
    assert.equal(res.status, 202);
  });

  it('still refuses an origin naming a different port', async () => {
    // Reading the bound port must not have widened the allowlist into
    // accepting anything: the guard is still a guard.
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/dispatch',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: `http://localhost:${server.port + 1}`,
      },
      body: JSON.stringify({ slug: 'ship-the-widget' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('the default port is unchanged', () => {
  let tmp;

  before(() => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
  });

  after(() => {
    if (tmp) rmTree(tmp);
  });

  it('starting without PORT still binds 7777', async (t) => {
    // The isolation belongs to the TESTS. A dev board that wandered to a new
    // address every start would trade one lost-address problem for a permanent
    // one — bookmarks and `pnpm board` both depend on 7777 staying put.
    //
    // Skipped rather than failed when 7777 is already taken: a developer's own
    // board is not a regression, and the alternative is a test that fails on
    // the machine of anyone running the thing it protects.
    const busy = await portInUse(7777);
    if (busy) {
      t.skip('port 7777 is already in use on this machine');
      return;
    }
    // PORT is DELETED, not set to '': the default is what is under test, and
    // an empty string is a value that Number() would turn into 0 — the one
    // case that would make this test pass while binding something else.
    const env = { ...process.env, PLOT_SCRIPTS_DIR: SCRIPTS_DIR, PLOT_REPO_ROOT: tmp };
    delete env.PORT;
    const proc = spawn('node', [ARTIFACT], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const line = await firstLine(proc);
      assert.match(line, /http:\/\/localhost:7777/);
    } finally {
      proc.kill('SIGTERM');
    }
  });
});

describe('the board answers on both loopback families', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    stub = makeStubScripts();
    writeImplementCommand(tmp, { bin: stub.implementBin });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (tmp) rmTree(tmp);
  });

  it('answers at 127.0.0.1 AND at ::1, against one running board', async () => {
    // THE assertion that separates the fix from the defect, and the reason it
    // names both addresses rather than `localhost`: that name resolves to
    // whichever family this machine prefers, so a request to it passes today,
    // unfixed, against a board bound to one family alone.
    //
    // Measured on Node v24.4.1, 2026-09-12: `listen(port, 'localhost')` binds
    // `::1` only, and a request to 127.0.0.1 gets ECONNREFUSED from a server
    // that is up. Observed on the operator's board 2026-09-11 as `lsof`
    // reporting `TCP [::1]:7777 (LISTEN)` while the page showed no contact for
    // 18 polls.
    for (const host of ['127.0.0.1', '::1']) {
      const res = await request(server.port, { path: '/api/board', host });
      assert.equal(res.status, 200, `no answer at ${host}: ${res.body}`);
      assert.ok(JSON.parse(res.body).generatedAt, `no board payload at ${host}`);
    }
  });

  it('binds both families on the SAME port under PORT=0', async () => {
    // Catches a second bind that asked for `0` again instead of the port the
    // first was given: the OS would assign a second, different port, the first
    // family would work, and the second would answer somewhere nobody looks.
    // `startServer` runs under PORT=0, so the port below was OS-assigned during
    // the first listen — both answers above came from this one number.
    assert.ok(server.port > 0);
    const [four, six] = await Promise.all([
      request(server.port, { path: '/api/board', host: '127.0.0.1' }),
      request(server.port, { path: '/api/board', host: '::1' }),
    ]);
    assert.equal(four.status, 200, 'IPv4 did not answer on the reported port');
    assert.equal(six.status, 200, 'IPv6 did not answer on the reported port');
  });

  it('keeps the write gate open on both families', async () => {
    // Catches the `listen(port)` / `'::'` trap, which fails NO other test: the
    // board comes up, /api/board answers correctly, and only the capabilities
    // are dead. `isLocalCaller` is a three-value string equality over
    // `localhost`, `127.0.0.1` and `::1`; the IPv6 wildcard `::` is in none of
    // them, so a board bound there refuses all ten capabilities with "the board
    // is bound to :: , not localhost" — a healthy process with broken buttons,
    // the same shape of failure this suite's subject is fixing.
    //
    // Asserted as "not 403" rather than as one status: 403 is the gate refusing,
    // and every other code means the request reached the handler behind it.
    for (const host of ['127.0.0.1', '::1']) {
      const res = await request(server.port, {
        method: 'POST',
        path: '/api/dispatch',
        host,
        headers: {
          'sec-fetch-site': 'same-origin',
          origin: `http://localhost:${server.port}`,
        },
        body: JSON.stringify({ slug: 'ship-the-widget' }),
      });
      assert.notEqual(res.status, 403, `the write gate refused a caller at ${host}: ${res.body}`);
    }
  });

  it('expands only a DEFAULT host, leaving an explicit HOST alone', async () => {
    // An operator who named HOST chose an address, and quietly binding a second
    // one would widen a surface they narrowed — the `0.0.0.0` path above all,
    // which index.ts:141 records as having once published every write endpoint
    // to every interface the machine had.
    //
    // The source is the assertion: the expansion reads `process.env.HOST`
    // directly rather than the derived constant, which has already collapsed
    // "unset" and "set to localhost" into one value.
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/board/src/server/index.ts'),
      'utf8',
    );
    assert.match(
      src,
      /process\.env\.HOST\s*\?\s*\[HOST\]\s*:\s*\['::1',\s*'127\.0\.0\.1'\]/,
      'the bind list must expand only when HOST is unset',
    );
  });
});

describe('a second board names the first and exits', () => {
  let tmp, first;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    first = await startServer(tmp);
  });

  after(() => {
    first?.kill();
    if (tmp) rmTree(tmp);
  });

  it('reports the running address and exits 0 without starting a second', async () => {
    // Today's behaviour was a raw EADDRINUSE stack trace: it states that a port
    // is taken without saying by what, or where to go instead. Seven board
    // servers accumulated on 2026-08-16 at 80 GraphQL calls/hour each because
    // nothing connected a new invocation to an existing one.
    const second = await runServer(tmp, { PORT: String(first.port) });
    assert.equal(second.timedOut, false, 'a second board must not keep running');
    assert.equal(second.code, 0, `expected exit 0, got ${second.code}\n${second.stderr}`);
    // Naming the address is the point — exiting quietly would leave the reader
    // with exactly the question the EADDRINUSE trace left them with.
    assert.match(second.stdout, new RegExp(`already running at http://localhost:${first.port}`));
  });

  it('does not kill the running board', async () => {
    // NOT kill-and-restart: a `pnpm board` in one terminal would shoot down the
    // board of another worktree, and several ran side by side the day this was
    // found.
    const board = await fetchBoard(first.port);
    assert.ok(board.generatedAt, 'the first board stopped answering');
  });

  it('detects the running board via the failed listen, not a prior probe', () => {
    // Probing first would rebuild, inside this very fix, the check-then-act
    // race the fix exists to remove. The source is the assertion: the bootstrap
    // reaches for the EADDRINUSE error code and never opens a probe socket.
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/board/src/server/index.ts'),
      'utf8',
    );
    assert.match(src, /EADDRINUSE/, 'expected the bootstrap to catch EADDRINUSE');
    assert.doesNotMatch(
      src,
      /net\.(createServer|createConnection|connect)/,
      'the bootstrap must not probe a port before binding it',
    );
  });
});

describe('no port is chosen before it is bound', () => {
  it('findFreePort no longer exists', async () => {
    // The assertion that fails if someone later "restores" the helper for
    // convenience. Bind-read-close-hand-over is the defect, not a detail of
    // one test file.
    const helpers = await import('./helpers.mjs');
    assert.equal(helpers.findFreePort, undefined);
    const src = fs.readFileSync(new URL('./helpers.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /findFreePort/);
  });

  it('no test file passes a port to startServer', () => {
    // All call sites, not the one that was seen to fail: migrating a single
    // file would leave the same race in seven that have merely not failed yet.
    const testDir = path.dirname(new URL(import.meta.url).pathname);
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'fixtures') walk(full);
        } else if (/\.(mjs|ts)$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(testDir);
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // startServer(cwd) or startServer(cwd, envObject) — never a number, and
      // never a call whose second argument is a port.
      for (const [, args] of src.matchAll(/startServer\(([^)]*)\)/g)) {
        assert.doesNotMatch(
          args,
          /findFreePort|\b\d{4,5}\b/,
          `${path.basename(file)} passes a port to startServer: startServer(${args})`,
        );
      }
    }
  });
});

/** Is something already listening on this port? Used only to SKIP a test. */
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

/** Resolve the first stdout line carrying the readiness URL. */
function firstLine(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no readiness line in 5s: ${out}`)), 5000);
    proc.stdout.on('data', (c) => {
      out += c.toString();
      const match = /http:\/\/localhost:\d+/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}) before ready: ${out}`));
    });
  });
}
