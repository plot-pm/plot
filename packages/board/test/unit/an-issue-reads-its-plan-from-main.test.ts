import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters';
import type { TreeBlob } from '@plot-pm/domain/ports/refs';

import type { BuildBoardOptions } from '../../src/server/board.js';
import { planMetasAtDefault } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

/**
 * `planMetasAtDefault` READS EVERY PLAN FROM `origin/<default>`, NOT THE
 * WORKING TREE (#2997).
 *
 * A local checkout goes stale the moment a plan merges — reading the working
 * tree answers "which plans name this issue" from whatever the worktree last
 * fetched. These cases exercise the helper directly against a `refsFixture`,
 * which lets each one state what `origin/main` holds independently of what
 * `repoRoot`'s plan directory on disk holds.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const CLAUDE_MD = '# Fixture\n\n## Plot Config\n\n'
  + '- **Branch prefixes:** idea/\n'
  + '- **Plan directory:** docs/plans/\n'
  + '- **Main branch:** main\n';

const plan = (title: string, phase: string, issue: number): string => [
  `# ${title}`,
  '',
  '## Status',
  `- **Phase:** ${phase}`,
  '- **Type:** bug',
  `- **Issue:** #${issue}`,
  '',
  '## Branches',
  '',
  '- `bug/the-fix` — the fix',
  '',
].join('\n');

const made: string[] = [];
const estate = (): { repoRoot: string; scriptsDir: string } => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-from-main-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), CLAUDE_MD, 'utf8');
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
};

afterEach(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

const blob = (blobPath: string, sha: string): TreeBlob => ({ mode: '100644', sha, path: blobPath });

const MAIN_TIP = 'b'.repeat(40);
const PLAN_PATH = 'docs/plans/2026-10-30-the-fix.md';

describe('planMetasAtDefault', () => {
  it('answers null where origin/main resolves but the parse call itself fails — not an empty list', async () => {
    const opts: BuildBoardOptions = {
      // `scriptsDir` names a directory with no `plot-plan-meta.sh` at all, so
      // the staged blob cannot be parsed — the same failure shape a broken
      // or missing script gives, surfacing through the same `catch` branch a
      // `cat-file --batch` framing error would.
      repoRoot: estate().repoRoot,
      scriptsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plan-from-main-no-scripts-')),
      refs: refsFixture({
        shas: { 'origin/main': MAIN_TIP },
        trees: { [MAIN_TIP]: [blob(PLAN_PATH, 'sha-plan')] },
        blobs: { 'sha-plan': plan('The fix', 'Approved', 2997) },
      }),
    };
    made.push(opts.scriptsDir);
    const metas = await planMetasAtDefault(opts);
    expect(metas).toBeNull();
  });

  it('reads a plan naming an issue from origin/main even though the working tree holds nothing', async () => {
    const opts: BuildBoardOptions = {
      ...estate(),
      refs: refsFixture({
        shas: { 'origin/main': MAIN_TIP },
        trees: { [MAIN_TIP]: [blob(PLAN_PATH, 'sha-plan')] },
        blobs: { 'sha-plan': plan('The fix', 'Approved', 2997) },
      }),
    };
    // The working tree's docs/plans is empty — estate() only mkdir's it.
    const metas = await planMetasAtDefault(opts);
    expect(metas).not.toBeNull();
    expect(metas?.map((m) => m.issues)).toEqual([[2997]]);
  });

  it('caches on the resolved oid: a second read at the same tip costs no second parse', async () => {
    const opts: BuildBoardOptions = {
      ...estate(),
      refs: refsFixture({
        shas: { 'origin/main': MAIN_TIP },
        trees: { [MAIN_TIP]: [blob(PLAN_PATH, 'sha-plan')] },
        blobs: { 'sha-plan': plan('The fix', 'Approved', 2997) },
      }),
    };
    const first = await planMetasAtDefault(opts);
    // A second call still resolves `origin/main` to the SAME oid, but states
    // no tree for it — a re-parse would list zero blobs and answer `[]`.
    // Getting `first` back instead proves the cache short-circuited before
    // `listBlobs` ran at all.
    const sameOidNoTree = refsFixture({ shas: { 'origin/main': MAIN_TIP } });
    const second = await planMetasAtDefault({ ...opts, refs: sameOidNoTree });
    expect(second).toEqual(first);
  });

  it('forces a second parse once the tip moves to a new commit', async () => {
    const base = estate();
    const before: BuildBoardOptions = {
      ...base,
      refs: refsFixture({
        shas: { 'origin/main': MAIN_TIP },
        trees: { [MAIN_TIP]: [blob(PLAN_PATH, 'sha-plan')] },
        blobs: { 'sha-plan': plan('The fix', 'Approved', 2997) },
      }),
    };
    await planMetasAtDefault(before);

    const NEW_TIP = 'c'.repeat(40);
    const NEW_PLAN_PATH = 'docs/plans/2026-10-31-the-other-fix.md';
    const after: BuildBoardOptions = {
      ...base,
      refs: refsFixture({
        shas: { 'origin/main': NEW_TIP },
        trees: { [NEW_TIP]: [blob(NEW_PLAN_PATH, 'sha-other')] },
        blobs: { 'sha-other': plan('The other fix', 'Approved', 3001) },
      }),
    };
    const metas = await planMetasAtDefault(after);
    expect(metas?.map((m) => m.issues)).toEqual([[3001]]);
  });

  it('keeps a Released plan\'s issue named', async () => {
    const opts: BuildBoardOptions = {
      ...estate(),
      refs: refsFixture({
        shas: { 'origin/main': MAIN_TIP },
        trees: { [MAIN_TIP]: [blob(PLAN_PATH, 'sha-plan')] },
        blobs: { 'sha-plan': plan('The fix', 'Released', 2997) },
      }),
    };
    const metas = await planMetasAtDefault(opts);
    expect(metas).toHaveLength(1);
    expect(metas?.[0]?.phase).toBe('released');
    expect(metas?.[0]?.issues).toEqual([2997]);
  });

  it('falls back to the working tree where origin/main cannot be resolved — no remote, never fetched', async () => {
    const base = estate();
    fs.writeFileSync(path.join(base.repoRoot, PLAN_PATH), plan('The fix', 'Approved', 2997), 'utf8');
    const opts: BuildBoardOptions = {
      ...base,
      refs: refsFixture({}), // resolve() fails for every ref — no shas stated
    };
    const metas = await planMetasAtDefault(opts);
    expect(metas?.map((m) => m.issues)).toEqual([[2997]]);
  });
});
