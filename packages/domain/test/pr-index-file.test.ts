import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectorFile, prIndexFile, PR_INDEX_HOME_ENV } from '../src/adapters/pr-index/pr-index-file.js';
import { PR_INDEX_VERSION, type PrIndex, type PrIndexRow } from '../src/entities/pr-index.js';

/** Runs git quietly in a directory. */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let root: string;
/** The main checkout. */
let main: string;
/** A linked worktree, standing in for a dispatch desk. */
let desk: string;

const row = (number: number, over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number,
  head: `feature/b${number}`,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: '',
  ...over,
});

const store = (rows: readonly PrIndexRow[], over: Partial<PrIndex> = {}): PrIndex => ({
  v: PR_INDEX_VERSION,
  connector: 'github',
  watermark: null,
  complete: true,
  at: '2026-09-21T10:00:00Z',
  rows: [...rows],
  ...over,
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-pr-index-'));
  main = join(root, 'checkout');
  mkdirSync(main, { recursive: true });
  git(main, 'init', '--quiet', '--initial-branch=main');
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'Test');
  writeFileSync(join(main, 'README.md'), 'x\n');
  git(main, 'add', 'README.md');
  git(main, 'commit', '--quiet', '-m', 'init');
  desk = join(root, 'desks', 'feature-a');
  git(main, 'worktree', 'add', '--quiet', '-b', 'feature/a', desk);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the store path', () => {
  // THE MEASUREMENT THIS ADAPTER EXISTS SEPARATELY FOR, taken 2026-09-15:
  //   --show-toplevel   → …/.worktrees/feature-…   ← the DESK
  //   --git-common-dir  → …/plot/.git              ← shared
  // `plot-reap.sh` runs `git worktree remove --force` over the desks, so a
  // store written to one is destroyed by the reaper on the machine that
  // measured it, with every gate green — a test run only in the main checkout
  // cannot see the difference.
  it('resolves to the SAME file from a dispatch desk and from the main checkout', async () => {
    const fromMain = await prIndexFile({ cwd: main, env: {} }).location('github');
    const fromDesk = await prIndexFile({ cwd: desk, env: {} }).location('github');
    expect(fromMain.ok).toBe(true);
    expect(fromDesk.ok).toBe(true);
    // The paths are compared through their PARENT's realpath, and the parent is
    // the `.git` directory, which exists. `realpathSync` on the store file
    // itself would answer ENOENT — nothing has written yet — and comparing the
    // raw strings fails on macOS, where `/var` is a symlink to `/private/var`:
    // git answers `--git-common-dir` RELATIVELY in the main checkout and
    // ABSOLUTELY in a linked worktree, so one side arrives already resolved.
    // That difference in shape is precisely why the adapter resolves the
    // answer against the cwd rather than trusting it.
    // `.git` is the deepest ancestor that EXISTS before anything is written,
    // so it is the one `realpathSync` can answer for; the four segments below
    // it are the adapter's own and compared as text.
    const gitDir = `${join('.git', '.plot', 'state', 'index')}${sep}`;
    const settled = (path: string): string => {
      const cut = path.lastIndexOf(gitDir);
      return join(realpathSync(path.slice(0, cut)), path.slice(cut));
    };
    expect(fromDesk.ok && settled(fromDesk.value)).toBe(
      fromMain.ok ? settled(fromMain.value) : '',
    );

    // And the trap this avoids: the desk's own toplevel is NOT the main
    // checkout, so a store keyed on `--show-toplevel` would sit in a tree
    // `plot-reap.sh` removes with `--force`.
    const deskTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: desk, encoding: 'utf8',
    }).trim();
    expect(realpathSync(deskTop)).not.toBe(realpathSync(main));
    expect(fromMain.ok && fromMain.value.startsWith(realpathSync(deskTop))).toBe(false);
  });

  it('is under the common git dir\'s .plot/state/index, which .gitignore already covers', async () => {
    const where = await prIndexFile({ cwd: main, env: {} }).location('github');
    expect(where.ok).toBe(true);
    // `.plot/state/` is gitignored at `.gitignore:30` and `:35`. The store sits
    // INSIDE it deliberately: adding an ignore rule under a different path is
    // how a store ends up committed, describing another machine's account.
    if (where.ok) expect(where.value).toContain(join('.plot', 'state', 'index'));
  });

  it('gives each connector its own file', async () => {
    const adapter = prIndexFile({ cwd: main, env: {} });
    const gh = await adapter.location('github');
    const bb = await adapter.location('bitbucket');
    expect(gh.ok && bb.ok && gh.value !== bb.value).toBe(true);
  });

  it('reduces a connector name to one path segment', () => {
    // The name reaches this from `## Plot Config`, written by hand. A value
    // carrying a separator would place the store outside the directory chosen
    // for it.
    expect(connectorFile('github')).toBe('github.json');
    expect(connectorFile('GitHub')).toBe('github.json');
    expect(connectorFile('../../etc/passwd')).not.toContain('/');
    expect(connectorFile('../../etc/passwd')).not.toContain('..');
    expect(connectorFile('')).toBe('unknown.json');
  });
});

describe('a cold store', () => {
  // THE DONE-WHEN: a cold store behaves exactly as today. No file means one
  // full read, no error surfaced to the operator.
  it('reads a missing file as nothing to start from, not as a failure', async () => {
    const home = join(root, 'cold');
    const read = await prIndexFile({ home, env: {} }).read('github');
    expect(read).toEqual({ ok: true, value: null });
  });

  it('reads an unrecognised version as nothing to start from and does not throw', async () => {
    // Catches version handling that only tolerates the version it was written
    // against; the NEXT schema change would then take the board down rather
    // than cost it one read.
    const home = join(root, 'future');
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'github.json'),
      JSON.stringify({ ...store([row(1)]), v: PR_INDEX_VERSION + 1 }),
    );
    const adapter = prIndexFile({ home, env: {} });
    await expect(adapter.read('github')).resolves.toEqual({ ok: true, value: null });
  });

  it('reads a torn file as nothing to start from', async () => {
    const home = join(root, 'torn');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'github.json'), '{"v":1,"rows":[{"num');
    await expect(prIndexFile({ home, env: {} }).read('github'))
      .resolves.toEqual({ ok: true, value: null });
  });
});

describe('a failed write', () => {
  // THE DONE-WHEN: a failed write leaves the board working. A read-only
  // filesystem or a full disk must cost time, not answers.
  it('answers failed rather than throwing', async () => {
    const home = join(root, 'readonly');
    mkdirSync(home, { recursive: true });
    chmodSync(home, 0o500);
    try {
      const written = await prIndexFile({ home, env: {} }).write('github', store([row(1)]));
      expect(written.ok).toBe(false);
      expect(existsSync(join(home, 'github.json'))).toBe(false);
    } finally {
      chmodSync(home, 0o700);
    }
  });

  it('answers failed where no git dir can be resolved', async () => {
    const nowhere = mkdtempSync(join(tmpdir(), 'plot-not-a-repo-'));
    try {
      const adapter = prIndexFile({ cwd: nowhere, env: {} });
      // A directory outside any repository has no common git dir, so there is
      // nowhere to put the store. It answers rather than guessing at a path.
      const where = await adapter.location('github');
      const read = await adapter.read('github');
      const written = await adapter.write('github', store([row(1)]));
      expect([where.ok, read.ok, written.ok]).toEqual([false, false, false]);
    } finally {
      rmSync(nowhere, { recursive: true, force: true });
    }
  });
});

describe('the round trip', () => {
  it('writes a store and reads back exactly what it wrote', async () => {
    const home = join(root, 'round');
    const adapter = prIndexFile({ home, env: {} });
    const original = store([row(1, { updatedAt: '2026-09-20T00:00:00Z' }), row(2)], {
      watermark: '2026-09-20T00:00:00Z',
    });
    expect((await adapter.write('github', original)).ok).toBe(true);
    await expect(adapter.read('github')).resolves.toEqual({ ok: true, value: original });
  });

  it('leaves no temp file behind', async () => {
    // The write is temp-then-rename so a board killed mid-write leaves the
    // previous whole store rather than a truncated one. A temp file surviving a
    // SUCCESSFUL write would accumulate one per refresh.
    const home = join(root, 'temp');
    const adapter = prIndexFile({ home, env: {} });
    await adapter.write('github', store([row(1)]));
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(home)).toEqual(['github.json']);
  });

  it('replaces the file rather than appending to it', async () => {
    const home = join(root, 'replace');
    const adapter = prIndexFile({ home, env: {} });
    await adapter.write('github', store([row(1), row(2), row(3)]));
    await adapter.write('github', store([row(9)]));
    const read = await adapter.read('github');
    expect(read.ok && read.value?.rows.map((r) => r.number)).toEqual([9]);
  });

  it('is readable as pretty JSON, so an operator can diff it', async () => {
    const home = join(root, 'pretty');
    const adapter = prIndexFile({ home, env: {} });
    await adapter.write('github', store([row(1)]));
    const text = readFileSync(join(home, 'github.json'), 'utf8');
    expect(text).toContain(`\n  "v": ${PR_INDEX_VERSION}`);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('the environment seam', () => {
  it('honours the home override, so a suite never touches the operator\'s store', async () => {
    const home = join(root, 'env-seam');
    const adapter = prIndexFile({ cwd: main, env: { [PR_INDEX_HOME_ENV]: home } });
    const where = await adapter.location('github');
    expect(where.ok && where.value).toBe(join(home, 'github.json'));
  });
});
