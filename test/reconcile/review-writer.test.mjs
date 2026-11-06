// Contract test for `plot-review-writer.mjs`: the `<slug>[bot]` login that
// `Review app` names, read from the pushed default branch and never from the
// working tree. `GET /app` is answered by a local server through GITHUB_API_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-review-writer.mjs');

const made = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  made.push(d);
  return d;
};
const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

let server;
let apiUrl;
let keyPath;
before(async () => {
  const root = tmp('review-writer-key');
  keyPath = path.join(root, 'app.pem');
  execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'ignore' });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/app') res.end(JSON.stringify({ slug: 'plot-review' }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const config = (reviewApp) => `# Project\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n${reviewApp === null ? '' : `- **Review app:** ${reviewApp}\n`}`;

/** A clone whose `origin/main` holds `pushed` as CLAUDE.md; `work` is then written to the working tree only. */
const repo = ({ pushed, work = null, push = true }) => {
  const t = tmp('review-writer-repo');
  const origin = path.join(t, 'origin.git');
  const dir = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'init', '-q', '-b', 'main', dir);
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), config(pushed));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  if (push) {
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'fetch', '-q', 'origin');
  }
  if (work !== null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), config(work));
  return dir;
};

const run = (cwd) => new Promise((resolve) => {
  const child = spawn('node', [script], { cwd, env: { ...process.env, GITHUB_API_URL: apiUrl } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('prints <slug>[bot] for the Review app the pushed default branch declares', async () => {
  const r = await run(repo({ pushed: `1234 ${keyPath}` }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'plot-review[bot]\n');
});

test('prints nothing and exits 0 where the pushed config declares no Review app', async () => {
  const r = await run(repo({ pushed: null }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('a working-tree-only change does not choose the login: the pushed value is read', async () => {
  const r = await run(repo({ pushed: `1234 ${keyPath}`, work: null }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'plot-review[bot]\n');
  const none = await run(repo({ pushed: null, work: `1234 ${keyPath}` }));
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout, '', 'a desk that adds a Review app locally stays unchecked');
});

test('with no origin/<default> ref it exits 4 and names the cause', async () => {
  const r = await run(repo({ pushed: `1234 ${keyPath}`, push: false }));
  assert.equal(r.status, 4);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /no origin\/<default> ref/);
});

test('an unfetched push reads the old value', async () => {
  const dir = repo({ pushed: null });
  const other = path.join(tmp('review-writer-other'), 'clone');
  git(path.dirname(other), 'clone', '-q', git(dir, 'remote', 'get-url', 'origin').trim(), other);
  git(other, 'config', 'user.email', 't@example.com');
  git(other, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(other, 'CLAUDE.md'), config(`1234 ${keyPath}`));
  git(other, 'commit', '-q', '-am', 'declare the review app');
  git(other, 'push', '-q', 'origin', 'main');
  const before = await run(dir);
  assert.equal(before.stdout, '', 'nothing fetched: the old config still reads unchecked');
  git(dir, 'fetch', '-q', 'origin');
  const after = await run(dir);
  assert.equal(after.stdout, 'plot-review[bot]\n');
});

test('a Review app naming an unreadable key file exits 4', async () => {
  const r = await run(repo({ pushed: `1234 ${path.join(os.tmpdir(), 'plot-no-such-key.pem')}` }));
  assert.equal(r.status, 4);
  assert.match(r.stderr, /key file that cannot be read/);
});

/** `run` with a config home holding the key for App `id`. */
const runWithFolder = (cwd, id) => {
  const xdg = tmp('review-writer-xdg');
  fs.mkdirSync(path.join(xdg, 'plot'));
  fs.copyFileSync(keyPath, path.join(xdg, 'plot', `plot-review.${id}.private-key.pem`));
  return new Promise((resolve) => {
    const child = spawn('node', [script], { cwd, env: { ...process.env, GITHUB_API_URL: apiUrl, XDG_CONFIG_HOME: xdg } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
};

test('an id-only Review app line resolves its key from the config folder', async () => {
  const r = await runWithFolder(repo({ pushed: '1234' }), '1234');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'plot-review[bot]\n');
});

test('a working-tree Review app with another id does not replace the pushed one', async () => {
  // The folder holds a key for 1234 only: a read of the working tree's 9999 would refuse.
  const r = await runWithFolder(repo({ pushed: '1234', work: '9999' }), '1234');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'plot-review[bot]\n');
});
