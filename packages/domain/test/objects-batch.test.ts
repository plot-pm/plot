import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  DROP_LIMIT,
  PAUSE_MS,
  listBlobsThrough,
  objectsBatch,
  type ObjectsBatch,
  type ObjectsBatchOptions,
} from '../src/adapters/refs/objects-batch.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';

/**
 * The object reader against a real sandbox repository, and against a stub
 * `git` on `PATH` that counts its starts and, by a mode file, wedges, exits,
 * closes stdin or writes a header out of step.
 */

const ISOLATED = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: ISOLATED,
  }).trim();

const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

/**
 * The stub: logs each start, then acts as its mode file says. A wedged stub
 * runs `sleep`, which keeps stdout open and never answers; redirecting stdout
 * would close the pipe and read as an exit.
 */
const STUB = `#!/bin/sh
echo "$*" >> "$OBJECTS_TEST_LOG"
mode=$(cat "$OBJECTS_TEST_MODE" 2>/dev/null)
case "$mode" in
  wedge) exec sleep 60 ;;
  exit) exec head -c 1 >/dev/null ;;
  epipe) exec 0<&-; exec sleep 30 ;;
  garbage) printf 'this is not a header\\n'; exec sleep 60 ;;
  wrong-oid) printf '%s blob 1\\nx\\n' ${'0'.repeat(40)}; exec sleep 60 ;;
esac
exec "${REAL_GIT}" "$@"
`;

let root = '';
let repo = '';
let stubDir = '';
let log = '';
let mode = '';
const readers: ObjectsBatch[] = [];

/** Text, blob id and commit id of the sandbox's first commit. */
const sandbox = { commit: '', plain: '', arrows: '', tricky: '' };

const CONTENT = {
  plain: 'plain text\n',
  arrows: 'a — b → c\n',
  // A body holding a newline and a line shaped like a header.
  tricky: `line one\n${'f'.repeat(40)} blob 3\nend`,
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-objects-batch-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet');
  for (const [name, text] of Object.entries(CONTENT)) fs.writeFileSync(path.join(repo, `${name}.txt`), text);
  fs.mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/plans/a.md'), '# a\n');
  fs.writeFileSync(path.join(repo, 'docs/plans/active/b.md'), '# b\n');
  fs.writeFileSync(path.join(repo, 'docs/run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync('a.md', path.join(repo, 'docs/plans/link.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'first');
  sandbox.commit = git(repo, 'rev-parse', 'HEAD');
  for (const name of Object.keys(CONTENT) as (keyof typeof CONTENT)[]) {
    sandbox[name] = git(repo, 'rev-parse', `HEAD:${name}.txt`);
  }

  stubDir = path.join(root, 'bin');
  fs.mkdirSync(stubDir);
  fs.writeFileSync(path.join(stubDir, 'git'), STUB, { mode: 0o755 });
  log = path.join(root, 'starts.log');
  mode = path.join(root, 'mode');
});

afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
  fs.rmSync(log, { force: true });
  fs.rmSync(mode, { force: true });
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

/** A reader whose `git` is the counting stub. */
const reader = (extra: Partial<ObjectsBatchOptions> = {}, cwd = repo): ObjectsBatch => {
  const made = objectsBatch({
    repoRoot: cwd,
    env: { PATH: `${stubDir}:${process.env.PATH ?? ''}`, OBJECTS_TEST_LOG: log, OBJECTS_TEST_MODE: mode, ...ISOLATED_GIT },
    ...extra,
  });
  readers.push(made);
  return made;
};

const starts = (): number => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
const setMode = (word: string): void => fs.writeFileSync(mode, word);
const text = (answer: unknown): string | undefined =>
  (answer as { body?: Buffer }).body?.toString('utf8');

describe('objectsBatch: one process answers many reads', () => {
  it('starts one git process for 100 contents and info requests', async () => {
    const batch = reader();
    const asks = Array.from({ length: 100 }, (_, at) =>
      at % 2 === 0 ? batch.contents([sandbox.plain]) : batch.info([sandbox.arrows]),
    );
    const results = await Promise.all(asks);
    expect(results.every((one) => one.ok)).toBe(true);
    expect(text((results[0] as { value: readonly unknown[] }).value[0])).toBe(CONTENT.plain);
    expect((results[1] as { value: readonly unknown[] }).value[0]).toEqual({
      found: true, oid: sandbox.arrows, type: 'blob', size: Buffer.byteLength(CONTENT.arrows),
    });
    expect(starts()).toBe(1);
    expect(batch.drops()).toEqual([]);
  });

  it('keeps order and bytes when blobs with — and → interleave with missing answers', async () => {
    const batch = reader();
    const absent = '0'.repeat(40);
    const result = await batch.contents([
      sandbox.arrows, absent, sandbox.tricky, `${sandbox.commit}:no/such/path`, sandbox.plain, sandbox.arrows,
    ]);
    if (!result.ok) throw new Error('expected an answer');
    expect(result.value.map((one) => (one.found ? text(one) : one.why))).toEqual([
      CONTENT.arrows, 'missing', CONTENT.tricky, 'missing', CONTENT.plain, CONTENT.arrows,
    ]);
    const info = await batch.info([absent, `${sandbox.commit}:arrows.txt`]);
    expect(info).toEqual({
      ok: true,
      value: [
        { found: false, why: 'missing' },
        { found: true, oid: sandbox.arrows, type: 'blob', size: Buffer.byteLength(CONTENT.arrows) },
      ],
    });
    expect(starts()).toBe(1);
  });

  it('answers an empty request with no process', async () => {
    expect(await reader().contents([])).toEqual({ ok: true, value: [] });
    expect(starts()).toBe(0);
  });

  it('reads a blob larger than one pipe chunk', async () => {
    const big = 'x→'.repeat(200_000);
    const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: big, encoding: 'utf8' }).trim();
    const result = await reader().contents([sha]);
    expect(result.ok && text(result.value[0])).toBe(big);
  });
});

describe('objectsBatch: a ref name never reaches the process', () => {
  it.each([
    ['origin/main', 'origin/main'],
    ['HEAD', 'HEAD'],
    ['a short id', 'abc1234'],
    ['a path holding a newline', `${'a'.repeat(40)}:docs/x\nflush`],
    ['a path holding a NUL', `${'a'.repeat(40)}:docs/x\0y`],
  ])('refuses %s before it writes to stdin', async (_, name) => {
    const batch = reader();
    const result = await batch.contents([sandbox.plain, name]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.why).toBe('unaskable');
    expect(starts()).toBe(0);
  });
});

describe('objectsBatch: a wedged process fails its reads and is replaced', () => {
  it('fails the request in flight and 2 queued ones after timeoutMs, then starts a new process', async () => {
    setMode('wedge');
    const timeoutMs = 300;
    const batch = reader({ timeoutMs });
    const began = Date.now();
    const results = await Promise.all([
      batch.contents([sandbox.plain]),
      batch.info([sandbox.arrows]),
      batch.contents([sandbox.tricky]),
    ]);
    expect(Date.now() - began).toBeGreaterThanOrEqual(timeoutMs - 5);
    expect(results).toEqual([{ ok: false, why: 'failed' }, { ok: false, why: 'failed' }, { ok: false, why: 'failed' }]);
    expect(batch.drops().map((one) => one.cause)).toEqual(['timeout']);

    fs.rmSync(mode);
    const next = await batch.contents([sandbox.plain]);
    expect(next.ok && text(next.value[0])).toBe(CONTENT.plain);
    expect(starts()).toBe(2);
  });
});

describe('objectsBatch: an exit, EPIPE or out-of-step header is a drop', () => {
  it.each([
    ['exit', 'exit', 1],
    ['epipe', 'epipe', 10_000],
    ['garbage', 'out-of-step', 1],
    ['wrong-oid', 'out-of-step', 1],
  ] as const)('stub %s drops with cause %s and fails every pending request', async (word, cause, count) => {
    setMode(word);
    const batch = reader({ timeoutMs: 5_000 });
    // EPIPE needs a write larger than the pipe buffer, so its tail is written after the stub closed stdin.
    const asked = Array.from({ length: count }, () => sandbox.plain);
    const began = Date.now();
    const results = await Promise.all([batch.contents(asked), batch.info([sandbox.arrows])]);
    expect(results).toEqual([{ ok: false, why: 'failed' }, { ok: false, why: 'failed' }]);
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(batch.drops().map((one) => one.cause)).toEqual([cause]);

    fs.rmSync(mode);
    const next = await batch.contents([sandbox.plain]);
    expect(next.ok && text(next.value[0])).toBe(CONTENT.plain);
    expect(starts()).toBe(2);
  });
});

describe('objectsBatch: repeated drops fall back, never stop', () => {
  it(`answers unaskable for 60 s after ${DROP_LIMIT} drops within 60 s, and refsGit.readBlobs still answers`, async () => {
    setMode('exit');
    let clock = 1_000_000;
    const batch = reader({ now: () => clock });
    for (let at = 0; at < DROP_LIMIT; at += 1) {
      expect(await batch.contents([sandbox.plain])).toEqual({ ok: false, why: 'failed' });
      clock += 10_000;
    }
    expect(starts()).toBe(DROP_LIMIT);

    const paused = await batch.contents([sandbox.plain]);
    expect(paused.ok === false && paused.why).toBe('unaskable');
    expect(starts()).toBe(DROP_LIMIT);

    const perCall = await refsGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') }).readBlobs([sandbox.arrows]);
    expect(perCall.ok && perCall.value.get(sandbox.arrows)).toBe(CONTENT.arrows);

    clock = batch.drops().at(-1)!.at + PAUSE_MS - 1;
    expect((await batch.info([sandbox.plain])).ok).toBe(false);
    expect(starts()).toBe(DROP_LIMIT);

    fs.rmSync(mode);
    clock += 1;
    const again = await batch.contents([sandbox.plain]);
    expect(again.ok && text(again.value[0])).toBe(CONTENT.plain);
    expect(starts()).toBe(DROP_LIMIT + 1);
  });

  it('does not pause on drops spread wider than 60 s', async () => {
    setMode('exit');
    let clock = 0;
    const batch = reader({ now: () => clock });
    for (let at = 0; at < DROP_LIMIT; at += 1) {
      await batch.contents([sandbox.plain]);
      clock += 31_000;
    }
    fs.rmSync(mode);
    const answered = await batch.contents([sandbox.plain]);
    expect(answered.ok).toBe(true);
  });
});

describe('objectsBatch: a fetch after start is visible', () => {
  it('reads a blob fetched into a new pack after the reader started, through the same process', async () => {
    const origin = path.join(root, 'origin');
    const clone = path.join(root, 'clone');
    git(root, 'clone', '--quiet', repo, origin);
    git(root, 'clone', '--quiet', origin, clone);
    const batch = reader({}, clone);
    const before = await batch.contents([sandbox.plain]);
    expect(before.ok && text(before.value[0])).toBe(CONTENT.plain);

    fs.writeFileSync(path.join(origin, 'fresh.txt'), 'fetched — later\n');
    git(origin, 'add', 'fresh.txt');
    git(origin, 'commit', '--quiet', '-m', 'fresh');
    git(clone, '-c', 'fetch.unpackLimit=1', 'fetch', '--quiet', 'origin');
    const fresh = git(clone, 'rev-parse', 'origin/main:fresh.txt');

    const after = await batch.contents([fresh]);
    expect(after.ok && text(after.value[0])).toBe('fetched — later\n');
    expect(starts()).toBe(1);
  });
});

describe('objectsBatch: close', () => {
  it('fails a pending request and refuses every later one', async () => {
    setMode('wedge');
    const batch = reader();
    const pending = batch.contents([sandbox.plain]);
    batch.close();
    expect(await pending).toEqual({ ok: false, why: 'failed' });
    const later = await batch.contents([sandbox.plain]);
    expect(later.ok === false && later.why).toBe('unaskable');
  });

  it('runs with an explicit git directory', async () => {
    const batch = reader({ gitDir: path.join(repo, '.git') }, root);
    const result = await batch.contents([sandbox.plain]);
    expect(result.ok && text(result.value[0])).toBe(CONTENT.plain);
  });
});

describe('listBlobsThrough: a tree listing from tree objects', () => {
  const lsTree = (dir: string): string[] =>
    execFileSync('git', ['ls-tree', '-r', '-z', sandbox.commit, ...(dir === '' ? [] : ['--', dir])], { cwd: repo, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const asLsTree = (blobs: readonly { mode: string; sha: string; path: string }[]): string[] =>
    blobs.map((blob) => `${blob.mode} blob ${blob.sha}\t${blob.path}`);

  it.each(['', '.', 'docs', 'docs/plans', 'docs/plans/', 'docs/plans/a.md', 'docs/run.sh', 'arrows.txt', 'no/such'])(
    'lists %j as ls-tree -r does',
    async (dir) => {
      const listed = await listBlobsThrough(reader(), sandbox.commit, dir);
      if (!listed.ok) throw new Error('expected an answer');
      expect(asLsTree(listed.value)).toEqual(lsTree(dir === '.' ? '' : dir));
    },
  );

  it('passes the reader refusal through', async () => {
    const listed = await listBlobsThrough(reader(), 'origin/main', 'docs');
    expect(listed.ok === false && listed.why).toBe('unaskable');
  });

  it('answers failed when the reader drops', async () => {
    setMode('exit');
    expect(await listBlobsThrough(reader(), sandbox.commit, 'docs')).toEqual({ ok: false, why: 'failed' });
  });
});
