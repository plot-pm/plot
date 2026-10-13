import { afterEach, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { buildBoard } from '../../src/server/board.js';
import { lastCompletePulseFor, stopFleetRefresh } from '../../src/server/fleet.js';

// A tracer plan whose every slice merged reads `proven` and stays in Design, and
// its card still offers Deliver. A non-tracer plan with the same pulse reads
// `deliverable` and moves to Testing. Here `proven` is the PlanStatus value,
// not the branch reading `plot-merge-subject.mjs proven` reports.

const REAL_SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const temps: string[] = [];
afterEach(() => {
  stopFleetRefresh();
  for (const d of temps.splice(0)) rmTree(d);
});

const planFile = (title: string, tracer: boolean) => [
  `# ${title}`, '', '## Status', '',
  '- **State:** Approved',
  '- **Type:** feature',
  ...(tracer ? ['- **Tracer:** yes'] : []),
  '', '## Slices', '',
  '### One', '',
  '- `feature/one` — a branch',
  '', '## Changelog', '', '- a plan', '',
].join('\n');

const planOf = (file: string) => ({
  file,
  phase: 'approved',
  slices: [{
    name: 'One',
    verdict: 'complete',
    branches: [{
      branch: 'feature/one', state: 'merged', deferred: false, claimed: '',
      local_dirty: false, local_worktree: '',
    }],
  }],
});

const fixture = () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-proven-'));
  temps.push(parent);
  const repoRoot = path.join(parent, 'repo');
  const scripts = path.join(parent, 'scripts');
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  const files = { tracer: '2026-10-01-a-tracer-plan.md', plain: '2026-10-01-a-plain-plan.md' };
  fs.writeFileSync(path.join(repoRoot, 'docs/plans', files.tracer), planFile('A tracer plan', true), 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'docs/plans', files.plain), planFile('A plain plan', false), 'utf8');
  const plans = [planOf(files.tracer), planOf(files.plain)];
  const reading = {
    main: 'main', head: 'abc1234', read_ref: 'abc1234', local_head: 'abc1234', plans,
    summary: { plans: 2, waves: 2, branches: 2, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  };
  const lines = [
    ...plans.map((plan) => JSON.stringify({ kind: 'plan', plan })),
    JSON.stringify({ kind: 'reading', reading }),
  ].map((l) => `printf '%s\\n' ${JSON.stringify(l)}`).join('\n');
  const scan = path.join(scripts, 'plot-fleet-scan.sh');
  fs.writeFileSync(scan, `#!/usr/bin/env bash\n${lines}\nexit 0\n`);
  fs.chmodSync(scan, 0o755);
  for (const helper of fs.readdirSync(REAL_SCRIPTS)) {
    if (helper === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, helper), path.join(scripts, helper));
  }
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  return { repoRoot, scriptsDir: scripts };
};

const until = async <T>(read: () => T, want: (v: T) => boolean): Promise<T> => {
  const stop = Date.now() + 30_000;
  for (;;) {
    const v = read();
    if (want(v)) return v;
    if (Date.now() > stop) throw new Error('timed out waiting for the first scan to finish');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('a proven tracer plan', () => {
  it('stays in Design, offers Deliver, and leaves a plain plan in Testing', async () => {
    const opts = fixture();
    await until(() => lastCompletePulseFor(opts), Boolean);
    const cards = (await buildBoard(opts)).columns.flatMap((col) => col.cards);
    const tracer = cards.find((c) => c.slug === 'a-tracer-plan');
    const plain = cards.find((c) => c.slug === 'a-plain-plan');
    expect(tracer?.status).toBe('proven');
    expect(tracer?.deliverable).toBe(true);
    expect(tracer?.phase).toBe('Design');
    expect(plain?.status).toBe('deliverable');
    expect(plain?.deliverable).toBe(true);
    expect(plain?.phase).toBe('Testing');
  }, 60_000);
});
