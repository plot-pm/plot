import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `refsGit`'s object reads with an installed reader, against a real sandbox
 * repository. Every start through `node:child_process` is recorded as one
 * command line, so a row can say which `git` a read started.
 */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const wrap = <F extends (...a: never[]) => unknown>(fn: F): F => {
    const wrapped = ((...a: unknown[]) => {
      starts.lines.push([String(a[0]), ...(Array.isArray(a[1]) ? a[1].map(String) : [])].join(' '));
      return (fn as unknown as (...b: unknown[]) => unknown)(...a);
    }) as unknown as F;
    for (const key of Reflect.ownKeys(fn)) {
      if (key === 'length' || key === 'name') continue;
      Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)!);
    }
    return wrapped;
  };
  const counted = { ...real, spawn: wrap(real.spawn), execFile: wrap(real.execFile) };
  return { ...counted, default: counted };
});

import { execFileSync } from 'node:child_process';

import { answered, failed, unaskable, type PortResult } from '../src/port-result.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { objectsBatch, type ObjectsBatch } from '../src/adapters/refs/objects-batch.js';
import { installObjectsReader, objectReaders, type ObjectReaders } from '../src/adapters/refs/object-readers.js';

const ISOLATED = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: ISOLATED,
  }).trim();

/** A path git quotes in `ls-tree` output without `-z`. */
const UNICODE_PLAN = 'docs/plans/ümlaut — plan.md';

let root = '';
let repo = '';
let stubDir = '';
const box = { head: '', tag: '', blob: '', unicodeBlob: '' };
const readers: ObjectsBatch[] = [];

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-object-reader-')));
  repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
  git(repo, 'init', '--quiet');
  fs.writeFileSync(path.join(repo, 'docs/plans/a.md'), '# a — plan\n');
  fs.writeFileSync(path.join(repo, 'docs/plans/active/b.md'), '# b\n');
  fs.writeFileSync(path.join(repo, UNICODE_PLAN), '# ü\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"2.35.0"}\n');
  fs.writeFileSync(path.join(repo, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'first');
  git(repo, 'remote', 'add', 'origin', repo);
  git(repo, 'fetch', '--quiet', 'origin');
  git(repo, 'tag', '-a', 'v1', '-m', 'v1');
  box.head = git(repo, 'rev-parse', 'HEAD');
  box.tag = git(repo, 'rev-parse', 'v1');
  box.blob = git(repo, 'rev-parse', 'HEAD:docs/plans/a.md');
  box.unicodeBlob = git(repo, 'rev-parse', `HEAD:${UNICODE_PLAN}`);

  stubDir = path.join(root, 'bin');
  fs.mkdirSync(stubDir);
});

beforeEach(() => {
  starts.lines.length = 0;
});

afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const context = () => ({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

/** A holder with a real reader installed for the sandbox. */
const withReader = async (): Promise<ObjectReaders> => {
  const held = objectReaders();
  const done = await installObjectsReader(repo, { readers: held });
  if (!done.installed) throw new Error(done.refusal);
  readers.push(done.reader);
  return held;
};

/** A holder whose one reader answers every request with `answer`. */
const fakeHolder = async (answer: () => PortResult<never>): Promise<ObjectReaders> => {
  const held = objectReaders();
  const commonDir = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const fake: ObjectsBatch = {
    contents: async () => answer(),
    info: async () => answer(),
    drops: () => [],
    holdsOpen: () => null,
    close: () => undefined,
  };
  held.install(commonDir, fake);
  return held;
};

/** The object-read starts: `git ls-tree`, `git show` and every `git cat-file`. */
const objectStarts = (): string[] => starts.lines.filter((line) => /^git (ls-tree|show|cat-file)\b/.test(line));

/** Every object read `refsGit` serves, once each. */
const readAll = async (refs: ReturnType<typeof refsGit>) => ({
  blobs: await refs.readBlobs([box.blob, box.unicodeBlob, '0'.repeat(40)]),
  listedByName: await refs.listBlobs('origin/main', 'docs/plans/'),
  listedByOid: await refs.listBlobs(box.head, 'docs/plans'),
  entries: await refs.entriesAt('origin/main', ['run.sh', 'docs/plans/a.md', 'docs/plans', 'docs/plans/none.md', UNICODE_PLAN]),
  shown: await refs.showFile('origin/main', 'package.json'),
  shownMissing: await refs.showFile('origin/main', 'none.json'),
  contained: await refs.containsMany([
    { ancestor: box.head, descendant: 'origin/main' },
    { ancestor: '0'.repeat(40), descendant: 'main' },
  ]),
});

describe('refsGit: object reads through an installed reader', () => {
  it('answers every object read as the per-call path does', async () => {
    const perCall = await readAll(refsGit(context(), undefined, objectReaders()));
    const through = await readAll(refsGit(context(), undefined, await withReader()));

    expect(through).toEqual(perCall);
    expect(through.blobs).toEqual(answered(new Map([[box.blob, '# a — plan\n'], [box.unicodeBlob, '# ü\n']])));
    expect(through.shown).toEqual(answered('{"version":"2.35.0"}\n'));
    expect(through.shownMissing).toEqual(failed());
    expect(through.contained).toEqual(answered(['yes', 'unknown']));
    expect(through.entries.ok && through.entries.value['run.sh']?.mode).toBe('100755');
    expect(through.entries.ok && through.entries.value['docs/plans']).toBeNull();
  });

  it('starts one git cat-file --batch-command and no ls-tree, show, --batch or --batch-check', async () => {
    const refs = refsGit(context(), undefined, await withReader());
    starts.lines.length = 0;
    await readAll(refs);
    await readAll(refs);

    expect(objectStarts()).toEqual(['git cat-file --batch-command --buffer -z']);
  });

  it('runs the per-call git where no reader is installed', async () => {
    await readAll(refsGit(context(), undefined, objectReaders()));

    expect(objectStarts()).toEqual(expect.arrayContaining([
      'git cat-file --batch',
      'git cat-file --batch-check',
      'git ls-tree -r -z origin/main -- docs/plans/',
      'git show origin/main:package.json',
    ]));
  });

  it('runs the per-call git for a name only git resolves', async () => {
    const refs = refsGit(context(), undefined, await withReader());
    const listed = await refs.listBlobs('origin/main~0', 'docs/plans');

    expect(listed.ok && listed.value.length).toBe(3);
    expect(objectStarts()).toContain('git ls-tree -r -z origin/main~0 -- docs/plans');
  });

  it('peels a tag on the per-call path', async () => {
    const refs = refsGit(context(), undefined, await withReader());

    expect(await refs.containsMany([{ ancestor: box.tag, descendant: 'main' }])).toEqual(answered(['yes']));
    expect(objectStarts()).toContain('git cat-file --batch-check');
  });
});

describe('refsGit: a non-ASCII path reads the same on both paths', () => {
  it('lists the path unquoted, per call and through the reader', async () => {
    const perCall = await refsGit(context(), undefined, objectReaders()).listBlobs('origin/main', 'docs/plans');
    const through = await refsGit(context(), undefined, await withReader()).listBlobs('origin/main', 'docs/plans');

    expect(through).toEqual(perCall);
    expect(perCall.ok && perCall.value.map((blob) => blob.path)).toContain(UNICODE_PLAN);
  });
});

describe('refsGit: a checkout root below the repository top level', () => {
  it('lists blobs relative to that directory, as ls-tree run there does', async () => {
    const sub = path.join(repo, 'docs');
    const subContext = { repoRoot: sub, scriptDir: path.join(sub, 'scripts') };
    const held = objectReaders();
    const done = await installObjectsReader(repo, { readers: held });
    if (!done.installed) throw new Error(done.refusal);
    readers.push(done.reader);

    const perCall = await refsGit(subContext, undefined, objectReaders()).listBlobs(box.head, 'plans/');
    const through = await refsGit(subContext, undefined, held).listBlobs(box.head, 'plans/');

    expect(perCall.ok && perCall.value.map((blob) => blob.path).sort()).toEqual(
      ['plans/a.md', 'plans/active/b.md', 'plans/ümlaut — plan.md'],
    );
    expect(through).toEqual(perCall);
  });
});

describe('refsGit: the reader falls back, never stops', () => {
  it('runs the per-call git while the reader answers unaskable after 3 drops', async () => {
    fs.writeFileSync(path.join(stubDir, 'git'), '#!/bin/sh\nexec head -c 1 >/dev/null\n', { mode: 0o755 });
    const paused = objectsBatch({ repoRoot: repo, env: { PATH: `${stubDir}:${process.env.PATH ?? ''}` } });
    readers.push(paused);
    for (let drop = 0; drop < 3; drop += 1) expect(await paused.contents([box.blob])).toEqual(failed());
    expect((await paused.contents([box.blob])).ok).toBe(false);
    expect(await paused.contents([box.blob])).toMatchObject({ why: 'unaskable' });

    const held = objectReaders();
    held.install(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), paused);
    const refs = refsGit(context(), undefined, held);
    starts.lines.length = 0;

    expect(await refs.readBlobs([box.blob])).toEqual(answered(new Map([[box.blob, '# a — plan\n']])));
    expect((await refs.listBlobs('origin/main', 'docs/plans')).ok).toBe(true);
    expect(objectStarts()).toEqual(['git cat-file --batch', 'git ls-tree -r -z origin/main -- docs/plans']);
  });

  it('answers failed, never empty, when the reader fails', async () => {
    const refs = refsGit(context(), undefined, await fakeHolder(() => failed()));

    expect(await refs.readBlobs([box.blob])).toEqual(failed());
    expect(await refs.listBlobs('origin/main', 'docs/plans')).toEqual(failed());
    expect(await refs.entriesAt('origin/main', ['run.sh'])).toEqual(failed());
    expect(await refs.showFile('origin/main', 'package.json')).toEqual(failed());
    expect(await refs.containsMany([{ ancestor: box.head, descendant: 'main' }])).toEqual(failed());
    expect(objectStarts()).toEqual([]);
  });

  it('runs every per-call git while the reader refuses', async () => {
    const refs = refsGit(context(), undefined, await fakeHolder(() => unaskable('paused')));

    expect(await readAll(refs)).toEqual(await readAll(refsGit(context(), undefined, objectReaders())));
  });

  it('answers failed for a tree that does not parse', async () => {
    const held = objectReaders();
    const commonDir = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const bad = { found: true, oid: box.head, type: 'tree', size: 3, body: Buffer.from('bad') } as const;
    held.install(commonDir, {
      contents: async () => answered([bad]),
      info: async () => answered([]),
      drops: () => [],
      holdsOpen: () => null,
      close: () => undefined,
    });

    expect(await refsGit(context(), undefined, held).entriesAt('origin/main', ['run.sh'])).toEqual(failed());
  });
});

describe('installObjectsReader', () => {
  const withGitVersion = async <T>(version: string, body: () => Promise<T>): Promise<T> => {
    const dir = fs.mkdtempSync(path.join(root, 'version-'));
    const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(
      path.join(dir, 'git'),
      `#!/bin/sh\n[ "$1" = "--version" ] && { echo "git version ${version}"; exit 0; }\nexec "${real}" "$@"\n`,
      { mode: 0o755 },
    );
    const before = process.env.PATH;
    process.env.PATH = `${dir}:${before ?? ''}`;
    try {
      return await body();
    } finally {
      process.env.PATH = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('refuses git 2.41.0 by name and installs nothing', async () => {
    const held = objectReaders();
    const done = await withGitVersion('2.41.0', () => installObjectsReader(repo, { readers: held }));

    expect(done).toEqual({ installed: false, why: 'git-version', refusal: 'plot needs git 2.42 or later for its object reader; found git 2.41.0' });
    expect(held.empty()).toBe(true);
  });

  it('installs on git 2.42.0, keyed by the common git directory', async () => {
    const held = objectReaders();
    const done = await withGitVersion('2.42.0', () => installObjectsReader(repo, { readers: held, timeoutMs: 5_000 }));
    if (done.installed) readers.push(done.reader);

    expect(done.installed).toBe(true);
    expect(done.installed && held.readerFor(done.commonDir)).toBe(done.installed && done.reader);
  });

  it('refuses a directory git names no git directory for', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-no-repo-'));
    try {
      const done = await installObjectsReader(outside, { readers: objectReaders() });
      expect(done).toEqual({ installed: false, why: 'no-git-directory', refusal: `plot found no git directory for ${outside}` });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('starts a reader whose process holds nothing open', async () => {
    const done = await installObjectsReader(repo, { readers: objectReaders() });
    if (!done.installed) throw new Error(done.refusal);
    readers.push(done.reader);

    expect(done.reader.holdsOpen()).toBeNull();
    await done.reader.contents([box.blob]);
    expect(done.reader.holdsOpen()).toBe(false);
  });
});

describe('objectReaders', () => {
  it('closes the reader it replaces and the one it removes', () => {
    const closed: string[] = [];
    const fake = (name: string): ObjectsBatch => ({
      contents: async () => answered([]),
      info: async () => answered([]),
      drops: () => [],
      holdsOpen: () => null,
      close: () => closed.push(name),
    });
    const held = objectReaders();
    const first = fake('first');
    held.install('/x/.git', first);
    held.install('/x/.git', first);
    held.install('/x/.git', fake('second'));
    held.remove('/x/.git');
    held.remove('/y/.git');

    expect(closed).toEqual(['first', 'second']);
    expect(held.empty()).toBe(true);
    expect(held.readerFor('/x/.git')).toBeUndefined();
  });
});
