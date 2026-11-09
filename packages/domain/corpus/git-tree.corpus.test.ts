import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

import { listBlobsThrough, objectsBatch } from '../src/adapters/refs/objects-batch.js';
import type { TreeBlob } from '../src/ports/refs.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE TREE PARSER AGAINST GIT: does `listBlobsThrough`, which reads tree
 * objects through one `git cat-file --batch-command` and parses them with
 * `rules/git-tree.ts`, list what `git ls-tree -r` lists?
 *
 * The tree format is a git rule this code repeats, so the pair is a declared
 * duplicate. NEITHER SIDE IS AUTHORITATIVE: on a disagreement the branch stops,
 * and adjusting either side to make this pass is the one move forbidden.
 *
 * Compared at `origin/main` and at every `origin/idea/*` tip of this
 * repository, over the repository root and the plan directories. `ls-tree`
 * runs with `-z`, so both sides name a path verbatim.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const SIDES: Sides = { left: 'batch', right: 'ls-tree' };
const report = describingAs(SIDES);

/** The directories production lists: the plan directory and its indexes, and the whole tree. */
const DIRS: readonly string[] = ['', 'docs/plans', 'docs/plans/active', 'docs/plans/delivered', 'docs/sprints'];

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** `git ls-tree -r -z <commit> -- <dir>`, as blobs. */
const lsTree = (commit: string, dir: string): readonly TreeBlob[] =>
  git('ls-tree', '-r', '-z', commit, ...(dir === '' ? [] : ['--', dir]))
    .split('\0')
    .flatMap((record) => {
      const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
      return m && m[2] === 'blob' ? [{ mode: m[1]!, sha: m[3]!, path: m[4]! }] : [];
    });

/** The refs compared: `origin/main` and every `origin/idea/*`. */
const refs = (): readonly string[] => [
  'origin/main',
  ...git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/idea/')
    .split('\n')
    .filter(Boolean),
];

const reader = objectsBatch({ repoRoot: ROOT });

afterAll(() => reader.close());

describe('git-tree corpus: listBlobsThrough against git ls-tree -r', () => {
  it('lists every blob, with its mode and oid, in ls-tree order, at origin/main and every origin/idea/* tip', async () => {
    const found: Disagreement[] = [];
    let compared = 0;
    let blobs = 0;
    for (const ref of refs()) {
      const commit = git('rev-parse', `${ref}^{commit}`).trim();
      for (const dir of DIRS) {
        const subject = `${ref} ${dir === '' ? '.' : dir}`;
        const theirs = lsTree(commit, dir);
        const mine = await listBlobsThrough(reader, commit, dir);
        compared += 1;
        if (!mine.ok) {
          compareField(found, subject, 'listBlobs', mine.why, `${theirs.length} blobs`);
          continue;
        }
        blobs += theirs.length;
        const left = new Map(mine.value.map((blob) => [blob.path, `${blob.mode} ${blob.sha}`]));
        const right = new Map(theirs.map((blob) => [blob.path, `${blob.mode} ${blob.sha}`]));
        for (const path of new Set([...left.keys(), ...right.keys()])) {
          compareField(found, `${ref} ${path}`, 'listBlobs', left.get(path) ?? 'absent', right.get(path) ?? 'absent');
        }
        if (left.size === right.size) {
          compareField(found, subject, 'order', mine.value.map((blob) => blob.path), theirs.map((blob) => blob.path));
        }
      }
    }
    expect(found.map(report)).toEqual([]);
    // A comparison over nothing proves nothing.
    expect(compared).toBeGreaterThanOrEqual(DIRS.length);
    expect(blobs).toBeGreaterThan(100);
  });
});
