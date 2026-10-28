import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planEstate } from '../../src/server/board.js';
import { rmTree } from '../helpers.mjs';

// THE DEFECT: a Draft plan's `DraftPlan` object carried no owner fields, so
// «Mine» could not tell whose it was and left every Draft row visible
// regardless of ownership. `fieldsBySlug` already computed `assignee`,
// `author` and `approver` for every plan including Draft ones — this proves
// the same values reach the `DraftPlan` object `planEstate` returns, not just
// the map beside it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

const trackedTempPaths: string[] = [];
afterAll(() => {
  for (const dir of trackedTempPaths) {
    try { rmTree(dir); } catch { /* a sandbox already gone is the wanted state */ }
  }
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const DRAFT = [
  '# A plan on the default branch',
  '',
  '## Status',
  '',
  '- **Phase:** Draft',
  '- **Type:** bug',
  '- **Assignee:** Christian Kehl',
  '- **Approved:** 2026-10-28, Jan Wloka',
  '',
  '## Slices',
  '',
].join('\n');

/** A repo whose `origin/main` already carries a Draft plan. */
const fixture = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-rows-obey-mine-'));
  trackedTempPaths.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'author@example.com');
  git(dir, 'config', 'user.name', 'Plan Author');
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# Fixture\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Main branch:** main\n',
  );
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-10-28-on-default.md'), DRAFT);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'add plan');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
};

describe('a Draft plan on the default branch carries its owner fields into DraftPlan', () => {
  it('passes assignee and approver through, computed the same way fieldsBySlug is', async () => {
    const repoRoot = fixture();
    const estate = await planEstate({ repoRoot, scriptsDir: SCRIPTS_DIR }, null, true);
    const fields = estate.fieldsBySlug.get('on-default');
    expect(fields).toEqual({ assignee: 'Christian Kehl', author: 'Plan Author', approver: 'Jan Wloka' });

    expect(estate.draftPlans).toHaveLength(1);
    const draft = estate.draftPlans[0];
    expect(draft.plan).toBe('on-default');
    // THE DEFECT, caught: the fields computed upstream in `fieldsBySlug` must
    // reach the `DraftPlan` object too, not stay dropped on the floor.
    expect(draft.assignee).toBe(fields!.assignee);
    expect(draft.author).toBe(fields!.author);
    expect(draft.approver).toBe(fields!.approver);
  });
});
