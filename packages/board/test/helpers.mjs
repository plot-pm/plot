// Test harness: spin up the BUILT board artifact against a scratch repo and
// query GET /api/board. Testing the shipped artifact (not the TS source) means
// these tests exercise exactly what plot ships — server, zod contract, and the
// real plot-plan-meta.sh / plot-config.sh helpers.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills/plot/scripts');
export const ARTIFACT = path.join(SCRIPTS_DIR, 'board/board-server.mjs');

/**
 * Start the built artifact with cwd = the scratch repo. PLOT_SCRIPTS_DIR points
 * the server at this repo's real helper scripts (the artifact ships next to
 * them in production, but in a scratch repo they live elsewhere).
 *
 * `PORT=0`: the OS assigns during the server's own `listen()`, so there is no
 * moment when a port is known-free but unbound. The predecessor of this helper
 * bound port 0, read the number, CLOSED, and handed it to this process to bind
 * later — a time-of-check-to-time-of-use race that CI, running test files in
 * parallel on one machine, lost often enough to gate a plan PR on a flake.
 *
 * The bound port comes back the way it always could have: the readiness line
 * this helper already waits on carries it.
 */
export function startServer(cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [ARTIFACT], {
      cwd,
      env: {
        ...process.env,
        PORT: '0',
        PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
        PLOT_REPO_ROOT: cwd,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let stdout = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        proc.kill('SIGTERM');
        reject(new Error(`server did not start in 5s.\nstderr: ${stderr.join('')}`));
      }
    }, 5000);
    proc.stdout.on('data', (chunk) => {
      if (done) return;
      stdout += chunk.toString();
      const match = /http:\/\/localhost:(\d+)/.exec(stdout);
      if (!match) return;
      done = true;
      clearTimeout(timer);
      resolve({ port: Number(match[1]), kill: () => proc.kill('SIGTERM') });
    });
    proc.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!done) reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (!done) reject(new Error(`server exited (${code}) before ready.\nstderr: ${stderr.join('')}`));
    });
  });
}

/** GET an arbitrary path; resolve { status, body, headers } without parsing. */
export function fetchRaw(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}${pathname}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      })
      .on('error', reject);
  });
}

/**
 * Issue an arbitrary request (any verb, any headers, optional body) and resolve
 * { status, body, headers } without parsing. The 405 guard and the same-origin
 * check are both things only a non-GET, header-bearing request can exercise.
 */
export function request(port, { method = 'GET', path: pathname = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    const req = http.request(
      {
        // `localhost`, matching the other helpers: the server binds to whatever
        // HOST names, and on a dual-stack machine that resolves to ::1 — a
        // hardcoded 127.0.0.1 would be refused by a server listening on IPv6.
        host: 'localhost',
        port,
        path: pathname,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * A stand-in scripts dir whose `plot-dispatch.sh` only records that it ran.
 *
 * The tests must NEVER run a real dispatch: it would create a worktree beside
 * the temp repo and push a claim from CI. The stub is what makes "a refused
 * request spawned nothing" an assertion about a file that does or does not
 * exist, rather than a hope.
 *
 * Every other helper the server needs is symlinked from the real scripts dir,
 * so the board still parses plans exactly as it ships.
 */
export function makeStubScripts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-stub-'));
  const marker = path.join(dir, 'dispatch-ran.txt');
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-dispatch.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\necho "stub dispatch: $*"\n`,
    { mode: 0o755 },
  );
  return {
    dir,
    marker,
    /** How many times the stub ran. 0 is the assertion that matters most. */
    runs: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean)
        : [],
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Give a scratch repo an `Approve command` pointing at a stub, and hand back a
 * reader for what that stub was asked to do.
 *
 * The tests must NEVER run a real approval: it merges a plan PR on the git
 * host, which is undoable only by more git. The stub is what makes "a refused
 * request approved nothing" an assertion about a file rather than a hope.
 *
 * `script` is the stub's body, defaulting to one that records its arguments and
 * exits 0. Pass one that writes to stderr and exits non-zero to exercise the
 * path the plan cares most about — a failure surfacing its OWN words.
 *
 * Re-callable: a repo can be given a different command mid-test, which is how
 * the slow-command case gets a stub that sleeps without a second repo.
 */
export function writeApproveCommand(repo, { script } = {}) {
  const bin = path.join(repo, 'approve-stub.sh');
  const marker = path.join(repo, 'approve-ran.txt');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n${
      script ?? ''
    }`,
    { mode: 0o755 },
  );
  // The config the server reads. `plot-config.sh` looks for a `## Plot Config`
  // section in the repo-root CLAUDE.md, so the scratch repo gets a real one.
  const claude = path.join(repo, 'CLAUDE.md');
  const existing = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : '';
  if (!/^##\s*Plot Config/im.test(existing)) {
    fs.writeFileSync(claude, `${existing}\n## Plot Config\n\n- **Approve command:** ${bin}\n`, 'utf8');
  }
  return {
    bin,
    marker,
    /** What the stub was invoked with, one entry per run. [] is the assertion that matters most. */
    runs: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean)
        : [],
  };
}

/** GET /api/board and parse the JSON body. */
export function fetchBoard(port) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}/api/board`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`bad JSON: ${data}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Scaffold a scratch repo.
 * @param {{
 *   plans?: Array<{ name: string, content: string }>,
 *   active?: string[],            // plan filenames to symlink into active/
 *   brokenActive?: string[],      // active/ symlinks pointing nowhere
 *   sprints?: Array<{ name: string, content: string }>,
 *   stories?: Array<{ dir: string, file: string, content: string }>,
 * }} spec
 */
export function makeRepo(spec = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-test-'));
  const plansDir = path.join(tmp, 'docs/plans');
  fs.mkdirSync(plansDir, { recursive: true });
  for (const p of spec.plans ?? []) {
    fs.writeFileSync(path.join(plansDir, p.name), p.content, 'utf8');
  }
  if ((spec.active ?? []).length || (spec.brokenActive ?? []).length) {
    const activeDir = path.join(plansDir, 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    for (const name of spec.active ?? []) {
      fs.symlinkSync(path.join(plansDir, name), path.join(activeDir, name));
    }
    for (const name of spec.brokenActive ?? []) {
      fs.symlinkSync(path.join(plansDir, name), path.join(activeDir, name));
    }
  }
  for (const s of spec.sprints ?? []) {
    const dir = path.join(tmp, 'docs/sprints/active');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, s.name), s.content, 'utf8');
  }
  for (const s of spec.stories ?? []) {
    const dir = path.join(tmp, 'docs/stories', s.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, s.file), s.content, 'utf8');
  }
  return tmp;
}
