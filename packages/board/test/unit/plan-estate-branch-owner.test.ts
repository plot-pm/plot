import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePersonDirectory } from '@plot-pm/domain';
import { planEstate } from '../../src/server/board.js';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';
import { rowsForReader, readerFrom } from '../../src/app/lib/agent-rows/mine-filter.js';
import { rmTree } from '../helpers.mjs';

// THE CASE #2389 REPORTS: a Draft plan that exists only on its `idea/` branch,
// naming another person as assignee. `planEstate` runs over a real repository
// and the real `plot-plan-meta.sh`, so the map under test is the one the server
// builds, not one the test hands in.

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
  '# Branch-only plan',
  '',
  '## Status',
  '',
  '- **Phase:** Draft',
  '- **Type:** bug',
  '- **Assignee:** Christian Kehl',
  '',
  '## Slices',
  '',
  '### Only',
  '',
  '- `bug/branch-only` — the work',
  '',
].join('\n');

/** A repo whose `origin/main` carries no plan and whose `origin/idea/branch-only` carries one. */
const fixture = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-estate-branch-'));
  trackedTempPaths.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# Fixture\n\n## Plot Config\n\n- **Branch prefixes:** idea/, bug/\n- **Plan directory:** docs/plans/\n- **Main branch:** main\n',
  );
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '.keep'), '');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'idea/branch-only');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-10-17-branch-only.md'), DRAFT);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'plan');
  git(dir, 'update-ref', 'refs/remotes/origin/idea/branch-only', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'branch', '-q', '-D', 'idea/branch-only');
  return dir;
};

describe('planEstate reads owner fields from a plan that exists only on a branch', () => {
  it('names the branch-only plan\'s assignee in fieldsBySlug, and leaves its status out', async () => {
    const repoRoot = fixture();
    const estate = await planEstate({ repoRoot, scriptsDir: SCRIPTS_DIR }, null, true);
    expect(estate.fieldsBySlug.get('branch-only')).toEqual({
      assignee: 'Christian Kehl', author: '', approver: '',
    });
    // The status, Draft list and spike answers keep the population they had.
    expect(estate.statusBySlug.has('branch-only')).toBe(false);
    expect(estate.draftPlans).toEqual([]);
  });

  it('hides the plan\'s no-PR row from a reader the assignee does not name', async () => {
    const repoRoot = fixture();
    const { fieldsBySlug } = await planEstate({ repoRoot, scriptsDir: SCRIPTS_DIR }, null, true);
    const pulse: FleetReading = {
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: '2026-10-17-branch-only.md',
        slices: [{
          name: 'Only',
          verdict: 'blocked',
          branches: [{
            branch: 'bug/branch-only', state: 'none', deferred: false,
            claimed: '', local_dirty: false, local_worktree: '',
          }],
        }],
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 1, deferred: 0 },
    } as FleetReading;
    const rows = rowsFromPulse(
      pulse, new Map(), 'plot', 30,
      /* prs */ null, /* urlBase */ '', /* approvedAt */ null, /* now */ Date.now(),
      /* ideaPlans */ null, /* versions */ null, /* runs */ null, /* questions */ null,
      /* prsByHeadMap */ null, /* repoRoot */ '', /* sprintOf */ null, /* unmerged */ null,
      /* supervision */ undefined, /* tipAt */ null, /* prAt */ null, /* phaseMap */ undefined,
      /* approvedSpikes */ null, fieldsBySlug,
    ).filter((r) => r.branch === 'bug/branch-only');
    expect(rows).toHaveLength(1);
    expect(rows[0].assignee).toBe('Christian Kehl');
    const directory = parsePersonDirectory('jwloka = Jan Wloka; ckehl = Christian Kehl');
    expect(rowsForReader(rows, readerFrom({ hostUser: 'jwloka', people: directory }), 'mine-and-unknown')).toHaveLength(0);
    expect(rowsForReader(rows, readerFrom({ hostUser: 'ckehl', people: directory }), 'mine-and-unknown')).toHaveLength(1);
  });
});
